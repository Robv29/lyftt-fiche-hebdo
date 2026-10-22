/**
 * Créneaux de rendez-vous des produits de suivi mensuel.
 *
 * Un client qui détient un produit de la famille se voit proposer un rendez-vous
 * de suivi avec Théo autant de fois dans le mois que sa fréquence l'indique, à
 * intervalles réguliers. Logique pure : qui reçoit quoi, et quel jour, se
 * décide ici, sans réseau, pour être vérifiable sans rien envoyer.
 *
 * ── Les jours, et pourquoi ceux-là ─────────────────────────────────────────
 * Deux campagnes occupent déjà le calendrier du client : le bilan mensuel part
 * le 5 (rattrapage jusqu'au 7) et la demande d'avis Google le 15 (jusqu'au 17)
 * en janvier, avril, juillet et octobre. `review-request.ts` le dit en clair :
 * deux messages le même jour, c'est un de trop. Les créneaux évitent donc ces
 * deux fenêtres :
 *
 *   1 rendez-vous  → le 10
 *   2 rendez-vous  → le 10 et le 24      (deux semaines d'écart)
 *   3 rendez-vous  → le 9, le 19 et le 28 (une dizaine de jours d'écart)
 *
 * Le 28 plutôt que le 29 ou le 30 : le dernier créneau doit exister en février,
 * sans quoi un client à trois rendez-vous en perdrait un chaque année.
 *
 * ── Un client qui détient les deux produits ────────────────────────────────
 * Une invitation par créneau et par **client**, jamais par produit. Le dépôt a
 * déjà tranché la question pour le bilan mensuel : un message par boîte nommant
 * tous les dossiers, « et non deux invitations identiques le même matin ». Ici
 * c'est plus fort encore — le rendez-vous est le même, avec la même personne,
 * sur le même lien de réservation : deux invitations pour un créneau
 * demanderaient deux fois la même réunion. Le nombre de créneaux du mois est
 * donc le plus grand des deux fréquences, et le message nomme les sujets à
 * l'ordre du jour. Un client à 3 + 1 reçoit trois invitations, pas quatre, et
 * l'accompagnement marketing est à l'ordre du jour de la première.
 */

import { trackingClientIsServed, findTrackingProduct, type TrackingClientState } from "./monthly-tracking";
import { FOLLOW_UP_BOOKING_URL } from "./monthly-follow-up";

/**
 * Lien de réservation.
 *
 * C'est le même rendez-vous avec la même personne que le bilan mensuel : le
 * lien est donc **importé**, pas recopié. Si l'agenda de Théo devait un jour
 * distinguer les deux dans Calendly, c'est ici — et ici seulement — qu'une
 * nouvelle constante serait déclarée.
 */
export const TRACKING_BOOKING_URL = FOLLOW_UP_BOOKING_URL;

/** Jours du mois, par fréquence vendue. */
export const TRACKING_SLOT_DAYS: Readonly<Record<number, readonly number[]>> = {
  1: [10],
  2: [10, 24],
  3: [9, 19, 28],
};

/*
 * Jours de rattrapage, comme les deux autres campagnes : une exécution
 * planifiée peut manquer, et un créneau sauté ne se rattrape pas. Les envois
 * étant consignés, repasser le lendemain ne complète que ce qui manque.
 *
 * Seul le dernier créneau du mois peut être écourté : le 28 + 2 tombe sur des
 * jours qui n'existent pas en février. C'est le prix d'un créneau de fin de
 * mois présent tous les mois, et il n'enlève rien au jour d'envoi lui-même.
 */
const CATCH_UP_DAYS = 2;

export function trackingSlotDays(frequency: number): readonly number[] {
  return TRACKING_SLOT_DAYS[frequency] ?? TRACKING_SLOT_DAYS[1]!;
}

/** Mois de rattachement d'un envoi, au format de la base. */
export function trackingSlotPeriod(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Créneau dû aujourd'hui pour cette fréquence, ou `null`.
 *
 * Les fenêtres de rattrapage ne se chevauchent jamais — 10-12 et 24-26 ; 9-11,
 * 19-21 et 28-30 — : un jour donné ne peut donc appartenir qu'à un créneau.
 */
export function dueTrackingSlot(today: string, frequency: number): number | null {
  const day = Number(today.slice(8, 10));
  const days = trackingSlotDays(frequency);
  const index = days.findIndex((slotDay) => day >= slotDay && day <= slotDay + CATCH_UP_DAYS);
  return index === -1 ? null : index;
}

/** Y a-t-il un créneau à servir aujourd'hui, quelle que soit la fréquence ? */
export function isTrackingSlotDay(today: string): boolean {
  return Object.keys(TRACKING_SLOT_DAYS)
    .some((frequency) => dueTrackingSlot(today, Number(frequency)) !== null);
}

/** Clé d'un envoi : un contact, pour un client, sur un créneau du mois. */
export function trackingSlotKey(clientId: string, slotIndex: number, email: string): string {
  return `${clientId}|${slotIndex}|${email.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Qui reçoit
// ---------------------------------------------------------------------------

export interface TrackingInvitationContact {
  firstName: string | null;
  email: string | null;
  receivesPlanning: boolean;
}

export interface TrackingInvitationClient extends TrackingClientState {
  id: string;
  name: string;
  /*
   * Faux pour les dossiers qui ne sont pas de vrais clients — l'agence
   * elle-même, un compte d'essai — et pour qui refuse ces invitations.
   */
  invitationsEnabled: boolean;
  /** Produits de la famille en cours ce mois-ci, avec leur fréquence vendue. */
  products: readonly { key: string; frequency: number }[];
  contacts: readonly TrackingInvitationContact[];
}

export interface TrackingInvitationClientSlot {
  id: string;
  name: string;
  /** Rang du créneau dans le mois, à partir de 0 : il entre dans la clé d'envoi. */
  slotIndex: number;
  /** Nombre de créneaux du mois pour ce client : « 2ᵉ rendez-vous sur 3 ». */
  slotCount: number;
  /** Sujets à l'ordre du jour de ce créneau : seuls les produits qui l'ont payé. */
  topics: string[];
}

/** Un message : une boîte, et les dossiers qu'elle suit. */
export interface TrackingInvitationRecipient {
  email: string;
  firstName: string | null;
  clients: TrackingInvitationClientSlot[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Destinataires du créneau du jour.
 *
 * - Invitations activées sur le dossier.
 * - Client en état d'être servi : ni archivé, ni terminé, ni en pause.
 * - Au moins un produit de la famille en cours ce mois-ci.
 * - Un créneau dû aujourd'hui pour sa fréquence.
 * - Les contacts qui reçoivent le planning, un message par boîte : la même
 *   personne qui suit deux dossiers reçoit un seul message qui les nomme tous
 *   les deux.
 */
export function trackingInvitationRecipients(input: {
  clients: readonly TrackingInvitationClient[];
  today: string;
  /** Envois déjà consignés pour ce mois, par `trackingSlotKey`. */
  alreadySent: ReadonlySet<string>;
  /**
   * Aperçu hors calendrier : montre qui serait servi au premier créneau du
   * mois, au lieu de ne rien montrer les jours sans créneau. Faux sur un vrai
   * passage, où le calendrier décide seul.
   */
  previewFirstSlot?: boolean;
}): TrackingInvitationRecipient[] {
  const byEmail = new Map<string, TrackingInvitationRecipient>();

  // Ordre stable : le message nomme les dossiers toujours dans le même ordre.
  const clients = [...input.clients].sort((first, second) => first.name.localeCompare(second.name, "fr"));

  for (const client of clients) {
    if (!client.invitationsEnabled) continue;
    if (!trackingClientIsServed(client, input.today)) continue;
    if (client.products.length === 0) continue;

    /*
     * Le plus grand des produits décide du nombre de créneaux : c'est ce qui
     * protège du déluge un client qui détient les deux. Trois rendez-vous et
     * un rendez-vous, ce sont trois rendez-vous, pas quatre.
     */
    const slotCount = Math.max(...client.products.map((product) => product.frequency));
    const slotIndex = dueTrackingSlot(input.today, slotCount)
      ?? (input.previewFirstSlot ? 0 : null);
    if (slotIndex === null) continue;

    const topics = client.products
      /*
       * Un produit n'est à l'ordre du jour que des créneaux qu'il a payés : la
       * fréquence vendue est aussi la quantité facturée du mois. Trois rendez-
       * vous de budget pub et un d'accompagnement, c'est l'accompagnement sur
       * la première invitation seulement, pas sur les trois.
       */
      .filter((product) => slotIndex < product.frequency)
      .map((product) => findTrackingProduct(product.key))
      .filter((product): product is NonNullable<typeof product> => product !== undefined)
      .map((product) => product.meetingTopic);
    if (topics.length === 0) continue;

    for (const contact of client.contacts) {
      const email = (contact.email ?? "").trim().toLowerCase();
      if (!contact.receivesPlanning || !EMAIL_PATTERN.test(email)) continue;
      if (input.alreadySent.has(trackingSlotKey(client.id, slotIndex, email))) continue;

      const entry = byEmail.get(email) ?? { email, firstName: null, clients: [] };
      if (entry.clients.some((known) => known.id === client.id)) continue;
      entry.clients.push({ id: client.id, name: client.name, slotIndex, slotCount, topics });
      entry.firstName ??= contact.firstName?.trim() || null;
      byEmail.set(email, entry);
    }
  }

  return [...byEmail.values()];
}
