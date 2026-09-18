import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseClientKind } from "@/lib/domain/client-lifecycle";
import {
  REVIEW_URL,
  isReviewRequestDay,
  reviewPeriod,
  reviewQuarter,
  reviewRequestRecipients,
} from "@/lib/domain/review-request";
import { buildReviewHtml, buildReviewSubject, buildReviewText } from "@/lib/notifications/review-request";
import { AGENCY_DISPLAY_NAME, AGENCY_REPLY_TO } from "@/lib/notifications/agency";
import { RESEND_BATCH_LIMIT, isEmailConfigured, sendEmailBatch } from "@/lib/notifications/resend";
import type { CampaignRun } from "./types";

/**
 * Demande d'avis Google : le 15 de janvier, avril, juillet et octobre.
 *
 * Même mécanique que le bilan mensuel : lancée chaque jour, elle n'agit que du
 * 15 au 17 du premier mois du trimestre, et chaque envoi est réservé en base
 * avant de partir — une adresse n'est sollicitée qu'une fois par trimestre.
 */
export async function runReviewRequests(today: string, preview: boolean): Promise<CampaignRun> {
  const campaign = "avis_google";

  if (!preview && !isReviewRequestDay(today)) {
    return { campaign, status: 200, body: { skipped: `Aucune demande d'avis le ${today}.` } };
  }
  if (!preview && !isEmailConfigured()) {
    console.error("[avis google] messagerie non configurée");
    return { campaign, status: 503, body: { error: "Messagerie non configurée (RESEND_API_KEY et MAIL_FROM)." } };
  }

  const admin = createSupabaseAdminClient();
  const period = reviewPeriod(today);

  const [
    { data: clients, error: clientsError },
    { data: sent, error: sentError },
    { data: optOuts, error: optOutsError },
  ] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date, created_at, review_requests, client_contacts ( first_name, email, is_primary, receives_planning )")
      .eq("is_active", true),
    admin
      .from("client_review_requests")
      .select("email")
      .eq("period_month", period),
    // Ceux qui ont répondu « stop » : le message le leur promet.
    admin
      .from("review_request_optouts")
      .select("email"),
  ]);

  // Sans la liste des envois déjà faits ou des désinscrits, on risquerait d'écrire à tort : on s'arrête.
  if (clientsError || sentError || optOutsError) {
    const message = clientsError?.message ?? sentError?.message ?? optOutsError?.message;
    console.error("[avis google] lecture impossible", message);
    return { campaign, status: 500, body: { error: `Lecture impossible : ${message}` } };
  }

  const recipients = reviewRequestRecipients({
    today,
    alreadySent: new Set([...(sent ?? []), ...(optOuts ?? [])].map((row) => String(row.email))),
    clients: (clients ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      isActive: Boolean(row.is_active),
      kind: parseClientKind(row.client_kind),
      contractStartDate: (row.contract_start_date as string | null) ?? null,
      contractEndDate: (row.contract_end_date as string | null) ?? null,
      pauseStartDate: (row.pause_start_date as string | null) ?? null,
      pauseEndDate: (row.pause_end_date as string | null) ?? null,
      createdAt: row.created_at as string,
      // Une valeur absente vaut « activé » : c'est le réglage par défaut en base.
      reviewEnabled: row.review_requests !== false,
      contacts: ((row.client_contacts ?? []) as { first_name: string | null; email: string | null; is_primary: boolean | null; receives_planning: boolean | null }[])
        .map((contact) => ({
          firstName: contact.first_name,
          email: contact.email,
          isPrimary: Boolean(contact.is_primary),
          receivesPlanning: Boolean(contact.receives_planning),
        })),
    })),
  });

  if (preview) {
    return {
      campaign,
      status: 200,
      body: {
        period,
        recipients: recipients.map((recipient) => ({ email: recipient.email, clients: recipient.clientNames })),
      },
    };
  }

  const quarter = reviewQuarter(today);
  let sentCount = 0;
  const failures: string[] = [];

  for (let start = 0; start < recipients.length; start += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(start, start + RESEND_BATCH_LIMIT);

    /*
     * Réservation avant l'envoi, une ligne par adresse. Une adresse déjà
     * réservée — par une exécution concurrente — n'est pas renvoyée par la
     * base : seules celles réservées ici partent.
     */
    const { data: reserved, error: reserveError } = await admin
      .from("client_review_requests")
      .upsert(
        chunk.map((recipient) => ({ period_month: period, email: recipient.email, client_id: recipient.clientId })),
        { onConflict: "period_month,email", ignoreDuplicates: true },
      )
      .select("id, email");
    if (reserveError) {
      failures.push(`réservation : ${reserveError.message}`);
      continue;
    }

    const reservedIds = new Map((reserved ?? []).map((row) => [String(row.email), row.id as string]));
    const batch = chunk.filter((recipient) => reservedIds.has(recipient.email));
    if (batch.length === 0) continue;
    const ids = batch.map((recipient) => reservedIds.get(recipient.email)!);

    const outcome = await sendEmailBatch(batch.map((recipient) => {
      const input = {
        firstName: recipient.firstName,
        clientNames: recipient.clientNames,
        quarter,
        reviewUrl: REVIEW_URL,
      };
      return {
        to: [recipient.email],
        subject: buildReviewSubject(input),
        html: buildReviewHtml(input),
        text: buildReviewText(input),
        replyTo: AGENCY_REPLY_TO,
        displayName: AGENCY_DISPLAY_NAME,
      };
    }));

    if (!outcome.sent) {
      failures.push(`envoi : ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ""}`);
      /*
       * Refus net : rien n'est parti, les réservations sont libérées pour le
       * rattrapage du lendemain. Issue inconnue (coupure, erreur serveur) :
       * elles restent — mieux vaut une demande manquée qu'un doublon.
       */
      if (outcome.reason === "rejected" || outcome.reason === "no_recipient" || outcome.reason === "not_configured") {
        const { error: releaseError } = await admin.from("client_review_requests").delete().in("id", ids);
        if (releaseError) {
          failures.push(`libération impossible (${releaseError.message}) : ${batch.map((recipient) => recipient.email).join(", ")}`);
        }
      }
      continue;
    }

    const sentAt = new Date().toISOString();
    await Promise.all(batch.map((_, index) => admin
      .from("client_review_requests")
      .update({ sent_at: sentAt, resend_id: outcome.ids[index] || null })
      .eq("id", ids[index])));
    sentCount += batch.length;
  }

  if (failures.length > 0) console.error("[avis google] échecs", failures);
  return {
    campaign,
    status: failures.length > 0 ? 502 : 200,
    body: { period, sent: sentCount, failures },
  };
}
