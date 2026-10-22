import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseClientKind } from "@/lib/domain/client-lifecycle";
import { TRACKING_SERVICE_KEYS, parseTrackingFrequency } from "@/lib/domain/monthly-tracking";
import {
  TRACKING_BOOKING_URL,
  isTrackingSlotDay,
  trackingInvitationRecipients,
  trackingSlotKey,
  trackingSlotPeriod,
} from "@/lib/domain/monthly-tracking-slots";
import {
  buildTrackingInvitationHtml,
  buildTrackingInvitationSubject,
  buildTrackingInvitationText,
} from "@/lib/notifications/tracking-invitation";
import { AGENCY_DISPLAY_NAME, AGENCY_REPLY_TO } from "@/lib/notifications/agency";
import { RESEND_BATCH_LIMIT, isEmailConfigured, sendEmailBatch } from "@/lib/notifications/resend";
import type { CampaignRun } from "./types";

/**
 * Invitations aux rendez-vous de suivi des produits de suivi mensuel.
 *
 * Même mécanique que le bilan mensuel et la demande d'avis : lancée chaque jour
 * par la tâche des e-mails clients, elle n'agit que les jours de créneau — le
 * 10 pour une fréquence de 1, le 10 et le 24 pour 2, le 9, le 19 et le 28 pour
 * 3 —, avec deux jours de rattrapage. Chaque envoi est réservé en base avant de
 * partir : un contact déjà servi sur ce créneau n'est jamais resollicité, même
 * si la tâche repasse le lendemain.
 *
 * Un client qui détient les deux produits reçoit **une** invitation par
 * créneau, et non une par produit : le nombre de créneaux est le plus grand des
 * deux fréquences, et l'ordre du jour les nomme tous les deux. La clé d'unicité
 * en base porte donc le créneau, pas le produit — c'est elle qui tient la
 * décision.
 *
 * En aperçu, elle liste les destinataires du jour sans rien envoyer, même hors
 * calendrier.
 */
export async function runTrackingInvitations(today: string, preview: boolean): Promise<CampaignRun> {
  const campaign = "suivi_mensuel";

  if (!preview && !isTrackingSlotDay(today)) {
    return { campaign, status: 200, body: { skipped: `Aucun créneau de suivi le ${today}.` } };
  }
  if (!preview && !isEmailConfigured()) {
    console.error("[suivi mensuel] messagerie non configurée");
    return { campaign, status: 503, body: { error: "Messagerie non configurée (RESEND_API_KEY et MAIL_FROM)." } };
  }

  const admin = createSupabaseAdminClient();
  const period = trackingSlotPeriod(today);

  const [
    { data: clients, error: clientsError },
    { data: subscriptions, error: subscriptionsError },
    { data: sent, error: sentError },
  ] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date, tracking_invitations, client_contacts ( first_name, email, receives_planning )")
      .eq("is_active", true),
    /*
     * La fréquence se lit sur la prestation vendue, pas sur la ligne de budget :
     * c'est la souscription qui dit ce qui est en cours ce mois-ci, même avant
     * que la tâche de nuit ait inscrit la ligne du mois.
     */
    admin
      .from("client_tracking_services")
      .select("client_id, service_key, frequency, started_on, ended_on")
      .lte("started_on", period)
      .or(`ended_on.is.null,ended_on.gte.${period}`),
    admin
      .from("client_tracking_invitations")
      .select("client_id, slot_index, email")
      .eq("period_month", period),
  ]);

  // Sans la liste des envois déjà faits, on risquerait d'écrire deux fois : on s'arrête.
  if (clientsError || subscriptionsError || sentError) {
    const message = clientsError?.message ?? subscriptionsError?.message ?? sentError?.message;
    console.error("[suivi mensuel] lecture impossible", message);
    return { campaign, status: 500, body: { error: `Lecture impossible : ${message}` } };
  }

  const productsByClient = new Map<string, { key: string; frequency: number }[]>();
  for (const row of subscriptions ?? []) {
    const key = row.service_key as string;
    const frequency = parseTrackingFrequency(row.frequency);
    // Une clé hors catalogue ou une fréquence hors plafond ne décide de rien.
    if (!TRACKING_SERVICE_KEYS.includes(key) || frequency === null) continue;
    const list = productsByClient.get(row.client_id as string) ?? [];
    list.push({ key, frequency });
    productsByClient.set(row.client_id as string, list);
  }

  const recipients = trackingInvitationRecipients({
    today,
    // Aperçu demandé un jour sans créneau : on montre le premier du mois, pour
    // que la liste puisse être relue avant le matin de l'envoi.
    previewFirstSlot: preview && !isTrackingSlotDay(today),
    alreadySent: new Set((sent ?? []).map((row) =>
      trackingSlotKey(row.client_id as string, Number(row.slot_index), row.email as string))),
    clients: (clients ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      isActive: Boolean(row.is_active),
      kind: parseClientKind(row.client_kind),
      contractStartDate: (row.contract_start_date as string | null) ?? null,
      contractEndDate: (row.contract_end_date as string | null) ?? null,
      pauseStartDate: (row.pause_start_date as string | null) ?? null,
      pauseEndDate: (row.pause_end_date as string | null) ?? null,
      // Une valeur absente vaut « activé » : c'est le réglage par défaut en base.
      invitationsEnabled: row.tracking_invitations !== false,
      products: productsByClient.get(row.id as string) ?? [],
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
          clients: recipient.clients.map((client) =>
            `${client.name} (${client.slotIndex + 1}/${client.slotCount})`),
        })),
      },
    };
  }

  let sentCount = 0;
  const failures: string[] = [];

  for (let start = 0; start < recipients.length; start += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(start, start + RESEND_BATCH_LIMIT);

    /*
     * Réservation avant l'envoi, une ligne par dossier nommé dans le message.
     * Une ligne déjà réservée — par une exécution concurrente — n'est pas
     * renvoyée par la base : le message ne nomme que les dossiers réservés
     * ici, et ne part que s'il en reste un.
     */
    const { data: reserved, error: reserveError } = await admin
      .from("client_tracking_invitations")
      .upsert(
        chunk.flatMap((recipient) => recipient.clients.map((client) => ({
          client_id: client.id,
          period_month: period,
          slot_index: client.slotIndex,
          email: recipient.email,
        }))),
        { onConflict: "client_id,period_month,slot_index,email", ignoreDuplicates: true },
      )
      .select("id, client_id, slot_index, email");
    if (reserveError) {
      failures.push(`réservation : ${reserveError.message}`);
      continue;
    }

    const reservedIds = new Map((reserved ?? []).map((row) => [
      trackingSlotKey(row.client_id as string, Number(row.slot_index), row.email as string),
      row.id as string,
    ]));

    const batch = chunk
      .map((recipient) => {
        const clientsHere = recipient.clients.filter((client) =>
          reservedIds.has(trackingSlotKey(client.id, client.slotIndex, recipient.email)));
        return {
          recipient,
          clientsHere,
          ids: clientsHere.map((client) =>
            reservedIds.get(trackingSlotKey(client.id, client.slotIndex, recipient.email))!),
        };
      })
      .filter((entry) => entry.clientsHere.length > 0);
    if (batch.length === 0) continue;
    const allIds = batch.flatMap((entry) => entry.ids);

    const outcome = await sendEmailBatch(batch.map(({ recipient, clientsHere }) => {
      const first = clientsHere[0]!;
      /*
       * Le rang n'est annoncé que s'il vaut pour tout le message. Une boîte qui
       * suit deux dossiers aux fréquences différentes recevrait sinon « 2ᵉ des
       * 3 » pour un dossier qui n'en a qu'un : mieux vaut ne rien dire que dire
       * faux. `slotCount: 1` éteint la phrase.
       */
      const sameRank = clientsHere.every((client) =>
        client.slotIndex === first.slotIndex && client.slotCount === first.slotCount);
      const input = {
        clientNames: clientsHere.map((client) => client.name),
        firstName: recipient.firstName,
        // Sujets de tous les dossiers nommés, sans doublon : c'est un seul rendez-vous.
        topics: [...new Set(clientsHere.flatMap((client) => client.topics))],
        slotNumber: sameRank ? first.slotIndex + 1 : 1,
        slotCount: sameRank ? first.slotCount : 1,
        bookingUrl: TRACKING_BOOKING_URL,
      };
      return {
        to: [recipient.email],
        subject: buildTrackingInvitationSubject(input),
        html: buildTrackingInvitationHtml(input),
        text: buildTrackingInvitationText(input),
        replyTo: AGENCY_REPLY_TO,
        displayName: AGENCY_DISPLAY_NAME,
      };
    }));

    if (!outcome.sent) {
      failures.push(`envoi : ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ""}`);
      /*
       * Refus net de la messagerie : rien n'est parti, on libère les
       * réservations pour que le rattrapage du lendemain réessaie. Sur une
       * coupure réseau ou une erreur serveur, l'issue est inconnue et la
       * réservation reste : mieux vaut une invitation manquée qu'un doublon.
       */
      if (outcome.reason === "rejected" || outcome.reason === "no_recipient" || outcome.reason === "not_configured") {
        const { error: releaseError } = await admin.from("client_tracking_invitations").delete().in("id", allIds);
        if (releaseError) {
          failures.push(`libération impossible (${releaseError.message}) : ${batch.map((entry) => entry.recipient.email).join(", ")}`);
        }
      }
      continue;
    }

    const sentAt = new Date().toISOString();
    await Promise.all(batch.flatMap((entry, index) => entry.ids.map((id) => admin
      .from("client_tracking_invitations")
      .update({ sent_at: sentAt, resend_id: outcome.ids[index] || null })
      .eq("id", id))));
    sentCount += batch.length;
  }

  if (failures.length > 0) console.error("[suivi mensuel] échecs", failures);
  return {
    campaign,
    status: failures.length > 0 ? 502 : 200,
    body: { period, sent: sentCount, failures },
  };
}
