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
  }

  return {
    done,
    upcoming,
    cancelled,
    totalMinutes,
    averageMinutes: measured > 0 ? Math.round(totalMinutes / measured) : null,
    missingDuration,
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
