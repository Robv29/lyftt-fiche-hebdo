import { isoWeekStart } from "./deadline";
import { requiresCaption, requiresMedia, type MediaFormat } from "./types";
import { CONTENT_BUCKETS, bucketForFormat, type ContentBucket } from "./content-buckets";

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

/**
 * Retard sur lequel on peut encore agir.
 *
 * Une échéance dépassée sur une semaine déjà passée l'est irrémédiablement :
 * les publications sont derrière nous, et la signaler en rouge noie les retards
 * qu'une relance ou une correction peut encore rattraper. Seule la semaine en
 * cours est donc mise en avant — l'information reste affichée, sans l'alarme.
 *
 * Sans période rattachée, on s'en tient à l'échéance : rien ne permet de dire
 * que l'objet appartient à une semaine révolue.
 *
 * Partagée par les fiches en attente de validation et les tickets clients : les
 * deux écrans doivent s'accorder sur ce qu'ils appellent « en retard ».
 */
export function isActionableOverdue(
  input: {
    dueAt: string | null | undefined;
    periodStart?: string | null;
    periodEnd?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (!input.dueAt) return false;
  if (new Date(input.dueAt).getTime() >= now.getTime()) return false;
  if (!input.periodStart || !input.periodEnd) return true;
  return planningBucketForPeriod(input.periodStart, input.periodEnd, now) === "current";
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
    // Une story n'attend pas de légende : ne la compter nulle part, ni au
    // numérateur ni au dénominateur, sans quoi elle plafonnerait la fiche.
    const needsCaption = requiresCaption(item.format);
    const needsMedia = requiresMedia(item.format);
    const total = 1 + (needsCaption ? 1 : 0) + (needsMedia ? 1 : 0);
    const completed = Number(needsCaption && Boolean(item.caption?.trim()))
      + Number(hasHashtags(item.hashtags))
      + Number(needsMedia && Boolean(item.mediaAssetId || item.mediaExternalUrl));
    return { completed: acc.completed + completed, total: acc.total + total };
  }, { completed: 0, total: 0 });

  return {
    ...totals,
    percentage: totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100),
  };
}

/**
 * État d'une famille de contenu, sur une fiche ou avant même sa création.
 *
 * `expected` : compris dans le forfait du client mais aucune fiche créée pour
 * la semaine — différent de `none`, qui veut dire que cette famille ne fait
 * simplement pas partie de sa formule.
 */
export type BucketStatus = "ready" | "pending" | "expected" | "none";

function isCompletionItemReady(item: CompletionItem): boolean {
  const captionOk = !requiresCaption(item.format) || Boolean(item.caption?.trim());
  const hashtagsOk = hasHashtags(item.hashtags);
  const mediaOk = !requiresMedia(item.format) || Boolean(item.mediaAssetId || item.mediaExternalUrl);
  return captionOk && hashtagsOk && mediaOk;
}

/**
 * État de chaque famille de contenu (photos, vidéos, visuels…) sur une fiche.
 *
 * Sert la vue d'ensemble de Production : un pourcentage global ne dit pas
 * *quoi* manque, alors que « Vidéos : à compléter » se lit sans ouvrir la
 * fiche.
 */
export function contentBucketStatuses(items: CompletionItem[]): Record<ContentBucket, BucketStatus> {
  const active = items.filter((item) => !item.isCancelled);
  const statuses = {} as Record<ContentBucket, BucketStatus>;
  for (const bucket of CONTENT_BUCKETS) {
    const bucketItems = active.filter((item) => bucketForFormat(item.format) === bucket.key);
    statuses[bucket.key] = bucketItems.length === 0 ? "none" : bucketItems.every(isCompletionItemReady) ? "ready" : "pending";
  }
  return statuses;
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

/**
 * Satisfaction client, exprimée en pourcentage.
 *
 * Le client se situe sur trois niveaux — décevant, correct, très bien — parce
 * qu'une échelle à cinq étoiles ne produit que des 4 et des 5. Ces niveaux se
 * lisent en pourcentage : 0, 50, 100. La moyenne est donc directement un taux,
 * comparable aux autres indicateurs de l'écran.
 */
export const SATISFACTION_LABELS: Record<number, string> = {
  1: "Décevant",
  2: "Correct",
  3: "Très bien",
};

export function satisfactionPercentage(score: number): number {
  const bounded = Math.min(3, Math.max(1, Math.round(score)));
  return ((bounded - 1) / 2) * 100;
}

export interface SatisfactionSummary {
  /** Moyenne des notes reçues, en pourcentage. Null tant que personne n'a répondu. */
  percentage: number | null;
  /** Nombre de notes reçues sur la période. */
  answers: number;
  /** Fiches validées sur la même période : le dénominateur du taux de réponse. */
  eligible: number;
  /**
   * Part des fiches validées qui ont reçu une note.
   *
   * Affiché aussi visiblement que la moyenne : une satisfaction de 100 % sur
   * une réponse ne dit rien, et l'oublier conduit à décider sur du vide.
   */
  responseRate: number | null;
  /** Notes basses, à traiter : elles appellent un geste, pas une statistique. */
  unhappy: number;
}

export function satisfactionSummary(input: {
  scores: readonly number[];
  eligible: number;
}): SatisfactionSummary {
  const answers = input.scores.length;
  const percentage = answers === 0
    ? null
    : Math.round(input.scores.reduce((total, score) => total + satisfactionPercentage(score), 0) / answers);
  return {
    percentage,
    answers,
    eligible: input.eligible,
    responseRate: input.eligible === 0 ? null : Math.round((answers / input.eligible) * 100),
    unhappy: input.scores.filter((score) => score <= 1).length,
  };
}

export interface ReschedulableItem {
  id: string;
  scheduledDate: string;
  /** Départage deux contenus tombant le même jour, pour un ordre stable. */
  createdAt: string;
}

/**
 * Redistribue les contenus d'une fiche sur les jours de publication du client.
 *
 * Les dates sont posées à la création de la fiche, d'après les jours renseignés
 * alors. Changer ces jours ensuite laissait les fiches déjà créées sur l'ancien
 * rythme : le planning affichait un mardi pour un client passé au jeudi.
 *
 * La répartition reprend `publicationDatesForWeek`, celle de la création : deux
 * chemins produiraient deux plannings différents pour une même formule. L'ordre
 * des contenus est conservé — le premier reste le premier — car il porte
 * souvent une progression voulue.
 *
 * Ne renvoie que les contenus dont la date change : rien à écrire pour les
 * autres.
 */
export function rescheduleItems(
  items: readonly ReschedulableItem[],
  weekdays: readonly number[],
  weekStart: Date,
): Array<{ id: string; scheduledDate: string }> {
  const days = normalizeWeekdays(weekdays);
  if (days.length === 0 || items.length === 0) return [];

  const ordered = [...items].sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt.localeCompare(b.createdAt));

  const dates = publicationDatesForWeek(ordered.length, days, weekStart);

  return ordered
    .map((item, index) => ({ id: item.id, scheduledDate: dates[index]! }))
    .filter((next, index) => next.scheduledDate && next.scheduledDate !== ordered[index]!.scheduledDate);
}

export interface ExistingItem {
  id: string;
  format: MediaFormat;
  /** Vrai si le contenu porte déjà du travail : texte, hashtags ou média. */
  filled: boolean;
}

/**
 * Écart entre le rythme vendu et les contenus d'une fiche.
 *
 * Le nombre de publications est posé à la création, d'après le rythme du moment.
 * Vendre deux vidéos de plus par mois laissait les fiches déjà créées à
 * l'ancien compte : le planning affichait trois contenus pour un forfait qui en
 * prévoyait cinq.
 *
 * **Rien de rempli n'est jamais retiré.** Un contenu en trop qui porte déjà un
 * texte, des hashtags ou un média est conservé et signalé : il a été travaillé,
 * et le supprimer effacerait ce travail sans qu'on puisse le récupérer. Seuls
 * les contenus restés vides sont repris.
 */
export function reconcileWeekItems(
  existing: readonly ExistingItem[],
  expectedFormats: readonly MediaFormat[],
): { toAdd: MediaFormat[]; toRemove: string[]; keptFilled: number } {
  const needed = new Map<MediaFormat, number>();
  for (const format of expectedFormats) needed.set(format, (needed.get(format) ?? 0) + 1);

  const toAdd: MediaFormat[] = [];
  const toRemove: string[] = [];
  let keptFilled = 0;

  const byFormat = new Map<MediaFormat, ExistingItem[]>();
  for (const item of existing) {
    const list = byFormat.get(item.format) ?? [];
    list.push(item);
    byFormat.set(item.format, list);
  }

  const formats = new Set<MediaFormat>([...needed.keys(), ...byFormat.keys()]);

  for (const format of formats) {
    const want = needed.get(format) ?? 0;
    /*
     * Les contenus déjà travaillés passent en tête : ce sont eux qu'on garde.
     * Le surplus se prend donc à la fin, sur les vides — l'inverse effacerait
     * un texte ou un média pour conserver une coquille vide.
     */
    const present = [...(byFormat.get(format) ?? [])].sort((a, b) => Number(b.filled) - Number(a.filled));

    if (present.length < want) {
      for (let i = present.length; i < want; i += 1) toAdd.push(format);
      continue;
    }

    const surplus = present.slice(want);
    for (const item of surplus) {
      if (item.filled) keptFilled += 1;
      else toRemove.push(item.id);
    }
  }

  return { toAdd, toRemove, keptFilled };
}
