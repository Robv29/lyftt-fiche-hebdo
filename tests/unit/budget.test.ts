import { describe, expect, it } from "vitest";
import {
  addMonths,
  billableLines,
  budgetSummary,
  BASE_MONTHLY_FEE_CENTS,
  budgetPenalty,
  dueManagementMonths,
  monthStartFraction,
  monthsRemainingToBill,
  reconcileManagementMonths,
  cadenceMonthlyCostCents,
  classifyShootings,
  shootingTally,
  findService,
  isShootingLine,
  envelopeLines,
  lineTotalCents,
  isManagementMonth,
  MANAGEMENT_MONTH_KEY,
  monthsBetween,
  parseShootingPlan,
  SERVICE_CATALOGUE,
  shootingMonthlyCostCents,
  shootingSchedule,
  shootingsPerYear,
  totalCents,
  type BudgetLine,
} from "@/lib/domain/budget";

const today = "2026-08-10";

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: "l1",
    serviceKey: "shooting_demi",
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
    // 4 photos/mois = 1/semaine = 80 € ; 2 vidéos/mois = 0,5/semaine = 110 €,
    // plus le forfait de base de 50 €.
    expect(cadenceMonthlyCostCents({ photo: 4, video: 2 })).toBe(19_000 + BASE_MONTHLY_FEE_CENTS);
  });

  it("facture le forfait de base même sans publication vendue", () => {
    expect(cadenceMonthlyCostCents({})).toBe(BASE_MONTHLY_FEE_CENTS);
    expect(BASE_MONTHLY_FEE_CENTS).toBe(5_000);
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
    const alert = summary.alerts.find((a) => a.title === "Budget non consommé à la fin");
    // Un manque à gagner rattrapable, pas une erreur : signalé sans alarmer.
    expect(alert?.level).toBe("reliquat");
  });

  it("ne compte que ce qui est inscrit à l'addition", () => {
    // Rien n'est ajouté par-dessus les lignes : sans elles, rien n'est consommé.
    const summary = budgetSummary({ ...base, contractStartDate: "2026-02-10" });
    expect(summary.consumedCents).toBe(0);
    expect(summary.recurringConsumedCents).toBe(0);
  });

  it("compte les mois de gestion inscrits comme production livrée", () => {
    const mois = [1, 2, 3].map((index) => line({
      id: `m${index}`,
      serviceKey: MANAGEMENT_MONTH_KEY,
      label: `Production du mois ${index}`,
      unitPriceCents: 19_000,
    }));
    const summary = budgetSummary({
      ...base,
      contractStartDate: "2026-05-10",
      lines: [...mois, line({ id: "s1", unitPriceCents: 22_500 })],
    });
    expect(summary.recurringConsumedCents).toBe(57_000);
    expect(summary.consumedCents).toBe(79_500);
    expect(summary.remainingCents).toBe(600_000 - 79_500);
  });

  it("ne compte rien tant que le début de gestion n'est pas renseigné", () => {
    const summary = budgetSummary({ ...base, contractStartDate: null });
    expect(summary.alerts.some((a) => a.title.includes("Date de début"))).toBe(true);
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

describe("mois de gestion dus", () => {
  it("facture d'avance, au premier jour de chaque mois", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-02-15",
      contractEndDate: null,
      monthlyCostCents: 19_000,
      today: "2026-08-11",
    });
    // Le mois entamé de février, puis les six premiers de mars à août.
    expect(months).toHaveLength(7);
    expect(months[0]!.dueOn).toBe("2026-02-15");
    expect(months[1]!.dueOn).toBe("2026-03-01");
    expect(months.at(-1)!.dueOn).toBe("2026-08-01");
  });

  it("facture le premier mois dès le premier jour de gestion", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-08-11",
      contractEndDate: null,
      monthlyCostCents: 10_000,
      today: "2026-08-11",
    });
    expect(months).toHaveLength(1);
    expect(months[0]!.index).toBe(1);
    // Démarrage un 11 : deuxième semaine, trois quarts du mois restent à courir.
    expect(months[0]!.amountCents).toBe(7_500);
  });

  /*
   * La facturation suit le calendrier, pas la date de signature : un client
   * parti le 21 juillet est facturé le 1er août comme tous les autres. Compter
   * d'anniversaire en anniversaire retardait sa facture d'août de trois
   * semaines, et elle manquait à l'appel le 18.
   */
  it("court en mois calendaires, pas d'anniversaire en anniversaire", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-05-15",
      contractEndDate: null,
      monthlyCostCents: 19_000,
      today: "2026-08-14",
    });
    expect(months.map((month) => month.dueOn)).toEqual([
      "2026-05-15", "2026-06-01", "2026-07-01", "2026-08-01",
    ]);
    // Seul le premier mois est entamé ; les suivants sont pleins.
    expect(months.map((month) => month.amountCents)).toEqual([9_500, 19_000, 19_000, 19_000]);
  });

  it("n'entame pas un mois commençant après la fin de gestion", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-01-31",
      contractEndDate: "2026-04-30",
      monthlyCostCents: 10_000,
      today: "2026-12-31",
    });
    // 31 janvier, 28 février, 31 mars, 30 avril : le 31 mai dépasse la fin.
    expect(months).toHaveLength(4);
  });

  it("ne produit rien sans début de gestion ni sans rythme", () => {
    const commun = { contractEndDate: null, today: "2026-12-31" };
    expect(dueManagementMonths({ ...commun, contractStartDate: null, monthlyCostCents: 19_000 })).toEqual([]);
    expect(dueManagementMonths({ ...commun, contractStartDate: "2026-01-01", monthlyCostCents: 0 })).toEqual([]);
  });

  it("ramène un 31 au dernier jour du mois visé", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonths("2026-05-15", 12)).toBe("2027-05-15");
  });

  it("reconnaît une ligne de mois de gestion", () => {
    expect(isManagementMonth(line({ serviceKey: MANAGEMENT_MONTH_KEY }))).toBe(true);
    expect(isManagementMonth(line())).toBe(false);
  });
});

describe("prestation facturée hors enveloppe", () => {
  const base = {
    billingMode: "financement" as const,
    annualBudgetCents: 600_000,
    lines: [],
    cadence: {},
    contractStartDate: today,
    contractEndDate: "2027-08-10",
    today,
  };

  it("ne consomme pas le budget", () => {
    const summary = budgetSummary({
      ...base,
      lines: [
        line({ id: "a", unitPriceCents: 45_000 }),
        line({ id: "b", unitPriceCents: 85_000, billedDirectly: true }),
      ],
    });
    expect(summary.consumedCents).toBe(45_000);
    expect(summary.remainingCents).toBe(555_000);
  });

  it("est écartée de l'enveloppe", () => {
    const lines = [line({ id: "a" }), line({ id: "b", billedDirectly: true })];
    expect(envelopeLines(lines, "financement").map((l) => l.id)).toEqual(["a"]);
  });

  it("est la seule à facturer chez un client en financement", () => {
    const lines = [
      line({ id: "a" }),
      line({ id: "b", billedDirectly: true }),
      line({ id: "m", serviceKey: MANAGEMENT_MONTH_KEY }),
    ];
    expect(billableLines(lines, "financement").map((l) => l.id)).toEqual(["b"]);
  });

  it("chez un client comptant, la gestion mensuelle se facture aussi", () => {
    // C'est même la prestation récurrente à facturer chaque mois.
    const lines = [
      line({ id: "a" }),
      line({ id: "m", serviceKey: MANAGEMENT_MONTH_KEY }),
    ];
    expect(billableLines(lines, "comptant").map((l) => l.id)).toEqual(["a", "m"]);
  });
});

describe("échéances restantes", () => {
  it("compte des échéances, pas une fraction de mois", () => {
    // Du 11 août au 30 novembre : 4 septembre, 4 octobre, 4 novembre.
    expect(monthsRemainingToBill({
      contractStartDate: "2026-05-04",
      contractEndDate: "2026-11-30",
      today: "2026-08-11",
    })).toBe(3);
  });

  it("exclut l'échéance du jour, déjà facturée", () => {
    expect(monthsRemainingToBill({
      contractStartDate: "2026-05-04",
      contractEndDate: "2026-09-30",
      today: "2026-09-04",
    })).toBe(0);
  });

  it("ne compte rien sans date de fin", () => {
    expect(monthsRemainingToBill({
      contractStartDate: "2026-05-04",
      contractEndDate: null,
      today: "2026-08-11",
    })).toBe(0);
  });

  it("projette le budget sur ces échéances", () => {
    const summary = budgetSummary({
      billingMode: "financement",
      annualBudgetCents: 504_000,
      lines: [],
      cadence: { photo: 12, video: 4 },
      contractStartDate: "2026-05-04",
      contractEndDate: "2026-11-30",
      today: "2026-08-11",
    });
    expect(summary.monthsRemaining).toBe(3);
    // 510 € par mois : forfait de base compris.
    expect(summary.monthlyCadenceCostCents).toBe(51_000);
    expect(summary.projectedCents).toBe(153_000);
  });
});

describe("réconciliation des mois inscrits", () => {
  const mois = (dueOn: string, index = 1) => ({ index, dueOn, amountCents: 10_000, fraction: 1 });

  it("ajoute ce qui manque", () => {
    const result = reconcileManagementMonths(
      [mois("2026-05-04", 1), mois("2026-06-04", 2)],
      [{ id: "a", performedOn: "2026-05-04" }],
    );
    expect(result.toInsert.map((m) => m.dueOn)).toEqual(["2026-06-04"]);
    expect(result.staleIds).toEqual([]);
  });

  it("retire ce qui n'est plus attendu", () => {
    const result = reconcileManagementMonths(
      [mois("2026-05-04")],
      [{ id: "a", performedOn: "2026-05-04" }, { id: "vieux", performedOn: "2026-06-04" }],
    );
    expect(result.staleIds).toEqual(["vieux"]);
    expect(result.toInsert).toEqual([]);
  });

  it("ne bouge rien quand tout concorde", () => {
    const result = reconcileManagementMonths(
      [mois("2026-05-04")],
      [{ id: "a", performedOn: "2026-05-04" }],
    );
    expect(result.toInsert).toEqual([]);
    expect(result.staleIds).toEqual([]);
  });
});

/*
 * Une facture partie chez le client est un fait. Corriger une règle de calcul
 * ne doit pas réécrire trois ans de comptabilité au tarif du jour.
 */
describe("mois déjà facturés", () => {
  const mois = (dueOn: string, index: number) => ({ index, dueOn, fraction: 1, amountCents: 19_000 });

  it("ne supprime pas une ligne appartenant à un mois prélevé", () => {
    const { staleIds } = reconcileManagementMonths(
      [mois("2026-08-01", 2)],
      [{ id: "ancienne", performedOn: "2026-07-21" }],
      { lockedMonths: ["2026-07-01"] },
    );
    expect(staleIds).toEqual([]);
  });

  it("n'ajoute rien dans un mois déjà facturé", () => {
    const { toInsert } = reconcileManagementMonths(
      [mois("2026-07-01", 1), mois("2026-08-01", 2)],
      [],
      { lockedMonths: ["2026-07-01"] },
    );
    expect(toInsert.map((month) => month.dueOn)).toEqual(["2026-08-01"]);
  });

  it("corrige librement les mois encore ouverts", () => {
    const { toInsert, staleIds } = reconcileManagementMonths(
      [mois("2026-08-01", 2)],
      [{ id: "ancienne", performedOn: "2026-08-21" }],
      { lockedMonths: ["2026-07-01"] },
    );
    expect(toInsert.map((month) => month.dueOn)).toEqual(["2026-08-01"]);
    expect(staleIds).toEqual(["ancienne"]);
  });

  it("se comporte comme avant sans mois verrouillé", () => {
    const { staleIds } = reconcileManagementMonths(
      [mois("2026-08-01", 2)],
      [{ id: "ancienne", performedOn: "2026-07-21" }],
    );
    expect(staleIds).toEqual(["ancienne"]);
  });
});

describe("prorata du premier mois", () => {
  it("découpe le mois en quatre semaines de prestation", () => {
    expect(monthStartFraction("2026-09-01")).toBe(1);
    expect(monthStartFraction("2026-09-07")).toBe(1);
    expect(monthStartFraction("2026-09-08")).toBe(0.75);
    expect(monthStartFraction("2026-09-14")).toBe(0.75);
    expect(monthStartFraction("2026-09-15")).toBe(0.5);
    expect(monthStartFraction("2026-09-21")).toBe(0.5);
    expect(monthStartFraction("2026-09-22")).toBe(0.25);
    expect(monthStartFraction("2026-09-30")).toBe(0.25);
  });

  it("ne facture que les semaines restantes du premier mois", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-05-17",
      contractEndDate: null,
      monthlyCostCents: 40_000,
      today: "2026-08-11",
    });
    // Démarrage en troisième semaine : la moitié du mois est déjà passée.
    expect(months[0]!.fraction).toBe(0.5);
    expect(months[0]!.amountCents).toBe(20_000);
  });

  it("facture les mois suivants en entier", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-05-17",
      contractEndDate: null,
      monthlyCostCents: 40_000,
      today: "2026-08-11",
    });
    expect(months.slice(1).every((month) => month.fraction === 1)).toBe(true);
    expect(months[1]!.amountCents).toBe(40_000);
  });

  it("ne rogne rien quand la gestion démarre en début de mois", () => {
    const months = dueManagementMonths({
      contractStartDate: "2026-05-04",
      contractEndDate: null,
      monthlyCostCents: 40_000,
      today: "2026-06-01",
    });
    expect(months[0]!.amountCents).toBe(40_000);
  });
});

describe("mode hybride", () => {
  const gestion = line({ id: "m", serviceKey: MANAGEMENT_MONTH_KEY, unitPriceCents: 30_000 });
  const shooting = line({ id: "s", unitPriceCents: 45_000 });
  const refuse = line({ id: "r", unitPriceCents: 85_000, billedDirectly: true });

  it("facture la gestion mensuelle et met le ponctuel sur l'enveloppe", () => {
    expect(billableLines([gestion, shooting], "hybride").map((l) => l.id)).toEqual(["m"]);
    expect(envelopeLines([gestion, shooting], "hybride").map((l) => l.id)).toEqual(["s"]);
  });

  it("laisse le refus de prise en charge partir en facturation", () => {
    expect(billableLines([gestion, shooting, refuse], "hybride").map((l) => l.id)).toEqual(["m", "r"]);
    expect(envelopeLines([gestion, shooting, refuse], "hybride").map((l) => l.id)).toEqual(["s"]);
  });

  it("ne consomme l'enveloppe qu'avec les prestations ponctuelles", () => {
    const summary = budgetSummary({
      billingMode: "hybride",
      annualBudgetCents: 200_000,
      lines: [gestion, shooting],
      cadence: { photo: 4, video: 2 },
      contractStartDate: "2026-05-04",
      contractEndDate: "2026-11-30",
      today: "2026-08-11",
    });
    expect(summary.applicable).toBe(true);
    expect(summary.consumedCents).toBe(45_000);
    expect(summary.remainingCents).toBe(155_000);
  });

  it("ne projette pas la production récurrente sur l'enveloppe", () => {
    const summary = budgetSummary({
      billingMode: "hybride",
      annualBudgetCents: 200_000,
      lines: [shooting],
      cadence: { photo: 12, video: 4 },
      contractStartDate: "2026-05-04",
      contractEndDate: "2026-11-30",
      today: "2026-08-11",
    });
    // La gestion est facturée au client : elle ne grignote pas le budget.
    expect(summary.projectedCents).toBe(45_000);
    expect(summary.alerts.some((a) => a.title.includes("Rythme trop élevé"))).toBe(false);
  });

  it("ne garde aucune enveloppe au comptant", () => {
    expect(envelopeLines([gestion, shooting], "comptant")).toEqual([]);
  });
});

describe("malus budgétaire", () => {
  it("ne retire rien quand tout est en ordre", () => {
    expect(budgetPenalty({ clientsWithIssue: 0, clientsTotal: 20 })).toBe(0);
  });

  it("retire d'autant plus que la part de dossiers en défaut est grande", () => {
    expect(budgetPenalty({ clientsWithIssue: 5, clientsTotal: 20 })).toBe(8);
    expect(budgetPenalty({ clientsWithIssue: 10, clientsTotal: 20 })).toBe(17);
  });

  it("plafonne à un tiers du score : le reste du travail compte encore", () => {
    expect(budgetPenalty({ clientsWithIssue: 20, clientsTotal: 20 })).toBe(33);
    expect(budgetPenalty({ clientsWithIssue: 40, clientsTotal: 20 })).toBe(33);
  });

  it("ne s'applique pas sans portefeuille connu", () => {
    expect(budgetPenalty({ clientsWithIssue: 3, clientsTotal: 0 })).toBe(0);
  });
});

describe("forfait shooting", () => {
  const demiTousLes4Mois = { serviceKey: "shooting_demi", everyMonths: 4 } as const;

  it("étale le prix du shooting sur sa période", () => {
    // 450 € tous les 4 mois : le client en paie le quart chaque mois.
    expect(shootingMonthlyCostCents(demiTousLes4Mois)).toBe(11_250);
    expect(shootingMonthlyCostCents({ serviceKey: "shooting_express", everyMonths: 2 })).toBe(11_250);
    expect(shootingMonthlyCostCents({ serviceKey: "shooting_jour", everyMonths: 1 })).toBe(85_000);
  });

  it("ne compte rien sans forfait ni période valable", () => {
    expect(shootingMonthlyCostCents(null)).toBe(0);
    expect(shootingMonthlyCostCents({ serviceKey: "shooting_demi", everyMonths: 0 })).toBe(0);
  });

  it("s'ajoute au coût mensuel du rythme vendu", () => {
    const cadence = { photo: 4 };
    const sansShooting = cadenceMonthlyCostCents(cadence);
    const avecShooting = cadenceMonthlyCostCents(cadence, demiTousLes4Mois);
    expect(avecShooting - sansShooting).toBe(11_250);
  });

  it("compte les shootings de l'année", () => {
    expect(shootingsPerYear(demiTousLes4Mois)).toBe(3);
    expect(shootingsPerYear({ serviceKey: "shooting_demi", everyMonths: 5 })).toBe(2.4);
  });

  it("écarte un forfait illisible venu des réglages", () => {
    expect(parseShootingPlan(null)).toBeNull();
    expect(parseShootingPlan({ serviceKey: "site_one_page", everyMonths: 3 })).toBeNull();
    expect(parseShootingPlan({ serviceKey: "shooting_demi" })).toBeNull();
    expect(parseShootingPlan({ serviceKey: "shooting_demi", everyMonths: 99 })).toBeNull();
    expect(parseShootingPlan({ serviceKey: "shooting_demi", everyMonths: 4 })).toEqual(demiTousLes4Mois);
  });

  /*
   * Le cas donné par la direction : dernier shooting le 4 août, un tous les deux
   * mois. Le rappel doit s'ouvrir le 4 septembre pour une échéance au 4 octobre.
   */
  it("ouvre le rappel un mois avant l'échéance", () => {
    const plan = { serviceKey: "shooting_demi", everyMonths: 2 } as const;
    const base = { plan, lastDoneOn: "2026-08-04", contractStartDate: "2026-01-01" };

    expect(shootingSchedule({ ...base, today: "2026-09-03" })).toMatchObject({
      dueOn: "2026-10-04",
      remindFrom: "2026-09-04",
      remindNow: false,
      overdue: false,
    });
    expect(shootingSchedule({ ...base, today: "2026-09-04" })?.remindNow).toBe(true);
    expect(shootingSchedule({ ...base, today: "2026-10-05" })?.overdue).toBe(true);
  });

  it("compte depuis le début de gestion quand aucun shooting n'a eu lieu", () => {
    const schedule = shootingSchedule({
      plan: demiTousLes4Mois,
      lastDoneOn: null,
      contractStartDate: "2026-03-15",
      today: "2026-07-01",
    });
    expect(schedule?.dueOn).toBe("2026-07-15");
  });

  /*
   * Cas remonté par la direction : un forfait mensuel était en alerte
   * permanente, le rappel s'ouvrant un mois avant une échéance mensuelle,
   * c'est-à-dire le jour même du shooting précédent.
   */
  it("ne prévient pas un mois avant sur un forfait mensuel", () => {
    const mensuel = { serviceKey: "shooting_demi", everyMonths: 1 } as const;
    const base = { plan: mensuel, lastDoneOn: "2026-08-07", contractStartDate: "2026-06-23" };

    expect(shootingSchedule({ ...base, today: "2026-08-18" })).toMatchObject({
      dueOn: "2026-09-07",
      remindFrom: "2026-08-23",
      remindNow: false,
      overdue: false,
    });
    // Quinze jours avant, soit la moitié de la période.
    expect(shootingSchedule({ ...base, today: "2026-08-23" })?.remindNow).toBe(true);
  });

  /*
   * Un shooting s'inscrit par le bouton « Date calée » ou depuis le catalogue
   * de l'écran budget. Ne reconnaître que le premier réclamait un shooting à
   * des clients qui en avaient déjà eu trois.
   */
  it("reconnaît un shooting quelle que soit la façon dont il a été inscrit", () => {
    expect(isShootingLine("shooting_forfait")).toBe(true);
    expect(isShootingLine("shooting_demi")).toBe(true);
    expect(isShootingLine("shooting_express")).toBe(true);
    expect(isShootingLine("shooting_jour")).toBe(true);
    expect(isShootingLine("production_mensuelle")).toBe(false);
    expect(isShootingLine("site_one_page")).toBe(false);
  });

  it("ne planifie rien sans forfait", () => {
    expect(shootingSchedule({
      plan: null,
      lastDoneOn: null,
      contractStartDate: "2026-03-15",
      today: "2026-07-01",
    })).toBeNull();
  });
});

/*
 * Le forfait donne droit à un shooting par période. Le premier de la période
 * est compris — déjà payé par le lissage mensuel — les suivants ont été vendus
 * en plus et doivent partir à la facture. C'est la période qui tranche, pas la
 * mémoire de celui qui saisit.
 */
describe("shooting compris ou vendu en plus", () => {
  const plan = { serviceKey: "shooting_demi", everyMonths: 1 } as const;
  const debut = "2026-06-23";

  it("compte le premier shooting de chaque période comme compris", () => {
    const map = classifyShootings({ plan, contractStartDate: debut, dates: ["2026-07-05", "2026-08-07"] });
    expect(map.get("2026-07-05")).toMatchObject({ periodIndex: 1, rankInPeriod: 1, suggestedIncluded: true });
    expect(map.get("2026-08-07")).toMatchObject({ periodIndex: 2, rankInPeriod: 1, suggestedIncluded: true });
  });

  it("compte le second de la même période comme vendu en plus", () => {
    const map = classifyShootings({ plan, contractStartDate: debut, dates: ["2026-07-05", "2026-07-19"] });
    expect(map.get("2026-07-05")?.suggestedIncluded).toBe(true);
    expect(map.get("2026-07-19")).toMatchObject({ rankInPeriod: 2, suggestedIncluded: false });
  });

  it("rattache un shooting fait en fin de période précédente à cette période-là", () => {
    // Période 1 : du 23 juin au 22 juillet inclus.
    const map = classifyShootings({ plan, contractStartDate: debut, dates: ["2026-07-22", "2026-07-23"] });
    expect(map.get("2026-07-22")?.periodIndex).toBe(1);
    expect(map.get("2026-07-23")?.periodIndex).toBe(2);
    // Chacun ouvre sa période : les deux sont compris, aucun n'est facturé.
    expect(map.get("2026-07-23")?.suggestedIncluded).toBe(true);
  });

  it("ne classe rien sans forfait ni date de début", () => {
    expect(classifyShootings({ plan: null, contractStartDate: debut, dates: ["2026-07-05"] }).size).toBe(0);
    expect(classifyShootings({ plan, contractStartDate: null, dates: ["2026-07-05"] }).size).toBe(0);
  });

  it("distingue compris, facturés et pas encore tranchés", () => {
    const shooting = (id: string, included: boolean | null) => ({
      ...line({ id, serviceKey: "shooting_demi", unitPriceCents: included ? 0 : 45_000 }),
      forfaitIncluded: included,
    });
    const tally = shootingTally([
      shooting("a", true),
      shooting("b", false),
      shooting("c", null),
      { ...line({ id: "d", serviceKey: MANAGEMENT_MONTH_KEY }), forfaitIncluded: null },
    ]);
    expect(tally).toEqual({ included: 1, extra: 1, extraCents: 45_000, pending: 1 });
  });
});

describe("RIB manquant", () => {
  const base = {
    annualBudgetCents: 600_000,
    lines: [],
    cadence: { photo: 4 },
    contractStartDate: "2026-01-01",
    contractEndDate: "2026-12-31",
    today,
  };

  it("alerte au comptant, où il n'y a pourtant aucune enveloppe à suivre", () => {
    const summary = budgetSummary({ ...base, billingMode: "comptant", ribOnFile: false });
    expect(summary.applicable).toBe(false);
    expect(summary.alerts.map((alert) => alert.title)).toContain("RIB manquant");
  });

  it("alerte en hybride, où la gestion mensuelle est prélevée", () => {
    const summary = budgetSummary({ ...base, billingMode: "hybride", ribOnFile: false });
    expect(summary.alerts.some((alert) => alert.title === "RIB manquant" && alert.level === "critique")).toBe(true);
  });

  it("ne dit rien en financement : le client n'est pas prélevé", () => {
    const summary = budgetSummary({ ...base, billingMode: "financement", ribOnFile: false });
    expect(summary.alerts.map((alert) => alert.title)).not.toContain("RIB manquant");
  });

  it("se taît dès que le RIB est déposé, et reste muet si l'on n'en sait rien", () => {
    expect(budgetSummary({ ...base, billingMode: "comptant", ribOnFile: true }).alerts).toEqual([]);
    expect(budgetSummary({ ...base, billingMode: "comptant" }).alerts).toEqual([]);
  });
});
