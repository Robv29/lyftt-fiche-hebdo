import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Le délai promis au client sur un retour.
 *
 * L'échéance d'un ticket était celle de la fiche : un retour arrivé le lundi
 * pour une semaine validée le vendredi passait pour « dans les temps » pendant
 * quatre jours. Ce qui compte est autre chose — l'heure à laquelle le retour
 * est arrivé, puis vingt heures **ouvrées** pour renvoyer au client un lien
 * avec la correction faite.
 *
 * Ouvrées, et non calendaires : un compteur qui tourne la nuit et le week-end
 * plaçait l'échéance d'un retour reçu le samedi matin au dimanche 5 h 54. On
 * était en faute avant d'avoir eu la moindre chance de répondre, et l'agence
 * aurait fini par ne plus regarder l'indicateur.
 */

/**
 * Dix heures ouvrées, soit une journée de travail et une heure : un retour
 * reçu un jour se répond le jour ouvré suivant, pas deux jours plus tard.
 * Vingt heures ouvrées ne mordait jamais — aucun retard sur l'historique.
 */
export const TICKET_SLA_HOURS = 10;
export const SLA_TIMEZONE = "Europe/Paris";
/** Journée de travail : 9 h – 18 h, soit neuf heures utiles. */
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

const HOUR = 3_600_000;

/** Champs civils d'un instant, lus dans le fuseau de l'agence. */
function parisFields(date: Date): { day: string; hour: number; minute: number; weekday: number } {
  const [day, clock, weekday] = formatInTimeZone(date, SLA_TIMEZONE, "yyyy-MM-dd|HH:mm|i").split("|");
  const [hour, minute] = clock.split(":").map(Number);
  return { day, hour, minute, weekday: Number(weekday) };
}

/** Instant correspondant à une heure civile parisienne (heure d'été comprise). */
function parisInstant(day: string, hour: number, minute = 0): Date {
  return fromZonedTime(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, SLA_TIMEZONE);
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * Dimanche de Pâques, algorithme de Meeus/Jones/Butcher.
 *
 * Trois fériés français en dépendent — lundi de Pâques, Ascension, lundi de
 * Pentecôte. Les coder en dur aurait fait vieillir la règle d'un an.
 */
function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

const holidayCache = new Map<number, Set<string>>();

/** Jours fériés français d'une année, en dates civiles. */
export function frenchHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const days = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
    `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
    addDays(easter, 1),  // lundi de Pâques
    addDays(easter, 39), // Ascension
    addDays(easter, 50), // lundi de Pentecôte
  ]);
  holidayCache.set(year, days);
  return days;
}

function isWorkingDay(day: string, weekday: number): boolean {
  if (weekday > 5) return false;
  return !frenchHolidays(Number(day.slice(0, 4))).has(day);
}

/** Ouverture de la prochaine journée travaillée, à partir d'un jour donné. */
function nextOpening(day: string): Date {
  let cursor = day;
  for (let guard = 0; guard < 400; guard += 1) {
    const opening = parisInstant(cursor, WORK_START_HOUR);
    if (isWorkingDay(cursor, parisFields(opening).weekday)) return opening;
    cursor = addDays(cursor, 1);
  }
  // Inatteignable : quatre cents jours sans un seul jour ouvré n'existent pas.
  return parisInstant(cursor, WORK_START_HOUR);
}

/**
 * Le compteur démarre à l'ouverture suivante.
 *
 * Un retour déposé à 6 h 42 ou un samedi ne consomme pas de délai avant que
 * quelqu'un puisse s'en occuper.
 */
function workingStart(from: Date): Date {
  const { day, hour, minute, weekday } = parisFields(from);
  if (!isWorkingDay(day, weekday)) return nextOpening(day);
  if (hour < WORK_START_HOUR) return parisInstant(day, WORK_START_HOUR);
  if (hour >= WORK_END_HOUR) return nextOpening(addDays(day, 1));
  return parisInstant(day, hour, minute);
}

/** Instant obtenu en consommant `hours` heures ouvrées à partir de `from`. */
export function addWorkingHours(from: Date, hours: number): Date {
  let cursor = workingStart(from);
  let remaining = hours * HOUR;

  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    const { day } = parisFields(cursor);
    const closing = parisInstant(day, WORK_END_HOUR);
    const available = closing.getTime() - cursor.getTime();
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = nextOpening(addDays(day, 1));
  }
  return cursor;
}

/** Heures ouvrées écoulées entre deux instants. */
export function workingHoursBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let cursor = workingStart(from);
  let total = 0;

  for (let guard = 0; guard < 400; guard += 1) {
    if (cursor >= to) break;
    const { day } = parisFields(cursor);
    const closing = parisInstant(day, WORK_END_HOUR);
    const slice = Math.min(closing.getTime(), to.getTime()) - cursor.getTime();
    if (slice > 0) total += slice;
    if (closing >= to) break;
    cursor = nextOpening(addDays(day, 1));
  }
  return Math.round((total / HOUR) * 10) / 10;
}

/** L'heure limite d'un ticket, déduite de son arrivée. */
export function ticketDeadline(submittedAt: string | Date): Date {
  return addWorkingHours(new Date(submittedAt), TICKET_SLA_HOURS);
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

/** Heures ouvrées restantes avant l'échéance ; négatif quand elle est passée. */
export function ticketHoursLeft(submittedAt: string, now: Date = new Date()): number {
  const deadline = ticketDeadline(submittedAt);
  if (now <= deadline) return workingHoursBetween(now, deadline);
  return -workingHoursBetween(deadline, now);
}

export interface TicketSlaSummary {
  /** Tickets jugeables : tenus + dépassés. Les compteurs en cours en sont exclus. */
  measured: number;
  onTime: number;
  late: number;
  running: number;
  /** Part des tickets tenus, ou null quand rien n'est jugeable. */
  percentage: number | null;
  /** Retard du pire ticket, en heures ouvrées, pour dire l'ampleur et pas seulement le nombre. */
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
    const lateHours = workingHoursBetween(ticketDeadline(ticket.submittedAt), reference);
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
