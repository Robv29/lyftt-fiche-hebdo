import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Vérification de la signature des webhooks Calendly.
 *
 * Calendly signe chaque appel avec l'en-tête `Calendly-Webhook-Signature`, au
 * format `t=<horodatage>,v1=<signature>`. La signature est un HMAC-SHA256 de
 * la chaîne `<horodatage>.<corps brut>` — le corps *brut*, avant tout
 * `JSON.parse()` : re-sérialiser le JSON réordonne les clés et change les
 * espaces, donc la signature ne correspondrait jamais.
 */

export interface CalendlySignatureParts {
  /** Horodatage UNIX en secondes, tel qu'envoyé par Calendly. */
  timestamp: string;
  /** Signature hexadécimale de la version 1 du schéma. */
  signature: string;
}

/** Découpe l'en-tête, ou null s'il est absent ou illisible. */
export function parseCalendlySignature(header: string | null | undefined): CalendlySignatureParts | null {
  if (!header) return null;

  let timestamp = "";
  let signature = "";

  for (const chunk of header.split(",")) {
    const separator = chunk.indexOf("=");
    if (separator === -1) continue;
    const key = chunk.slice(0, separator).trim();
    const value = chunk.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signature = value;
  }

  // Un horodatage non numérique ou une signature qui n'est pas de
  // l'hexadécimal ne viennent pas de Calendly : inutile d'aller plus loin.
  if (!/^\d+$/.test(timestamp)) return null;
  if (!/^[0-9a-f]+$/i.test(signature)) return null;

  return { timestamp, signature };
}

/**
 * Fenêtre de tolérance sur l'horodatage, en secondes.
 *
 * Sans elle, une requête interceptée pourrait être rejouée indéfiniment. Cinq
 * minutes est la valeur recommandée par Calendly : assez large pour absorber
 * une horloge serveur décalée, assez courte pour qu'un rejeu soit inutile.
 */
export const CALENDLY_SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyCalendlySignature({
  header,
  body,
  secret,
  now = Date.now(),
  toleranceSeconds = CALENDLY_SIGNATURE_TOLERANCE_SECONDS,
}: {
  header: string | null | undefined;
  body: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const parts = parseCalendlySignature(header);
  if (!parts) return false;

  const ageSeconds = Math.abs(now / 1000 - Number(parts.timestamp));
  if (ageSeconds > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parts.timestamp}.${body}`)
    .digest("hex");

  // Comparaison à temps constant : une comparaison naïve laisse deviner la
  // signature attendue caractère par caractère. `timingSafeEqual` exige des
  // longueurs égales, d'où le test préalable.
  if (expected.length !== parts.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.signature.toLowerCase()));
}
