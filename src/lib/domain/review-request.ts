import { clientLifecycle, todayInParis, type ClientKind } from "./client-lifecycle";

/**
 * Demande d'avis Google, une fois par trimestre.
 *
 * Logique pure : qui reçoit quoi se décide ici, sans réseau, pour pouvoir être
 * testé sans rien envoyer. La demande part à tous les clients actifs, sans tri
 * sur leur satisfaction supposée : solliciter seulement les contents serait
 * contraire aux règles de Google, et fausserait ce que les avis disent.
 */

export const REVIEW_URL = "https://g.page/r/CYAzDpK1ny7oEAE/review";

/** Premier mois de chaque trimestre. */
const REVIEW_MONTHS = [1, 4, 7, 10];
/** Jour d'envoi : loin du 5, où part le bilan mensuel — deux messages le même jour, c'est un de trop. */
export const REVIEW_DAY = 15;
/** Jours de rattrapage si l'exécution du 15 a manqué. */
const CATCH_UP_DAYS = 2;
/** Un client signé la semaine dernière n'a encore rien à juger. */
export const REVIEW_MIN_SENIORITY_DAYS = 30;

export function isReviewRequestDay(today: string): boolean {
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  return REVIEW_MONTHS.includes(month) && day >= REVIEW_DAY && day <= REVIEW_DAY + CATCH_UP_DAYS;
}

/** Trimestre civil, de 1 à 4. */
export function reviewQuarter(today: string): 1 | 2 | 3 | 4 {
  return (Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Premier jour du trimestre : la clé d'un envoi, pour n'écrire qu'une fois par trimestre. */
export function reviewPeriod(today: string): string {
  const firstMonth = (reviewQuarter(today) - 1) * 3 + 1;
  return `${today.slice(0, 4)}-${String(firstMonth).padStart(2, "0")}-01`;
}

export interface ReviewContact {
  firstName: string | null;
  email: string | null;
  isPrimary: boolean;
  receivesPlanning: boolean;
}

export interface ReviewClient {
  id: string;
  name: string;
  isActive: boolean;
  kind: ClientKind;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
  createdAt: string;
  /* Faux pour l'agence elle-même, un compte d'essai, ou un client qui refuse. */
  reviewEnabled: boolean;
  contacts: ReviewContact[];
}

export interface ReviewRecipient {
  email: string;
  firstName: string | null;
  /** Premier dossier du contact, gardé comme trace de l'envoi. */
  clientId: string;
  clientNames: string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function daysBetween(from: string, to: string): number {
  return (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
}

/**
 * Destinataires de la demande d'avis de ce trimestre.
 *
 * - Clients actifs : en gestion (ni en pause, ni terminée, ni à venir) ou en
 *   prestation ponctuelle — un client ponctuel a, lui aussi, un avis à donner.
 * - Clients depuis au moins trente jours.
 * - Leurs contacts principaux ou destinataires du planning.
 * - Un seul message par adresse et par trimestre : l'avis porte sur l'agence,
 *   pas sur un dossier ; la même personne qui en suit deux n'est sollicitée
 *   qu'une fois, et le message nomme ses dossiers.
 */
export function reviewRequestRecipients(input: {
  clients: readonly ReviewClient[];
  today: string;
  /** Adresses à ne pas solliciter : déjà servies ce trimestre, ou désinscrites. */
  alreadySent: ReadonlySet<string>;
}): ReviewRecipient[] {
  const byEmail = new Map<string, ReviewRecipient>();
  const namesByEmail = new Map<string, Set<string>>();
  const clients = [...input.clients].sort((first, second) => first.name.localeCompare(second.name, "fr"));

  for (const client of clients) {
    if (!client.reviewEnabled) continue;

    const state = clientLifecycle({
      isActive: client.isActive,
      kind: client.kind,
      contractStartDate: client.contractStartDate,
      contractEndDate: client.contractEndDate,
      pauseStartDate: client.pauseStartDate,
      pauseEndDate: client.pauseEndDate,
    }, input.today).state;
    if (state !== "active" && state !== "one_shot") continue;

    const since = client.contractStartDate ?? todayInParis(new Date(client.createdAt));
    if (daysBetween(since, input.today) < REVIEW_MIN_SENIORITY_DAYS) continue;

    for (const contact of client.contacts) {
      if (!contact.isPrimary && !contact.receivesPlanning) continue;
      const email = (contact.email ?? "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email) || input.alreadySent.has(email)) continue;

      const entry = byEmail.get(email) ?? { email, firstName: null, clientId: client.id, clientNames: [] };
      if (!entry.clientNames.includes(client.name)) entry.clientNames.push(client.name);
      const name = contact.firstName?.trim();
      if (name) {
        const names = namesByEmail.get(email) ?? new Set<string>();
        names.add(name.toLocaleLowerCase("fr"));
        namesByEmail.set(email, names);
        entry.firstName ??= name;
      }
      byEmail.set(email, entry);
    }
  }

  /*
   * Une boîte partagée par plusieurs personnes — la boutique, le couple de
   * gérants — ne se salue pas d'un seul prénom pris au hasard : « Bonjour, ».
   */
  return [...byEmail.values()].map((entry) =>
    (namesByEmail.get(entry.email)?.size ?? 0) > 1 ? { ...entry, firstName: null } : entry);
}
