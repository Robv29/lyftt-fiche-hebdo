import { describe, expect, it } from "vitest";
import {
  calendarState,
  dayWorkload,
  inCalendarScope,
  isCivilDate,
  monthAgenda,
  monthEnd,
  monthGrid,
  monthRange,
  monthWorkload,
  placeTasks,
  shiftMonth,
  taskFromCorrection,
  taskFromRequest,
  type CalendarTask,
} from "@/lib/domain/production-calendar";
import { EMPTY_BOARD_FILTERS, matchesBoardFilters } from "@/lib/domain/production-board";
import { UNKNOWN_PERSON_KEY } from "@/lib/domain/production-requests";

const AUJOURD_HUI = "2026-09-24";
const GRAPHISTE = "22222222-2222-2222-2222-222222222222";
const VIDEASTE = "33333333-3333-3333-3333-333333333333";

function commande(over: Partial<Parameters<typeof taskFromRequest>[0]> = {}) {
  return taskFromRequest({
    id: "commande-1",
    clientId: "client-1",
    clientName: "Muratet",
    kind: "video",
    title: "Vidéo de présentation",
    dueOn: "2026-09-28",
    status: "a_faire",
    assignedToId: GRAPHISTE,
    assigneeLabel: "Simon",
    isMine: false,
    assignedToViewer: false,
    canReschedule: false,
    ...over,
  }, AUJOURD_HUI);
}

function correction(over: Partial<Parameters<typeof taskFromCorrection>[0]> = {}) {
  return taskFromCorrection({
    id: "correction-1",
    clientId: "client-2",
    clientName: "BCL Piscine",
    title: "Reprendre le visuel",
    category: "graphic",
    dueOn: "2026-09-29",
    status: "assigned",
    overdue: false,
    assignedToId: VIDEASTE,
    assigneeLabel: "Sinclair",
    assignedToViewer: false,
    ...over,
  }, AUJOURD_HUI);
}

describe("isCivilDate — ce qu'une échéance déplacée a le droit d'être", () => {
  it("accepte une date civile bien formée", () => {
    expect(isCivilDate("2026-09-24")).toBe(true);
  });

  it("refuse un jour qui n'existe pas, que l'expression régulière laisserait passer", () => {
    expect(isCivilDate("2026-02-31")).toBe(false);
    expect(isCivilDate("2026-13-01")).toBe(false);
  });

  it("refuse un instant : le calendrier ne manipule que des jours", () => {
    expect(isCivilDate("2026-09-24T10:00:00Z")).toBe(false);
    expect(isCivilDate("24/09/2026")).toBe(false);
  });

  it("accepte le 29 février d'une année bissextile et refuse celui d'une autre", () => {
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilDate("2026-02-29")).toBe(false);
  });
});

describe("monthGrid — des semaines entières, lundi en tête", () => {
  it("commence chaque ligne un lundi et la finit un dimanche", () => {
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0]!.date}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${week[6]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("déborde sur les mois voisins pour compléter la première et la dernière semaine", () => {
    // Le 1er septembre 2026 est un mardi : le lundi 31 août ouvre la grille.
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    const premier = grid.weeks[0]![0]!;
    expect(premier.date).toBe("2026-08-31");
    expect(premier.inMonth).toBe(false);
    expect(grid.weeks.flat().filter((day) => day.inMonth)).toHaveLength(30);
  });

  it("n'ajoute pas de semaine vide après le dernier jour du mois", () => {
    // Février 2027 commence un lundi et finit un dimanche : quatre lignes, pas plus.
    const grid = monthGrid("2027-02", AUJOURD_HUI);
    expect(grid.weeks).toHaveLength(4);
    expect(grid.weeks.flat().every((day) => day.inMonth)).toBe(true);
  });

  it("porte un mois de 31 jours ouvert un dimanche sur six lignes", () => {
    // 1er août 2026 = samedi : la grille court du 27 juillet au 6 septembre.
    const grid = monthGrid("2026-08", AUJOURD_HUI);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks[0]![0]!.date).toBe("2026-07-27");
    expect(grid.weeks[5]![6]!.date).toBe("2026-09-06");
  });

  it("marque aujourd'hui, et lui seul", () => {
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    const marques = grid.weeks.flat().filter((day) => day.isToday);
    expect(marques.map((day) => day.date)).toEqual([AUJOURD_HUI]);
  });

  it("marque samedi et dimanche comme week-end", () => {
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    expect(grid.weeks[0]!.map((day) => day.isWeekend)).toEqual([false, false, false, false, false, true, true]);
  });

  it("franchit le changement d'année sans trou", () => {
    const grid = monthGrid("2026-12", AUJOURD_HUI);
    const jours = grid.weeks.flat().map((day) => day.date);
    expect(jours).toContain("2026-12-31");
    expect(jours).toContain("2027-01-01");
    // Aucun jour manquant ni répété : la suite est continue.
    expect(new Set(jours).size).toBe(jours.length);
  });
});

describe("shiftMonth / monthEnd — les bornes des mois", () => {
  it("recule de janvier à décembre de l'année précédente", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("connaît la longueur de février, bissextile ou non", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-09")).toBe("2026-09-30");
  });
});

describe("taskFromRequest — la couleur d'une commande", () => {
  it("dit « en retard » d'une échéance passée", () => {
    expect(calendarState(commande({ dueOn: "2026-09-23" }))).toBe("en_retard");
  });

  it("distingue demain du retard : l'un se rattrape encore", () => {
    expect(calendarState(commande({ dueOn: "2026-09-25" }))).toBe("demain");
    expect(calendarState(commande({ dueOn: "2026-09-26" }))).toBe("a_faire");
  });

  it("ne met jamais en retard une commande livrée : elle attend une validation", () => {
    const livree = commande({ dueOn: "2026-09-01", status: "livree" });
    expect(livree.urgency).toBeNull();
    expect(calendarState(livree)).toBe("livree");
  });

  it("nomme la nature de la commande avec le vocabulaire de la file", () => {
    expect(commande({ kind: "video" }).kindLabel).toBe("Vidéo");
    expect(commande({ kind: "visuel" }).kindLabel).toBe("Visuel");
  });
});

describe("taskFromCorrection — l'autre moitié du plan de charge", () => {
  it("reprend le retard calculé en amont plutôt que de comparer les dates", () => {
    /*
     * Une correction attendue sur une semaine déjà publiée n'est pas signalée
     * en rouge : `isActionableOverdue` l'a dit, le calendrier ne le refait pas.
     */
    const passee = correction({ dueOn: "2026-08-25", overdue: false });
    expect(calendarState(passee)).toBe("a_faire");
    expect(calendarState(correction({ dueOn: "2026-08-25", overdue: true }))).toBe("en_retard");
  });

  it("passe en attente de validation dès que le fichier est déposé", () => {
    expect(calendarState(correction({ status: "ready_for_review", overdue: true }))).toBe("livree");
    expect(calendarState(correction({ status: "sent_back_to_client" }))).toBe("livree");
  });

  it("accepte une correction sans échéance sans la dater d'office", () => {
    const sansDate = correction({ dueOn: null });
    expect(sansDate.dueOn).toBeNull();
    expect(sansDate.urgency).toBeNull();
  });

  it("ne propose jamais de déplacer une correction : sa date est celle du client", () => {
    expect(correction().canReschedule).toBe(false);
  });
});

describe("placeTasks — poser les tâches sur les jours", () => {
  it("range chaque tâche sur son échéance", () => {
    const { byDay } = placeTasks([commande({ dueOn: "2026-09-28" }), correction({ dueOn: "2026-09-29" })]);
    expect(byDay.get("2026-09-28")).toHaveLength(1);
    expect(byDay.get("2026-09-29")).toHaveLength(1);
  });

  it("met les tâches sans échéance à part, sans les perdre", () => {
    const { byDay, undated } = placeTasks([correction({ dueOn: null }), commande()]);
    expect(undated.map((task) => task.id)).toEqual(["correction-1"]);
    expect([...byDay.values()].flat()).toHaveLength(1);
  });

  it("classe une journée du plus urgent au moins urgent", () => {
    const jour = "2026-09-24";
    const { byDay } = placeTasks([
      commande({ id: "livree", dueOn: jour, status: "livree" }),
      commande({ id: "retard", dueOn: jour, clientName: "Zèbre" }),
      commande({ id: "a-faire", dueOn: jour }),
    ]);
    // Le 24 est aujourd'hui : « à faire » aujourd'hui n'est ni en retard ni demain.
    expect(byDay.get(jour)!.map((task) => task.id)).toEqual(["a-faire", "retard", "livree"]);
  });

  it("départage deux tâches du même état par client puis par intitulé", () => {
    const jour = "2026-09-28";
    const { byDay } = placeTasks([
      commande({ id: "b", dueOn: jour, clientName: "Zèbre", title: "Affiche" }),
      commande({ id: "a", dueOn: jour, clientName: "Aneto", title: "Teaser" }),
    ]);
    expect(byDay.get(jour)!.map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("rend une grille vide sans tâche, plutôt que de tomber", () => {
    const placement = placeTasks([]);
    expect(placement.byDay.size).toBe(0);
    expect(placement.undated).toEqual([]);
    expect(dayWorkload("2026-09-24", placement)).toMatchObject({ total: 0, late: 0, unassigned: 0 });
  });
});

describe("dayWorkload — ce que pèse une journée", () => {
  it("compte le total, les retards et ce qui reste à confier", () => {
    const jour = "2026-09-23";
    const placement = placeTasks([
      commande({ id: "retard", dueOn: jour }),
      commande({ id: "orpheline", dueOn: jour, assignedToId: null, assigneeLabel: null }),
      correction({ id: "correction", dueOn: jour, overdue: true }),
    ]);
    expect(dayWorkload(jour, placement)).toMatchObject({ total: 3, late: 3, unassigned: 1 });
  });

  it("ne compte jamais une correction parmi ce qui reste à confier", () => {
    /*
     * Une correction sans affectation n'atteint pas cet écran : celles qu'on
     * voit sont confiées, et « À confier » ne parle donc que des commandes.
     */
    const jour = "2026-09-29";
    const placement = placeTasks([correction({ dueOn: jour, assignedToId: null, assigneeLabel: null })]);
    expect(dayWorkload(jour, placement).unassigned).toBe(0);
  });
});

describe("monthAgenda / monthWorkload — l'écran étroit et le résumé", () => {
  it("ne garde que les jours qui portent quelque chose, dans l'ordre", () => {
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    const placement = placeTasks([commande({ dueOn: "2026-09-28" }), commande({ id: "tot", dueOn: "2026-09-23" })]);
    expect(monthAgenda(grid, placement).map((day) => day.date)).toEqual(["2026-09-23", "2026-09-28"]);
  });

  it("compte aussi ce qui tombe sur les jours voisins affichés par la grille", () => {
    const grid = monthGrid("2026-09", AUJOURD_HUI);
    // Le 1er octobre figure sur la dernière ligne de septembre : il est compté.
    const placement = placeTasks([commande({ dueOn: "2026-10-01" })]);
    expect(monthWorkload(grid, placement).total).toBe(1);
  });

  it("rend un mois vide sans rien inventer", () => {
    const grid = monthGrid("2026-11", AUJOURD_HUI);
    const placement = placeTasks([commande({ dueOn: "2026-09-28" })]);
    expect(monthAgenda(grid, placement)).toEqual([]);
    expect(monthWorkload(grid, placement)).toEqual({ total: 0, late: 0 });
  });
});

describe("monthRange — jusqu'où la pagination va", () => {
  it("tient toujours le mois courant, même sans aucune tâche", () => {
    expect(monthRange([], AUJOURD_HUI)).toEqual({ first: "2026-09", last: "2026-09" });
  });

  it("s'ouvre jusqu'au premier et au dernier mois portant une tâche", () => {
    const range = monthRange([commande({ dueOn: "2026-07-02" }), commande({ dueOn: "2026-12-15" })], AUJOURD_HUI);
    expect(range).toEqual({ first: "2026-07", last: "2026-12" });
  });

  it("ignore les tâches sans échéance : elles n'étendent aucun mois", () => {
    expect(monthRange([correction({ dueOn: null })], AUJOURD_HUI)).toEqual({ first: "2026-09", last: "2026-09" });
  });
});

describe("inCalendarScope — les mêmes vues que la file", () => {
  const moi = commande({ id: "mienne", isMine: true, assignedToId: null, assigneeLabel: null });
  const pourMoi = correction({ id: "pour-moi", assignedToViewer: true });
  const enRetard = commande({ id: "retard", dueOn: "2026-09-01" });

  it("rend tout sur « Toutes »", () => {
    expect([moi, pourMoi, enRetard].every((task) => inCalendarScope(task, "toutes"))).toBe(true);
  });

  it("reconnaît ce qui est confié à la personne qui regarde, corrections comprises", () => {
    expect(inCalendarScope(pourMoi, "pour_vous")).toBe(true);
    expect(inCalendarScope(moi, "pour_vous")).toBe(false);
  });

  it("ne range parmi « À confier » que les commandes sans affectataire", () => {
    expect(inCalendarScope(moi, "a_confier")).toBe(true);
    expect(inCalendarScope(correction({ assignedToId: null, assigneeLabel: null }), "a_confier")).toBe(false);
    expect(inCalendarScope(commande(), "a_confier")).toBe(false);
  });

  it("dit « en retard » ce que la couleur dit en retard", () => {
    expect(inCalendarScope(enRetard, "en_retard")).toBe(true);
    expect(inCalendarScope(commande({ dueOn: "2026-09-01", status: "livree" }), "en_retard")).toBe(false);
  });
});

describe("matchesBoardFilters — la barre de la file appliquée aux tâches", () => {
  it("filtre une tâche de calendrier comme une ligne de file", () => {
    const tache: CalendarTask = correction();
    expect(matchesBoardFilters(tache, { ...EMPTY_BOARD_FILTERS, clientId: "client-2" })).toBe(true);
    expect(matchesBoardFilters(tache, { ...EMPTY_BOARD_FILTERS, clientId: "client-1" })).toBe(false);
    // Recherche insensible aux accents, sur le client comme sur l'intitulé.
    expect(matchesBoardFilters(tache, { ...EMPTY_BOARD_FILTERS, query: "piscine" })).toBe(true);
    expect(matchesBoardFilters(tache, { ...EMPTY_BOARD_FILTERS, person: VIDEASTE })).toBe(true);
    expect(matchesBoardFilters(tache, { ...EMPTY_BOARD_FILTERS, person: UNKNOWN_PERSON_KEY })).toBe(false);
  });
});
