import { describe, expect, it } from "vitest";
import {
  countBySector,
  departmentAt,
  groupByDepartment,
  placeImplantations,
  projectToMap,
  type ImplantationInput,
} from "@/lib/domain/implantations";
import { FRANCE_DEPARTMENTS, MAP_VIEWBOX } from "@/lib/geo/france-map";

const client = (over: Partial<ImplantationInput> & { id: string }): ImplantationInput => ({
  name: over.id, city: "Ville", clientType: "commerce", longitude: 1.4442, latitude: 43.6045,
  state: "active", ...over,
});

describe("projectToMap", () => {
  it("place les villes dans le bon quadrant", () => {
    const paris = projectToMap(2.3522, 48.8566)!;
    const toulouse = projectToMap(1.4442, 43.6045)!;
    const strasbourg = projectToMap(7.7521, 48.5734)!;
    const brest = projectToMap(-4.4861, 48.3904)!;

    // Le nord est en haut : Paris est au-dessus de Toulouse.
    expect(paris.y).toBeLessThan(toulouse.y);
    // L'est est à droite : Strasbourg après Paris, Brest avant.
    expect(strasbourg.x).toBeGreaterThan(paris.x);
    expect(brest.x).toBeLessThan(paris.x);
  });

  it("garde les villes françaises dans le cadre", () => {
    for (const [lon, lat] of [[2.3522, 48.8566], [9.15, 41.6], [-4.48, 48.39], [7.75, 48.57]]) {
      const point = projectToMap(lon!, lat!)!;
      expect(point).not.toBeNull();
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(MAP_VIEWBOX.width);
      expect(point.y).toBeLessThanOrEqual(MAP_VIEWBOX.height);
    }
  });

  it("écarte ce qui tombe hors du tracé plutôt que de le coller au bord", () => {
    // Berlin, Madrid, et des coordonnées absentes.
    expect(projectToMap(13.4, 52.52)).toBeNull();
    expect(projectToMap(-3.7, 40.4)).toBeNull();
    expect(projectToMap(Number.NaN, 43.6)).toBeNull();
    expect(projectToMap(1.44, 0)).toBeNull();
  });
});

describe("placeImplantations", () => {
  it("laisse un client seul sur le centre de sa commune", () => {
    const [placed] = placeImplantations([client({ id: "a" })]);
    expect(placed!.x).toBeCloseTo(placed!.anchorX, 10);
    expect(placed!.y).toBeCloseTo(placed!.anchorY, 10);
  });

  it("écarte les clients d'une même commune pour qu'aucun n'en cache un autre", () => {
    const placed = placeImplantations(
      Array.from({ length: 8 }, (_, i) => client({ id: `c${i}` })),
    );
    expect(placed).toHaveLength(8);

    const seen = new Set(placed.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(seen.size).toBe(8);
    // Tous restent rattachés au même centre de commune.
    for (const point of placed) {
      expect(point.anchorX).toBeCloseTo(placed[0]!.anchorX, 10);
    }
  });

  it("place les mêmes clients au même endroit d'un appel à l'autre", () => {
    const input = Array.from({ length: 5 }, (_, i) => client({ id: `c${i}` }));
    expect(placeImplantations(input)).toEqual(placeImplantations(input));
  });

  it("ignore un client sans coordonnées plutôt que de l'inventer", () => {
    const placed = placeImplantations([
      client({ id: "a" }),
      client({ id: "sans", longitude: null, latitude: null }),
    ]);
    expect(placed.map((p) => p.id)).toEqual(["a"]);
  });

  it("ne mélange pas deux communes distinctes", () => {
    const placed = placeImplantations([
      client({ id: "toulouse" }),
      client({ id: "paris", longitude: 2.3522, latitude: 48.8566 }),
    ]);
    expect(placed).toHaveLength(2);
    expect(placed[0]!.anchorY).not.toBeCloseTo(placed[1]!.anchorY, 1);
  });
});

describe("countBySector", () => {
  it("compte par secteur en gardant l'ordre du référentiel", () => {
    const counts = countBySector(
      [client({ id: "a", clientType: "bar" }), client({ id: "b", clientType: "bar" }),
        client({ id: "c", clientType: "hotel" }), client({ id: "d", clientType: null })],
      ["restaurant", "bar", "hotel"],
    );
    expect(counts).toEqual([
      { type: "restaurant", count: 0 },
      { type: "bar", count: 2 },
      { type: "hotel", count: 1 },
    ]);
  });
});

describe("departmentAt", () => {
  it("range chaque ville dans son département", () => {
    const cases: Array<[string, number, number, string]> = [
      ["Toulouse", 1.4442, 43.6045, "31"],
      ["Montauban", 1.3638, 44.0198, "82"],
      ["Paris", 2.3522, 48.8566, "75"],
      ["Marseille", 5.405, 43.282, "13"],
      ["Périgueux", 0.7113, 45.1931, "24"],
      ["Mont-de-Marsan", -0.5002, 43.8914, "40"],
      ["Cernay-la-Ville", 1.9677, 48.6717, "78"],
      ["Castres", 2.2455, 43.6094, "81"],
      ["Narbonne", 3.0501, 43.1667, "11"],
    ];
    for (const [nom, lon, lat, attendu] of cases) {
      const point = projectToMap(lon, lat)!;
      expect(departmentAt(point.x, point.y, FRANCE_DEPARTMENTS), nom).toMatchObject({ code: attendu });
    }
  });

  it("ne rattache rien à un point hors des terres", () => {
    // Pleine mer au large de la Bretagne.
    const point = projectToMap(-5.5, 47.5);
    expect(point === null || departmentAt(point.x, point.y, FRANCE_DEPARTMENTS) === null).toBe(true);
  });
});

describe("groupByDepartment", () => {
  it("groupe par département, le plus fourni en tête", () => {
    const placed = placeImplantations([
      client({ id: "toulouse1" }),
      client({ id: "toulouse2" }),
      client({ id: "montauban", longitude: 1.3638, latitude: 44.0198 }),
    ]);
    const groups = groupByDepartment(placed, FRANCE_DEPARTMENTS);
    expect(groups.map((g) => [g.code, g.clients.length])).toEqual([["31", 2], ["82", 1]]);
  });

  it("garde le rattachement stable malgré l'écartement des points", () => {
    /*
     * Huit clients d'une même commune sont dispersés autour de leur centre.
     * Le rattachement doit suivre le centre, pas la position décalée, sinon
     * un client saute dans le département voisin.
     */
    const placed = placeImplantations(
      Array.from({ length: 8 }, (_, i) => client({ id: `c${i}`, longitude: 1.3638, latitude: 44.0198 })),
    );
    const groups = groupByDepartment(placed, FRANCE_DEPARTMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.code).toBe("82");
  });
});
