/**
 * Changement de programme d'une publication.
 *
 * Reporter un post à un jour suivant, sans repasser par le client — y compris
 * sur une semaine déjà validée. C'est un geste de production : une météo, une
 * rupture de stock, un événement qui décale. Le contenu ne change pas, seule
 * la date bouge, et la validation donnée par le client reste valable.
 *
 * Deux garde-fous, et seulement deux :
 *  - on ne fait que reporter, jamais avancer : publier plus tôt que ce que le
 *    client a vu reviendrait à modifier ce qu'il a validé ;
 *  - on ne reporte pas dans le passé, ni ce qui est déjà publié.
 */

export interface ReprogrammableItem {
  scheduledDate: string;
  publishedAt: string | null;
  isCancelled: boolean;
}

export type ReprogrammingRefusal =
  | "published"
  | "cancelled"
  | "not_later"
  | "in_the_past"
  | "invalid_date";

export const REPROGRAMMING_REFUSALS: Record<ReprogrammingRefusal, string> = {
  published: "Cette publication est déjà en ligne : il n'y a plus rien à reporter.",
  cancelled: "Cette publication est annulée.",
  not_later: "Un changement de programme ne fait que reporter : choisissez un jour après la date prévue.",
  in_the_past: "La nouvelle date est déjà passée.",
  invalid_date: "Date invalide.",
};

/** `null` si le report est permis, sinon la raison du refus. */
export function reprogrammingRefusal(
  item: ReprogrammableItem,
  newDate: string,
  today: string,
): ReprogrammingRefusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(Date.parse(`${newDate}T00:00:00Z`))) {
    return "invalid_date";
  }
  if (item.publishedAt) return "published";
  if (item.isCancelled) return "cancelled";
  if (newDate <= item.scheduledDate) return "not_later";
  if (newDate < today) return "in_the_past";
  return null;
}

/**
 * Date d'origine à conserver.
 *
 * Reporté deux fois, un post garde la toute première date prévue : c'est
 * celle que le client avait validée, et c'est elle que la pastille rappelle.
 * Écraser par la date intermédiaire effacerait la trace de l'engagement.
 */
export function originalDate(current: string, alreadyReprogrammedFrom: string | null): string {
  return alreadyReprogrammedFrom ?? current;
}
