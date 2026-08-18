/**
 * Le délai promis au client sur un retour.
 *
 * L'échéance d'un ticket était celle de la fiche : un retour arrivé le lundi
 * pour une semaine validée le vendredi passait pour « dans les temps » pendant
 * quatre jours. Ce qui compte est autre chose — l'heure à laquelle le retour
 * est arrivé. À partir de là, vingt heures pour renvoyer au client un lien
 * avec la correction faite.
 *
 * Vingt heures et non un jour ouvré : un retour reçu à 16 h se répond le
 * lendemain midi, pas le surlendemain.
 */

export const TICKET_SLA_HOURS = 20;

const HOUR = 3_600_000;

/** L'heure limite d'un ticket, déduite de son arrivée. */
export function ticketDeadline(submittedAt: string | Date): Date {
  return new Date(new Date(submittedAt).getTime() + TICKET_SLA_HOURS * HOUR);
}

/**
 * `tenu` : la correction est partie dans les temps.
 * `depasse` : elle est partie trop tard, ou elle n'est toujours pas partie.
 * `en_cours` : le compteur tourne encore, rien à juger.
 */
export type TicketSlaState = "tenu" | "depasse" | "en_cours";

export interface TicketSlaInput {
  submittedAt: string;
  /**
   * Moment où la correction est repartie chez le client.
   *
   * Ce n'est pas la clôture du ticket : `resolved_at` n'est presque jamais
   * renseigné — douze tickets validés par le client sur treize n'en portent
   * aucun. Ce qui fait foi est l'envoi de la version corrigée, c'est-à-dire le
   * lien que le client a reçu. La clôture ne sert que de repli.
   */
  respondedAt: string | null;
}

export function ticketSlaState(ticket: TicketSlaInput, now: Date = new Date()): TicketSlaState {
  const deadline = ticketDeadline(ticket.submittedAt);
  if (ticket.respondedAt) {
    return new Date(ticket.respondedAt) <= deadline ? "tenu" : "depasse";
  }
  /*
   * Un ticket encore ouvert dont l'heure est passée est déjà en faute :
   * attendre sa clôture pour le compter effacerait les retards les plus
   * longs, ceux que personne n'a traités.
   */
  return now > deadline ? "depasse" : "en_cours";
}

/** Heures restantes avant l'échéance ; négatif quand elle est dépassée. */
export function ticketHoursLeft(submittedAt: string, now: Date = new Date()): number {
  return Math.round(((ticketDeadline(submittedAt).getTime() - now.getTime()) / HOUR) * 10) / 10;
}

export interface TicketSlaSummary {
  /** Tickets jugeables : tenus + dépassés. Les compteurs en cours en sont exclus. */
  measured: number;
  onTime: number;
  late: number;
  running: number;
  /** Part des tickets tenus, ou null quand rien n'est jugeable. */
  percentage: number | null;
  /** Retard du pire ticket, en heures, pour dire l'ampleur et pas seulement le nombre. */
  worstLateHours: number | null;
}

export function ticketSlaSummary(
  tickets: readonly TicketSlaInput[],
  now: Date = new Date(),
): TicketSlaSummary {
  let onTime = 0;
  let late = 0;
  let running = 0;
  let worstLateHours: number | null = null;

  for (const ticket of tickets) {
    const state = ticketSlaState(ticket, now);
    if (state === "en_cours") { running += 1; continue; }
    if (state === "tenu") { onTime += 1; continue; }
    late += 1;
    const reference = ticket.respondedAt ? new Date(ticket.respondedAt) : now;
    const lateHours = Math.round(
      ((reference.getTime() - ticketDeadline(ticket.submittedAt).getTime()) / HOUR) * 10,
    ) / 10;
    if (worstLateHours === null || lateHours > worstLateHours) worstLateHours = lateHours;
  }

  const measured = onTime + late;
  return {
    measured,
    onTime,
    late,
    running,
    percentage: measured === 0 ? null : Math.round((onTime / measured) * 100),
    worstLateHours,
  };
}
