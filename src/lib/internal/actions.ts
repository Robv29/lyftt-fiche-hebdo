"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/supabase/env";
import { ensureRequestLink } from "@/lib/review/request-link";
import { generateReviewToken } from "@/lib/domain/tokens";
import { canTransition, contributorAssignment } from "@/lib/domain/workflow";
import { checkExportBeforeSend } from "@/lib/domain/edge-cases";
import { normalizeHashtags, sanitizeText } from "@/lib/security/sanitize";
import type { TicketStatus } from "@/lib/domain/types";
import { isServiceRequest, type TicketType } from "@/lib/domain/ticket-types";
import { whatsappLink } from "@/lib/domain/templates";
import { sheetCompletion } from "@/lib/domain/planning";
import {
  ACCESS_DENIED_MESSAGE,
  EDITORIAL_ROLES,
  resolveAccessibleSheet,
} from "@/lib/internal/authorization";
import type { MediaFormat } from "@/lib/domain/types";

export interface InternalActionResult {
  ok: boolean;
  message?: string;
  /** Token en clair, affiché une seule fois à la génération du lien. */
  reviewUrl?: string;
  /** Avertissement à confirmer avant de poursuivre (§14). */
  warning?: string;
  /** Message prêt à copier après préparation d'une correction. */
  messageBody?: string;
  /** Destination WhatsApp avec le message prérempli. */
  whatsappUrl?: string;
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
    .select(`id, current_version_id, status,
      weekly_sheet_items ( caption, hashtags, format, media_asset_id, media_external_url, is_cancelled )`)
    .eq("id", sheetId)
    .maybeSingle();

  if (!sheet) return { ok: false, message: "Fiche introuvable ou accès refusé." };

  const completion = sheetCompletion((sheet.weekly_sheet_items ?? []).map((item) => ({
    caption: item.caption,
    hashtags: item.hashtags,
    format: item.format as MediaFormat,
    mediaAssetId: item.media_asset_id,
    mediaExternalUrl: item.media_external_url,
    isCancelled: item.is_cancelled,
  })));
  if (completion.percentage < 100) {
    return { ok: false, message: `Complétez la fiche à 100 % avant de générer le lien client (${completion.percentage} % actuellement).` };
  }

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

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.reviewLinkTtlDays);

  /*
   * On réutilise le lien déjà actif au lieu d'en fabriquer un nouveau.
   * Regénérer révoquait l'adresse que le client avait déjà reçue : elle
   * mourait au bout de quelques heures alors qu'elle devait tenir la semaine.
   * On se contente donc de le rattacher à la version courante et de repousser
   * son échéance — le client garde la même adresse.
   */
  const { data: active } = await admin
    .from("client_review_links")
    .select("id, token")
    .eq("weekly_sheet_id", sheetId)
    .is("revoked_at", null)
    .maybeSingle();

  if (active?.token) {
    const { error: refreshError } = await admin
      .from("client_review_links")
      .update({
        sheet_version_id: versionId,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id);
    if (refreshError) return { ok: false, message: "Le lien n'a pas pu être prolongé." };

    revalidatePath(`/fiches/${sheetId}`);
    return { ok: true, reviewUrl: `${env.appUrl}/client-review/${active.token}` };
  }

  // Lien d'avant cette bascule (token non conservé) : on le remplace une fois.
  if (active) {
    await admin
      .from("client_review_links")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "Nouveau lien généré" })
      .eq("id", active.id);
  }

  const { token, tokenHash, tokenPrefix } = generateReviewToken();

  const { error } = await admin.from("client_review_links").insert({
    weekly_sheet_id: sheetId,
    sheet_version_id: versionId,
    token,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    expires_at: expiresAt.toISOString(),
    created_by: profile.id,
  });

  if (error) return { ok: false, message: "Le lien n'a pas pu être créé." };

  revalidatePath(`/fiches/${sheetId}`);
  return { ok: true, reviewUrl: `${env.appUrl}/client-review/${token}` };
}

/**
 * Révocation d'un lien de consultation client.
 *
 * L'action n'exigeait qu'une session : n'importe quel compte connecté pouvait
 * révoquer n'importe quel lien à partir de son seul identifiant, sans que la
 * fiche concernée soit dans son périmètre. L'écriture passe par la clé
 * service, donc la RLS ne rattrapait rien.
 *
 * Deux barrières désormais : un rôle éditorial, et une fiche que la personne
 * voit réellement — lecture faite avec le client soumis à RLS, comme partout
 * ailleurs, pour que la politique SQL reste seule juge du périmètre.
 */
export async function revokeReviewLink(
  linkId: string,
  sheetId: string,
  reason: string,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!EDITORIAL_ROLES.includes(profile.role)) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  const sheet = await resolveAccessibleSheet(sheetId);
  if (!sheet) return { ok: false, message: ACCESS_DENIED_MESSAGE };

  const admin = createSupabaseAdminClient();

  await admin
    .from("client_review_links")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: sanitizeText(reason, 300) || "Révocation manuelle",
    })
    .eq("id", linkId)
    // Le lien doit appartenir à la fiche : un identifiant emprunté à un autre
    // client ne doit pas se révoquer par ce chemin.
    .eq("weekly_sheet_id", sheet.id);

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

// ---------------------------------------------------------------------------
// Parcours simplifié : corriger → préparer le lien → ouvrir WhatsApp
// ---------------------------------------------------------------------------

const correctionSchema = z.object({
  ticketId: z.string().uuid(),
  sheetId: z.string().uuid(),
  itemId: z.string().uuid().optional().or(z.literal("")),
  caption: z.string().max(5000),
  hashtags: z.string().max(1000),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  mediaExternalUrl: z.string().url("Le lien du média est invalide.").optional().or(z.literal("")),
  /*
   * Le résumé n'est plus saisi : il se déduit du ticket. Un champ obligatoire
   * de plus à chaque correction ne disait jamais rien qui ne fût déjà dans la
   * demande du client, et retardait l'envoi.
   */
  summary: z.string().trim().max(500).optional(),
});

export async function prepareCorrectionForClient(formData: FormData): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok:false, message:"Seul le community manager peut préparer l’envoi client." };
  }

  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok:false, message:parsed.error.issues[0]?.message ?? "Correction invalide." };
  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  const applied = await applyCorrection(admin, profile, input);
  if (!applied.ok) return applied;
  const versionId = applied.versionId;

  await admin.from("client_tickets").update({ resolution_version_id:versionId, status:"new_version_generated" }).eq("id", input.ticketId);
  await admin.from("weekly_sheets").update({ status:"new_version_to_send" }).eq("id", input.sheetId);

  const link = await generateReviewLink(input.sheetId);
  if (!link.ok || !link.reviewUrl) return link;

  const { data:sheet } = await admin.from("weekly_sheets").select(`iso_week, validation_deadline_at, clients ( name, whatsapp_group_name, client_contacts ( first_name, phone, is_primary ) )`).eq("id", input.sheetId).single();
  const client = sheet?.clients as unknown as { name:string; whatsapp_group_name:string|null; client_contacts:{first_name:string;phone:string|null;is_primary:boolean}[] } | null;
  const contact = client?.client_contacts?.find((value) => value.is_primary) ?? client?.client_contacts?.[0];
  const deadline = sheet?.validation_deadline_at ? new Intl.DateTimeFormat("fr-FR", { dateStyle:"long", timeStyle:"short", timeZone:"Europe/Paris" }).format(new Date(sheet.validation_deadline_at)) : "l’échéance convenue";
  const messageBody = `Bonjour ${contact?.first_name ?? ""},\n\nNous avons corrigé votre demande concernant le planning de ${client?.name ?? "votre entreprise"}, semaine ${sheet?.iso_week ?? ""}.\n\nVous pouvez consulter la nouvelle version et la valider ici :\n${link.reviewUrl}\n\nMerci de nous confirmer que tout vous convient avant ${deadline}.\n\n${profile.full_name} — LYFTT`;

  revalidatePath(`/retours/${input.ticketId}`);
  return { ok:true, message:"Correction enregistrée. Le message client est prêt.", reviewUrl:link.reviewUrl, messageBody, whatsappUrl:whatsappLink(messageBody, contact?.phone ?? undefined) };
}

type CorrectionInput = z.infer<typeof correctionSchema>;
type ActionProfile = Awaited<ReturnType<typeof requireProfile>>;

/**
 * Application d'une correction : le contenu corrigé, puis une nouvelle
 * version de la fiche.
 *
 * Partagée par les deux issues d'une correction — renvoyer au client, ou
 * valider sans renvoi — pour que le texte enregistré et la version tracée
 * soient les mêmes quel que soit le choix fait ensuite.
 */
async function applyCorrection(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profile: ActionProfile,
  input: CorrectionInput,
  summarySuffix?: string,
): Promise<{ ok:true; versionId:string } | { ok:false; message:string }> {
  if (input.itemId) {
    const itemUpdate: Record<string, unknown> = {
      caption:sanitizeText(input.caption, 5000),
      hashtags:normalizeHashtags(input.hashtags),
      approval_status:"corrected",
    };
    if (input.scheduledDate) itemUpdate.scheduled_date = input.scheduledDate;
    if (input.mediaExternalUrl) itemUpdate.media_external_url = input.mediaExternalUrl;
    const { error } = await admin.from("weekly_sheet_items").update(itemUpdate).eq("id", input.itemId).eq("weekly_sheet_id", input.sheetId);
    if (error) return { ok:false, message:"La correction n’a pas pu être enregistrée." };
  }

  /*
   * L'historique des versions garde une trace lisible : à défaut de résumé
   * saisi, c'est la demande du client qui nomme la version — elle dit déjà ce
   * qui a été corrigé, et personne n'a à le réécrire.
   */
  const { data:ticketRow } = await admin
    .from("client_tickets")
    .select("ticket_number, title")
    .eq("id", input.ticketId)
    .maybeSingle();
  const base = input.summary?.trim()
    ? input.summary
    : ticketRow?.title
      ? `Correction ${ticketRow.ticket_number} — ${ticketRow.title}`
      : "Version corrigée";
  const summary = sanitizeText(summarySuffix ? `${base} · ${summarySuffix}` : base, 500);

  const { data:versionId, error:versionError } = await admin.rpc("create_sheet_version", {
    target_sheet_id:input.sheetId,
    summary,
    author:profile.id,
    ticket:input.ticketId,
  });
  if (versionError || !versionId) return { ok:false, message:"La nouvelle version n’a pas pu être générée." };
  return { ok:true, versionId:versionId as string };
}

// ---------------------------------------------------------------------------
// Validation par l'agence, sans renvoi au client
// ---------------------------------------------------------------------------

const STAFF_VALIDATION_ROLES = ["super_admin", "production_manager", "community_manager"];

/*
 * Garde-fou côté serveur : la double confirmation se fait à l'écran, mais une
 * action appelée sans elle — un bouton mal branché, un appel rejoué — ne doit
 * rien valider à la place du client.
 */
const DOUBLE_CONFIRMATION = "double";

/**
 * Ce qui fait d'une correction une correction validée, sans le client.
 *
 * La trace est posée d'abord : si la suite échoue, on sait au moins qui a
 * voulu valider. Puis le contenu passe « validé après correction » et le
 * ticket se clôt — pas « validé par le client », qui serait faux. Le statut de
 * la fiche se recalcule de lui-même à partir de ses contenus.
 */
async function completeStaffValidation(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profile: ActionProfile,
  input: { ticketId:string; sheetId:string; itemId:string|null; versionId:string|null; createdVersion:boolean },
): Promise<InternalActionResult> {
  const { data:sheet } = await admin.from("weekly_sheets").select("client_id").eq("id", input.sheetId).maybeSingle();
  if (!sheet) return { ok:false, message:"Fiche introuvable." };

  const now = new Date().toISOString();
  const { error:traceError } = await admin.from("weekly_sheet_staff_validations").insert({
    client_id:sheet.client_id as string,
    weekly_sheet_id:input.sheetId,
    weekly_sheet_item_id:input.itemId,
    ticket_id:input.ticketId,
    validated_by:profile.id,
    validated_by_name:profile.full_name,
    created_at:now,
  });
  if (traceError) return { ok:false, message:`Validation non enregistrée : ${traceError.message}` };

  if (input.itemId) {
    const { error:itemError } = await admin
      .from("weekly_sheet_items")
      .update({ approval_status:"approved_after_fix" })
      .eq("id", input.itemId)
      .eq("weekly_sheet_id", input.sheetId);
    if (itemError) return { ok:false, message:`Contenu non validé : ${itemError.message}` };
  }

  const { error:ticketError } = await admin
    .from("client_tickets")
    .update({
      status:"closed",
      resolved_at:now,
      closed_at:now,
      ...(input.versionId ? { resolution_version_id:input.versionId } : {}),
    })
    .eq("id", input.ticketId);
  if (ticketError) return { ok:false, message:`Ticket non clos : ${ticketError.message}` };

  /*
   * Une autre correction de la fiche attend encore d'être envoyée au client :
   * la fiche reste « nouvelle version à envoyer », et ce qui partira est la
   * version qu'on vient de créer — elle contient aussi cette autre correction.
   * Posé après la clôture du ticket, dernier déclencheur du recalcul, pour ne
   * pas être écrasé par lui.
   */
  const { data:pendingSend } = await admin
    .from("client_tickets")
    .select("id")
    .eq("weekly_sheet_id", input.sheetId)
    .eq("status", "new_version_generated");
  if (pendingSend && pendingSend.length > 0) {
    if (input.createdVersion && input.versionId) {
      await admin.from("client_tickets")
        .update({ resolution_version_id:input.versionId })
        .in("id", pendingSend.map((row) => row.id as string));
      await admin.from("client_review_links")
        .update({ sheet_version_id:input.versionId, updated_at:now })
        .eq("weekly_sheet_id", input.sheetId)
        .is("revoked_at", null);
    }
    await admin.from("weekly_sheets").update({ status:"new_version_to_send" }).eq("id", input.sheetId);
  }

  // Le ticket garde lui aussi la trace, lisible sans ouvrir l'historique.
  await admin.from("client_ticket_comments").insert({
    ticket_id:input.ticketId,
    author_profile_id:profile.id,
    author_type:"staff",
    author_name:profile.full_name,
    visibility:"internal",
    body:`Correction validée directement par ${profile.full_name}, sans renvoi au client.`,
  });

  revalidatePath(`/retours/${input.ticketId}`);
  revalidatePath("/retours");
  revalidatePath(`/fiches/${input.sheetId}`);
  revalidatePath("/fiches");
  revalidatePath("/historique");
  revalidatePath("/");

  // Le contenu est validé ; la fiche ne l'est que si tous ses autres contenus le sont déjà.
  const { data:after } = await admin.from("weekly_sheets").select("status").eq("id", input.sheetId).maybeSingle();
  return {
    ok:true,
    message: after?.status === "approved_by_client"
      ? "Correction validée sans renvoi au client. La fiche est validée ; l’historique en garde la trace."
      : "Correction validée sans renvoi au client. La fiche n’est pas encore validée : d’autres contenus attendent le client ou une correction.",
  };
}

/*
 * Valider un contenu à la place du client alors qu'une autre demande reste
 * ouverte dessus l'enterrerait : le contenu passerait « validé », le client ne
 * pourrait plus répondre, et la demande resterait sans suite. Même garde-fou
 * que la validation côté client, qui refuse tant qu'une demande est ouverte.
 */
async function otherOpenTicketsOnItem(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ticketId: string,
  itemId: string | null,
): Promise<string[] | null> {
  if (!itemId) return [];
  const { data, error } = await admin
    .from("client_tickets")
    .select("ticket_number")
    .eq("weekly_sheet_item_id", itemId)
    .neq("id", ticketId)
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)");
  if (error) return null;
  return (data ?? []).map((row) => row.ticket_number as string);
}

function otherTicketsMessage(numbers: string[] | null): string | null {
  if (!numbers) return "Vérification impossible. Réessayez.";
  if (numbers.length === 0) return null;
  return `D’autres demandes sont ouvertes sur ce contenu (${numbers.join(", ")}). Traitez-les avant de le valider sans renvoi.`;
}

/** Le ticket existe, est visible de la personne, et porte bien sur cette fiche. */
async function staffValidationTarget(ticketId:string, sheetId:string) {
  const supabase = await createSupabaseServerClient();
  const { data:ticket } = await supabase
    .from("client_tickets")
    .select("id, status, weekly_sheet_id, weekly_sheet_item_id, resolution_version_id")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || ticket.weekly_sheet_id !== sheetId) return null;
  return ticket;
}

const staffValidationSchema = correctionSchema.extend({ confirmation:z.literal(DOUBLE_CONFIRMATION) });

/** Enregistrer la correction et la valider aussitôt, sans renvoi au client. */
export async function correctAndValidateWithoutClient(formData: FormData): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!STAFF_VALIDATION_ROLES.includes(profile.role)) {
    return { ok:false, message:"Seuls la direction, le chef de projet et les community managers peuvent valider à la place du client." };
  }
  const parsed = staffValidationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok:false, message:"Validation non confirmée." };
  const input = parsed.data;

  const ticket = await staffValidationTarget(input.ticketId, input.sheetId);
  if (!ticket) return { ok:false, message:"Ticket introuvable ou accès refusé." };
  if (["closed", "approved_by_client", "cancelled", "rejected"].includes(ticket.status as string)) {
    return { ok:false, message:"Ce ticket est déjà clos." };
  }

  // Le contenu validé est celui du ticket, pas celui que le formulaire désigne.
  const itemId = (ticket.weekly_sheet_item_id as string | null) ?? null;
  const admin = createSupabaseAdminClient();
  const blocked = otherTicketsMessage(await otherOpenTicketsOnItem(admin, input.ticketId, itemId));
  if (blocked) return { ok:false, message:blocked };

  /*
   * Si une autre correction de la fiche attend d'être envoyée, la version créée
   * ici partira chez le client : elle ne doit pas se dire « sans renvoi ». La
   * validation par l'agence reste tracée à part.
   */
  const { count:pendingCount } = await admin
    .from("client_tickets")
    .select("id", { count:"exact", head:true })
    .eq("weekly_sheet_id", input.sheetId)
    .eq("status", "new_version_generated")
    .neq("id", input.ticketId);
  const applied = await applyCorrection(
    admin, profile, { ...input, itemId:itemId ?? "" },
    pendingCount ? undefined : "validée par l’agence, sans renvoi au client",
  );
  if (!applied.ok) return applied;

  return completeStaffValidation(admin, profile, {
    ticketId:input.ticketId,
    sheetId:input.sheetId,
    itemId,
    versionId:applied.versionId,
    createdVersion:true,
  });
}

/** Valider une correction déjà préparée, au lieu de l'envoyer au client. */
export async function validateWithoutClient(formData: FormData): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!STAFF_VALIDATION_ROLES.includes(profile.role)) {
    return { ok:false, message:"Seuls la direction, le chef de projet et les community managers peuvent valider à la place du client." };
  }
  const parsed = z.object({
    ticketId:z.string().uuid(),
    sheetId:z.string().uuid(),
    confirmation:z.literal(DOUBLE_CONFIRMATION),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok:false, message:"Validation non confirmée." };

  const ticket = await staffValidationTarget(parsed.data.ticketId, parsed.data.sheetId);
  if (!ticket) return { ok:false, message:"Ticket introuvable ou accès refusé." };
  if (["closed", "approved_by_client", "cancelled", "rejected"].includes(ticket.status as string)) {
    return { ok:false, message:"Ce ticket est déjà clos." };
  }

  const itemId = (ticket.weekly_sheet_item_id as string | null) ?? null;
  const admin = createSupabaseAdminClient();
  const blocked = otherTicketsMessage(await otherOpenTicketsOnItem(admin, parsed.data.ticketId, itemId));
  if (blocked) return { ok:false, message:blocked };

  return completeStaffValidation(admin, profile, {
    ticketId:parsed.data.ticketId,
    sheetId:parsed.data.sheetId,
    itemId,
    versionId:(ticket.resolution_version_id as string | null) ?? null,
    createdVersion:false,
  });
}

const correctionDispatchSchema = z.object({
  ticketId:z.string().uuid(), sheetId:z.string().uuid(), body:z.string().min(1), recipientLabel:z.string().max(200).optional(),
});

export async function sendCorrectionToClient(formData: FormData): Promise<InternalActionResult> {
  const profile = await requireProfile();
  const parsed = correctionDispatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok:false, message:"Envoi non enregistrable." };
  const admin = createSupabaseAdminClient();
  const { data:sheet } = await admin.from("weekly_sheets").select("current_version_id, clients ( client_contacts ( phone, is_primary ) )").eq("id", parsed.data.sheetId).single();
  if (!sheet?.current_version_id) return { ok:false, message:"Générez d’abord la version corrigée." };

  await admin.from("client_message_dispatches").insert({ weekly_sheet_id:parsed.data.sheetId, sheet_version_id:sheet.current_version_id, template_type:"after_corrections", channel:"whatsapp", recipient_label:parsed.data.recipientLabel ?? null, rendered_body:parsed.data.body, sent_by:profile.id });
  await admin.from("weekly_sheet_versions").update({ status:"sent", sent_to_client_at:new Date().toISOString() }).eq("id", sheet.current_version_id);
  await admin.from("client_tickets").update({ status:"sent_back_to_client" }).eq("id", parsed.data.ticketId);
  await admin.from("weekly_sheet_items").update({ approval_status:"resent" }).eq("weekly_sheet_id", parsed.data.sheetId).eq("approval_status", "corrected");
  await admin.from("weekly_sheets").update({ status:"awaiting_revalidation", sent_to_client_at:new Date().toISOString() }).eq("id", parsed.data.sheetId);

  const client = sheet.clients as unknown as { client_contacts:{phone:string|null;is_primary:boolean}[] } | null;
  const contact = client?.client_contacts?.find((value) => value.is_primary) ?? client?.client_contacts?.[0];
  revalidatePath(`/retours/${parsed.data.ticketId}`);
  revalidatePath(`/fiches/${parsed.data.sheetId}`);
  return { ok:true, message:"Envoi enregistré. Ouverture de WhatsApp…", whatsappUrl:whatsappLink(parsed.data.body, contact?.phone ?? undefined) };
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

/**
 * Clôture d'une demande hors publication.
 *
 * Devis, date de shooting, service annexe : rien à corriger, rien à renvoyer
 * au client pour revalidation. Le circuit de correction de contenu — corrigé,
 * relu, renvoyé — n'a aucun sens ici ; il suffit de dire que c'est traité.
 */
export async function resolveServiceRequest(ticketId: string): Promise<InternalActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Action non autorisée." };
  }
  if (!z.string().uuid().safeParse(ticketId).success) {
    return { ok: false, message: "Demande invalide." };
  }

  const scoped = await createSupabaseServerClient();
  const { data: ticket } = await scoped
    .from("client_tickets")
    .select("id, ticket_type, status")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "Demande introuvable ou accès refusé." };

  if (!isServiceRequest(ticket.ticket_type as TicketType)) {
    return { ok: false, message: "Cette demande porte sur un contenu : utilisez le circuit de correction." };
  }

  const now = new Date().toISOString();
  const { error } = await createSupabaseAdminClient()
    .from("client_tickets")
    .update({ status: "closed", resolved_at: now, closed_at: now })
    .eq("id", ticketId);
  if (error) return { ok: false, message: `Clôture impossible : ${error.message}` };

  revalidatePath("/retours");
  revalidatePath(`/retours/${ticketId}`);
  return { ok: true, message: "Demande marquée comme traitée." };
}

// ---------------------------------------------------------------------------
// Qui s'occupe d'une correction
// ---------------------------------------------------------------------------

/**
 * Désignation de la personne qui produit la correction.
 *
 * À la réception d'un ticket, l'application classe la demande — visuel et
 * vidéo partent en production, le reste reste éditorial — puis retient le
 * premier graphiste ou vidéaste actif qu'elle trouve, sans autre critère. Ce
 * choix était définitif : la personne désignée était la seule à voir le ticket
 * dans son écran de production, et un départ en congés suffisait à le rendre
 * invisible pour tout le monde.
 *
 * Le community manager reste `owner` quoi qu'il arrive : on ne remplace ici que
 * le `contributor`, celui qui tient le fichier.
 */
export async function assignTicketContributor(
  ticketId: string,
  profileId: string,
): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Seul l'encadrement peut changer l'affectation." };
  }

  const ids = z.object({ ticketId: z.string().uuid(), profileId: z.string().uuid() })
    .safeParse({ ticketId, profileId });
  if (!ids.success) return { ok: false, message: "Affectation invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("client_tickets")
    .select("id, title, status")
    .eq("id", ids.data.ticketId)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "Ticket introuvable ou accès refusé." };

  const plan = contributorAssignment(ticket.status as TicketStatus);
  if (!plan.allowed) return { ok: false, message: plan.error };

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, full_name, is_active, role")
    .eq("id", ids.data.profileId)
    .maybeSingle();
  if (!target?.is_active) return { ok: false, message: "Cette personne n'est plus active." };
  // Même liste que le sélecteur : un ticket confié à quelqu'un hors production ne serait vu par personne.
  if (!["graphic_designer", "video_editor", "production_manager"].includes(target.role as string)) {
    return { ok: false, message: "Cette personne ne fait pas partie de la production." };
  }

  // Un seul contributeur à la fois : sinon le ticket s'affiche sur deux écrans
  // et chacun attend que l'autre s'en occupe.
  await admin
    .from("client_ticket_assignments")
    .delete()
    .eq("ticket_id", ids.data.ticketId)
    .eq("assignment_role", "contributor");

  const { error } = await admin.from("client_ticket_assignments").insert({
    ticket_id: ids.data.ticketId,
    profile_id: ids.data.profileId,
    assignment_role: "contributor",
  });
  if (error) return { ok: false, message: `Affectation impossible : ${error.message}` };

  // Le ticket passe en « Affecté » par les transitions ordinaires, une étape après l'autre.
  for (const nextStatus of plan.path) {
    const step = new FormData();
    step.set("ticketId", ids.data.ticketId);
    step.set("nextStatus", nextStatus);
    const moved = await transitionTicket(step);
    if (!moved.ok) {
      return {
        ok: false,
        message: `${target.full_name} est désigné, mais le ticket n'a pas pu passer en production : ${moved.message}`,
      };
    }
  }

  await admin.from("internal_notifications").insert({
    profile_id: ids.data.profileId,
    ticket_id: ids.data.ticketId,
    title: "Correction à produire",
    body: `${profile.full_name} vous confie : ${ticket.title}`,
  });

  revalidatePath(`/retours/${ids.data.ticketId}`);
  revalidatePath("/retours");
  revalidatePath("/production");
  return { ok: true, message: `Confié à ${target.full_name}.` };
}

/**
 * Lien de demande d'un client, à lui donner une fois pour toutes.
 *
 * Un seul lien par client, créé au premier besoin et réutilisé ensuite : en
 * émettre un nouveau à chaque clic ferait mourir celui que le client a déjà
 * enregistré dans ses contacts.
 */
export async function clientRequestLink(clientId: string): Promise<InternalActionResult> {
  const profile = await requireProfile();
  if (!["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Action non autorisée." };
  }

  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };

  // Le périmètre est vérifié par RLS avant toute écriture par la clé service.
  const scoped = await createSupabaseServerClient();
  const { data: client } = await scoped
    .from("clients")
    .select("id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!client) return { ok: false, message: "Client introuvable ou accès refusé." };

  const link = await ensureRequestLink(parsed.data, profile.id);
  if ("error" in link) return { ok: false, message: `Lien indisponible : ${link.error}` };

  return { ok: true, reviewUrl: `${env.appUrl}/demande/${link.token}` };
}
