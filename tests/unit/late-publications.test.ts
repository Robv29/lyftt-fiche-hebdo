import { describe, expect, it } from "vitest";
import {
  LATE_WINDOW_DAYS,
  hasLatePublications,
  latePublicationWindow,
  latePublications,
  sheetReachedClient,
  type LatePublicationRow,
} from "@/lib/domain/late-publications";
import { PRE_SEND_SHEET_STATUSES } from "@/lib/domain/sheet-status";
import { SHEET_STATUS_LABELS, type SheetStatus } from "@/lib/domain/types";

const TODAY = "2026-10-30";

function row(overrides: Partial<LatePublicationRow> = {}): LatePublicationRow {
  return {
    id: "item-1",
    scheduledDate: "2026-10-28",
    scheduledTime: "18:00:00",
    clientName: "REITER",
    format: "video",
    approvalStatus: "approved",
    sheetStatus: "approved_by_client",
    publishedAt: null,
    isCancelled: false,
    alertEnabled: true,
    ...overrides,
  };
}

function view(rows: LatePublicationRow[], today = TODAY) {
  return latePublications({ rows, today });
}

describe("latePublicationWindow", () => {
  it("couvre les sept jours révolus, hier compris, aujourd'hui exclu", () => {
    expect(latePublicationWindow(TODAY)).toEqual({ since: "2026-10-23", until: "2026-10-29" });
    expect(LATE_WINDOW_DAYS).toBe(7);
  });

  it("traverse un changement d'heure sans décaler la date civile", () => {
    // Le passage à l'heure d'hiver a eu lieu dans la nuit du 25 octobre 2026.
    expect(latePublicationWindow("2026-10-26")).toEqual({ since: "2026-10-19", until: "2026-10-25" });
    // Et le passage à l'heure d'été, fin mars.
    expect(latePublicationWindow("2026-03-30")).toEqual({ since: "2026-03-23", until: "2026-03-29" });
  });

  it("traverse un changement de mois et une année bissextile", () => {
    expect(latePublicationWindow("2026-01-03")).toEqual({ since: "2025-12-27", until: "2026-01-02" });
    expect(latePublicationWindow("2028-03-02")).toEqual({ since: "2028-02-24", until: "2028-03-01" });
  });
});

describe("sheetReachedClient", () => {
  it("écarte les trois statuts d'avant-envoi, lus à leur source unique", () => {
    for (const status of PRE_SEND_SHEET_STATUSES) {
      expect(sheetReachedClient(status)).toBe(false);
    }
  });

  it("écarte une fiche refusée ou périmée : elle se refait, elle ne se publie pas", () => {
    expect(sheetReachedClient("rejected")).toBe(false);
    expect(sheetReachedClient("expired")).toBe(false);
  });

  it("accepte tout ce qui est parti chez le client", () => {
    const sent: SheetStatus[] = [
      "sent_to_client",
      "partially_approved",
      "changes_requested",
      "corrections_in_progress",
      "new_version_to_send",
      "awaiting_revalidation",
      "approved_by_client",
      "tacitly_approved",
    ];
    for (const status of sent) expect(sheetReachedClient(status)).toBe(true);
  });

  it("tranche sur chaque statut de l'énumération, sans exception muette", () => {
    for (const status of Object.keys(SHEET_STATUS_LABELS) as SheetStatus[]) {
      expect(typeof sheetReachedClient(status)).toBe("boolean");
    }
  });
});

describe("latePublications", () => {
  it("ne dit rien quand il n'y a rien", () => {
    const result = view([]);
    expect(result.late).toEqual([]);
    expect(result.today).toEqual([]);
    expect(result.awaitingApproval).toBe(0);
    expect(hasLatePublications(result)).toBe(false);
  });

  it("compte une publication validée dont la date est passée", () => {
    const result = view([row()]);
    expect(result.late).toHaveLength(1);
    expect(hasLatePublications(result)).toBe(true);
  });

  it("ne compte pas le jour même, mais le rappelle", () => {
    const result = view([row({ scheduledDate: TODAY })]);
    expect(result.late).toEqual([]);
    expect(result.today).toHaveLength(1);
    // Le jour n'est pas fini : la fenêtre ne s'ouvre pas pour ça.
    expect(hasLatePublications(result)).toBe(false);
  });

  it("ne compte pas un contenu déjà coché publié", () => {
    expect(view([row({ publishedAt: "2026-10-28T18:05:00Z" })]).late).toEqual([]);
  });

  it("ne compte pas un contenu annulé", () => {
    expect(view([row({ isCancelled: true })]).late).toEqual([]);
  });

  it("ne compte pas un contenu dont la fiche n'est jamais partie", () => {
    for (const status of PRE_SEND_SHEET_STATUSES) {
      const result = view([row({ sheetStatus: status })]);
      expect(result.late).toEqual([]);
      expect(result.awaitingApproval).toBe(0);
    }
  });

  it("ne compte pas un contenu de fiche refusée ou périmée", () => {
    expect(view([row({ sheetStatus: "rejected" })]).late).toEqual([]);
    expect(view([row({ sheetStatus: "expired" })]).late).toEqual([]);
  });

  it("ne compte pas un dossier qui a coupé l'alerte", () => {
    const result = view([row({ alertEnabled: false, approvalStatus: "pending" })]);
    expect(result.late).toEqual([]);
    expect(result.awaitingApproval).toBe(0);
  });

  it("met à part le retard dont la case est grisée, sans le nommer", () => {
    const result = view([
      row({ id: "a", approvalStatus: "pending" }),
      row({ id: "b", approvalStatus: "corrected" }),
      row({ id: "c", approvalStatus: "changes_requested" }),
      row({ id: "d", approvalStatus: "resent" }),
    ]);
    expect(result.late).toEqual([]);
    expect(result.awaitingApproval).toBe(4);
    expect(hasLatePublications(result)).toBe(false);
  });

  it("accepte une validation obtenue après correction", () => {
    expect(view([row({ approvalStatus: "approved_after_fix" })]).late).toHaveLength(1);
  });

  it("n'attribue pas au retard une attente de validation datée d'aujourd'hui", () => {
    const result = view([row({ scheduledDate: TODAY, approvalStatus: "pending" })]);
    expect(result.awaitingApproval).toBe(0);
    expect(result.today).toEqual([]);
  });

  it("ignore ce qui précède la fenêtre et ce qui lui est postérieur", () => {
    const result = view([
      row({ id: "trop-vieux", scheduledDate: "2026-08-13" }),
      row({ id: "veille-de-fenetre", scheduledDate: "2026-10-22" }),
      row({ id: "premier-jour", scheduledDate: "2026-10-23" }),
      row({ id: "dernier-jour", scheduledDate: "2026-10-29" }),
      row({ id: "demain", scheduledDate: "2026-10-31" }),
    ]);
    expect(result.late.map((item) => item.id)).toEqual(["premier-jour", "dernier-jour"]);
  });

  it("voit, un lundi, le retard du vendredi précédent", () => {
    /*
     * Le trou de la semaine ISO, mesuré : le lundi 26 octobre, trois contenus
     * du vendredi 23 étaient réellement en retard et invisibles — rien n'est à
     * la fois « cette semaine » et « avant aujourd'hui ».
     */
    const result = view(
      [
        row({ id: "e-move", scheduledDate: "2026-10-23", clientName: "E-MOVE MANAGEMENT" }),
        row({ id: "muratet", scheduledDate: "2026-10-23", clientName: "Muratet" }),
      ],
      "2026-10-26",
    );
    expect(result.late).toHaveLength(2);
  });

  it("classe du plus ancien au plus récent, puis par heure, puis par dossier", () => {
    const result = view([
      row({ id: "c", scheduledDate: "2026-10-28", scheduledTime: "18:00:00", clientName: "REITER" }),
      row({ id: "b", scheduledDate: "2026-10-28", scheduledTime: "09:00:00", clientName: "Zèbre" }),
      row({ id: "a", scheduledDate: "2026-10-23", scheduledTime: "18:00:00", clientName: "Muratet" }),
      row({ id: "d", scheduledDate: "2026-10-28", scheduledTime: "18:00:00", clientName: "GÎTES CANAL DU MIDI" }),
    ]);
    expect(result.late.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("supporte une heure absente sans perdre la ligne", () => {
    const result = view([row({ scheduledTime: null })]);
    expect(result.late).toHaveLength(1);
    expect(result.late[0].scheduledTime).toBeNull();
  });

  it("rend la fenêtre lue avec la vue", () => {
    const result = view([]);
    expect(result.since).toBe("2026-10-23");
    expect(result.until).toBe("2026-10-29");
  });

  it("reproduit le partage mesuré du 30 octobre 2026", () => {
    /*
     * Fenêtre du 23 au 29 octobre, fiches parties, dossiers alertés :
     * 13 contenus, dont 5 cochables et 8 en attente de validation client ;
     * et 5 contenus datés du jour, dont 2 cochables.
     */
    const rows = [
      ...Array.from({ length: 5 }, (_, index) =>
        row({ id: `cochable-${index}`, scheduledDate: "2026-10-28", approvalStatus: "approved" })),
      ...Array.from({ length: 8 }, (_, index) =>
        row({ id: `attente-${index}`, scheduledDate: "2026-10-27", approvalStatus: "pending" })),
      ...Array.from({ length: 2 }, (_, index) =>
        row({ id: `jour-ok-${index}`, scheduledDate: TODAY, approvalStatus: "approved" })),
      ...Array.from({ length: 3 }, (_, index) =>
        row({ id: `jour-attente-${index}`, scheduledDate: TODAY, approvalStatus: "pending" })),
    ];
    const result = view(rows);
    expect(result.late).toHaveLength(5);
    expect(result.awaitingApproval).toBe(8);
    expect(result.today).toHaveLength(2);
    expect(hasLatePublications(result)).toBe(true);
  });
});
