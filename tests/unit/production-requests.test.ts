import { describe, expect, it } from "vitest";
import {
  assigneeLabels,
  firstNameOf,
  involvedPeople,
  isResponsible,
  matchesPerson,
  matchesVerdictFilter,
  productionHistorySummary,
  productionPunctuality,
  productionVerdict,
  productionVerdictLabel,
  responsibleOf,
  UNKNOWN_PERSON_KEY,
  type ProductionHistoryInput,
} from "@/lib/domain/production-requests";

describe("ponctualité des commandes internes", () => {
  it("compte une livraison le jour de l'échéance comme tenue", () => {
    // L'échéance est une date : livrer à 18 h le jour dit, c'est tenir parole.
    const result = productionPunctuality([
      { dueOn: "2026-08-14", deliveredAt: "2026-08-14T18:00:00Z" },
    ]);
    expect(result.percentage).toBe(100);
    expect(result.late).toBe(0);
  });

  it("compte en retard une livraison du lendemain", () => {
    const result = productionPunctuality([
      { dueOn: "2026-08-14", deliveredAt: "2026-08-15T09:00:00Z" },
    ]);
    expect(result.percentage).toBe(0);
    expect(result.late).toBe(1);
  });

  it("donne la part tenue et le retard moyen, en jours de Paris", () => {
    const result = productionPunctuality([
      { dueOn: "2026-08-10", deliveredAt: "2026-08-09T10:00:00Z" },
      // 23 h UTC le 10 août = 1 h du matin le 11 à Paris : un jour de retard.
      { dueOn: "2026-08-10", deliveredAt: "2026-08-10T23:00:00Z" },
      { dueOn: "2026-08-10", deliveredAt: "2026-08-12T12:00:00Z" },
      { dueOn: "2026-08-10", deliveredAt: "2026-08-14T12:00:00Z" },
    ]);
    expect(result).toMatchObject({ percentage: 25, delivered: 4, onTime: 1, late: 3 });
    // Retards de 1, 2 et 4 jours calendaires.
    expect(result.averageDelayDays).toBe(2.3);
  });

  it("n'invente aucun taux sans livraison", () => {
    expect(productionPunctuality([])).toEqual({
      percentage: null, delivered: 0, onTime: 0, late: 0, averageDelayDays: null,
    });
  });
});

describe("verdict d'une commande", () => {
  const today = "2026-09-18";

  it("livrée avant minuit heure de Paris le jour dit : à l'heure", () => {
    // 21 h 59 UTC en été = 23 h 59 à Paris.
    expect(productionVerdict({ dueOn: "2026-09-10", deliveredAt: "2026-09-10T21:59:00Z" }, today))
      .toEqual({ kind: "on_time" });
  });

  it("livrée après minuit heure de Paris : un jour de retard", () => {
    expect(productionVerdict({ dueOn: "2026-09-10", deliveredAt: "2026-09-10T22:30:00Z" }, today))
      .toEqual({ kind: "late", days: 1 });
  });

  it("compte le retard en jours calendaires, heure d'hiver comprise", () => {
    // 23 h 30 UTC le 1er décembre = 0 h 30 le 2 à Paris.
    expect(productionVerdict({ dueOn: "2026-11-28", deliveredAt: "2026-12-01T23:30:00Z" }, today))
      .toEqual({ kind: "late", days: 4 });
  });

  it("non livrée, échéance aujourd'hui ou plus tard : en attente", () => {
    expect(productionVerdict({ dueOn: today, deliveredAt: null, status: "a_faire" }, today)).toEqual({ kind: "pending" });
    expect(productionVerdict({ dueOn: "2026-09-21", deliveredAt: null, status: "a_faire" }, today)).toEqual({ kind: "pending" });
  });

  it("non livrée après l'échéance : le retard court", () => {
    expect(productionVerdict({ dueOn: "2026-09-15", deliveredAt: null, status: "a_faire" }, today))
      .toEqual({ kind: "overdue", days: 3 });
  });

  it("validée sans date de livraison : verdict inconnu, pas un retard inventé", () => {
    expect(productionVerdict({ dueOn: "2026-09-01", deliveredAt: null, status: "validee" }, today))
      .toEqual({ kind: "unknown" });
  });

  it("formule le verdict", () => {
    expect(productionVerdictLabel({ kind: "on_time" })).toBe("À l’heure");
    expect(productionVerdictLabel({ kind: "late", days: 1 })).toBe("En retard de 1 jour");
    expect(productionVerdictLabel({ kind: "late", days: 3 })).toBe("En retard de 3 jours");
    expect(productionVerdictLabel({ kind: "pending" })).toBe("En attente");
    expect(productionVerdictLabel({ kind: "overdue", days: 2 })).toBe("Non livrée · 2 jours de retard");
  });

  it("filtre par verdict", () => {
    expect(matchesVerdictFilter({ kind: "late", days: 2 }, "en_retard")).toBe(true);
    expect(matchesVerdictFilter({ kind: "overdue", days: 2 }, "en_retard")).toBe(false);
    expect(matchesVerdictFilter({ kind: "overdue", days: 2 }, "non_livree_en_retard")).toBe(true);
  });
});

describe("synthèse de l'historique de production", () => {
  const base: Omit<ProductionHistoryInput, "dueOn" | "deliveredAt" | "status"> = {
    assignedToId: null, assignedToName: null, deliveredById: null, deliveredByName: null,
  };
  const sinclair = { assignedToId: "s", assignedToName: "Sinclair CASON" };

  it("calcule le taux sur les seules livraisons, et compte à part le retard qui court", () => {
    const summary = productionHistorySummary([
      { ...base, ...sinclair, dueOn: "2026-09-10", deliveredAt: "2026-09-10T08:00:00Z", status: "validee" },
      { ...base, ...sinclair, dueOn: "2026-09-10", deliveredAt: "2026-09-14T08:00:00Z", status: "validee" },
      { ...base, ...sinclair, dueOn: "2026-09-15", deliveredAt: null, status: "a_faire" },
      { ...base, dueOn: "2026-09-21", deliveredAt: null, status: "a_faire" },
    ], "2026-09-18");

    expect(summary.total).toMatchObject({
      orders: 4, delivered: 2, onTime: 1, late: 1, pending: 1, overdue: 1, onTimeRate: 50, averageDelayDays: 4,
    });
    expect(summary.byPerson.map((person) => [person.name, person.orders, person.onTimeRate])).toEqual([
      ["Sinclair CASON", 3, 50],
      [null, 1, null],
    ]);
  });

  it("rattache une commande ancienne, sans affectation, à la personne qui l'a livrée", () => {
    expect(responsibleOf({ ...base, deliveredById: "t", deliveredByName: "Théo Simbert" }))
      .toEqual({ key: "t", name: "Théo Simbert" });
    expect(responsibleOf({ ...base, ...sinclair, deliveredById: "t", deliveredByName: "Théo Simbert" }))
      .toEqual({ key: "s", name: "Sinclair CASON" });
    // Profil effacé : le nom figé suffit à regrouper.
    expect(responsibleOf({ ...base, assignedToName: "Ancien graphiste" }))
      .toEqual({ key: "nom:Ancien graphiste", name: "Ancien graphiste" });
    expect(responsibleOf(base)).toEqual({ key: null, name: null });
  });

  it("filtre une personne sur ce qui lui était confié comme sur ce qu'elle a livré", () => {
    const deliveredForOther = { ...base, ...sinclair, deliveredById: "t", deliveredByName: "Théo Simbert" };
    expect(involvedPeople(deliveredForOther).map((person) => person.key)).toEqual(["s", "t"]);
    expect(matchesPerson(deliveredForOther, "t")).toBe(true);
    expect(matchesPerson(deliveredForOther, "s")).toBe(true);
    // La ponctualité ne compte que pour celui qui répond de la commande.
    expect(isResponsible(deliveredForOther, "s")).toBe(true);
    expect(isResponsible(deliveredForOther, "t")).toBe(false);
    expect(matchesPerson(deliveredForOther, UNKNOWN_PERSON_KEY)).toBe(false);
    expect(matchesPerson(base, UNKNOWN_PERSON_KEY)).toBe(true);
    expect(matchesPerson(base, "s")).toBe(false);
  });

  it("ne donne aucun taux sans commande", () => {
    expect(productionHistorySummary([], "2026-09-18")).toEqual({
      total: { orders: 0, delivered: 0, onTime: 0, late: 0, pending: 0, overdue: 0, unknown: 0, onTimeRate: null, averageDelayDays: null },
      byPerson: [],
    });
  });
});

describe("libellés des personnes de production", () => {
  it("affiche le prénom seul", () => {
    const labels = assigneeLabels([
      { id: "a", fullName: "Sinclair CASON" },
      { id: "b", fullName: "Simon Ménard" },
    ]);
    expect(labels.get("a")).toBe("Sinclair");
    expect(labels.get("b")).toBe("Simon");
  });

  it("ajoute l'initiale du nom quand deux prénoms se confondent", () => {
    const labels = assigneeLabels([
      { id: "a", fullName: "Simon Ménard" },
      { id: "b", fullName: "Simon durand" },
      { id: "c", fullName: "Sinclair CASON" },
    ]);
    expect(labels.get("a")).toBe("Simon M.");
    expect(labels.get("b")).toBe("Simon D.");
    expect(labels.get("c")).toBe("Sinclair");
  });

  it("tire le prénom d'un nom complet", () => {
    expect(firstNameOf("  Théo Simbert ")).toBe("Théo");
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf("")).toBeNull();
  });
});
