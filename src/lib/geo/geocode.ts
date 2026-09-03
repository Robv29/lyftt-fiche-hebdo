import "server-only";

import { primaryCommune } from "./commune";

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
 * réapparaît dans la liste « position inconnue » de la carte, où le rattrapage
 * nocturne viendra le reprendre.
 */

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
/* Au-delà, l'enregistrement de la fiche paraîtrait bloqué. */
const TIMEOUT_MS = 4_000;

export interface GeocodedCommune {
  latitude: number;
  longitude: number;
  /** Commune telle que le service l'a comprise. */
  label: string;
  /** Code postal retenu par le service, qui n'est pas toujours celui saisi. */
  postcode: string;
}

/*
 * Trois issues, pas deux.
 *
 * « Rien trouvé » et « service indisponible » se ressemblent — les deux
 * renvoient l'absence de résultat — mais appellent des suites opposées :
 * l'une justifie d'élargir la recherche, l'autre impose de s'arrêter et de
 * réessayer plus tard. Les confondre revient à lancer une recherche sur toute
 * la France parce qu'un serveur a hoqueté.
 */
type QueryOutcome =
  | { status: "found"; commune: GeocodedCommune }
  | { status: "empty" }
  | { status: "unavailable" };

async function query(params: Record<string, string>): Promise<QueryOutcome> {
  const url = new URL(ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("type", "municipality");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { status: "unavailable" };

    const body = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { label?: string; postcode?: string };
      }>;
    };

    const feature = body.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!coordinates || coordinates.length !== 2) return { status: "empty" };

    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return { status: "empty" };

    return {
      status: "found",
      commune: {
        longitude,
        latitude,
        label: feature?.properties?.label ?? "",
        postcode: feature?.properties?.postcode ?? "",
      },
    };
  } catch (error) {
    // Réseau coupé, délai dépassé, réponse illisible.
    console.error("[géocodage] service injoignable", (error as Error).message);
    return { status: "unavailable" };
  }
}

/** Département d'un code postal. La Corse partage « 20 », ce qui suffit ici. */
function departmentOf(postalCode: string): string {
  return postalCode.trim().slice(0, 2);
}

/**
 * Position d'une commune, à partir de son nom et du code postal saisis.
 *
 * Le code postal est un indice, pas une vérité : les fiches portent souvent
 * celui de la grande ville voisine — Balma saisi en 31000, qui est Toulouse.
 * Le nom de la commune prime donc, et le code postal ne sert qu'à départager
 * les homonymes.
 *
 * Quand la recherche par code postal ne donne rien, on élargit au nom seul —
 * mais on vérifie alors que le résultat reste dans le même département.
 * Sans ce garde-fou, « Sainte-Marie » saisi en 31 renvoyait la première
 * Sainte-Marie de France, à sept cents kilomètres de là, et le point était
 * posé sans que rien ne signale l'erreur.
 */
export async function geocodeCommune(
  city: string | null | undefined,
  postalCode: string | null | undefined,
): Promise<GeocodedCommune | null> {
  const commune = primaryCommune(city);
  if (!commune) return null;

  const code = (postalCode ?? "").trim();
  const hasCode = /^\d{5}$/.test(code);

  if (hasCode) {
    const precise = await query({ q: commune, postcode: code });
    if (precise.status === "found") return precise.commune;
    // Service en panne : on ne cherche pas ailleurs, on réessaiera cette nuit.
    if (precise.status === "unavailable") return null;
  }

  const wide = await query({ q: commune });
  if (wide.status !== "found") return null;

  if (hasCode && departmentOf(wide.commune.postcode) !== departmentOf(code)) {
    console.error(
      "[géocodage] homonyme écarté", commune,
      `attendu ${departmentOf(code)}, trouvé ${departmentOf(wide.commune.postcode)}`,
    );
    return null;
  }

  return wide.commune;
}
