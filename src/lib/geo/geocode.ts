import "server-only";

/**
 * Géocodage d'une commune française par l'API Adresse de l'État.
 *
 * Service public, gratuit, sans clé : https://api-adresse.data.gouv.fr.
 * On ne demande que la commune (`type=municipality`), jamais la voie ni le
 * numéro — la carte montre où l'agence est implantée, pas où habitent les
 * gérants, et une adresse complète n'a pas à sortir de la fiche client.
 *
 * L'appel ne doit jamais faire échouer un enregistrement : un géocodeur
 * injoignable donne `null`, le client est enregistré sans position et
 * réapparaît dans la liste « position inconnue » de la carte.
 */

import { primaryCommune } from "./commune";

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
/* Au-delà, l'enregistrement de la fiche paraîtrait bloqué. */
const TIMEOUT_MS = 4_000;

export interface GeocodedCommune {
  latitude: number;
  longitude: number;
  /** Commune telle que le service l'a comprise. */
  label: string;
}

async function query(params: Record<string, string>): Promise<GeocodedCommune | null> {
  const url = new URL(ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("type", "municipality");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;

  const body = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { label?: string };
    }>;
  };

  const feature = body.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates || coordinates.length !== 2) return null;

  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  return { longitude, latitude, label: feature?.properties?.label ?? "" };
}

/**
 * Position d'une commune, à partir de son nom et du code postal saisis.
 *
 * Le code postal est un indice, pas une vérité : les fiches portent souvent
 * celui de la grande ville voisine — Balma saisi en 31000, qui est Toulouse.
 * Le nom de la commune prime donc, et le code postal ne sert qu'à départager
 * les homonymes. S'il fait échouer la recherche, on repart sur le seul nom
 * plutôt que de renoncer.
 */
export async function geocodeCommune(
  city: string | null | undefined,
  postalCode: string | null | undefined,
): Promise<GeocodedCommune | null> {
  const commune = primaryCommune(city);
  if (!commune) return null;

  const code = (postalCode ?? "").trim();

  try {
    if (/^\d{5}$/.test(code)) {
      const withCode = await query({ q: commune, postcode: code });
      if (withCode) return withCode;
    }
    return await query({ q: commune });
  } catch (error) {
    // Réseau coupé, service en panne, délai dépassé : la fiche s'enregistre.
    console.error("[géocodage] commune non localisée", commune, (error as Error).message);
    return null;
  }
}
