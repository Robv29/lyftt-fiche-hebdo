import { describe, expect, it } from "vitest";
import { isOnSettledInvoice } from "@/lib/domain/invoicing";

describe("ligne déjà sur une facture établie", () => {
  it("juge le mois de la prestation quand la gestion a commencé", () => {
    expect(isOnSettledInvoice({ performedOn: "2026-08-12" }, "2026-07-01", { "2026-08-01": "faite" })).toBe(true);
    expect(isOnSettledInvoice({ performedOn: "2026-08-12" }, "2026-07-01", { "2026-08-01": "a_faire" })).toBe(false);
  });

  it("une prestation antérieure au début de gestion suit la facture du mois de démarrage", () => {
    // Shooting de juin, gestion au 1er juillet, facture de juillet partie : la ligne y figure.
    expect(isOnSettledInvoice({ performedOn: "2026-06-23" }, "2026-07-01", { "2026-07-01": "prelevement_programme" })).toBe(true);
    // Juin déjà facturé à part : la ligne est restée sur juin.
    expect(isOnSettledInvoice({ performedOn: "2026-06-23" }, "2026-07-01", { "2026-06-01": "faite" })).toBe(true);
    expect(isOnSettledInvoice({ performedOn: "2026-06-23" }, "2026-07-01", {})).toBe(false);
  });
});
