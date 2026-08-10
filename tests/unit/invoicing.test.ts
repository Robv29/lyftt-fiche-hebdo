import { describe, expect, it } from "vitest";
import {
  INVOICE_STATUS_LABELS,
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
