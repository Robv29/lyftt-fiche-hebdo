import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseClientKind } from "@/lib/domain/client-lifecycle";
import {
  FOLLOW_UP_BOOKING_URL,
  followUpKey,
  followUpPeriod,
  followUpRecipients,
  isFollowUpDay,
  reviewedMonthName,
} from "@/lib/domain/monthly-follow-up";
import {
  buildFollowUpHtml,
  buildFollowUpSubject,
  buildFollowUpText,
} from "@/lib/notifications/monthly-follow-up";
import { AGENCY_DISPLAY_NAME, AGENCY_REPLY_TO } from "@/lib/notifications/agency";
import { RESEND_BATCH_LIMIT, isEmailConfigured, sendEmailBatch } from "@/lib/notifications/resend";
import type { CampaignRun } from "./types";

/**
 * Bilan mensuel : le 5 du mois, chaque client en gestion active reçoit une
 * proposition de rendez-vous de suivi.
 *
 * Lancé chaque jour par la tâche des e-mails clients, il n'agit que du 5 au 7 :
 * le 5 envoie, les deux jours suivants rattrapent un passage manqué. Chaque
 * envoi est réservé en base avant de partir ; un contact déjà servi ce mois-ci
 * n'est jamais resollicité.
 *
 * En aperçu, il liste les destinataires du jour sans rien envoyer, même hors
 * calendrier — de quoi vérifier la liste avant un passage.
 */
export async function runMonthlyFollowUp(today: string, preview: boolean): Promise<CampaignRun> {
  const campaign = "bilan_mensuel";

  if (!preview && !isFollowUpDay(today)) {
    return { campaign, status: 200, body: { skipped: `Aucun bilan à proposer le ${today}.` } };
  }
  if (!preview && !isEmailConfigured()) {
    console.error("[bilan mensuel] messagerie non configurée");
    return { campaign, status: 503, body: { error: "Messagerie non configurée (RESEND_API_KEY et MAIL_FROM)." } };
  }

  const admin = createSupabaseAdminClient();
  const period = followUpPeriod(today);

  const [{ data: clients, error: clientsError }, { data: sent, error: sentError }] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date, created_at, monthly_follow_up, client_contacts ( first_name, email, receives_planning )")
      .eq("is_active", true),
    admin
      .from("client_follow_up_emails")
      .select("client_id, email")
      .eq("period_month", period),
  ]);

  // Sans la liste des envois déjà faits, on risquerait d'écrire deux fois : on s'arrête.
  if (clientsError || sentError) {
    const message = clientsError?.message ?? sentError?.message;
    console.error("[bilan mensuel] lecture impossible", message);
    return { campaign, status: 500, body: { error: `Lecture impossible : ${message}` } };
  }

  const recipients = followUpRecipients({
    today,
    alreadySent: new Set((sent ?? []).map((row) => followUpKey(row.client_id as string, row.email as string))),
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
      followUpEnabled: row.monthly_follow_up !== false,
      contacts: ((row.client_contacts ?? []) as { first_name: string | null; email: string | null; receives_planning: boolean | null }[])
        .map((contact) => ({
          firstName: contact.first_name,
          email: contact.email,
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
        recipients: recipients.map((recipient) => ({
          email: recipient.email,
          clients: recipient.clients.map((client) => client.name),
        })),
      },
    };
  }

  const reviewedMonth = reviewedMonthName(today);
  let sentCount = 0;
  const failures: string[] = [];

  for (let start = 0; start < recipients.length; start += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(start, start + RESEND_BATCH_LIMIT);

    /*
     * Réservation avant l'envoi, une ligne par client nommé dans le message.
     * Une ligne déjà réservée — par une exécution concurrente — n'est pas
     * renvoyée par la base : le message ne nomme que les dossiers réservés
     * ici, et part seulement s'il en reste un.
     */
    const { data: reserved, error: reserveError } = await admin
      .from("client_follow_up_emails")
      .upsert(
        chunk.flatMap((recipient) => recipient.clients.map((client) => ({
          client_id: client.id,
          period_month: period,
          email: recipient.email,
        }))),
        { onConflict: "client_id,period_month,email", ignoreDuplicates: true },
      )
      .select("id, client_id, email");
    if (reserveError) {
      failures.push(`réservation : ${reserveError.message}`);
      continue;
    }

    const reservedIds = new Map((reserved ?? []).map((row) => [
      followUpKey(row.client_id as string, row.email as string),
      row.id as string,
    ]));

    const batch = chunk
      .map((recipient) => {
        const clientsHere = recipient.clients.filter((client) => reservedIds.has(followUpKey(client.id, recipient.email)));
        return {
          recipient,
          clientsHere,
          ids: clientsHere.map((client) => reservedIds.get(followUpKey(client.id, recipient.email))!),
        };
      })
      .filter((entry) => entry.clientsHere.length > 0);
    if (batch.length === 0) continue;
    const allIds = batch.flatMap((entry) => entry.ids);

    const outcome = await sendEmailBatch(batch.map(({ recipient, clientsHere }) => {
      const input = {
        clientNames: clientsHere.map((client) => client.name),
        firstName: recipient.firstName,
        reviewedMonth,
        bookingUrl: FOLLOW_UP_BOOKING_URL,
      };
      return {
        to: [recipient.email],
        subject: buildFollowUpSubject(input),
        html: buildFollowUpHtml(input),
        text: buildFollowUpText(input),
        replyTo: AGENCY_REPLY_TO,
        displayName: AGENCY_DISPLAY_NAME,
      };
    }));

    if (!outcome.sent) {
      failures.push(`envoi : ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ""}`);
      /*
       * Refus net de la messagerie : rien n'est parti, on libère les
       * réservations pour que le rattrapage du lendemain réessaie. Sur une
       * coupure réseau ou une erreur serveur, l'issue est inconnue — les
       * messages sont peut-être partis — et la réservation reste : mieux vaut
       * un bilan manqué qu'un doublon chez le client.
       */
      if (outcome.reason === "rejected" || outcome.reason === "no_recipient" || outcome.reason === "not_configured") {
        const { error: releaseError } = await admin.from("client_follow_up_emails").delete().in("id", allIds);
        if (releaseError) {
          // Réservations restées en place : ces contacts ne seront pas retentés sans intervention.
          failures.push(`libération impossible (${releaseError.message}) : ${batch.map((entry) => entry.recipient.email).join(", ")}`);
        }
      }
      continue;
    }

    const sentAt = new Date().toISOString();
    await Promise.all(batch.flatMap((entry, index) => entry.ids.map((id) => admin
      .from("client_follow_up_emails")
      .update({ sent_at: sentAt, resend_id: outcome.ids[index] || null })
      .eq("id", id))));
    sentCount += batch.length;
  }

  if (failures.length > 0) console.error("[bilan mensuel] échecs", failures);
  return {
    campaign,
    status: failures.length > 0 ? 502 : 200,
    body: { period, sent: sentCount, failures },
  };
}
