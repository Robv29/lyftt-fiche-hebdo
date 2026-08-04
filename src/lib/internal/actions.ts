"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/supabase/env";
import { generateReviewToken } from "@/lib/domain/tokens";
import { canTransition } from "@/lib/domain/workflow";
import { checkExportBeforeSend } from "@/lib/domain/edge-cases";
import { sanitizeText } from "@/lib/security/sanitize";
import type { TicketStatus } from "@/lib/domain/types";

export interface InternalActionResult {
  ok: boolean;
  message?: string;
  /** Token en clair, affiché une seule fois à la génération du lien. */
  reviewUrl?: string;
  /** Avertissement à confirmer avant de poursuivre (§14). */
  warning?: string;
}

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Non authentifié.");
  return profile;
}

// ---------------------------------------------------------------------------
// §2 — Génération d'un lien de consultation
// ---------------------------------------------------------------------------

export async function generateReviewLink(
  sheetId: string,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  // La lecture passe par RLS : on vérifie ainsi que l'utilisateur a bien accès.
  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select("id, current_version_id, status")
    .eq("id", sheetId)
    .maybeSingle();

  if (!sheet) return { ok: false, message: "Fiche introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();

  let versionId = sheet.current_version_id;
  if (!versionId) {
    // Pas encore de version : on gèle la version 1 avant d'exposer la fiche.
    const { data, error } = await admin.rpc("create_sheet_version", {
      target_sheet_id: sheetId,
      summary: "Version initiale envoyée au client",
      author: profile.id,
    });
    if (error) return { ok: false, message: "Impossible de figer la version initiale." };
    versionId = data as string;
  }

  // Un seul lien actif par fiche : l'ancien est révoqué (§2, §14).
  await admin
    .from("client_review_links")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "Nouveau lien généré" })
    .eq("weekly_sheet_id", sheetId)
    .is("revoked_at", null);

  const { token, tokenHash, tokenPrefix } = generateReviewToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.reviewLinkTtlDays);

  const { error } = await admin.from("client_review_links").insert({
    weekly_sheet_id: sheetId,
    sheet_version_id: versionId,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    expires_at: expiresAt.toISOString(),
    created_by: profile.id,
  });

  if (error) return { ok: false, message: "Le lien n'a pas pu être créé." };

  revalidatePath(`/fiches/${sheetId}`);
  return { ok: true, reviewUrl: `${env.appUrl}/client-review/${token}` };
}

export async function revokeReviewLink(
  linkId: string,
  sheetId: string,
  reason: string,
): Promise<InternalActionResult> {
  await requireProfile();
  const admin = createSupabaseAdminClient();

  await admin
    .from("client_review_links")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: sanitizeText(reason, 300) || "Révocation manuelle",
    })
    .eq("id", linkId);

  revalidatePath(`/fiches/${sheetId}`);
  return { ok: true, message: "Lien révoqué." };
}

// ---------------------------------------------------------------------------
// §4 — Enregistrement de l'envoi du message
// ---------------------------------------------------------------------------

const dispatchSchema = z.object({
  sheetId: z.string().uuid(),
  templateType: z.string(),
  channel: z.enum(["whatsapp", "email"]),
  body: z.string().min(1),
  recipientLabel: z.string().max(200).optional(),
});

export async function markMessageSent(
  formData: FormData,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const parsed = dispatchSchema.safeParse({
    sheetId: formData.get("sheetId"),
    templateType: formData.get("templateType"),
    channel: formData.get("channel"),
    body: formData.get("body"),
    recipientLabel: formData.get("recipientLabel") ?? undefined,
  });

  if (!parsed.success) return { ok: false, message: "Envoi non enregistrable." };

  const supabase = await createSupabaseServerClient();
  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select("id, current_version_id, status")
    .eq("id", parsed.data.sheetId)
    .maybeSingle();

  if (!sheet) return { ok: false, message: "Fiche introuvable." };

  const admin = createSupabaseAdminClient();
  await admin.from("client_message_dispatches").insert({
    weekly_sheet_id: parsed.data.sheetId,
    sheet_version_id: sheet.current_version_id,
    template_type: parsed.data.templateType,
    channel: parsed.data.channel,
    recipient_label: parsed.data.recipientLabel ?? null,
    rendered_body: parsed.data.body,
    sent_by: profile.id,
  });

  // La version envoyée est marquée comme telle, et la fiche change de statut.
  if (sheet.current_version_id) {
    await admin
      .from("weekly_sheet_versions")
      .update({ status: "sent", sent_to_client_at: new Date().toISOString() })
      .eq("id", sheet.current_version_id);
  }

  const nextStatus =
    sheet.status === "new_version_to_send" || sheet.status === "corrections_in_progress"
      ? "awaiting_revalidation"
      : "sent_to_client";

  await admin
    .from("weekly_sheets")
    .update({ status: nextStatus, sent_to_client_at: new Date().toISOString() })
    .eq("id", parsed.data.sheetId);

  revalidatePath(`/fiches/${parsed.data.sheetId}`);
  return { ok: true, message: "Envoi enregistré." };
}

// ---------------------------------------------------------------------------
// §10 — Transitions de ticket
// ---------------------------------------------------------------------------

export async function transitionTicket(
  formData: FormData,
): Promise<InternalActionResult> {
  const profile = await requireProfile();

  const ticketId = String(formData.get("ticketId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "") as TicketStatus;
  const reason = sanitizeText(String(formData.get("reason") ?? ""), 2000);

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("client_tickets")
    .select("id, status, weekly_sheet_id, weekly_sheet_item_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return { ok: false, message: "Ticket introuvable ou accès refusé." };

  const check = canTransition(ticket.status, nextStatus, profile.role);
  if (!check.allowed) return { ok: false, message: check.error };
  if (check.requiresReason && reason.length < 3) {
    return { ok: false, message: "Cette action demande une justification écrite." };
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === "internally_reviewed") updates.resolved_at = now;
  if (nextStatus === "closed") updates.closed_at = now;
  if (nextStatus === "reopened") {
    updates.reopened_at = now;
    updates.closed_at = null;
  }

  await admin.from("client_tickets").update(updates).eq("id", ticketId);

  if (reason) {
    await admin.from("client_ticket_comments").insert({
      ticket_id: ticketId,
      author_profile_id: profile.id,
      author_type: "staff",
      author_name: profile.full_name,
      visibility: "internal",
      body: reason,
    });
  }

  // Le contenu suit le ticket (§15).
  if (ticket.weekly_sheet_item_id) {
    const itemStatus =
      nextStatus === "internally_reviewed" || nextStatus === "new_version_generated"
        ? "corrected"
        : nextStatus === "sent_back_to_client"
          ? "resent"
          : nextStatus === "approved_by_client"
            ? "approved_after_fix"
            : null;

    if (itemStatus) {
      await admin
        .from("weekly_sheet_items")
        .update({ approval_status: itemStatus })
        .eq("id", ticket.weekly_sheet_item_id);
    }
  }

  // §24 — la réouverture d'un ticket alerte le responsable de production.
  if (nextStatus === "reopened") {
    const { data: counter } = await admin
      .from("client_tickets")
      .select("reopen_count")
      .eq("id", ticketId)
      .single();

    await admin
      .from("client_tickets")
      .update({ reopen_count: (counter?.reopen_count ?? 0) + 1 })
      .eq("id", ticketId);

    const { data: managers } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "production_manager")
      .eq("is_active", true);

    for (const manager of managers ?? []) {
      await admin.from("internal_notifications").insert({
        profile_id: manager.id,
        ticket_id: ticketId,
        title: "Ticket rouvert",
        body: reason,
      });
    }
  }

  revalidatePath(`/retours/${ticketId}`);
  revalidatePath("/retours");
  return { ok: true, message: "Ticket mis à jour." };
}

export async function addTicketComment(
  formData: FormData,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = sanitizeText(String(formData.get("body") ?? ""), 5000);
  const visibility = String(formData.get("visibility") ?? "internal");

  if (body.length < 2) return { ok: false, message: "Commentaire vide." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_ticket_comments").insert({
    ticket_id: ticketId,
    author_profile_id: profile.id,
    author_type: "staff",
    author_name: profile.full_name,
    visibility: visibility === "client_visible" ? "client_visible" : "internal",
    body,
  });

  if (error) return { ok: false, message: "Commentaire non enregistré." };

  revalidatePath(`/retours/${ticketId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// §11 / §14 — Génération d'une version corrigée
// ---------------------------------------------------------------------------

export async function generateCorrectedVersion(
  formData: FormData,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const sheetId = String(formData.get("sheetId") ?? "");
  const summary = sanitizeText(String(formData.get("summary") ?? ""), 500);
  const ticketId = formData.get("ticketId") ? String(formData.get("ticketId")) : null;

  const supabase = await createSupabaseServerClient();
  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select("id")
    .eq("id", sheetId)
    .maybeSingle();

  if (!sheet) return { ok: false, message: "Fiche introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();
  const { data: versionId, error } = await admin.rpc("create_sheet_version", {
    target_sheet_id: sheetId,
    summary: summary || "Version corrigée",
    author: profile.id,
    ticket: ticketId,
  });

  if (error) return { ok: false, message: "La version n'a pas pu être générée." };

  if (ticketId) {
    await admin
      .from("client_tickets")
      .update({ resolution_version_id: versionId, status: "new_version_generated" })
      .eq("id", ticketId);
  }

  await admin
    .from("weekly_sheets")
    .update({ status: "new_version_to_send" })
    .eq("id", sheetId);

  revalidatePath(`/fiches/${sheetId}`);
  return { ok: true, message: "Nouvelle version générée. L'ancien export est marqué obsolète." };
}

/** §14 — refuse silencieusement d'envoyer un export dépassé sans confirmation. */
export async function verifyExportBeforeSend(
  exportId: string,
): Promise<InternalActionResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from("sheet_exports")
    .select(
      "id, is_obsolete, weekly_sheet_id, weekly_sheet_versions:sheet_version_id ( version_number ), weekly_sheets:weekly_sheet_id ( current_version_id )",
    )
    .eq("id", exportId)
    .maybeSingle();

  if (!record) return { ok: false, message: "Export introuvable." };

  const version = record.weekly_sheet_versions as unknown as { version_number: number };
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from("weekly_sheet_versions")
    .select("version_number")
    .eq("weekly_sheet_id", record.weekly_sheet_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const check = checkExportBeforeSend(
    { isObsolete: record.is_obsolete, versionNumber: version.version_number },
    current?.version_number ?? version.version_number,
  );

  return {
    ok: true,
    warning: check.requiresConfirmation ? check.warning : undefined,
  };
}

// ---------------------------------------------------------------------------
// §8 — Alertes
// ---------------------------------------------------------------------------

/** Marquer comme lue ne ferme pas le ticket (§8). */
export async function markNotificationRead(
  notificationId: string,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("internal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("profile_id", profile.id);

  revalidatePath("/");
  return { ok: true };
}
