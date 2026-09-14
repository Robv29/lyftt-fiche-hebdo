import { clientLifecycle, todayInParis, type ClientKind } from "./client-lifecycle";

/**
 * Rendez-vous de suivi proposé chaque mois aux clients en gestion.
 *
 * Le 5 du mois, chaque contact qui reçoit le planning se voit proposer un
 * bilan du mois écoulé, avec un lien de réservation. Logique pure : qui reçoit
 * quoi se décide ici, sans réseau, pour pouvoir être testé sans rien envoyer.
 */

export const FOLLOW_UP_BOOKING_URL =
  "https://calendly.com/theo-simbert-lyftt/agence-lyftt-bilan-mensuel";

/** Jour d'envoi dans le mois. */
export const FOLLOW_UP_DAY = 5;

/*
 * Jours de rattrapage. Une exécution planifiée peut manquer — déploiement en
 * cours, messagerie indisponible — et un mois sans proposition de bilan ne se
 * rattrape pas. Les envois déjà faits étant consignés, repasser le lendemain
 * ne complète que ce qui manque.
 */
const CATCH_UP_DAYS = 2;

/** Mois de rattachement d'un envoi, au format de la base. */
export function followUpPeriod(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

export function isFollowUpDay(today: string): boolean {
  const day = Number(today.slice(8, 10));
  return day >= FOLLOW_UP_DAY && day <= FOLLOW_UP_DAY + CATCH_UP_DAYS;
}

/** Premier jour du mois précédent : le mois dont on fait le bilan. */
function reviewedMonthStart(today: string): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

/** Nom du mois dont on fait le bilan : le précédent. */
export function reviewedMonthName(today: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" })
    .format(new Date(`${reviewedMonthStart(today)}T00:00:00Z`));
}

export interface FollowUpContact {
  firstName: string | null;
  email: string | null;
  receivesPlanning: boolean;
}

export interface FollowUpClient {
  id: string;
  name: string;
  isActive: boolean;
  kind: ClientKind;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
  /** Création du dossier, qui tient lieu de début quand la date manque. */
  createdAt: string;
  /*
   * Faux pour les dossiers qui ne sont pas de vrais clients — l'agence
   * elle-même, un compte d'essai — et pour qui la refuse.
   */
  followUpEnabled: boolean;
  contacts: FollowUpContact[];
}

/** Un message : une boîte, et les clients dont elle suit le planning. */
export interface FollowUpRecipient {
  email: string;
  firstName: string | null;
  /** Presque toujours un seul ; plusieurs quand la même personne suit plusieurs dossiers. */
  clients: { id: string; name: string }[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Clé d'un envoi : un contact, pour un client, sur un mois. */
export function followUpKey(clientId: string, email: string): string {
  return `${clientId}|${email.trim().toLowerCase()}`;
}

/*
 * Mois commenté entièrement en pause : il n'y a rien eu à produire, donc rien
 * à commenter. La pause qui s'achève le 3 laisse le client « actif » le 5 —
 * c'est le mois écoulé qu'il faut regarder, pas le jour de l'envoi.
 */
function pausedThroughReviewedMonth(client: FollowUpClient, today: string): boolean {
  if (!client.pauseStartDate) return false;
  const first = reviewedMonthStart(today);
  const lastDate = new Date(`${followUpPeriod(today)}T00:00:00Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);
  const last = lastDate.toISOString().slice(0, 10);
  return client.pauseStartDate <= first
    && (client.pauseEndDate === null || client.pauseEndDate >= last);
}

/**
 * Destinataires du bilan de ce mois.
 *
 * - Bilan activé sur le dossier : ni l'agence elle-même, ni un compte d'essai.
 * - Client en gestion active : ni archivé, ni en pause, ni terminé, ni en
 *   prestation ponctuelle — il n'y a pas de mois à commenter.
 * - Gestion commencée avant le 1er du mois, et mois écoulé pas entièrement en
 *   pause : un client signé le 2 n'a encore rien à faire le point.
 * - Les contacts qui reçoivent le planning, un message par boîte : la même
 *   personne qui suit deux dossiers reçoit un seul message qui les nomme tous
 *   les deux, et non deux invitations identiques le même matin.
 */
export function followUpRecipients(input: {
  clients: readonly FollowUpClient[];
  today: string;
  /** Envois déjà consignés pour ce mois, par `followUpKey`. */
  alreadySent: ReadonlySet<string>;
}): FollowUpRecipient[] {
  const period = followUpPeriod(input.today);
  const byEmail = new Map<string, FollowUpRecipient>();

  // Ordre stable : le message nomme les dossiers toujours dans le même ordre.
  const clients = [...input.clients].sort((first, second) => first.name.localeCompare(second.name, "fr"));

  for (const client of clients) {
    if (!client.followUpEnabled) continue;

    const lifecycle = clientLifecycle({
      isActive: client.isActive,
      kind: client.kind,
      contractStartDate: client.contractStartDate,
      contractEndDate: client.contractEndDate,
      pauseStartDate: client.pauseStartDate,
      pauseEndDate: client.pauseEndDate,
    }, input.today);
    if (lifecycle.state !== "active") continue;

    // La création se lit à l'heure de Paris : un dossier créé le 1er à 0 h 30 l'est en septembre à Londres.
    const startedOn = client.contractStartDate ?? todayInParis(new Date(client.createdAt));
    if (startedOn >= period) continue;
    if (pausedThroughReviewedMonth(client, input.today)) continue;

    for (const contact of client.contacts) {
      const email = (contact.email ?? "").trim().toLowerCase();
      if (!contact.receivesPlanning || !EMAIL_PATTERN.test(email)) continue;
      if (input.alreadySent.has(followUpKey(client.id, email))) continue;

      const entry = byEmail.get(email) ?? { email, firstName: null, clients: [] };
      if (entry.clients.some((known) => known.id === client.id)) continue;
      entry.clients.push({ id: client.id, name: client.name });
      entry.firstName ??= contact.firstName?.trim() || null;
      byEmail.set(email, entry);
    }
  }

  return [...byEmail.values()];
}
