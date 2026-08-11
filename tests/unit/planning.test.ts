import { describe, expect, it } from "vitest";
import {
  planningBucketForPeriod,
  planningWeekRange,
  selectHashtags,
  sheetCompletion,
  weeklyFormatsForCadence,
  publicationDatesForWeek,
  normalizeWeekdays,
} from "../../src/lib/domain/planning";

describe("planning hebdomadaire", () => {
  const now = new Date("2026-08-04T10:00:00Z");

  it("calcule la semaine courante et la suivante", () => {
    expect(planningWeekRange(now)).toMatchObject({
      currentStart: "2026-08-03",
      currentEnd: "2026-08-09",
      nextStart: "2026-08-10",
      nextEnd: "2026-08-16",
      nextIsoYear: 2026,
      nextIsoWeek: 33,
    });
  });

  it("range les fiches dans les trois périodes utiles", () => {
    expect(planningBucketForPeriod("2026-07-27", "2026-08-02", now)).toBe("past");
    expect(planningBucketForPeriod("2026-08-03", "2026-08-09", now)).toBe("current");
    expect(planningBucketForPeriod("2026-08-10", "2026-08-16", now)).toBe("next");
    expect(planningBucketForPeriod("2026-08-17", "2026-08-23", now)).toBe("later");
  });

  it("compte texte, hashtags et média dans la progression", () => {
    expect(sheetCompletion([
      { caption: "Texte", hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
      { caption: "", hashtags: ["#Local"], format: "video", mediaAssetId: null },
    ])).toEqual({ completed: 4, total: 6, percentage: 67 });
  });

  it("ne demande pas de média pour un texte seul", () => {
    expect(sheetCompletion([
      { caption: "Texte", hashtags: "#Local", format: "texte_seul" },
    ])).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  it("répartit les formats selon la cadence mensuelle", () => {
    const fourWeeks = [33, 34, 35, 36].flatMap((week) =>
      weeklyFormatsForCadence({ photo: 4, video: 2, story: 6, visual: 2 }, week),
    );
    expect(fourWeeks.filter((format) => format === "photo")).toHaveLength(4);
    expect(fourWeeks.filter((format) => format === "video")).toHaveLength(2);
    expect(fourWeeks.filter((format) => format === "story")).toHaveLength(6);
    expect(fourWeeks.filter((format) => format === "visuel")).toHaveLength(2);
  });

  it("ne produit aucune story quand le client n'en a pas vendu", () => {
    const fourWeeks = [33, 34, 35, 36].flatMap((week) =>
      weeklyFormatsForCadence({ photo: 4, video: 2, visual: 2 }, week),
    );
    expect(fourWeeks.filter((format) => format === "story")).toHaveLength(0);
  });

  it("sélectionne des hashtags variés mais stables", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `#Tag${index}`);
    const first = selectHashtags(tags, "client-33-0");
    const second = selectHashtags(tags, "client-33-0");
    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
    expect(selectHashtags(tags, "client-33-1")).not.toEqual(first);
  });
});

describe("jours de publication", () => {
  const monday = new Date("2026-08-10T00:00:00Z"); // lundi

  it("pose les contenus sur les jours choisis, dans l'ordre", () => {
    expect(publicationDatesForWeek(3, [4, 2], monday)).toEqual([
      "2026-08-11", // mardi
      "2026-08-13", // jeudi
      "2026-08-11", // on repasse sur le mardi
    ]);
  });

  it("dédoublonne et écarte les jours hors semaine", () => {
    expect(normalizeWeekdays([3, 3, 0, 8, 1])).toEqual([1, 3]);
  });

  it("ne propose aucune date sans jour renseigné", () => {
    expect(publicationDatesForWeek(2, [], monday)).toEqual(["", ""]);
  });

  it("couvre la semaine entière du lundi au dimanche", () => {
    expect(publicationDatesForWeek(7, [1, 2, 3, 4, 5, 6, 7], monday)).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
      "2026-08-14", "2026-08-15", "2026-08-16",
    ]);
  });
});
