/**
 * Lecture d'activité des shootings : compter, filtrer, résumer.
 *
 * Pur et testable. Ce module ne connaît ni la base ni les écrans : il reçoit
 * des shootings déjà lus et répond aux trois questions du cahier des charges —
 * ce qu'on a réalisé, ce qui est prévu, quelle activité cela représente.
 */

export type ShootingStatus = "realise" | "cale" | "annule";
export type ShootingKind = "photo" | "video" | "photo_video";

export const SHOOTING_KIND_LABELS: Record<ShootingKind, string> = {
  photo: "Photo",
  video: "Vidéo",
  photo_video: "Photo + Vidéo",
};

export const SHOOTING_STATUS_LABELS: Record<ShootingStatus, string> = {
  realise: "Réalisé",
  cale: "À venir",
  annule: "Annulé",
};

export interface CountedShooting {
  date: string;
  clientId: string;
  status: ShootingStatus;
  kind: ShootingKind | null;
  durationMinutes: number | null;
  /** Contenus livrés à l'issue du shooting. */
  assetsCount?: number | null;
  /** Délai promis au client, en jours. */
  deliveryDays?: number | null;
  /** Date de livraison réelle. */
  deliveredOn?: string | null;
}

export interface ShootingFilters {
  clientId?: string | null;
  status?: ShootingStatus | null;
  kind?: ShootingKind | null;
  /** Bornes incluses, au format AAAA-MM-JJ. */
  from?: string | null;
  to?: string | null;
}

export function filterShootings<T extends CountedShooting>(
  shootings: readonly T[],
  filters: ShootingFilters,
): T[] {
  return shootings.filter((shooting) => {
    if (filters.clientId && shooting.clientId !== filters.clientId) return false;
    if (filters.status && shooting.status !== filters.status) return false;
    if (filters.kind && shooting.kind !== filters.kind) return false;
    if (filters.from && shooting.date < filters.from) return false;
    if (filters.to && shooting.date > filters.to) return false;
    return true;
  });
}

export interface ShootingStats {
  done: number;
  upcoming: number;
  cancelled: number;
  /** Minutes cumulées des shootings réalisés dont la durée est connue. */
  totalMinutes: number;
  /** Moyenne sur les seuls shootings réalisés dont la durée est connue. */
  averageMinutes: number | null;
  /** Réalisés sans durée saisie : la moyenne ne les couvre pas. */
  missingDuration: number;
  /** Contenus livrés, cumulés sur les shootings qui l'ont renseigné. */
  assets: number;
  /** Livraisons dans le délai promis, sur celles qui sont mesurables. */
  onTime: number;
  /** Livraisons mesurables : délai promis ET date de livraison connus. */
  measuredDeliveries: number;
}

/**
 * Part des livraisons faites dans le délai promis.
 *
 * `null` quand rien n'est mesurable, plutôt que zéro : « 0 % à temps » sur un
 * portefeuille où personne n'a encore saisi de date de livraison se lirait
 * comme une catastrophe, alors que c'est une absence d'information.
 */
export function onTimeRate(stats: ShootingStats): number | null {
  if (stats.measuredDeliveries === 0) return null;
  return Math.round((stats.onTime / stats.measuredDeliveries) * 100);
}

/** Échéance de livraison promise : la date du shooting plus le délai. */
export function deliveryDueOn(date: string, deliveryDays: number): string {
  const due = new Date(`${date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + deliveryDays);
  return due.toISOString().slice(0, 10);
}

/**
 * Activité de production.
 *
 * La durée moyenne ne porte que sur les shootings dont la durée est renseignée,
 * et le nombre de ceux qui manquent est rendu avec elle : une moyenne calculée
 * sur trois fiches remplies parmi vingt se lirait comme une moyenne générale.
 */
export function shootingStats(shootings: readonly CountedShooting[]): ShootingStats {
  let done = 0;
  let upcoming = 0;
  let cancelled = 0;
  let totalMinutes = 0;
  let measured = 0;
  let missingDuration = 0;
  let assets = 0;
  let onTime = 0;
  let measuredDeliveries = 0;

  for (const shooting of shootings) {
    if (shooting.status === "annule") { cancelled += 1; continue; }
    if (shooting.status === "cale") { upcoming += 1; continue; }

    done += 1;
    if (typeof shooting.durationMinutes === "number" && shooting.durationMinutes > 0) {
      totalMinutes += shooting.durationMinutes;
      measured += 1;
    } else {
      missingDuration += 1;
    }

    if (typeof shooting.assetsCount === "number" && shooting.assetsCount > 0) {
      assets += shooting.assetsCount;
    }

    /*
     * Une livraison n'est mesurable que si le délai promis ET la date réelle
     * sont connus. Sans promesse, il n'y a rien à tenir ; sans date, rien à
     * comparer — et compter ces cas comme des retards inventerait un échec.
     */
    if (typeof shooting.deliveryDays === "number" && shooting.deliveredOn) {
      measuredDeliveries += 1;
      if (shooting.deliveredOn <= deliveryDueOn(shooting.date, shooting.deliveryDays)) onTime += 1;
    }
  }

  return {
    done,
    upcoming,
    cancelled,
    totalMinutes,
    averageMinutes: measured > 0 ? Math.round(totalMinutes / measured) : null,
    missingDuration,
    assets,
    onTime,
    measuredDeliveries,
  };
}

/** « 5 h 20 », « 45 min ». Vide quand la durée est inconnue. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** Nombre de shootings réalisés par mois, du plus ancien au plus récent. */
export function shootingsPerMonth(
  shootings: readonly CountedShooting[],
): Array<{ month: string; count: number }> {
  const counts = new Map<string, number>();
  for (const shooting of shootings) {
    if (shooting.status !== "realise") continue;
    const month = shooting.date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((first, second) => first.month.localeCompare(second.month));
}

/** Répartition par type, les shootings sans type restant comptés à part. */
export function shootingsByKind(
  shootings: readonly CountedShooting[],
): { counts: Record<ShootingKind, number>; unknown: number } {
  const counts: Record<ShootingKind, number> = { photo: 0, video: 0, photo_video: 0 };
  let unknown = 0;
  for (const shooting of shootings) {
    if (shooting.status === "annule") continue;
    if (shooting.kind) counts[shooting.kind] += 1;
    else unknown += 1;
  }
  return { counts, unknown };
}
