import { formatInTimeZone } from "date-fns-tz";

/**
 * Heure civile de l'agence, lue une seule fois.
 *
 * Tout ce qui se décide « à telle heure » se décide à l'heure de Paris, et
 * jamais à l'heure de la machine : une tâche planifiée tourne en UTC, et l'écart
 * change deux fois par an. Trois modules reconstruisaient ce calcul — le délai
 * des tickets avec `date-fns-tz`, la date du jour avec `Intl`, et maintenant
 * l'alerte du vendredi. Un décalage horaire calculé à la main finit toujours par
 * se tromper d'une heure fin octobre.
 *
 * `formatInTimeZone` répond pour les deux saisons sans qu'on ait à le savoir :
 * c'est la base de données de fuseaux qui sait quand l'heure d'été s'arrête.
 */

export const PARIS_TIMEZONE = "Europe/Paris";

/** Champs civils d'un instant, lus dans le fuseau de l'agence. */
export interface ParisFields {
  /** Date civile, `YYYY-MM-DD`. */
  day: string;
  hour: number;
  minute: number;
  /** Jour de la semaine ISO : 1 = lundi, 5 = vendredi, 7 = dimanche. */
  weekday: number;
}

export function parisFields(date: Date): ParisFields {
  const [day, clock, weekday] = formatInTimeZone(date, PARIS_TIMEZONE, "yyyy-MM-dd|HH:mm|i").split("|");
  const [hour, minute] = clock.split(":").map(Number);
  return { day, hour, minute, weekday: Number(weekday) };
}
