"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadReviewSheet,
  logReviewEvent,
  resolveReviewLink,
  type ReviewLinkContext,
} from "@/lib/review/access";
import { getTicketTypeDefinition, isTicketType } from "@/lib/domain/ticket-types";
import { routeTicket } from "@/lib/domain/routing";
import { canApproveAll } from "@/lib/domain/sheet-status";
import {
  detectDuplicateTicket,
  itemRequestability,
  requestChangeAfterApproval,
} from "@/lib/domain/edge-cases";
import { isMeaningful, sanitizeText } from "@/lib/security/sanitize";
import {
  ATTACHMENT_MAX_BYTES,
  checkAttachment,
  safeFileName,
} from "@/lib/security/attachments";
import { rateLimit } from "@/lib/security/rate-limit";
import { env } from "@/lib/supabase/env";
import { formatDeadline } from "@/lib/domain/deadline";
import { sendEmail } from "@/lib/notifications/resend";
import {
  buildHtmlBody,
  buildSubject,
  buildTextBody,
  type TicketEmailInput,
} from "@/lib/notifications/ticket-email";

/**
 * Actions du portail client.
 *
 * Le client ne modifie jamais directement une ligne de production : il valide,
 * ou il crée une demande. Toute correction réelle est faite par l'équipe (§19).
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Renseigné quand une demande très proche existe déjà (§24). */
  duplicateOf?: string;
}

const DENIAL_MESSAGES: Record<string, string> = {
  malformed: "Ce lien n'est pas valide.",
  not_found: "Ce lien n'est pas valide.",
  revoked: "Ce lien a été désactivé. Contactez votre community manager.",
  expired: "Ce lien a expiré. Contactez votre community manager.",
  rate_limited: "Trop de requêtes. Merci de réessayer dans quelques instants.",
};

async function requireLink(
  token: string,
): Promise<{ ok: true; context: ReviewLinkContext } | { ok: false; result: ActionResult }> {
  const resolved = await resolveReviewLink(token);
  if (!resolved.ok) {
    return {
      ok: false,
      result: { ok: false, message: DENIAL_MESSAGES[resolved.reason] ?? "Accès refusé." },
    };
  }
  return { ok: true, context: resolved.context };
}

// ---------------------------------------------------------------------------
// Validation d'un contenu
// ---------------------------------------------------------------------------

const approveItemSchema = z.object({
  itemId: z.string().uuid(),
  clientName: z.string().trim().max(120).optional(),
});

/**
 * Constate que la fiche est bien entre les mains du client.
 *
 * Le recalcul de statut refuse de faire évoluer une fiche encore marquée
 * « brouillon » — protection contre les remous de la préparation interne.
 * Mais une action passée par un lien de validation valide **prouve** que le
 * client l'a reçue : sans cette promotion, une fiche entièrement validée
 * restait affichée en brouillon, et n'alimentait ni le planning ni les
 * publications.
 */
async function ensureSheetIsWithClient(sheetId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("weekly_sheets")
    .update({ status: "sent_to_client" })
    .eq("id", sheetId)
    .in("status", ["draft", "internal_review", "ready_to_send"]);
}

export async function approveItem(
  token: string,
  formData: FormData,
): Promise<ActionResult> {
  const link = await requireLink(token);
  if (!link.ok) return link.result;

  // Le client agit : la fiche est chez lui, quel que soit son marquage interne.
  await ensureSheetIsWithClient(link.context.sheetId);

  const parsed = approveItemSchema.safeParse({
    itemId: formData.get("itemId"),
    clientName: formData.get("clientName") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "Demande invalide." };

  if (!rateLimit("approval", link.context.linkId).allowed) {
    return { ok: false, message: "Trop d'actions successives. Réessayez dans un instant." };
  }

  const sheet = await loadReviewSheet(link.context);
  const item = sheet?.items.find((i) => i.id === parsed.data.itemId);
  if (!sheet || !item) return { ok: false, message: "Contenu introuvable." };

  if (item.isCancelled) {
    return { ok: false, message: "Cette publication a été annulée." };
  }
  if (item.openTicketCount > 0) {
    return {
      ok: false,
      message:
        "Une demande de modification est en cours sur ce contenu. Il pourra être validé une fois corrigé.",
    };
  }

  const supabase = createSupabaseAdminClient();
  const nextStatus =
    item.approvalStatus === "corrected" || item.approvalStatus === "resent"
      ? "approved_after_fix"
      : "approved";

  await supabase
    .from("weekly_sheet_items")
    .update({ approval_status: nextStatus })
    .eq("id", item.id)
    .eq("weekly_sheet_id", link.context.sheetId);

  // La validation de la correction résout automatiquement le ticket associé.
  await supabase
    .from("client_tickets")
    .update({ status:"approved_by_client", resolved_at:new Date().toISOString() })
    .eq("weekly_sheet_id", link.context.sheetId)
    .eq("weekly_sheet_item_id", item.id)
    .eq("status", "sent_back_to_client");

  await recordApproval(link.context, sheet.currentVersionId, item.id, nextStatus, {
    clientName: parsed.data.clientName,
  });

  await logReviewEvent(link.context.linkId, "item_approved", { itemId: item.id });
  revalidatePath(`/client-review/${token}`);

  return { ok: true, message: "Contenu validé. Merci !" };
}

// ---------------------------------------------------------------------------
// Validation globale
// ---------------------------------------------------------------------------

export async function approveAll(
  token: string,
  formData: FormData,
): Promise<ActionResult> {
  const link = await requireLink(token);
  if (!link.ok) return link.result;

  // Le client agit : la fiche est chez lui, quel que soit son marquage interne.
  await ensureSheetIsWithClient(link.context.sheetId);

  if (!rateLimit("approval", link.context.linkId).allowed) {
    return { ok: false, message: "Trop d'actions successives. Réessayez dans un instant." };
  }

  const sheet = await loadReviewSheet(link.context);
  if (!sheet) return { ok: false, message: "Fiche introuvable." };

  const openTicketStatuses = sheet.items.flatMap((item) =>
    Array.from({ length: item.openTicketCount }, () => "new" as const),
  );

  // §5 — « Tout valider » n'est disponible qu'en l'absence de demande ouverte.
  if (!canApproveAll({
    items: sheet.items.map((i) => ({
      approvalStatus: i.approvalStatus,
      isCancelled: i.isCancelled,
    })),
    ticketStatuses: openTicketStatuses,
  })) {
    return {
      ok: false,
      message:
        "La validation globale n'est pas possible tant qu'une demande de modification est en cours.",
    };
  }

  const clientName = sanitizeText(String(formData.get("clientName") ?? ""), 120);
  const supabase = createSupabaseAdminClient();

  for (const item of sheet.items) {
    if (item.isCancelled) continue;
    if (["approved", "approved_after_fix"].includes(item.approvalStatus)) continue;

    const nextStatus =
      item.approvalStatus === "corrected" || item.approvalStatus === "resent"
        ? "approved_after_fix"
        : "approved";

    await supabase
      .from("weekly_sheet_items")
      .update({ approval_status: nextStatus })
      .eq("id", item.id)
      .eq("weekly_sheet_id", link.context.sheetId);

    await recordApproval(link.context, sheet.currentVersionId, item.id, nextStatus, {
      clientName,
    });
  }

  // « Tout valider » valide aussi toutes les corrections renvoyées de cette fiche.
  await supabase
    .from("client_tickets")
    .update({ status:"approved_by_client", resolved_at:new Date().toISOString() })
    .eq("weekly_sheet_id", link.context.sheetId)
    .eq("status", "sent_back_to_client");

  await recordApproval(link.context, sheet.currentVersionId, null, "approved", {
    clientName,
  });
  await logReviewEvent(link.context.linkId, "sheet_approved", {});
  revalidatePath(`/client-review/${token}`);

  return { ok: true, message: "Merci, l'ensemble du planning est validé." };
}

async function recordApproval(
  context: ReviewLinkContext,
  versionId: string | null,
  itemId: string | null,
  status: "approved" | "approved_after_fix",
  options: { clientName?: string; comment?: string } = {},
): Promise<void> {
  if (!versionId) return;

  const supabase = createSupabaseAdminClient();
  await supabase.from("client_content_approvals").upsert(
    {
      weekly_sheet_id: context.sheetId,
      weekly_sheet_item_id: itemId,
      sheet_version_id: versionId,
      review_link_id: context.linkId,
      status,
      client_name: options.clientName || null,
      comment: options.comment || null,
      approved_at: new Date().toISOString(),
    },
    { onConflict: "sheet_version_id,weekly_sheet_item_id" },
  );
}

// ---------------------------------------------------------------------------
// Création d'un ticket
// ---------------------------------------------------------------------------

const createTicketSchema = z.object({
  itemId: z.string().uuid().nullable(),
  ticketType: z.string().refine(isTicketType, "Type de demande inconnu"),
  description: z.string().trim().min(3, "Merci de préciser votre demande."),
  suggestion: z.string().trim().max(5000).optional(),
  selection: z.string().trim().max(1000).optional(),
  timecode: z.string().trim().max(20).optional(),
  option: z.string().trim().max(60).optional(),
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.string().trim().email().max(180).optional().or(z.literal("")),
  confirmDuplicate: z.string().optional(),
});

export async function createTicket(
  token: string,
  formData: FormData,
): Promise<ActionResult> {
  const link = await requireLink(token);
  if (!link.ok) return link.result;

  // Le client agit : la fiche est chez lui, quel que soit son marquage interne.
  await ensureSheetIsWithClient(link.context.sheetId);

  if (!rateLimit("ticketCreation", link.context.linkId).allowed) {
    return {
      ok: false,
      message: "Trop de demandes envoyées coup sur coup. Réessayez dans quelques minutes.",
    };
  }

  const rawItemId = formData.get("itemId");
  const parsed = createTicketSchema.safeParse({
    itemId: rawItemId ? String(rawItemId) : null,
    ticketType: formData.get("ticketType"),
    description: formData.get("description"),
    suggestion: formData.get("suggestion") ?? undefined,
    selection: formData.get("selection") ?? undefined,
    timecode: formData.get("timecode") ?? undefined,
    option: formData.get("option") ?? undefined,
    clientName: formData.get("clientName") ?? undefined,
    clientEmail: formData.get("clientEmail") ?? undefined,
    confirmDuplicate: formData.get("confirmDuplicate") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }

  const input = parsed.data;
  const description = sanitizeText(input.description);
  if (!isMeaningful(description)) {
    return {
      ok: false,
      message:
        "Merci de préciser ce qui doit être modifié : c'est ce qui nous permet de corriger du premier coup.",
    };
  }

  const sheet = await loadReviewSheet(link.context);
  if (!sheet) return { ok: false, message: "Fiche introuvable." };

  const definition = getTicketTypeDefinition(input.ticketType);
  const item = input.itemId ? sheet.items.find((i) => i.id === input.itemId) : null;

  if (input.itemId && !item) return { ok: false, message: "Contenu introuvable." };
  if (!input.itemId && !definition.sheetLevel) {
    return { ok: false, message: "Cette demande doit porter sur une publication." };
  }

  const supabase = createSupabaseAdminClient();

  // §24 — demande en double.
  if (item && !input.confirmDuplicate) {
    const { data: existing } = await supabase
      .from("client_tickets")
      .select("id, ticket_number, weekly_sheet_item_id, ticket_type, description, status, created_at")
      .eq("weekly_sheet_id", link.context.sheetId)
      .eq("weekly_sheet_item_id", item.id);

    const duplicate = detectDuplicateTicket(
      { itemId: item.id, type: input.ticketType, description },
      (existing ?? []).map((t) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        itemId: t.weekly_sheet_item_id,
        type: t.ticket_type,
        description: t.description,
        status: t.status,
        createdAt: new Date(t.created_at),
      })),
    );

    if (duplicate.isDuplicate && duplicate.existing) {
      return {
        ok: false,
        message: duplicate.message,
        duplicateOf: duplicate.existing.ticketNumber,
      };
    }
  }

  // §24 — contenu déjà publié, annulé, ou publication imminente.
  let notice: string | undefined;
  let escalateForTiming = false;

  if (item) {
    const scheduledAt = new Date(
      `${item.scheduledDate}T${item.scheduledTime ?? "12:00:00"}`,
    );
    const requestability = itemRequestability(
      {
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        isCancelled: item.isCancelled,
        scheduledAt,
      },
    );

    if (requestability.state === "cancelled") {
      return { ok: false, message: requestability.notice };
    }
    notice = requestability.notice;
    escalateForTiming =
      requestability.state === "tight_deadline" ||
      requestability.state === "already_published";

    // §24 — le client revient sur une validation.
    const afterApproval = requestChangeAfterApproval(
      {
        approvalStatus: item.approvalStatus,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        scheduledAt,
      },
    );
    if (afterApproval.notifyProductionManager) escalateForTiming = true;
  }

  const deadlinePassed = sheet.validationDeadlineAt
    ? new Date(sheet.validationDeadlineAt) < new Date()
    : false;

  const routing = routeTicket(input.ticketType, {
    priority: escalateForTiming ? "high" : "normal",
    requestsAdditionalContent: definition.mayAffectScope,
    submittedAfterDeadline: deadlinePassed,
  });

  const details: Record<string, unknown> = {};
  if (input.option) details.option = input.option;
  if (input.timecode) details.timecode = input.timecode;
  if (input.selection) details.selection = sanitizeText(input.selection, 1000);
  if (notice) details.notice = notice;

  const title = item
    ? `${definition.label} — ${formatItemLabel(item.scheduledDate)}`
    : definition.label;

  const { data: ticket, error } = await supabase
    .from("client_tickets")
    .insert({
      client_id: link.context.clientId,
      weekly_sheet_id: link.context.sheetId,
      weekly_sheet_item_id: item?.id ?? null,
      sheet_version_id: sheet.currentVersionId,
      review_link_id: link.context.linkId,
      ticket_type: input.ticketType,
      category: definition.category,
      title,
      description,
      client_suggestion: input.suggestion ? sanitizeText(input.suggestion) : null,
      details,
      priority: escalateForTiming ? "high" : "normal",
      status: "new",
      due_at: sheet.validationDeadlineAt,
      created_by_type: "client",
      created_by_name: input.clientName ? sanitizeText(input.clientName, 120) : null,
      created_by_email: input.clientEmail || null,
    })
    .select("id, ticket_number")
    .single();

  if (error || !ticket) {
    return { ok: false, message: "La demande n'a pas pu être enregistrée. Réessayez." };
  }

  // Le contenu passe en « modification demandée » (§15).
  if (item) {
    await supabase
      .from("weekly_sheet_items")
      .update({ approval_status: "changes_requested" })
      .eq("id", item.id)
      .eq("weekly_sheet_id", link.context.sheetId);
  }

  const recipients = await assignAndNotify(
    ticket.id,
    link.context.clientId,
    routing,
    title,
  );
  await handleAttachment(formData, ticket.id, link.context);

  // L'alerte e-mail est un rappel, pas la source de vérité : un échec d'envoi
  // ne doit jamais empêcher l'enregistrement de la demande.
  await sendTicketAlert({
    recipients,
    email: {
      ticketNumber: ticket.ticket_number,
      clientName: sheet.clientName,
      ticketType: input.ticketType,
      priority: escalateForTiming ? "high" : "normal",
      description,
      clientSuggestion: input.suggestion ? sanitizeText(input.suggestion) : null,
      itemLabel: item ? formatItemLabel(item.scheduledDate) : null,
      authorName: input.clientName ? sanitizeText(input.clientName, 120) : null,
      ticketUrl: `${env.appUrl}/retours/${ticket.id}`,
      deadlineLabel: sheet.validationDeadlineAt
        ? formatDeadline(new Date(sheet.validationDeadlineAt), sheet.timezone)
        : null,
      escalationReasons: routing.escalation.reasons,
      afterDeadline: deadlinePassed,
    },
  });

  await logReviewEvent(link.context.linkId, "ticket_created", {
    ticketId: ticket.id,
    ticketType: input.ticketType,
  });
  revalidatePath(`/client-review/${token}`);

  return {
    ok: true,
    message: notice
      ? `Demande ${ticket.ticket_number} enregistrée. ${notice}`
      : `Demande ${ticket.ticket_number} enregistrée. Votre community manager la traite et revient vers vous.`,
  };
}

function formatItemLabel(scheduledDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${scheduledDate}T00:00:00Z`));
}

/** §7 / §8 — affectation automatique puis notification interne. */
async function assignAndNotify(
  ticketId: string,
  clientId: string,
  routing: ReturnType<typeof routeTicket>,
  title: string,
): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const recipients: string[] = [];

  for (const target of routing.targets) {
    // On cherche d'abord la personne rattachée au client pour ce rôle.
    const { data: assigned } = await supabase
      .from("client_assignments")
      .select("profile_id, profiles ( id, email )")
      .eq("client_id", clientId)
      .eq("role", target.role)
      .limit(1);

    let profileId = assigned?.[0]?.profile_id as string | undefined;
    let email = (assigned?.[0]?.profiles as unknown as { email: string } | null)?.email;

    // À défaut, on retombe sur un membre actif du rôle (responsable de production).
    if (!profileId) {
      const { data: fallback } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("role", target.role)
        .eq("is_active", true)
        .limit(1);
      profileId = fallback?.[0]?.id;
      email = fallback?.[0]?.email;
    }

    if (!profileId) continue;
    if (email) recipients.push(email);

    await supabase.from("client_ticket_assignments").upsert(
      {
        ticket_id: ticketId,
        profile_id: profileId,
        assignment_role: target.assignmentRole,
      },
      { onConflict: "ticket_id,profile_id,assignment_role" },
    );

    await supabase.from("internal_notifications").insert({
      profile_id: profileId,
      ticket_id: ticketId,
      title: `Nouveau retour client : ${title}`,
      body: target.reason,
    });
  }

  // Le ticket est affecté dès sa création, mais reste à qualifier (§10).
  await supabase.from("client_tickets").update({ status: "new" }).eq("id", ticketId);

  return recipients;
}

/**
 * §8 — Alerte e-mail vers les personnes concernées par la demande.
 *
 * Destinataires : le community manager référent, le graphiste ou le vidéaste
 * quand une correction visuelle est nécessaire, et le responsable de production
 * lorsqu'une escalade est déclenchée — c'est exactement le routage calculé
 * par `routeTicket`.
 */
async function sendTicketAlert(params: {
  recipients: string[];
  email: TicketEmailInput;
}): Promise<void> {
  if (params.recipients.length === 0) return;

  try {
    await sendEmail({
      to: params.recipients,
      subject: buildSubject(params.email),
      html: buildHtmlBody(params.email),
      text: buildTextBody(params.email),
    });
  } catch (error) {
    // Volontairement absorbé : la demande client est déjà enregistrée.
    console.error("[alerte ticket] envoi impossible", error);
  }
}

/** §6 / §19 — pièce jointe éventuelle, contrôlée avant stockage. */
async function handleAttachment(
  formData: FormData,
  ticketId: string,
  context: ReviewLinkContext,
): Promise<void> {
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) return;

  if (!rateLimit("attachment", context.linkId).allowed) return;

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const check = checkAttachment(
    { size: file.size, type: file.type, name: file.name },
    head,
  );
  if (!check.valid) return;

  const supabase = createSupabaseAdminClient();
  const fileName = safeFileName(file.name);
  const path = `tickets/${ticketId}/${crypto.randomUUID()}-${fileName}`;

  const { error } = await supabase.storage
    .from("media")
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    });
  if (error) return;

  const { data: asset } = await supabase
    .from("media_assets")
    .insert({
      client_id: context.clientId,
      kind: file.type.startsWith("video/")
        ? "video"
        : file.type === "application/pdf"
          ? "document"
          : "image",
      storage_path: path,
      file_name: fileName,
      mime_type: file.type,
      byte_size: Math.min(file.size, ATTACHMENT_MAX_BYTES),
    })
    .select("id")
    .single();

  if (!asset) return;

  await supabase.from("client_ticket_attachments").insert({
    ticket_id: ticketId,
    media_asset_id: asset.id,
    uploaded_by_type: "client",
  });

  await logReviewEvent(context.linkId, "attachment_uploaded", { ticketId });
}

const serviceRequestSchema = z.object({
  requestType: z.enum(["quote_request", "shooting_request", "side_service"]),
  description: z.string().trim().min(10, "Décrivez votre demande en quelques mots.").max(3000),
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
});

/**
 * Demande hors publication : devis, date de shooting, service annexe.
 *
 * Elle n'est rattachée à aucun contenu de la semaine — c'est ce qui la
 * distingue d'une correction — mais emprunte le circuit des tickets, qui sait
 * déjà router, assigner, alerter et clore. Elle arrive par le second lien du
 * message hebdomadaire, avec le même jeton : le client n'a rien de plus à
 * retenir.
 */
export async function createServiceRequest(
  token: string,
  formData: FormData,
): Promise<ActionResult> {
  const link = await requireLink(token);
  if (!link.ok) return link.result;

  if (!rateLimit("ticketCreation", link.context.linkId).allowed) {
    return { ok: false, message: "Trop de demandes successives. Réessayez dans un instant." };
  }

  const parsed = serviceRequestSchema.safeParse({
    requestType: formData.get("requestType"),
    description: formData.get("description"),
    clientName: formData.get("clientName") ?? undefined,
    clientEmail: formData.get("clientEmail") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande incomplète." };
  }

  const input = parsed.data;
  const definition = getTicketTypeDefinition(input.requestType);
  const description = sanitizeText(input.description, 3000);
  const sheet = await loadReviewSheet(link.context);
  const supabase = createSupabaseAdminClient();

  const { data: ticket, error } = await supabase
    .from("client_tickets")
    .insert({
      client_id: link.context.clientId,
      /*
       * Rattachée à la fiche du lien pour retrouver le contexte, mais à
       * aucune publication : elle ne porte sur aucun contenu.
       */
      weekly_sheet_id: link.context.sheetId,
      weekly_sheet_item_id: null,
      review_link_id: link.context.linkId,
      ticket_type: input.requestType,
      category: definition.category,
      title: definition.label,
      description,
      priority: "normal",
      status: "new",
      created_by_type: "client",
      created_by_name: input.clientName ? sanitizeText(input.clientName, 120) : null,
      created_by_email: input.clientEmail || null,
    })
    .select("id, ticket_number")
    .single();

  if (error || !ticket) {
    return { ok: false, message: "La demande n'a pas pu être enregistrée. Réessayez." };
  }

  const recipients = await assignAndNotify(
    ticket.id,
    link.context.clientId,
    routeTicket(input.requestType, { priority: "normal" }),
    definition.label,
  );

  await sendTicketAlert({
    recipients,
    email: {
      ticketNumber: ticket.ticket_number,
      clientName: sheet?.clientName ?? "Client",
      ticketType: input.requestType,
      priority: "normal",
      description,
      clientSuggestion: null,
      itemLabel: null,
      authorName: input.clientName ? sanitizeText(input.clientName, 120) : null,
      ticketUrl: `${env.appUrl}/retours/${ticket.id}`,
      deadlineLabel: null,
      escalationReasons: [],
      afterDeadline: false,
    },
  });

  await logReviewEvent(link.context.linkId, "ticket_created", {
    ticketId: ticket.id,
    ticketType: input.requestType,
    serviceRequest: true,
  });

  revalidatePath(`/client-review/${token}/demandes`);
  return {
    ok: true,
    message: `Demande ${ticket.ticket_number} enregistrée. Nous revenons vers vous rapidement.`,
  };
}

// ---------------------------------------------------------------------------
// Satisfaction de la semaine
// ---------------------------------------------------------------------------

const ratingSchema = z.object({
  score: z.coerce.number().int().min(1).max(3),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Note donnée par le client à la fiche qu'il vient de valider.
 *
 * Demandée sur place, à la validation : le client est devant l'écran et vient
 * de regarder ses publications. Un questionnaire envoyé plus tard n'obtient que
 * des réponses extrêmes, et trop peu pour en tirer quoi que ce soit.
 *
 * Une seule note par fiche : reposer la question à chaque passage transformerait
 * la validation en sondage. Une réponse donnée deux fois écrase la précédente,
 * ce qui laisse au client le droit de se corriger.
 */
export async function rateSheet(token: string, formData: FormData): Promise<ActionResult> {
  const link = await requireLink(token);
  if (!link.ok) return link.result;

  if (!rateLimit("approval", link.context.linkId).allowed) {
    return { ok: false, message: "Trop d'actions successives. Réessayez dans un instant." };
  }

  const parsed = ratingSchema.safeParse({
    score: formData.get("score"),
    comment: formData.get("comment") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "Note invalide." };

  const comment = parsed.data.comment && isMeaningful(parsed.data.comment)
    ? sanitizeText(parsed.data.comment, 1000)
    : null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("client_sheet_ratings").upsert({
    weekly_sheet_id: link.context.sheetId,
    client_id: link.context.clientId,
    review_link_id: link.context.linkId,
    score: parsed.data.score,
    comment,
    submitted_at: new Date().toISOString(),
  }, { onConflict: "weekly_sheet_id" });

  if (error) return { ok: false, message: "Merci — votre retour n'a pas pu être enregistré." };

  revalidatePath(`/client-review/${token}`);
  return { ok: true, message: "Merci pour votre retour." };
}
