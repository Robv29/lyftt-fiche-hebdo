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
export interface Placement {
  placed: PlacedImplantation[];
  /**
   * Clients qui ont des coordonnées mais qui ne tombent pas sur le fond de
   * carte : outre-mer, ou géocodage parti ailleurs.
   *
   * Ils étaient simplement ignorés. Un client absent de la carte *et* absent
   * de toute liste passe pour un client qu'on n'a pas — c'est la pire issue
   * possible, pire qu'un point mal placé, qui se voit.
   */
  offMap: ImplantationInput[];
}

export function placeImplantations(clients: readonly ImplantationInput[]): Placement {
  const byCommune = new Map<string, ImplantationInput[]>();
  const placed: PlacedImplantation[] = [];
  const offMap: ImplantationInput[] = [];

  for (const client of clients) {
    if (client.longitude === null || client.latitude === null) continue;
    const key = `${client.longitude.toFixed(4)},${client.latitude.toFixed(4)}`;
    const group = byCommune.get(key) ?? [];
    group.push(client);
    byCommune.set(key, group);
  }

  for (const group of byCommune.values()) {
    const anchor = projectToMap(group[0]!.longitude!, group[0]!.latitude!);
    if (!anchor) { offMap.push(...group); continue; }

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

  return { placed, offMap };
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

/*
 * ---------------------------------------------------------------------------
 * Rattachement d'un point à son département
 * ---------------------------------------------------------------------------
 *
 * Le département n'est pas déduit du code postal. Les fiches portent souvent
 * celui de la grande ville voisine, et surtout : le point est dessiné à partir
 * des coordonnées, pas du code postal. Deux sources différentes finiraient par
 * se contredire — un point visiblement dans l'Ariège, rangé dans la
 * Haute-Garonne parce que le code postal le disait.
 *
 * On interroge donc le tracé lui-même, celui qui est à l'écran. Le clic sur un
 * département et la liste qui s'ouvre ne peuvent alors pas diverger.
 */

/** Découpe un tracé « M x,y L x,y … Z » en anneaux de points. */
function parseRings(path: string): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  for (const chunk of path.split("M").slice(1)) {
    const ring = chunk
      .replace(/Z\s*$/, "")
      .split("L")
      .map((pair) => pair.split(",").map(Number) as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

/** Lancer de rayon : un point est dedans s'il traverse un nombre impair de côtés. */
function isInsideRings(x: number, y: number, rings: Array<Array<[number, number]>>): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/*
 * Les anneaux d'un département ne changent jamais : on les découpe une fois.
 * Sans ce cache, chaque filtre relançait l'analyse de 96 tracés.
 */
const RINGS_CACHE = new Map<string, Array<Array<[number, number]>>>();

function ringsOf(department: { code: string; path: string }): Array<Array<[number, number]>> {
  const cached = RINGS_CACHE.get(department.code);
  if (cached) return cached;
  const rings = parseRings(department.path);
  RINGS_CACHE.set(department.code, rings);
  return rings;
}

/**
 * Département contenant un point de la carte, ou `null` s'il n'en touche aucun.
 *
 * À interroger avec le centre de la commune, pas la position écartée : un point
 * décalé de quelques unités peut franchir une frontière, et se retrouver
 * rangé loin de ses voisins de la même ville.
 */
export function departmentAt(
  x: number,
  y: number,
  departments: readonly { code: string; name: string; path: string }[],
): { code: string; name: string } | null {
  for (const department of departments) {
    if (isInsideRings(x, y, ringsOf(department))) {
      return { code: department.code, name: department.name };
    }
  }

  /*
   * Rattrapage de bord de trait.
   *
   * Le fond de carte est simplifié : le littoral y perd ses découpes, et une
   * commune côtière ou insulaire peut tomber quelques unités en dehors du
   * tracé de son propre département. Sans ce rattrapage, elle se retrouvait
   * dans un fourre-tout « Hors carte », son département ne s'allumait jamais,
   * et sa liste ne la contenait pas — alors que son point était bien dessiné
   * au bon endroit.
   *
   * On accepte donc le département le plus proche, dans une marge étroite.
   * Au-delà, mieux vaut ne rien affirmer : un point à cent kilomètres des
   * terres n'appartient à personne.
   */
  let best: { code: string; name: string; distance: number } | null = null;
  for (const department of departments) {
    for (const ring of ringsOf(department)) {
      for (const [px, py] of ring) {
        const distance = Math.hypot(px - x, py - y);
        if (distance <= COAST_TOLERANCE && (!best || distance < best.distance)) {
          best = { code: department.code, name: department.name, distance };
        }
      }
    }
  }

  return best ? { code: best.code, name: best.name } : null;
}

/*
 * Marge du rattrapage littoral, en unités de la vue — la France y fait mille
 * unités de large, donc une unité vaut environ un kilomètre.
 */
const COAST_TOLERANCE = 12;

export interface DepartmentGroup {
  code: string;
  name: string;
  clients: PlacedImplantation[];
}

/**
 * Regroupe les points placés par département, du plus fourni au moins fourni.
 *
 * Un point hors de tout tracé est rangé sous un code vide plutôt que jeté :
 * il reste visible dans la liste, où son absence passerait pour une perte.
 */
export function groupByDepartment(
  placed: readonly PlacedImplantation[],
  departments: readonly { code: string; name: string; path: string }[],
): DepartmentGroup[] {
  const groups = new Map<string, DepartmentGroup>();

  for (const point of placed) {
    const found = departmentAt(point.anchorX, point.anchorY, departments);
    const code = found?.code ?? "";
    const group = groups.get(code)
      ?? { code, name: found?.name ?? "Hors carte", clients: [] };
    group.clients.push(point);
    groups.set(code, group);
  }

  return [...groups.values()].sort(
    (a, b) => b.clients.length - a.clients.length || a.code.localeCompare(b.code),
  );
}
