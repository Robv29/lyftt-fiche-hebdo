"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestLink } from "@/lib/review/request-link";
import { getTicketTypeDefinition, isTicketType } from "@/lib/domain/ticket-types";
import { isMeaningful, sanitizeText } from "@/lib/security/sanitize";
import { rateLimit } from "@/lib/security/rate-limit";

export interface RequestResult {
  ok: boolean;
  message: string;
  /** Numéro du ticket créé, pour que le client puisse le citer. */
  reference?: string;
}

const schema = z.object({
  requestType: z.string().refine(isTicketType, "Choisissez le motif de votre demande."),
  description: z.string().trim().min(10, "Décrivez votre demande en quelques mots."),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email("E-mail invalide.").optional().or(z.literal("")),
});

/**
 * Demande déposée par un client depuis son lien permanent.
 *
 * Le tri se fait tout seul : le motif choisi porte sa famille, et c'est elle
 * qui envoie la demande en production — visuel, vidéo — ou la laisse au
 * community manager. Le client n'a pas à savoir qui fait quoi.
 *
 * La demande est rattachée à la dernière fiche du client : un ticket appartient
 * toujours à une semaine, et c'est la plus récente qui donne le contexte utile.
 */
export async function submitClientRequest(
  token: string,
  formData: FormData,
): Promise<RequestResult> {
  const context = await resolveRequestLink(token);
  if (!context) return { ok: false, message: "Ce lien n'est plus valable. Contactez votre interlocuteur LYFTT." };

  if (!(await rateLimit("ticketCreation", context.clientId)).allowed) {
    return { ok: false, message: "Trop de demandes successives. Réessayez dans un instant." };
  }

  const parsed = schema.safeParse({
    requestType: formData.get("requestType"),
    description: formData.get("description"),
    contactName: formData.get("contactName") ?? undefined,
    contactEmail: formData.get("contactEmail") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande incomplète." };
  }
  if (!isMeaningful(parsed.data.description)) {
    return { ok: false, message: "Décrivez votre demande en quelques mots." };
  }

  const admin = createSupabaseAdminClient();
  const { data: sheet } = await admin
    .from("weekly_sheets")
    .select("id")
    .eq("client_id", context.clientId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sheet) {
    return {
      ok: false,
      message: "Votre espace n'est pas encore ouvert. Écrivez directement à votre interlocuteur LYFTT.",
    };
  }

  const definition = getTicketTypeDefinition(parsed.data.requestType);
  const { data: ticket, error } = await admin.from("client_tickets").insert({
    client_id: context.clientId,
    weekly_sheet_id: sheet.id,
    weekly_sheet_item_id: null,
    ticket_type: parsed.data.requestType,
    // La famille du motif décide seule du circuit : production ou éditorial.
    category: definition.category,
    title: definition.label,
    description: sanitizeText(parsed.data.description, 3000),
    priority: "normal",
    status: "new",
    created_by_type: "client",
    created_by_name: parsed.data.contactName ? sanitizeText(parsed.data.contactName, 120) : null,
    created_by_email: parsed.data.contactEmail || null,
  }).select("ticket_number").single();

  if (error) return { ok: false, message: "Votre demande n'a pas pu être enregistrée. Réessayez." };

  return {
    ok: true,
    message: "Demande reçue. Nous revenons vers vous rapidement.",
    reference: ticket?.ticket_number as string,
  };
}
