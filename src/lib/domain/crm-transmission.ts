import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "./deadline";

/**
 * Fiches transmises par le CRM commercial.
 *
 * Le CRM et cette application ne partagent que ces quelques champs : ce que le
 * commercial connaît d'un client qui vient de signer. Tout ce qui suit sert à
 * les présenter ou à les retrouver, sans dépendre de la base.
 */

/** Nom du contact tel qu'on l'écrit, ou null si le CRM n'a rien transmis. */
export function contactFullName(
  prenom?: string | null,
  nom?: string | null,
): string | null {
  const parts = [prenom, nom].map((part) => (part ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Numéro utilisable dans un lien `tel:`.
 *
 * Les commerciaux saisissent « 06 12 34 56 78 » ou « +33 6.12.34.56.78 ».
 * Passé tel quel, le téléphone compose la ponctuation avec le reste et
 * l'appel échoue : seuls les chiffres et un éventuel « + » de tête survivent.
 */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Neutralise les jokers d'un motif `LIKE`.
 *
 * Une adresse comme `jean_dupont@exemple.fr` cherchée telle quelle en `ilike`
 * ferait du souligné un joker : `jeanXdupont@exemple.fr` correspondrait aussi,
 * et le rendez-vous Calendly se poserait sur la fiche d'un autre client.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Montant du contrat, tel qu'on l'affiche sur une carte. */
export function formatMontantCa(montant: number | null | undefined): string | null {
  if (montant === null || montant === undefined || Number.isNaN(montant)) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: montant % 1 === 0 ? 0 : 2,
  }).format(montant);
}

/** Date et heure d'un rendez-vous, lues à l'heure de Paris. */
export function formatParisDateTime(iso: string): string {
  return formatInTimeZone(new Date(iso), DEFAULT_TIMEZONE, "dd/MM/yyyy 'à' HH'h'mm");
}

/**
 * Valeur d'un `<input type="datetime-local">` à partir d'un instant absolu.
 *
 * Le champ n'a pas de fuseau : il affiche ce qu'on lui donne. Passer l'ISO brut
 * afficherait l'heure UTC — un rendez-vous de 16 h apparaîtrait à 14 h l'été.
 */
export function parisDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatInTimeZone(date, DEFAULT_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Inverse du précédent : l'heure saisie est lue comme une heure de Paris, puis
 * convertie en instant absolu. Le passage à l'heure d'été est géré par
 * date-fns-tz.
 */
export function parisDateTimeToIso(local: string): string | null {
  const trimmed = local.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const instant = fromZonedTime(trimmed, DEFAULT_TIMEZONE);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
