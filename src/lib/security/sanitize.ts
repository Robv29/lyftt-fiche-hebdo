/**
 * §19 — Nettoyage des textes saisis par le client.
 *
 * React échappe déjà le rendu ; ce nettoyage protège les usages qui sortent de
 * React : PDF, e-mails, exports, notifications.
 */

// Caractères de contrôle, en conservant la tabulation (\x09) et le saut de ligne (\x0A).
const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
/** Marques de direction, utilisables pour masquer ou inverser du texte. */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeText(input: string, maxLength = 5000): string {
  return input
    .replace(CONTROL_CHARACTERS, "")
    .replace(BIDI_OVERRIDES, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

/** Un commentaire vide après nettoyage n'est pas exploitable par l'équipe. */
export function isMeaningful(input: string, minLength = 3): boolean {
  return sanitizeText(input).length >= minLength;
}

/** Normalise les hashtags saisis librement (« #Été, montauban » → ["#Été", "#montauban"]). */
export function normalizeHashtags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
        .filter((tag) => tag.length > 1),
    ),
  ];
}
