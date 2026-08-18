import { describe, expect, it } from "vitest";
import {
  planningBucketForPeriod,
  planningWeekRange,
  selectHashtags,
  satisfactionPercentage,
  satisfactionSummary,
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

  /*
   * Une story n'a pas de légende : le texte est incrusté à l'image au montage.
   * La compter comme manquante bloquait la fiche à 66 % pour toujours.
   */
  it("ne demande pas de texte pour une story", () => {
    expect(sheetCompletion([
      { caption: "", hashtags: "#Local", format: "story", mediaAssetId: "media" },
    ])).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  it("ne crédite pas un texte écrit par erreur sur une story", () => {
    expect(sheetCompletion([
      { caption: "Texte inutile", hashtags: "#Local", format: "story", mediaAssetId: "media" },
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

describe("étalement du rythme mensuel", () => {
  it("répartit deux vidéos par mois une semaine sur deux", () => {
    const semaines = [33, 34, 35, 36].map((week) =>
      weeklyFormatsForCadence({ video: 2 }, week).filter((format) => format === "video").length);
    // Deux semaines servies sur quatre, alternées et non groupées.
    expect(semaines.reduce((total, count) => total + count, 0)).toBe(2);
    expect(semaines[0]).not.toBe(semaines[1]);
    expect(semaines[1]).not.toBe(semaines[2]);
    expect(semaines[2]).not.toBe(semaines[3]);
  });

  it("sert une prestation mensuelle une semaine sur quatre", () => {
    const semaines = [33, 34, 35, 36].map((week) =>
      weeklyFormatsForCadence({ video: 1 }, week).filter((format) => format === "video").length);
    expect(semaines.reduce((total, count) => total + count, 0)).toBe(1);
  });

  it("sert chaque semaine dès que le volume atteint quatre", () => {
    for (const week of [33, 34, 35, 36]) {
      expect(weeklyFormatsForCadence({ video: 4 }, week).filter((f) => f === "video")).toHaveLength(1);
    }
  });
});

describe("visibilité d'une fiche hors gestion", () => {
  /*
   * Le filtre sert à ne pas proposer de travail ; il ne doit pas escamoter un
   * travail réel sur la foi d'une date de contrat mal saisie.
   */
  const estVisible = (statut: string, produit: boolean) =>
    !["draft", "internal_review", "ready_to_send"].includes(statut) || produit;

  it("garde une fiche envoyée ou validée même hors gestion", () => {
    expect(estVisible("sent_to_client", false)).toBe(true);
    expect(estVisible("approved_by_client", false)).toBe(true);
    expect(estVisible("awaiting_revalidation", false)).toBe(true);
  });

  it("écarte un brouillon jamais transmis", () => {
    expect(estVisible("draft", false)).toBe(false);
    expect(estVisible("ready_to_send", false)).toBe(false);
  });

  it("garde tout ce qui relève d'un client en gestion", () => {
    expect(estVisible("draft", true)).toBe(true);
  });
});

/*
 * Satisfaction client : trois niveaux lus en pourcentage, et un taux de réponse
 * affiché aussi visiblement que la note. Un 100 % sur une réponse ne dit rien.
 */
describe("satisfaction client", () => {
  it("traduit les trois niveaux en pourcentage", () => {
    expect(satisfactionPercentage(1)).toBe(0);
    expect(satisfactionPercentage(2)).toBe(50);
    expect(satisfactionPercentage(3)).toBe(100);
  });

  it("borne une note hors échelle plutôt que de produire un taux absurde", () => {
    expect(satisfactionPercentage(0)).toBe(0);
    expect(satisfactionPercentage(9)).toBe(100);
  });

  it("moyenne les réponses et dit combien de fiches ont répondu", () => {
    expect(satisfactionSummary({ scores: [3, 3, 2], eligible: 10 })).toEqual({
      percentage: 83,
      answers: 3,
      eligible: 10,
      responseRate: 30,
      unhappy: 0,
    });
  });

  it("compte les notes basses, qui appellent un geste", () => {
    expect(satisfactionSummary({ scores: [1, 3], eligible: 2 }).unhappy).toBe(1);
  });

  it("n'invente aucun chiffre sans réponse", () => {
    expect(satisfactionSummary({ scores: [], eligible: 4 })).toMatchObject({
      percentage: null,
      answers: 0,
      responseRate: 0,
    });
    // Sans fiche validée, le taux de réponse n'a pas de dénominateur.
    expect(satisfactionSummary({ scores: [], eligible: 0 }).responseRate).toBeNull();
  });
});
