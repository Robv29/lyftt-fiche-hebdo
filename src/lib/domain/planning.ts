import { isoWeekStart } from "./deadline";
import type { MediaFormat } from "./types";

export type PlanningBucket = "past" | "current" | "next" | "later";

export interface PlanningWeekRange {
  currentStart: string;
  currentEnd: string;
  nextStart: string;
  nextEnd: string;
  nextIsoYear: number;
  nextIsoWeek: number;
}

function civilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isoWeekIdentity(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return {
    year: target.getUTCFullYear(),
    week: Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7),
  };
}

/**
 * Date civile située N jours avant une autre.
 *
 * Sert à borner l'historique du planning : une seule semaine passée est
 * conservée, la purge planifiée supprime au-delà.
 */
export function civilDaysBefore(date: string, days: number): string {
  return civilDate(addDays(new Date(`${date}T00:00:00Z`), -days));
}

export function planningWeekRange(now = new Date()): PlanningWeekRange {
  const current = isoWeekIdentity(now);
  const currentStartDate = isoWeekStart(current.year, current.week);
  const nextStartDate = addDays(currentStartDate, 7);
  const next = isoWeekIdentity(nextStartDate);

  return {
    currentStart: civilDate(currentStartDate),
    currentEnd: civilDate(addDays(currentStartDate, 6)),
    nextStart: civilDate(nextStartDate),
    nextEnd: civilDate(addDays(nextStartDate, 6)),
    nextIsoYear: next.year,
    nextIsoWeek: next.week,
  };
}

export function planningBucketForPeriod(
  periodStart: string,
  periodEnd: string,
  now = new Date(),
): PlanningBucket {
  const range = planningWeekRange(now);
  if (periodEnd < range.currentStart) return "past";
  if (periodStart <= range.currentEnd && periodEnd >= range.currentStart) return "current";
  if (periodStart <= range.nextEnd && periodEnd >= range.nextStart) return "next";
  return "later";
}

export interface CompletionItem {
  caption: string | null;
  hashtags: string[] | string | null;
  format: MediaFormat;
  mediaAssetId?: string | null;
  mediaExternalUrl?: string | null;
  isCancelled?: boolean;
}

function hasHashtags(value: CompletionItem["hashtags"]): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

export function sheetCompletion(items: CompletionItem[]): {
  completed: number;
  total: number;
  percentage: number;
} {
  const active = items.filter((item) => !item.isCancelled);
  const totals = active.reduce((acc, item) => {
    const requiresMedia = item.format !== "texte_seul";
    const total = 2 + (requiresMedia ? 1 : 0);
    const completed = Number(Boolean(item.caption?.trim()))
      + Number(hasHashtags(item.hashtags))
      + Number(requiresMedia && Boolean(item.mediaAssetId || item.mediaExternalUrl));
    return { completed: acc.completed + completed, total: acc.total + total };
  }, { completed: 0, total: 0 });

  return {
    ...totals,
    percentage: totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100),
  };
}

export interface MonthlyCadence {
  photo?: number;
  video?: number;
  story?: number;
  visual?: number;
}

const CADENCE_FORMATS: Array<{ key: keyof MonthlyCadence; format: MediaFormat; offset: number }> = [
  { key: "photo", format: "photo", offset: 0 },
  { key: "video", format: "video", offset: 1 },
  { key: "story", format: "story", offset: 2 },
  { key: "visual", format: "visuel", offset: 3 },
];

/**
 * Répartit un volume mensuel sur quatre semaines, sans changer le contrat.
 *
 * Le reste doit être **étalé**, pas groupé : deux vidéos par mois se tournent
 * une semaine sur deux, pas deux semaines de suite suivies de deux semaines
 * vides. La comparaison porte donc sur le reste multiplié par le rang de la
 * semaine, ce qui distribue les semaines retenues au lieu de les tasser en
 * début de cycle.
 */
export function weeklyFormatsForCadence(cadence: MonthlyCadence, isoWeek: number): MediaFormat[] {
  const formats: MediaFormat[] = [];

  for (const entry of CADENCE_FORMATS) {
    const monthly = Math.max(0, Math.min(31, Math.trunc(Number(cadence[entry.key] ?? 0))));
    const base = Math.floor(monthly / 4);
    const remainder = monthly % 4;
    // Décalage par format : deux prestations rares ne tombent pas le même jour.
    const week = isoWeek + entry.offset;
    const extra = remainder > 0 && (week * remainder) % 4 < remainder ? 1 : 0;
    formats.push(...Array.from({ length: base + extra }, () => entry.format));
  }

  return formats.length ? formats : ["photo"];
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mélange déterministe : résultat varié, mais stable après rechargement de la fiche. */
export function selectHashtags(tags: string[], seed: string, limit = 8): string[] {
  const unique = [...new Set(tags.filter(Boolean))];
  let state = hashSeed(seed) || 1;
  const shuffled = [...unique];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled.slice(0, Math.max(0, limit));
}

/**
 * Jours de publication choisis sur la fiche client, en numérotation ISO :
 * 1 pour lundi, 7 pour dimanche.
 */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

/** Jours retenus, dédoublonnés et remis dans l'ordre de la semaine. */
export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    .sort((a, b) => a - b);
}

/**
 * Date de publication de chaque contenu de la semaine.
 *
 * Les publications sont posées sur les jours choisis par le client, dans
 * l'ordre de la semaine. Quand il y a plus de contenus que de jours, on
 * repasse sur les mêmes jours : mieux vaut deux posts le mardi qu'une date
 * vide que personne ne remplira.
 *
 * Sans jour renseigné, aucune date n'est proposée — le community manager
 * garde la main, comme avant.
 */
export function publicationDatesForWeek(
  count: number,
  weekdays: readonly number[],
  weekStart: Date,
): string[] {
  const days = normalizeWeekdays(weekdays);
  if (days.length === 0) return Array.from({ length: count }, () => "");

  return Array.from({ length: count }, (_, index) => {
    const weekday = days[index % days.length]!;
    return civilDate(addDays(weekStart, weekday - 1));
  });
}
