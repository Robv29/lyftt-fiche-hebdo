import { describe, expect, it } from "vitest";
import {
  filterShootings,
  formatDuration,
  shootingStats,
  shootingsByKind,
  shootingsPerMonth,
  type CountedShooting,
} from "@/lib/domain/shootings";

const s = (over: Partial<CountedShooting> & { date: string }): CountedShooting => ({
  clientId: "c1", status: "realise", kind: null, durationMinutes: null, ...over,
});

describe("shootingStats", () => {
  it("sépare réalisés, à venir et annulés", () => {
    const stats = shootingStats([
      s({ date: "2026-01-10" }),
      s({ date: "2026-02-10" }),
      s({ date: "2026-12-10", status: "cale" }),
      s({ date: "2026-03-10", status: "annule" }),
    ]);
    expect(stats).toMatchObject({ done: 2, upcoming: 1, cancelled: 1 });
  });

  it("ne compte pas un shooting annulé comme réalisé, même à une date passée", () => {
    /*
     * L'annulation ne se déduit d'aucune date : sans elle, un tournage annulé
     * il y a trois mois gonflerait l'activité de production.
     */
    const stats = shootingStats([s({ date: "2020-01-01", status: "annule", durationMinutes: 300 })]);
    expect(stats.done).toBe(0);
    expect(stats.totalMinutes).toBe(0);
  });

  it("ne moyenne que les durées connues, et dit combien manquent", () => {
    const stats = shootingStats([
      s({ date: "2026-01-10", durationMinutes: 300 }),
      s({ date: "2026-02-10", durationMinutes: 340 }),
      s({ date: "2026-03-10" }),
    ]);
    expect(stats.totalMinutes).toBe(640);
    expect(stats.averageMinutes).toBe(320);
    // Une moyenne sur deux fiches parmi trois ne doit pas passer pour générale.
    expect(stats.missingDuration).toBe(1);
  });

  it("rend une moyenne nulle plutôt que zéro quand rien n'est mesuré", () => {
    const stats = shootingStats([s({ date: "2026-01-10" })]);
    expect(stats.averageMinutes).toBeNull();
    expect(stats.missingDuration).toBe(1);
  });

  it("ignore une durée aberrante au lieu de la cumuler", () => {
    const stats = shootingStats([s({ date: "2026-01-10", durationMinutes: 0 })]);
    expect(stats.totalMinutes).toBe(0);
    expect(stats.missingDuration).toBe(1);
  });
});

describe("filterShootings", () => {
  const lot = [
    s({ date: "2026-01-10", clientId: "a", kind: "photo" }),
    s({ date: "2026-06-10", clientId: "b", kind: "video", status: "cale" }),
    s({ date: "2026-09-10", clientId: "a", kind: "photo_video" }),
  ];

  it("filtre par client, statut et type", () => {
    expect(filterShootings(lot, { clientId: "a" })).toHaveLength(2);
    expect(filterShootings(lot, { status: "cale" })).toHaveLength(1);
    expect(filterShootings(lot, { kind: "photo_video" })).toHaveLength(1);
  });

  it("borne la période aux deux extrémités incluses", () => {
    expect(filterShootings(lot, { from: "2026-01-10", to: "2026-06-10" })).toHaveLength(2);
    expect(filterShootings(lot, { from: "2026-01-11" })).toHaveLength(2);
    expect(filterShootings(lot, { to: "2026-01-09" })).toHaveLength(0);
  });

  it("combine les filtres sans en oublier", () => {
    expect(filterShootings(lot, { clientId: "a", kind: "photo" })).toHaveLength(1);
    expect(filterShootings(lot, { clientId: "a", status: "cale" })).toHaveLength(0);
  });

  it("ne filtre rien quand aucun critère n'est donné", () => {
    expect(filterShootings(lot, {})).toHaveLength(3);
    expect(filterShootings(lot, { clientId: null, status: null })).toHaveLength(3);
  });
});

describe("formatDuration", () => {
  it("écrit les durées en heures et minutes", () => {
    expect(formatDuration(320)).toBe("5 h 20");
    expect(formatDuration(300)).toBe("5 h");
    expect(formatDuration(45)).toBe("45 min");
  });

  it("ne prétend pas connaître une durée absente", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
  });
});

describe("répartitions", () => {
  it("compte les réalisés par mois, du plus ancien au plus récent", () => {
    expect(shootingsPerMonth([
      s({ date: "2026-03-02" }), s({ date: "2026-01-15" }), s({ date: "2026-03-20" }),
      s({ date: "2026-05-01", status: "cale" }),
    ])).toEqual([{ month: "2026-01", count: 1 }, { month: "2026-03", count: 2 }]);
  });

  it("compte les types sans noyer ceux qui n'en ont pas", () => {
    const { counts, unknown } = shootingsByKind([
      s({ date: "2026-01-10", kind: "photo" }),
      s({ date: "2026-02-10", kind: "photo" }),
      s({ date: "2026-03-10", kind: "video" }),
      s({ date: "2026-04-10" }),
      s({ date: "2026-05-10", kind: "photo", status: "annule" }),
    ]);
    expect(counts).toEqual({ photo: 2, video: 1, photo_video: 0 });
    expect(unknown).toBe(1);
  });
});
