import { describe, expect, it } from "vitest";
import {
  MONTHLY_TRACKING_PRODUCTS,
  TRACKING_MAX_FREQUENCY,
  TRACKING_REPORT_DUE_DAY,
  TRACKING_SERVICE_KEYS,
  buildTrackingReportHistory,
  computeTrackingRatios,
  dueTrackingLines,
  dueTrackingMonths,
  findTrackingProduct,
  isTrackingService,
  missingRequiredStats,
  parseTrackingFrequency,
  parseTrackingStats,
  reconcileTrackingMonths,
  trackingClientIsServed,
  trackingLineLabel,
  trackingReportDueOn,
  trackingReportPeriod,
  trackingReportsToOpen,
  trackingServiceDefinitions,
  type TrackingSubscription,
} from "@/lib/domain/monthly-tracking";
import {
  SERVICE_CATALOGUE,
  billableLines,
  envelopeLines,
  hasTypedPrice,
  isCustomService,
  isRecurringMonthly,
  lineTotalCents,
  type BudgetLine,
} from "@/lib/domain/budget";

const today = "2026-10-22";

function subscription(overrides: Partial<TrackingSubscription> = {}): TrackingSubscription {
  return {
    id: "s1",
    serviceKey: "gestion_budget_pub",
    label: "Gestion du budget publicitaire — Meta",
    unitPriceCents: 25_000,
    frequency: 2,
    startedOn: "2026-08-01",
    endedOn: null,
    ...overrides,
  };
}

const openClient = { contractEndDate: null, pauseStartDate: null, pauseEndDate: null };

describe("la famille et sa déclaration", () => {
  it("déclare les deux produits demandés, sur des clés distinctes", () => {
    expect(TRACKING_SERVICE_KEYS).toEqual(["gestion_budget_pub", "marketing_externalise"]);
    expect(new Set(TRACKING_SERVICE_KEYS).size).toBe(TRACKING_SERVICE_KEYS.length);
    expect(findTrackingProduct("gestion_budget_pub")?.label).toBe("Gestion du budget publicitaire");
    expect(findTrackingProduct("marketing_externalise")?.label)
      .toBe("Accompagnement marketing externalisé");
    expect(findTrackingProduct("inconnu")).toBeUndefined();
  });

  it("ne reprend pas la clé « accompagnement » déjà occupée par la carte", () => {
    const existing = SERVICE_CATALOGUE.filter((service) => service.key === "accompagnement");
    expect(existing).toHaveLength(1);
    expect(existing[0]!.label).toBe("Accompagnement stratégique personnalisé");
    expect(isTrackingService("accompagnement")).toBe(false);
  });

  it("entre au catalogue en « ponctuel » : surtout pas en « mensuel »", () => {
    for (const definition of trackingServiceDefinitions()) {
      // `mensuel` multiplie une ligne par un engagement et la fait tomber sur une seule facture.
      expect(definition.billing).toBe("ponctuel");
      // `dessert` = « Accompagnement mensuel », déjà présent dans CATEGORY_ORDER du formulaire.
      expect(definition.category).toBe("dessert");
      expect(definition.unitPriceCents).toBe(0);
    }
    const keys = SERVICE_CATALOGUE.map((service) => service.key);
    for (const key of TRACKING_SERVICE_KEYS) expect(keys).toContain(key);
  });

  it("déclare un jeu de statistiques par produit, et des ratios calculables", () => {
    for (const product of MONTHLY_TRACKING_PRODUCTS) {
      expect(product.stats.length).toBeGreaterThan(0);
      expect(product.ratios.length).toBeGreaterThan(0);
      const statKeys = product.stats.map((field) => field.key);
      expect(new Set(statKeys).size).toBe(statKeys.length);

      for (const ratio of product.ratios) {
        const [numerator, denominator] = ratio.of;
        expect(statKeys).toContain(numerator);
        expect(statKeys).toContain(denominator);
        // Un ratio ne doit jamais dépendre d'une case facultative : il serait faux ou absent.
        expect(product.stats.find((field) => field.key === numerator)!.required).toBe(true);
        expect(product.stats.find((field) => field.key === denominator)!.required).toBe(true);
      }
    }
  });

  it("garde le prix libre sans élargir le passage en prestation ponctuelle", () => {
    expect(hasTypedPrice("sur_mesure")).toBe(true);
    expect(hasTypedPrice("gestion_budget_pub")).toBe(true);
    expect(hasTypedPrice("marketing_externalise")).toBe(true);
    expect(hasTypedPrice("post_photo")).toBe(false);
    // Le bouton « Client sans gestion RS » reste attaché à la seule ligne libre.
    expect(isCustomService("gestion_budget_pub")).toBe(false);
  });
});

describe("plafond de la fréquence mensuelle", () => {
  it("accepte 1 à 3, entiers seulement", () => {
    expect(parseTrackingFrequency(1)).toBe(1);
    expect(parseTrackingFrequency(3)).toBe(3);
    expect(parseTrackingFrequency("2")).toBe(2);
    expect(TRACKING_MAX_FREQUENCY).toBe(3);
  });

  it("refuse zéro, quatre, un demi et n'importe quoi", () => {
    expect(parseTrackingFrequency(0)).toBeNull();
    expect(parseTrackingFrequency(4)).toBeNull();
    expect(parseTrackingFrequency(1.5)).toBeNull();
    expect(parseTrackingFrequency(-1)).toBeNull();
    expect(parseTrackingFrequency("")).toBeNull();
    expect(parseTrackingFrequency("deux")).toBeNull();
    expect(parseTrackingFrequency(null)).toBeNull();
  });
});

describe("mois dus par une prestation de suivi", () => {
  it("part du mois de vente et va jusqu'au mois en cours", () => {
    expect(dueTrackingMonths({ ...openClient, startedOn: "2026-08-01", endedOn: null, today }))
      .toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("inscrit le mois de la vente dès le mois en cours", () => {
    expect(dueTrackingMonths({ ...openClient, startedOn: "2026-10-01", endedOn: null, today }))
      .toEqual(["2026-10-01"]);
  });

  it("s'arrête au dernier mois vendu", () => {
    expect(dueTrackingMonths({ ...openClient, startedOn: "2026-08-01", endedOn: "2026-09-01", today }))
      .toEqual(["2026-08-01", "2026-09-01"]);
  });

  it("s'arrête à la fin de gestion du client", () => {
    expect(dueTrackingMonths({
      startedOn: "2026-08-01",
      endedOn: null,
      contractEndDate: "2026-09-15",
      pauseStartDate: null,
      pauseEndDate: null,
      today,
    })).toEqual(["2026-08-01", "2026-09-01"]);
  });

  it("saute un mois entièrement en pause, et garde un mois partiellement en pause", () => {
    expect(dueTrackingMonths({
      startedOn: "2026-08-01",
      endedOn: null,
      contractEndDate: null,
      pauseStartDate: "2026-09-01",
      pauseEndDate: "2026-09-30",
      today,
    })).toEqual(["2026-08-01", "2026-10-01"]);

    expect(dueTrackingMonths({
      startedOn: "2026-08-01",
      endedOn: null,
      contractEndDate: null,
      pauseStartDate: "2026-09-10",
      pauseEndDate: "2026-09-20",
      today,
    })).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("ne rend rien pour une prestation qui démarre le mois prochain", () => {
    expect(dueTrackingMonths({ ...openClient, startedOn: "2026-11-01", endedOn: null, today }))
      .toEqual([]);
  });

  it("laisse la revente la plus récente décider du mois qu'elles se disputent", () => {
    const due = dueTrackingLines({
      client: openClient,
      today,
      subscriptions: [
        subscription({ id: "ancien", startedOn: "2026-08-01", endedOn: "2026-09-01", unitPriceCents: 20_000 }),
        subscription({ id: "nouveau", startedOn: "2026-09-01", unitPriceCents: 30_000, frequency: 3 }),
      ],
    });
    expect(due.map((month) => [month.month, month.unitPriceCents, month.frequency])).toEqual([
      ["2026-08-01", 20_000, 2],
      ["2026-09-01", 30_000, 3],
      ["2026-10-01", 30_000, 3],
    ]);
  });

  it("tient les deux produits d'un même client côte à côte", () => {
    const due = dueTrackingLines({
      client: openClient,
      today,
      subscriptions: [
        subscription({ id: "a", startedOn: "2026-10-01", frequency: 3 }),
        subscription({ id: "b", serviceKey: "marketing_externalise", startedOn: "2026-10-01", frequency: 1 }),
      ],
    });
    expect(due).toHaveLength(2);
    expect(due.map((month) => month.serviceKey)).toEqual(["gestion_budget_pub", "marketing_externalise"]);
  });
});

describe("réconciliation des mois inscrits", () => {
  const due = dueTrackingLines({
    client: openClient,
    today,
    subscriptions: [subscription()],
  });

  it("ajoute ce qui manque, par produit et par mois", () => {
    const plan = reconcileTrackingMonths(due, []);
    expect(plan.toInsert.map((month) => month.month))
      .toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.staleIds).toEqual([]);
  });

  it("recale le prix et la fréquence d'un mois déjà inscrit", () => {
    const plan = reconcileTrackingMonths(due, [
      { id: "l1", serviceKey: "gestion_budget_pub", performedOn: "2026-08-01", unitPriceCents: 25_000, quantity: 2 },
      { id: "l2", serviceKey: "gestion_budget_pub", performedOn: "2026-09-01", unitPriceCents: 20_000, quantity: 2 },
      { id: "l3", serviceKey: "gestion_budget_pub", performedOn: "2026-10-01", unitPriceCents: 25_000, quantity: 1 },
    ]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate.map((entry) => entry.id)).toEqual(["l2", "l3"]);
  });

  it("retire un mois qui n'est plus dû, prestation arrêtée", () => {
    const stopped = dueTrackingLines({
      client: openClient,
      today,
      subscriptions: [subscription({ endedOn: "2026-09-01" })],
    });
    const plan = reconcileTrackingMonths(stopped, [
      { id: "l1", serviceKey: "gestion_budget_pub", performedOn: "2026-09-01", unitPriceCents: 25_000, quantity: 2 },
      { id: "l2", serviceKey: "gestion_budget_pub", performedOn: "2026-10-01", unitPriceCents: 25_000, quantity: 2 },
    ]);
    expect(plan.staleIds).toEqual(["l2"]);
  });

  it("n'effleure jamais un mois déjà facturé", () => {
    const plan = reconcileTrackingMonths(
      dueTrackingLines({ client: openClient, today, subscriptions: [subscription({ endedOn: "2026-08-01" })] }),
      [
        { id: "l1", serviceKey: "gestion_budget_pub", performedOn: "2026-08-01", unitPriceCents: 19_000, quantity: 1 },
        { id: "l2", serviceKey: "gestion_budget_pub", performedOn: "2026-09-01", unitPriceCents: 25_000, quantity: 2 },
      ],
      { lockedMonths: ["2026-08-01", "2026-09-01"] },
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.staleIds).toEqual([]);
  });

  it("ne confond pas les deux produits d'un même mois", () => {
    const both = dueTrackingLines({
      client: openClient,
      today,
      subscriptions: [
        subscription({ id: "a", startedOn: "2026-10-01" }),
        subscription({ id: "b", serviceKey: "marketing_externalise", startedOn: "2026-10-01", frequency: 1 }),
      ],
    });
    const plan = reconcileTrackingMonths(both, [
      { id: "l1", serviceKey: "gestion_budget_pub", performedOn: "2026-10-01", unitPriceCents: 25_000, quantity: 2 },
    ]);
    expect(plan.toInsert.map((month) => month.serviceKey)).toEqual(["marketing_externalise"]);
    expect(plan.staleIds).toEqual([]);
  });

  it("libelle le mois pour qu'il se relise seul sur l'addition", () => {
    expect(trackingLineLabel("Budget pub — Meta", "2026-09-01"))
      .toBe("Budget pub — Meta · septembre 2026");
  });
});

describe("le mois coûte prix × fréquence, sans toucher au calcul des additions", () => {
  const line = (quantity: number): BudgetLine => ({
    id: "l",
    serviceKey: "gestion_budget_pub",
    label: "Budget pub · octobre 2026",
    billing: "ponctuel",
    unitPriceCents: 25_000,
    quantity,
    months: null,
    performedOn: "2026-10-01",
  });

  it("multiplie le prix du rendez-vous par la fréquence", () => {
    expect(lineTotalCents(line(1))).toBe(25_000);
    expect(lineTotalCents(line(3))).toBe(75_000);
  });

  it("compte comme récurrent : facturé en hybride, hors de l'enveloppe", () => {
    expect(isRecurringMonthly(line(2))).toBe(true);
    expect(envelopeLines([line(2)], "hybride")).toEqual([]);
    expect(billableLines([line(2)], "hybride")).toHaveLength(1);
    // En financement, rien ne change : l'enveloppe paie, sauf refus de prise en charge.
    expect(envelopeLines([line(2)], "financement")).toHaveLength(1);
    expect(billableLines([line(2)], "financement")).toEqual([]);
  });
});

describe("le compte rendu : son mois, son échéance", () => {
  it("porte sur le mois écoulé, pas sur le mois en cours", () => {
    expect(trackingReportPeriod("2026-10-01")).toBe("2026-09-01");
    expect(trackingReportPeriod(today)).toBe("2026-09-01");
    expect(trackingReportPeriod("2026-01-03")).toBe("2025-12-01");
  });

  it("est attendu le 8 du mois suivant, avant le premier rendez-vous", () => {
    expect(TRACKING_REPORT_DUE_DAY).toBe(8);
    expect(trackingReportDueOn("2026-09-01")).toBe("2026-10-08");
    expect(trackingReportDueOn("2026-12-01")).toBe("2027-01-08");
  });

  it("n'ouvre que les mois clos, et pas plus de trois en arrière", () => {
    const due = dueTrackingLines({
      client: openClient,
      today,
      subscriptions: [subscription({ startedOn: "2026-02-01" })],
    });
    const months = trackingReportsToOpen(due, today).map((month) => month.month);
    // Le mois en cours n'a rien à dire ; au-delà de trois mois, plus personne ne retrouve les chiffres.
    expect(months).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });
});

describe("les ratios, calculés et jamais demandés", () => {
  const pub = findTrackingProduct("gestion_budget_pub")!;

  it("calcule taux de clic, coût par clic et coût par contact", () => {
    const ratios = computeTrackingRatios(pub, {
      // 500 € en centimes : jamais de flottant sur de l'argent.
      budget_depense: 50_000,
      impressions: 10_000,
      clics: 250,
      contacts: 20,
    });
    expect(ratios.map((ratio) => [ratio.key, ratio.text])).toEqual([
      ["ctr", "2,50 %"],
      ["cpc", "2,00 €"],
      ["cpl", "25,00 €"],
    ]);
  });

  it("rend un tiret plutôt qu'un zéro quand le dénominateur manque ou vaut zéro", () => {
    const ratios = computeTrackingRatios(pub, { budget_depense: 50_000, impressions: 0, clics: 0 });
    expect(ratios.find((ratio) => ratio.key === "ctr")!.text).toBe("—");
    // Zéro clic ne donne pas un coût par clic de zéro : il n'en donne aucun.
    expect(ratios.find((ratio) => ratio.key === "cpc")!.text).toBe("—");
    expect(ratios.find((ratio) => ratio.key === "cpl")!.text).toBe("—");
  });

  it("calcule le taux de signature et les devis par rendez-vous du marketing", () => {
    const marketing = findTrackingProduct("marketing_externalise")!;
    const ratios = computeTrackingRatios(marketing, {
      actions: 6,
      rendez_vous: 5,
      devis_envoyes: 8,
      devis_signes: 3,
    });
    expect(ratios.map((ratio) => [ratio.key, ratio.text])).toEqual([
      ["taux_signature", "37,50 %"],
      ["devis_par_rdv", "1,6"],
    ]);
  });

  it("nomme les chiffres obligatoires qui manquent", () => {
    expect(missingRequiredStats(pub, { budget_depense: 1_000, clics: 4 }))
      .toEqual(["Impressions", "Contacts obtenus"]);
    expect(missingRequiredStats(pub, {
      budget_depense: 1_000, impressions: 10, clics: 4, contacts: 1,
    })).toEqual([]);
    // Le chiffre d'affaires du marketing est facultatif : son absence ne bloque rien.
    expect(missingRequiredStats(findTrackingProduct("marketing_externalise")!, {
      actions: 1, rendez_vous: 1, devis_envoyes: 1, devis_signes: 1,
    })).toEqual([]);
  });

  it("écarte ce qui n'est pas un nombre plutôt que de le convertir en zéro", () => {
    // Un `null` devenu zéro se lirait « aucune impression » au lieu de « non relevé ».
    expect(parseTrackingStats({ clics: 4, impressions: null, contacts: "abc", budget: "250" }))
      .toEqual({ clics: 4, budget: 250 });
    expect(parseTrackingStats(null)).toEqual({});
    expect(parseTrackingStats("rien")).toEqual({});
  });
});

describe("l'historique mensuel", () => {
  const rows = [
    {
      id: "r1",
      serviceKey: "gestion_budget_pub",
      periodMonth: "2026-08-01",
      improvements: "Audiences resserrées sur Montauban.",
      stats: { budget_depense: 40_000, impressions: 8_000, clics: 200, contacts: 10 },
      filledAt: "2026-09-03T09:00:00Z",
      filledByName: "Théo Simbert",
    },
    {
      id: "r2",
      serviceKey: "marketing_externalise",
      periodMonth: "2026-09-01",
      improvements: "Relance de la base clients.",
      stats: { actions: 4, rendez_vous: 5, devis_envoyes: 6, devis_signes: 3 },
      filledAt: "2026-10-02T09:00:00Z",
      filledByName: null,
    },
  ];

  it("se relit mois après mois, du plus récent au plus ancien", () => {
    const history = buildTrackingReportHistory(rows);
    expect(history.map((report) => report.periodMonth)).toEqual(["2026-09-01", "2026-08-01"]);
    expect(history[0]!.monthLabel).toBe("septembre 2026");
    expect(history[0]!.productLabel).toBe("Accompagnement marketing externalisé");
  });

  it("porte ses chiffres et ses ratios, et le texte des améliorations", () => {
    const [, pub] = buildTrackingReportHistory(rows);
    // Les espaces insécables des milliers varient avec la version d'ICU : on normalise.
    const plain = (text: string) => text.replace(/[  ]/g, " ");
    expect(pub!.figures.map((figure) => [figure.label, plain(figure.text)])).toEqual([
      ["Budget dépensé", "400,00 €"],
      ["Impressions", "8 000"],
      ["Clics", "200"],
      ["Contacts obtenus", "10"],
    ]);
    expect(pub!.ratios.map((ratio) => ratio.text)).toEqual(["2,50 %", "2,00 €", "40,00 €"]);
    expect(pub!.improvements).toBe("Audiences resserrées sur Montauban.");
  });

  it("n'affiche pas de case vide pour une statistique facultative non relevée", () => {
    const [marketing] = buildTrackingReportHistory(rows);
    expect(marketing!.figures.map((figure) => figure.label))
      .not.toContain("Chiffre d’affaires signé");
  });
});

describe("qui est encore servi", () => {
  const base = {
    isActive: true,
    kind: "gestion" as const,
    contractStartDate: "2026-01-01",
    contractEndDate: null,
    pauseStartDate: null,
    pauseEndDate: null,
  };

  it("sert un client actif, et un client en prestation ponctuelle", () => {
    expect(trackingClientIsServed(base, today)).toBe(true);
    // Ces deux produits se vendent sans gestion des réseaux.
    expect(trackingClientIsServed({ ...base, kind: "ponctuel" }, today)).toBe(true);
  });

  it("ne sert ni l'archivé, ni le terminé, ni le mis en pause, ni celui qui n'a pas commencé", () => {
    expect(trackingClientIsServed({ ...base, isActive: false }, today)).toBe(false);
    expect(trackingClientIsServed({ ...base, contractEndDate: "2026-09-30" }, today)).toBe(false);
    expect(trackingClientIsServed({ ...base, pauseStartDate: "2026-10-01", pauseEndDate: null }, today)).toBe(false);
    expect(trackingClientIsServed({ ...base, contractStartDate: "2026-12-01" }, today)).toBe(false);
  });
});
