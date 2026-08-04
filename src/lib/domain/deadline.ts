import { differenceInMinutes } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";

/**
 * §3 — Échéance de validation client.
 *
 * La fiche est préparée le vendredi pour la semaine suivante ; le client valide
 * en général avant le mardi 10 h. Rien n'est écrit en dur : le jour, l'heure et
 * le fuseau viennent du paramétrage client, et la date exacte est calculée à
 * partir de la semaine de publication.
 */

export const DEFAULT_TIMEZONE = "Europe/Paris";
export const DEFAULT_DEADLINE_WEEKDAY = 2; // mardi (ISO : 1 = lundi)
export const DEFAULT_DEADLINE_TIME = "10:00";

export interface DeadlineSettings {
  /** 1 = lundi … 7 = dimanche (ISO 8601). */
  weekday: number;
  /** "HH:mm" ou "HH:mm:ss". */
  time: string;
  timezone: string;
}

export const DEFAULT_DEADLINE_SETTINGS: DeadlineSettings = {
  weekday: DEFAULT_DEADLINE_WEEKDAY,
  time: DEFAULT_DEADLINE_TIME,
  timezone: DEFAULT_TIMEZONE,
};

/** Lundi de la semaine ISO demandée, en date civile. */
export function isoWeekStart(isoYear: number, isoWeek: number): Date {
  // Le 4 janvier appartient toujours à la semaine ISO 1.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Isodow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Isodow - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;
}

function parseTime(time: string): { hours: number; minutes: number } {
  const [rawHours, rawMinutes] = time.split(":");
  const hours = Number.parseInt(rawHours ?? "", 10);
  const minutes = Number.parseInt(rawMinutes ?? "0", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Heure d'échéance invalide : "${time}"`);
  }
  return { hours, minutes };
}

function isoDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Date civile (yyyy-MM-dd) d'une date de période, lue en UTC. */
function civilDate(date: Date, addDays = 0): string {
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + addDays),
  );
  return shifted.toISOString().slice(0, 10);
}

/**
 * Instant exact de l'échéance pour une semaine de publication donnée.
 *
 * `periodStart` est le lundi de la semaine de publication, interprété comme une
 * date civile en UTC — c'est ainsi que PostgreSQL renvoie une colonne `date`.
 * Si le jour paramétré précède ce lundi, l'échéance reste dans la semaine de
 * publication.
 */
export function computeValidationDeadline(
  periodStart: Date,
  settings: DeadlineSettings = DEFAULT_DEADLINE_SETTINGS,
): Date {
  if (settings.weekday < 1 || settings.weekday > 7) {
    throw new Error(`Jour d'échéance invalide : ${settings.weekday}`);
  }

  const { hours, minutes } = parseTime(settings.time);
  const offset = (settings.weekday - isoDayOfWeek(periodStart) + 7) % 7;

  // Date civile « mardi 10:00 » interprétée dans le fuseau du client, puis
  // convertie en instant absolu — l'heure d'été est gérée par date-fns-tz.
  const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  return fromZonedTime(`${civilDate(periodStart, offset)}T${time}`, settings.timezone);
}

/** « mardi 11 août à 10 h » — formulation utilisée dans les messages clients. */
export function formatDeadline(
  deadline: Date,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const day = formatInTimeZone(deadline, timezone, "EEEE d MMMM", { locale: fr });
  const hours = formatInTimeZone(deadline, timezone, "H", { locale: fr });
  const minutes = formatInTimeZone(deadline, timezone, "mm", { locale: fr });
  return minutes === "00" ? `${day} à ${hours} h` : `${day} à ${hours} h ${minutes}`;
}

/**
 * « du 10 au 16 août » — période de publication.
 *
 * Début et fin sont des dates civiles : elles se lisent en UTC, sinon un fuseau
 * en retard sur UTC afficherait la veille.
 */
export function formatPeriod(start: Date, end: Date): string {
  const sameMonth =
    formatInTimeZone(start, "UTC", "MM-yyyy") === formatInTimeZone(end, "UTC", "MM-yyyy");
  const startLabel = sameMonth
    ? formatInTimeZone(start, "UTC", "d", { locale: fr })
    : formatInTimeZone(start, "UTC", "d MMMM", { locale: fr });
  const endLabel = formatInTimeZone(end, "UTC", "d MMMM", { locale: fr });
  return `du ${startLabel} au ${endLabel}`;
}

export type DeadlineUrgency = "comfortable" | "approaching" | "imminent" | "overdue";

export interface DeadlineState {
  urgency: DeadlineUrgency;
  isOverdue: boolean;
  minutesRemaining: number;
  /** « dans 2 jours », « dans 3 h », « en retard de 5 h ». */
  label: string;
}

export function deadlineState(deadline: Date, now: Date = new Date()): DeadlineState {
  const minutesRemaining = differenceInMinutes(deadline, now);

  if (minutesRemaining < 0) {
    return {
      urgency: "overdue",
      isOverdue: true,
      minutesRemaining,
      label: `en retard de ${humanizeMinutes(-minutesRemaining)}`,
    };
  }

  const urgency: DeadlineUrgency =
    minutesRemaining <= 4 * 60
      ? "imminent"
      : minutesRemaining <= 24 * 60
        ? "approaching"
        : "comfortable";

  return {
    urgency,
    isOverdue: false,
    minutesRemaining,
    label: `dans ${humanizeMinutes(minutesRemaining)}`,
  };
}

function humanizeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 h" : `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 jour" : `${days} jours`;
}
