import { describe, expect, it } from "vitest";
import {
  assigneeKey,
  BOARD_SORT_LABELS,
  EMPTY_BOARD_FILTERS,
  inBoardScope,
  matchesBoardFilters,
  normalize,
  productionRequestRights,
  sortBoard,
  type BoardRow,
  type BoardSort,
  type ProductionRequestParties,
  type ProductionViewer,
} from "@/lib/domain/production-board";
import { UNKNOWN_PERSON_KEY } from "@/lib/domain/production-requests";

const DEMANDEUR = "11111111-1111-1111-1111-111111111111";
const GRAPHISTE = "22222222-2222-2222-2222-222222222222";
const TIERS = "33333333-3333-3333-3333-333333333333";

function request(over: Partial<ProductionRequestParties> = {}): ProductionRequestParties {
  return { requestedBy: DEMANDEUR, assignedTo: GRAPHISTE, status: "a_faire", ...over };
}

const viewer = (id: string, role: ProductionViewer["role"] = "graphic_designer"): ProductionViewer => ({ id, role });

describe("productionRequestRights — qui est concerné", () => {
  it("laisse le tiers en lecture seule, sans aucun bouton", () => {
    const rights = productionRequestRights(request(), viewer(TIERS, "community_manager"));
    expect(rights.isConcerned).toBe(false);
    expect(rights.canDeliver).toBe(false);
    expect(rights.canValidate).toBe(false);
    expect(rights.canReopen).toBe(false);
    expect(rights.canDelete).toBe(false);
    expect(rights.canReassign).toBe(false);
  });

  it("ne donne rien du tout sans personne connectée", () => {
    expect(productionRequestRights(request(), null).isConcerned).toBe(false);
  });

  it("reconnaît le demandeur, qui décide du sort de sa commande", () => {
    const rights = productionRequestRights(request({ status: "livree" }), viewer(DEMANDEUR, "community_manager"));
    expect(rights.isRequester).toBe(true);
    expect(rights.mayDecide).toBe(true);
    expect(rights.canValidate).toBe(true);
    expect(rights.canDelete).toBe(true);
  });

  it("laisse l'affectataire livrer, mais pas valider son propre travail", () => {
    const rights = productionRequestRights(request({ status: "livree" }), viewer(GRAPHISTE));
    expect(rights.isAssignee).toBe(true);
    expect(rights.canDeliver).toBe(true);
    expect(rights.canValidate).toBe(false);
    expect(rights.canDelete).toBe(false);
    expect(rights.canReassign).toBe(false);
  });

  it("donne tout à l'encadrement, sur n'importe quelle commande", () => {
    for (const role of ["super_admin", "production_manager"] as const) {
      const rights = productionRequestRights(request({ status: "livree" }), viewer(TIERS, role));
      expect(rights.isLead).toBe(true);
      expect(rights.canValidate).toBe(true);
      expect(rights.canReopen).toBe(true);
      expect(rights.canDelete).toBe(true);
      expect(rights.canDeliver).toBe(true);
    }
  });

  it("n'étend pas l'encadrement au community manager : il décide des siennes", () => {
    const rights = productionRequestRights(request(), viewer(TIERS, "community_manager"));
    expect(rights.isLead).toBe(false);
    expect(rights.canReassign).toBe(false);
  });

  it("laisse l'observateur en lecture, même sur une commande sans affectataire", () => {
    const rights = productionRequestRights(request({ assignedTo: null }), viewer(TIERS, "observer"));
    expect(rights.isConcerned).toBe(false);
    expect(rights.canDeliver).toBe(false);
  });

  it("ne confond pas « personne » avec « moi » quand les colonnes sont nulles", () => {
    const rights = productionRequestRights({ requestedBy: null, assignedTo: null, status: "a_faire" }, viewer(TIERS));
    expect(rights.isRequester).toBe(false);
    expect(rights.isAssignee).toBe(false);
    expect(rights.isConcerned).toBe(false);
  });
});

describe("productionRequestRights — ce que le statut autorise", () => {
  it("ne propose la validation que sur une livraison", () => {
    const me = viewer(DEMANDEUR, "community_manager");
    expect(productionRequestRights(request({ status: "a_faire" }), me).canValidate).toBe(false);
    expect(productionRequestRights(request({ status: "livree" }), me).canValidate).toBe(true);
    expect(productionRequestRights(request({ status: "validee" }), me).canValidate).toBe(false);
  });

  it("ne rouvre que ce qui est sorti de production", () => {
    const me = viewer(DEMANDEUR, "community_manager");
    expect(productionRequestRights(request({ status: "a_faire" }), me).canReopen).toBe(false);
    expect(productionRequestRights(request({ status: "livree" }), me).canReopen).toBe(true);
    expect(productionRequestRights(request({ status: "validee" }), me).canReopen).toBe(true);
  });

  it("ne réaffecte plus une commande livrée", () => {
    const me = viewer(DEMANDEUR, "community_manager");
    expect(productionRequestRights(request({ status: "a_faire" }), me).canReassign).toBe(true);
    expect(productionRequestRights(request({ status: "livree" }), me).canReassign).toBe(false);
  });

  it("ne dépose plus rien sur une commande validée : la rouvrir d'abord", () => {
    expect(productionRequestRights(request({ status: "validee" }), viewer(GRAPHISTE)).canDeliver).toBe(false);
  });
});

// ---------------------------------------------------------------------------

function row(over: Partial<BoardRow> = {}): BoardRow {
  return {
    clientId: "client-a",
    clientName: "Ánetô",
    title: "Reel de présentation",
    dueOn: "2026-09-25",
    createdAt: "2026-09-20T09:00:00.000Z",
    status: "a_faire",
    urgency: null,
    assignedToId: GRAPHISTE,
    assigneeLabel: "Sinclair",
    isMine: false,
    assignedToViewer: false,
    ...over,
  };
}

describe("normalize", () => {
  it("ignore accents et casse", () => {
    expect(normalize("Ánetô")).toBe("aneto");
    expect(normalize("VGS Autos")).toBe("vgs autos");
  });
});

describe("inBoardScope", () => {
  it("garde tout sur « Toutes »", () => {
    expect(inBoardScope(row(), "toutes")).toBe(true);
  });

  it("« Pour vous » ne garde que ce qui est confié à la personne connectée", () => {
    expect(inBoardScope(row({ assignedToViewer: true }), "pour_vous")).toBe(true);
    expect(inBoardScope(row(), "pour_vous")).toBe(false);
  });

  it("« Mes demandes » ne garde que ce que la personne a commandé", () => {
    expect(inBoardScope(row({ isMine: true }), "mes_demandes")).toBe(true);
    expect(inBoardScope(row(), "mes_demandes")).toBe(false);
  });

  it("« À confier » ne garde que ce qui n'est confié à personne et reste à produire", () => {
    expect(inBoardScope(row({ assignedToId: null }), "a_confier")).toBe(true);
    expect(inBoardScope(row({ assignedToId: null, status: "livree" }), "a_confier")).toBe(false);
    expect(inBoardScope(row(), "a_confier")).toBe(false);
  });

  it("« En retard » suit l'urgence calculée ailleurs, sans la recalculer", () => {
    expect(inBoardScope(row({ urgency: "overdue" }), "en_retard")).toBe(true);
    expect(inBoardScope(row({ urgency: "due_tomorrow" }), "en_retard")).toBe(false);
  });
});

describe("matchesBoardFilters", () => {
  it("ne filtre rien quand tout est vide", () => {
    expect(matchesBoardFilters(row(), EMPTY_BOARD_FILTERS)).toBe(true);
  });

  it("cherche dans le nom du client comme dans l'intitulé, sans les accents", () => {
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, query: " aneto " })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, query: "REEL" })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, query: "carrousel" })).toBe(false);
  });

  it("filtre par client", () => {
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, clientId: "client-a" })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, clientId: "client-b" })).toBe(false);
  });

  it("filtre par personne, « non confiée » comprise", () => {
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, person: GRAPHISTE })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, person: TIERS })).toBe(false);
    expect(assigneeKey(row({ assignedToId: null }))).toBe(UNKNOWN_PERSON_KEY);
    expect(matchesBoardFilters(row({ assignedToId: null }), { ...EMPTY_BOARD_FILTERS, person: UNKNOWN_PERSON_KEY })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, person: UNKNOWN_PERSON_KEY })).toBe(false);
  });

  it("filtre par statut", () => {
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, status: "a_faire" })).toBe(true);
    expect(matchesBoardFilters(row(), { ...EMPTY_BOARD_FILTERS, status: "livree" })).toBe(false);
  });

  it("cumule les critères", () => {
    const filters = { query: "reel", clientId: "client-a", person: GRAPHISTE, status: "a_faire" as const };
    expect(matchesBoardFilters(row(), filters)).toBe(true);
    expect(matchesBoardFilters(row({ clientId: "client-b" }), filters)).toBe(false);
  });
});

describe("sortBoard", () => {
  const rows = [
    row({ title: "C", clientName: "Muratet", clientId: "m", dueOn: "2026-09-30", createdAt: "2026-09-01T08:00:00.000Z", assigneeLabel: "Simon" }),
    row({ title: "A", clientName: "Ánetô", clientId: "a", dueOn: "2026-09-24", createdAt: "2026-09-22T08:00:00.000Z", assigneeLabel: null, assignedToId: null }),
    row({ title: "B", clientName: "Bergerac", clientId: "b", dueOn: "2026-09-26", createdAt: "2026-09-10T08:00:00.000Z", assigneeLabel: "Sinclair" }),
  ];
  const titles = (sort: BoardSort) => sortBoard(rows, sort).map((entry) => entry.title);

  it("classe par échéance, au plus tôt puis au plus tard", () => {
    expect(titles("echeance")).toEqual(["A", "B", "C"]);
    expect(titles("echeance_tard")).toEqual(["C", "B", "A"]);
  });

  it("classe par client, accents ignorés par la locale française", () => {
    expect(titles("client")).toEqual(["A", "B", "C"]);
  });

  it("classe par personne et ferme la liste par les commandes sans affectataire", () => {
    expect(titles("personne")).toEqual(["C", "B", "A"]); // Simon avant Sinclair
  });

  it("classe des plus récentes aux plus anciennes", () => {
    expect(titles("recentes")).toEqual(["A", "B", "C"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const original = [...rows];
    sortBoard(rows, "client");
    expect(rows).toEqual(original);
  });

  it("départage deux mêmes échéances de façon stable", () => {
    const sameDay = [
      row({ title: "Z", clientName: "Bergerac", dueOn: "2026-09-24" }),
      row({ title: "A", clientName: "Ánetô", dueOn: "2026-09-24" }),
    ];
    expect(sortBoard(sameDay, "echeance").map((entry) => entry.title)).toEqual(["A", "Z"]);
  });

  it("nomme chaque tri", () => {
    expect(Object.keys(BOARD_SORT_LABELS)).toHaveLength(5);
  });
});
