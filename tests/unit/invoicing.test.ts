import { describe, expect, it } from "vitest";
import {
  INVOICE_STATUS_LABELS,
  invoiceMonthFor,
  invoiceMonths,
  isInvoiceSettled,
  monthKey,
  monthLabel,
  nextInvoiceStatus,
  pendingInvoiceCount,
  type InvoiceStatus,
} from "@/lib/domain/invoicing";
import type { BudgetLine } from "@/lib/domain/budget";

function line(performedOn: string, unitPriceCents: number, id = performedOn): BudgetLine {
  return {
    id,
    serviceKey: "shooting_demi",
    label: "Shooting ½ journée",
    billing: "ponctuel",
    unitPriceCents,
    quantity: 1,
    months: null,
    performedOn,
  };
}

describe("chaîne de facturation", () => {
  it("avance d'un état à la fois", () => {
    expect(nextInvoiceStatus("a_faire")).toBe("faite");
    expect(nextInvoiceStatus("faite")).toBe("prelevement_programme");
  });

  it("s'arrête au prélèvement programmé", () => {
    expect(nextInvoiceStatus("prelevement_programme")).toBeNull();
    expect(isInvoiceSettled("prelevement_programme")).toBe(true);
    expect(isInvoiceSettled("faite")).toBe(false);
  });

  it("nomme chaque état", () => {
    for (const status of ["a_faire", "faite", "prelevement_programme"] as InvoiceStatus[]) {
      expect(INVOICE_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe("regroupement mensuel", () => {
  it("ramène une date au premier jour de son mois", () => {
    expect(monthKey("2026-08-27")).toBe("2026-08-01");
  });

  it("nomme le mois en français", () => {
    expect(monthLabel("2026-08-01")).toContain("août");
  });

  it("range les mois du plus récent au plus ancien", () => {
    const months = invoiceMonths([
      line("2026-06-10", 45_000),
      line("2026-08-04", 22_500),
      line("2026-07-21", 85_000),
    ]);
    expect(months.map((month) => month.month)).toEqual([
      "2026-08-01",
      "2026-07-01",
      "2026-06-01",
    ]);
  });

  it("additionne les prestations d'un même mois", () => {
    const months = invoiceMonths([
      line("2026-08-04", 22_500, "a"),
      line("2026-08-19", 45_000, "b"),
    ]);
    expect(months).toHaveLength(1);
    expect(months[0]!.totalCents).toBe(67_500);
    expect(months[0]!.lines).toHaveLength(2);
  });

  it("considère un mois à faire tant que rien n'est enregistré", () => {
    const months = invoiceMonths([line("2026-08-04", 22_500)]);
    expect(months[0]!.status).toBe("a_faire");
  });

  it("reprend l'état enregistré du mois", () => {
    const months = invoiceMonths(
      [line("2026-08-04", 22_500), line("2026-07-04", 45_000)],
      { "2026-08-01": "faite", "2026-07-01": "prelevement_programme" },
    );
    expect(months[0]!.status).toBe("faite");
    expect(months[1]!.status).toBe("prelevement_programme");
  });

  it("ne compte que les mois non bouclés", () => {
    const months = invoiceMonths(
      [line("2026-08-04", 1), line("2026-07-04", 1), line("2026-06-04", 1)],
      { "2026-06-01": "prelevement_programme", "2026-07-01": "faite" },
    );
    expect(pendingInvoiceCount(months)).toBe(2);
  });

  it("ne renvoie aucun mois sans prestation", () => {
    expect(invoiceMonths([])).toEqual([]);
  });
});

/*
 * Rattachement borné par le début de gestion.
 *
 * Cas vécu : une prestation vendue à un client dont la gestion démarre le
 * 1er septembre était saisie fin août — le formulaire proposant la date du
 * jour — et tombait donc sur la facture d'août, alors que rien n'avait encore
 * commencé.
 */
describe("mois de facturation et début de gestion", () => {
  it("reporte au mois de démarrage une prestation saisie avant", () => {
    const months = invoiceMonths([line("2026-08-27", 11_000)], {}, "2026-09-01");

    expect(months).toHaveLength(1);
    expect(months[0]!.month).toBe("2026-09-01");
    expect(months[0]!.totalCents).toBe(11_000);
  });

  it("ne touche pas une prestation postérieure au démarrage", () => {
    const months = invoiceMonths([line("2026-10-12", 11_000)], {}, "2026-09-01");
    expect(months[0]!.month).toBe("2026-10-01");
  });

  it("laisse dans son mois une prestation du mois de démarrage", () => {
    // Le 3 septembre pour une gestion démarrée le 1er : rien à décaler.
    const months = invoiceMonths([line("2026-09-03", 11_000)], {}, "2026-09-01");
    expect(months[0]!.month).toBe("2026-09-01");
  });

  it("regroupe au mois de démarrage plusieurs prestations préparées en amont", () => {
    const months = invoiceMonths(
      [line("2026-07-15", 5_000), line("2026-08-27", 11_000)],
      {},
      "2026-09-01",
    );

    expect(months).toHaveLength(1);
    expect(months[0]!.month).toBe("2026-09-01");
    expect(months[0]!.totalCents).toBe(16_000);
  });

  it("sans date de début, garde le mois de la prestation", () => {
    const months = invoiceMonths([line("2026-08-27", 11_000)], {}, null);
    expect(months[0]!.month).toBe("2026-08-01");
  });
});

/*
 * Le report s'arrête aux factures déjà parties.
 *
 * Cas vécu : « Un été à la campagne » portait 675 € de shootings en mai, mois
 * dont la facture était déjà en prélèvement programmé. Les reporter en juin
 * aurait vidé une facture déjà émise et gonflé la suivante.
 */
describe("report et factures déjà établies", () => {
  it("ne déplace pas une prestation dont le mois est en prélèvement programmé", () => {
    const months = invoiceMonths(
      [line("2026-05-22", 45_000)],
      { "2026-05-01": "prelevement_programme" },
      "2026-06-01",
    );

    expect(months[0]!.month).toBe("2026-05-01");
    expect(months[0]!.totalCents).toBe(45_000);
  });

  it("ne déplace pas non plus une prestation dont la facture est faite", () => {
    const months = invoiceMonths(
      [line("2026-05-22", 45_000)],
      { "2026-05-01": "faite" },
      "2026-06-01",
    );
    expect(months[0]!.month).toBe("2026-05-01");
  });

  it("déplace tant que le mois reste à facturer", () => {
    const months = invoiceMonths(
      [line("2026-05-22", 45_000)],
      { "2026-05-01": "a_faire" },
      "2026-06-01",
    );
    expect(months[0]!.month).toBe("2026-06-01");
  });
});

/*
 * La règle est partagée, pas recopiée.
 *
 * L'écran de facturation groupée regroupait par mois de son côté, sans passer
 * par `invoiceMonths` : corriger l'un laissait l'autre ranger une prestation au
 * mois de sa saisie. E-MOVE MANAGEMENT restait affiché en août alors que sa
 * gestion démarre le 1er septembre.
 */
describe("invoiceMonthFor, partagée par les écrans", () => {
  it("reporte au mois de démarrage", () => {
    expect(invoiceMonthFor(line("2026-08-27", 11_000), "2026-09-01", {})).toBe("2026-09-01");
  });

  it("ne touche pas ce qui suit le démarrage", () => {
    expect(invoiceMonthFor(line("2026-10-12", 11_000), "2026-09-01", {})).toBe("2026-10-01");
  });

  it("s'arrête devant une facture déjà établie", () => {
    expect(invoiceMonthFor(line("2026-05-22", 45_000), "2026-06-01", { "2026-05-01": "faite" }))
      .toBe("2026-05-01");
  });

  it("sans date de démarrage, garde le mois de la prestation", () => {
    expect(invoiceMonthFor(line("2026-08-27", 11_000), null, {})).toBe("2026-08-01");
  });

  it("donne le même mois que le regroupement complet", () => {
    // Les deux chemins doivent répondre la même chose : c'est leur divergence
    // qui avait laissé E-MOVE en août.
    const l = line("2026-08-27", 11_000);
    expect(invoiceMonths([l], {}, "2026-09-01")[0]!.month).toBe(invoiceMonthFor(l, "2026-09-01", {}));
  });
});
