import { describe, expect, it } from "vitest";
import {
  sheetShownForWeek,
  sheetsToCreate,
  weekExpectation,
  weekLifecycle,
  type WeekExpectationRow,
} from "../../src/lib/domain/week-expectation";

/*
 * Une seule règle pour le planning (« à créer »), le tableau de bord
 * (« Fiches à préparer ») et la production : une fiche n'est attendue que si
 * le client est en gestion cette semaine-là **et** que son rythme y prévoit
 * une publication.
 */
function client(id: string, overrides: Partial<WeekExpectationRow> = {}, cadence?: object, weekdays?: number[]) {
  const settings = {
    ...(cadence === undefined ? {} : { monthlyCadence: cadence }),
    ...(weekdays === undefined ? {} : { publicationWeekdays: weekdays }),
  };
  return {
    id,
    is_active: true,
    client_kind: "gestion",
    notes: Object.keys(settings).length ? JSON.stringify(settings) : null,
    contract_start_date: null,
    contract_end_date: null,
    pause_start_date: null,
    pause_end_date: null,
    ...overrides,
  };
}

// Deux vidéos par mois, LinkedIn, publication le mercredi, contrat du
// 1er septembre au lundi 30 novembre 2026.
const emove = client("emove", {
  contract_start_date: "2026-09-01",
  contract_end_date: "2026-11-30",
}, { photo: 0, video: 2, story: 0, visual: 0 }, [3]);

const S38 = "2026-09-14";
const S39 = "2026-09-21";

describe("attente d'une semaine pour un client", () => {
  it("ne prévoit rien une semaine creuse du rythme", () => {
    expect(weekExpectation(emove, S38)).toEqual({ kind: "off_week" });
  });

  it("prévoit la vidéo une semaine de publication", () => {
    expect(weekExpectation(emove, S39)).toEqual({ kind: "publish", formats: ["video"] });
  });

  it("dit hors gestion avant le début et après la fin du contrat, quel que soit le rythme", () => {
    expect(weekExpectation(emove, "2026-08-24")).toEqual({ kind: "off_contract" }); // S35, impaire
    expect(weekExpectation(emove, "2026-12-14")).toEqual({ kind: "off_contract" }); // S51, impaire
  });

  /*
   * Le contrat s'arrête le lundi 30 novembre et E-MOVE publie le mercredi :
   * la semaine 49 n'a plus aucune publication couverte. Jugée au lundi, elle
   * réclamait une vidéo pour le 2 décembre.
   */
  it("arrête E-MOVE à la semaine 48", () => {
    expect(weekExpectation(emove, "2026-11-16")).toEqual({ kind: "publish", formats: ["video"] }); // S47, impaire
    expect(weekExpectation(emove, "2026-11-23")).toEqual({ kind: "off_week" }); // S48, paire : en gestion
    expect(weekExpectation(emove, "2026-11-30")).toEqual({ kind: "off_contract" }); // S49, impaire
    expect(weekLifecycle(emove, "2026-11-30").state).toBe("ended");
  });

  it("garde la semaine de fin quand une publication y tombe encore", () => {
    // Fin le mercredi 30 septembre, publication lundi et vendredi : le lundi 28 est couvert.
    const monFri = client("lundi-vendredi", { contract_end_date: "2026-09-30" }, { photo: 4 }, [1, 5]);
    expect(weekExpectation(monFri, "2026-09-28")).toEqual({ kind: "publish", formats: ["photo"] }); // S40
    expect(weekExpectation(monFri, "2026-10-05")).toEqual({ kind: "off_contract" }); // S41
  });

  it("juge la fin au lundi quand aucun jour de publication n'est renseigné", () => {
    const noDays = client("sans-jour", {
      contract_start_date: "2026-09-01",
      contract_end_date: "2026-11-30",
    }, { photo: 0, video: 2, story: 0, visual: 0 });
    expect(weekExpectation(noDays, "2026-11-30")).toEqual({ kind: "publish", formats: ["video"] }); // S49
    // Réglages illisibles : même repli.
    expect(weekExpectation({ ...noDays, notes: "{pas du json" }, "2026-11-30"))
      .toEqual({ kind: "publish", formats: ["photo"] });
  });

  it("laisse le début du contrat jugé au lundi", () => {
    // Début le jeudi 24 septembre, publication mercredi et vendredi : S39 reste hors gestion.
    const lateStart = client("debut-jeudi", { contract_start_date: "2026-09-24" }, { photo: 4 }, [3, 5]);
    expect(weekExpectation(lateStart, S39)).toEqual({ kind: "off_contract" });
    expect(weekLifecycle(lateStart, S39).state).toBe("not_started");
    expect(weekExpectation(lateStart, "2026-09-28")).toEqual({ kind: "publish", formats: ["photo"] });
  });

  it("dit hors gestion une semaine touchée par une pause", () => {
    const paused = { ...emove, pause_start_date: "2026-09-23", pause_end_date: "2026-09-30" };
    expect(weekExpectation(paused, S39)).toEqual({ kind: "off_contract" });
    expect(weekLifecycle(paused, S39).state).toBe("paused");
    // Pause jusqu'au mercredi 30 : la semaine 40 aussi, reprise la semaine 41.
    expect(weekExpectation(paused, "2026-09-28")).toEqual({ kind: "off_contract" });
    expect(weekExpectation(paused, "2026-10-05")).toEqual({ kind: "publish", formats: ["video"] }); // S41
  });

  it("propose une photo de repli à un client sans rythme lisible", () => {
    expect(weekExpectation(client("ancien"), S38)).toEqual({ kind: "publish", formats: ["photo"] });
    expect(weekExpectation(client("illisible", { notes: "{pas du json" }), S38))
      .toEqual({ kind: "publish", formats: ["photo"] });
    expect(weekExpectation(client("zero", {}, { photo: 0, video: 0, story: 0, visual: 0 }), S38))
      .toEqual({ kind: "publish", formats: ["photo"] });
  });

  it("ne propose rien à une prestation ponctuelle", () => {
    expect(weekExpectation(client("oneshot", { client_kind: "ponctuel" }, { photo: 4 }), S39))
      .toEqual({ kind: "off_contract" });
  });
});

describe("fiche existante affichée pour la semaine (planning et tableau de bord)", () => {
  it("masque un brouillon hors contrat, garde une fiche déjà envoyée", () => {
    expect(sheetShownForWeek("draft", emove, "2026-11-30")).toBe(false); // S49 : contrat fini
    expect(sheetShownForWeek("sent_to_client", emove, "2026-11-30")).toBe(true);
    expect(sheetShownForWeek("draft", emove, "2026-11-23")).toBe(true); // S48 : encore en gestion
    expect(sheetShownForWeek("draft", undefined, "2026-11-30")).toBe(true); // client inconnu
  });
});

describe("fiches à créer (planning et tableau de bord)", () => {
  const weekly = client("hebdo", {}, { photo: 4 });
  const covered = client("couvert", {}, { photo: 4 });
  const notStarted = client("bientot", { contract_start_date: "2026-10-05" }, { photo: 4 });
  const clients = [emove, weekly, covered, notStarted];
  const coveredIds = new Set(["couvert"]);

  it("n'inclut pas E-MOVE sa semaine creuse", () => {
    const ids = sheetsToCreate(clients, coveredIds, S38).map((entry) => entry.client.id);
    expect(ids).toEqual(["hebdo"]);
  });

  it("inclut E-MOVE, avec sa vidéo, sa semaine de publication", () => {
    const proposals = sheetsToCreate(clients, coveredIds, S39);
    expect(proposals.map((entry) => entry.client.id)).toEqual(["emove", "hebdo"]);
    expect(proposals[0]!.formats).toEqual(["video"]);
  });

  it("n'inclut ni un client déjà couvert ni un contrat pas encore commencé", () => {
    const ids = sheetsToCreate(clients, coveredIds, S39).map((entry) => entry.client.id);
    expect(ids).not.toContain("couvert");
    expect(ids).not.toContain("bientot");
  });

  it("donne le même chiffre d'une semaine sur l'autre qu'un décompte à la main", () => {
    // S38 : hebdo seul. S39 : E-MOVE et hebdo. Alternance attendue ensuite.
    const counts = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]
      .map((weekStart) => sheetsToCreate(clients, coveredIds, weekStart).length);
    expect(counts).toEqual([1, 2, 1, 3]);
  });

  it("ne propose plus E-MOVE la semaine 49, après la fin de son contrat", () => {
    const ids = sheetsToCreate(clients, coveredIds, "2026-11-30").map((entry) => entry.client.id);
    expect(ids).toEqual(["hebdo", "bientot"]);
  });
});
