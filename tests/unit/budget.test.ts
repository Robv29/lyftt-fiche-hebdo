import { describe, expect, it } from "vitest";
import {
  budgetSummary,
  cadenceMonthlyCostCents,
  findService,
  lineTotalCents,
  monthsBetween,
  SERVICE_CATALOGUE,
  totalCents,
  type BudgetLine,
} from "@/lib/domain/budget";

const today = "2026-08-10";

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: "l1",
    label: "Shooting ½ journée",
    billing: "ponctuel",
    unitPriceCents: 45_000,
    quantity: 1,
    months: null,
    performedOn: today,
    ...overrides,
  };
}

describe("catalogue", () => {
  it("applique les tarifs réels, moitié des prix affichés", () => {
    // La carte publique double volontairement les prix.
    expect(findService("strategie")?.unitPriceCents).toBe(150_000);
    expect(findService("shooting_demi")?.unitPriceCents).toBe(45_000);
    expect(findService("shooting_jour")?.unitPriceCents).toBe(85_000);
    expect(findService("site_one_page")?.unitPriceCents).toBe(125_000);
    expect(findService("video")?.unitPriceCents).toBe(22_000);
    // La story est tarifée à l'unité hebdomadaire, pas au binôme de la carte.
    expect(findService("story")?.unitPriceCents).toBe(2_500);
    expect(findService("shooting_express")?.unitPriceCents).toBe(22_500);
  });

  it("n'a aucune clé en double", () => {
    const keys = SERVICE_CATALOGUE.map((service) => service.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("montant d'une ligne", () => {
  it("compte une prestation ponctuelle une seule fois", () => {
    expect(lineTotalCents(line())).toBe(45_000);
    expect(lineTotalCents(line({ quantity: 3 }))).toBe(135_000);
  });

  it("étale une prestation mensuelle sur son engagement", () => {
    const abonnement = line({ billing: "mensuel", unitPriceCents: 8_000, quantity: 2, months: 6 });
    expect(lineTotalCents(abonnement)).toBe(96_000);
  });

  it("traite un engagement absent comme un mois", () => {
    expect(lineTotalCents(line({ billing: "mensuel", unitPriceCents: 10_000, months: null }))).toBe(10_000);
  });

  it("additionne l'ensemble des lignes", () => {
    expect(totalCents([line(), line({ id: "l2", quantity: 2 })])).toBe(135_000);
  });
});

describe("coût du rythme vendu", () => {
  it("convertit un volume mensuel en prix hebdomadaire du catalogue", () => {
    // 4 photos/mois = 1/semaine = 80 € ; 2 vidéos/mois = 0,5/semaine = 110 €.
    expect(cadenceMonthlyCostCents({ photo: 4, video: 2 })).toBe(19_000);
  });

  it("ne coûte rien sans rythme", () => {
    expect(cadenceMonthlyCostCents({})).toBe(0);
  });
});

describe("mois restants", () => {
  it("ne descend jamais sous zéro", () => {
    expect(monthsBetween(today, "2026-01-01")).toBe(0);
  });

  it("compte environ douze mois sur une année", () => {
    expect(monthsBetween("2026-01-01", "2026-12-31")).toBeCloseTo(11.96, 1);
  });
});

describe("synthèse budgétaire", () => {
  const base = {
    billingMode: "financement" as const,
    annualBudgetCents: 600_000,
    lines: [],
    cadence: { photo: 4, video: 2 },
    // Par défaut : gestion démarrant aujourd'hui, donc rien encore livré.
    contractStartDate: today,
    contractEndDate: "2027-08-10",
    today,
  };

  it("ne s'applique pas à un client comptant", () => {
    const summary = budgetSummary({ ...base, billingMode: "comptant" });
    expect(summary.applicable).toBe(false);
    expect(summary.alerts).toEqual([]);
  });

  it("alerte fortement quand la date de fin manque", () => {
    const summary = budgetSummary({ ...base, contractEndDate: null });
    const alert = summary.alerts.find((a) => a.title.includes("Date de fin"));
    expect(alert?.level).toBe("critique");
    expect(summary.monthsRemaining).toBe(0);
  });

  it("alerte quand le budget n'est pas renseigné", () => {
    const summary = budgetSummary({ ...base, annualBudgetCents: 0 });
    expect(summary.alerts.some((a) => a.title === "Budget non renseigné")).toBe(true);
  });

  it("signale un dépassement déjà engagé", () => {
    const summary = budgetSummary({
      ...base,
      lines: [line({ unitPriceCents: 700_000 })],
    });
    expect(summary.remainingCents).toBe(-100_000);
    expect(summary.alerts.some((a) => a.title === "Budget dépassé")).toBe(true);
  });

  it("alerte quand le rythme épuisera le budget avant la fin", () => {
    // 19 000 c/mois sur ~12 mois = 228 000 c, pour un budget de 100 000 c.
    const summary = budgetSummary({ ...base, annualBudgetCents: 100_000 });
    expect(summary.projectedGapCents).toBeGreaterThan(0);
    expect(summary.alerts.some((a) => a.title.includes("Rythme trop élevé"))).toBe(true);
  });

  it("alerte quand le budget ne sera pas consommé", () => {
    const summary = budgetSummary({ ...base, annualBudgetCents: 2_000_000 });
    expect(summary.projectedGapCents).toBeLessThan(0);
    expect(summary.alerts.some((a) => a.title === "Budget non consommé à la fin")).toBe(true);
  });

  it("décompte la production déjà livrée depuis le début de gestion", () => {
    // Six mois écoulés à 19 000 c/mois de production récurrente.
    const summary = budgetSummary({ ...base, contractStartDate: "2026-02-10" });
    expect(summary.monthsElapsed).toBeCloseTo(5.9, 1);
    expect(summary.recurringConsumedCents).toBeGreaterThan(110_000);
    expect(summary.lineCents).toBe(0);
    expect(summary.consumedCents).toBe(summary.recurringConsumedCents);
    expect(summary.remainingCents).toBe(600_000 - summary.recurringConsumedCents);
  });

  it("ne compte rien tant que le début de gestion n'est pas renseigné", () => {
    const summary = budgetSummary({ ...base, contractStartDate: null });
    expect(summary.recurringConsumedCents).toBe(0);
    expect(summary.alerts.some((a) => a.title.includes("Date de début"))).toBe(true);
  });

  it("arrête le décompte à la fin de gestion", () => {
    // Contrat clos depuis un an : la production ne court plus depuis.
    const closed = budgetSummary({
      ...base,
      contractStartDate: "2025-08-10",
      contractEndDate: "2026-02-10",
      today,
    });
    expect(closed.monthsElapsed).toBeCloseTo(6, 0);
  });

  it("additionne production livrée et prestations ajoutées", () => {
    const summary = budgetSummary({
      ...base,
      contractStartDate: "2026-05-10",
      lines: [line({ unitPriceCents: 22_500 })],
    });
    expect(summary.lineCents).toBe(22_500);
    expect(summary.consumedCents).toBe(summary.recurringConsumedCents + 22_500);
  });

  it("donne le rythme mensuel à tenir pour tout consommer", () => {
    const summary = budgetSummary({ ...base, lines: [line({ unitPriceCents: 120_000 })] });
    expect(summary.remainingCents).toBe(480_000);
    // Reliquat réparti sur les mois restants.
    expect(summary.targetMonthlyCents).toBe(
      Math.round(480_000 / summary.monthsRemaining),
    );
  });

  it("borne la part consommée à cent pour cent", () => {
    const summary = budgetSummary({ ...base, lines: [line({ unitPriceCents: 900_000 })] });
    expect(summary.consumedPercentage).toBe(100);
  });
});
