import { MAP_PROJECTION, MAP_VIEWBOX } from "@/lib/geo/france-map";
import type { LyfttClientType } from "./hashtags";

/**
 * Placement des clients sur la carte de France.
 *
 * Tout ici est du calcul pur : la projection, l'écartement des points qui se
 * superposent, le comptage par secteur. Le tracé du fond, lui, est figé dans
 * `@/lib/geo/france-map`.
 */

const RAD = Math.PI / 180;

/*
 * Lambert conique conforme, paramètres français. Ces valeurs doivent rester
 * identiques à celles qui ont servi à générer le fond de carte : un point
 * projeté autrement tomberait à côté du département auquel il appartient.
 */
const PHI_1 = 44 * RAD;
const PHI_2 = 49 * RAD;
const PHI_0 = 46.5 * RAD;
const LAMBDA_0 = 3 * RAD;

const tangent = (phi: number) => Math.tan(Math.PI / 4 + phi / 2);
const N = Math.log(Math.cos(PHI_1) / Math.cos(PHI_2)) / Math.log(tangent(PHI_2) / tangent(PHI_1));
const BIG_F = (Math.cos(PHI_1) * Math.pow(tangent(PHI_1), N)) / N;
const RHO_0 = BIG_F / Math.pow(tangent(PHI_0), N);

/**
 * Coordonnées géographiques vers le repère du fond de carte.
 *
 * Renvoie `null` hors des limites du tracé : un client saisi avec une longitude
 * fantaisiste doit disparaître de la carte, pas se coller contre un bord en
 * laissant croire qu'il est en Bretagne.
 */
export function projectToMap(longitude: number, latitude: number): { x: number; y: number } | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (latitude <= 0 || latitude >= 90) return null;

  const rho = BIG_F / Math.pow(tangent(latitude * RAD), N);
  const theta = N * (longitude * RAD - LAMBDA_0);
  const x = (rho * Math.sin(theta) - MAP_PROJECTION.minX) * MAP_PROJECTION.scale;
  const y = (MAP_PROJECTION.maxY - (RHO_0 - rho * Math.cos(theta))) * MAP_PROJECTION.scale;

  if (x < 0 || y < 0 || x > MAP_VIEWBOX.width || y > MAP_VIEWBOX.height) return null;
  return { x, y };
}

export type ImplantationState = "active" | "paused" | "ended";

export interface ImplantationInput {
  id: string;
  name: string;
  city: string;
  clientType: LyfttClientType | null;
  longitude: number | null;
  latitude: number | null;
  state: ImplantationState;
}

export interface PlacedImplantation extends ImplantationInput {
  /** Position finale, écartement compris. */
  x: number;
  y: number;
  /** Centre de la commune, avant écartement : utile pour relier le point à sa ville. */
  anchorX: number;
  anchorY: number;
}

/*
 * Rayon du premier anneau d'écartement, en unités de la vue.
 *
 * Six points répartis sur un cercle de ce rayon sont séparés d'exactement ce
 * rayon : à 11, des pastilles de 5,5 de rayon se touchent sans se recouvrir.
 * Réduire la valeur les empile, l'augmenter détache la grappe de sa commune.
 */
const SPREAD_RADIUS = 11;

/**
 * Place les clients, en écartant ceux qui partagent une commune.
 *
 * Huit clients à Montauban tombent sur le même point au pixel près : sans
 * écartement, sept d'entre eux sont invisibles et la carte ment sur ce que
 * l'agence couvre. On les dispose donc en couronne autour du centre de la
 * commune, par anneaux de six.
 *
 * L'ordre d'entrée détermine la position : à données égales la carte est
 * identique d'un affichage à l'autre, sans quoi filtrer par secteur ferait
 * danser les points restants.
 */
export function placeImplantations(clients: readonly ImplantationInput[]): PlacedImplantation[] {
  const byCommune = new Map<string, ImplantationInput[]>();
  const placed: PlacedImplantation[] = [];

  for (const client of clients) {
    if (client.longitude === null || client.latitude === null) continue;
    const key = `${client.longitude.toFixed(4)},${client.latitude.toFixed(4)}`;
    const group = byCommune.get(key) ?? [];
    group.push(client);
    byCommune.set(key, group);
  }

  for (const group of byCommune.values()) {
    const anchor = projectToMap(group[0]!.longitude!, group[0]!.latitude!);
    if (!anchor) continue;

    group.forEach((client, index) => {
      if (group.length === 1) {
        placed.push({ ...client, x: anchor.x, y: anchor.y, anchorX: anchor.x, anchorY: anchor.y });
        return;
      }
      /*
       * Anneaux successifs de six : le premier client tient le centre, les
       * suivants tournent autour. Le demi-tour d'un anneau à l'autre évite
       * d'aligner les points sur un même rayon.
       */
      const ring = Math.floor((index + 5) / 6);
      const slot = (index - 1) % 6;
      const angle = (slot / 6) * 2 * Math.PI + (ring % 2 === 0 ? Math.PI / 6 : 0);
      const radius = index === 0 ? 0 : SPREAD_RADIUS * ring;
      placed.push({
        ...client,
        x: anchor.x + radius * Math.cos(angle),
        y: anchor.y + radius * Math.sin(angle),
        anchorX: anchor.x,
        anchorY: anchor.y,
      });
    });
  }

  return placed;
}

/**
 * Nombre de clients par secteur, dans l'ordre d'un référentiel donné.
 *
 * Les secteurs sans client sont conservés à zéro : un filtre qui apparaît et
 * disparaît selon le portefeuille est plus déroutant qu'un filtre grisé.
 */
export function countBySector(
  clients: readonly ImplantationInput[],
  order: readonly LyfttClientType[],
): Array<{ type: LyfttClientType; count: number }> {
  const counts = new Map<LyfttClientType, number>();
  for (const client of clients) {
    if (!client.clientType) continue;
    counts.set(client.clientType, (counts.get(client.clientType) ?? 0) + 1);
  }
  return order.map((type) => ({ type, count: counts.get(type) ?? 0 }));
}
