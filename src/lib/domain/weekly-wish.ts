import { formatPeriod } from "./deadline";

/**
 * « Vos envies » — ce que le client aimerait pour la semaine suivante.
 *
 * Une envie n'est pas une correction. Elle ne porte sur aucune publication de
 * la fiche en cours : elle dit ce que le client voudrait voir la semaine
 * d'après — un produit à mettre en avant, un événement, un sujet. Jusqu'ici
 * cela arrivait par message, au mieux, et se perdait.
 *
 * Elle est recueillie au moment où le client vient de regarder ses
 * publications, à côté de la validation finale, et jamais à la place : valider
 * reste un clic, et une envie peut partir sans validation comme après elle.
 *
 * Ce module ne contient que la règle : la semaine visée, le titre du ticket,
 * les bornes du texte et le plafond. Aucun accès base, aucun rendu.
 */

/**
 * Bornes du texte.
 *
 * Dix caractères au minimum, comme une demande hors publication : en dessous,
 * il n'y a rien à exploiter. Mille cinq cents au maximum : une envie se dit en
 * quelques phrases, et le champ sert aussi de garde-fou sur un portail public.
 */
export const WISH_MIN_LENGTH = 10;
export const WISH_MAX_LENGTH = 1500;

/** Jour civil `AAAA-MM-JJ`, décalé de `days` jours. Nul si la date est illisible. */
function addDays(day: string, days: number): string | null {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface WeekRange {
  start: string;
  end: string;
}

/**
 * Semaine visée par une envie : celle qui suit la fiche consultée.
 *
 * Le client regarde la semaine N et parle de la semaine N+1. La fiche porte
 * ses propres bornes — on ne devine pas un lundi, on prend le lendemain de sa
 * fin de période et les sept jours qui suivent.
 */
export function nextWeekRange(periodEnd: string): WeekRange | null {
  const start = addDays(periodEnd, 1);
  const end = addDays(periodEnd, 7);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Titre du ticket.
 *
 * Il nourrit la liste des retours (« type — titre ») et l'historique : il doit
 * dire de quelle semaine on parle, sans quoi une envie déposée en semaine 41
 * se lit comme une demande *sur* la semaine 41.
 */
export function wishTicketTitle(periodEnd: string): string {
  const range = nextWeekRange(periodEnd);
  if (!range) return "Semaine prochaine";
  return `Semaine ${formatPeriod(
    new Date(`${range.start}T00:00:00Z`),
    new Date(`${range.end}T00:00:00Z`),
  )}`;
}

/** Envie déjà déposée sur cette fiche, telle qu'on la relit en base. */
export interface ExistingWish {
  ticketNumber: string;
  /** Faux dès que l'agence l'a marquée prise en compte. */
  isOpen: boolean;
}

export type WishGuard =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Une envie par fiche, c'est-à-dire une par semaine.
 *
 * C'est le même modèle que la note de satisfaction : la question est posée une
 * fois, au bon moment. Sans ce plafond, la limite de vingt tickets par heure
 * laisserait passer vingt envies pour la même semaine — et vingt tickets à
 * Théo pour un seul besoin.
 *
 * Le refus est doux et nomme la référence : le client doit comprendre que son
 * envie est arrivée, pas qu'elle a échoué.
 */
export function canSubmitWish(existing: ExistingWish | null): WishGuard {
  if (!existing) return { allowed: true };

  return {
    allowed: false,
    message: existing.isOpen
      ? `C'est déjà noté : votre envie pour la semaine prochaine porte la référence ${existing.ticketNumber}. Votre community manager revient vers vous.`
      : `Votre envie pour la semaine prochaine (${existing.ticketNumber}) a déjà été prise en compte. Pour un nouveau besoin, parlez-en à votre community manager.`,
  };
}
