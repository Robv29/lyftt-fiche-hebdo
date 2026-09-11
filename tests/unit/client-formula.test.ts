import { describe, expect, it } from "vitest";
import { clientFormula } from "@/lib/domain/client-formula";
import { cadenceMonthlyCostCents } from "@/lib/domain/budget";

const row = (notes: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  notes: JSON.stringify(notes),
  contract_start_date: "2026-09-01",
  contract_end_date: null,
  pause_start_date: null,
  pause_end_date: null,
  ...over,
});

describe("clientFormula", () => {
  it("lit toute la formule, forfait de base négocié compris", () => {
    /*
     * Cas réel d'E-MOVE : 25 € de base négociés. Un appelant qui oubliait ce
     * champ facturait 50 €, et le montant changeait selon l'écran ouvert.
     */
    const f = clientFormula(row({
      monthlyCadence: { photo: 0, video: 2, story: 0, visual: 0 },
      customMonthlyService: { label: "Shooting 2h en agence", priceCents: 4_950 },
      baseMonthlyFeeCents: 2_500,
    }));
    expect(cadenceMonthlyCostCents(f.cadence, f.shooting, f.customMonthly, f.baseFeeCents)).toBe(18_450);
  });

  it("transporte les dates de pause", () => {
    const f = clientFormula(row({}, { pause_start_date: "2026-10-01", pause_end_date: "2026-10-31" }));
    expect(f.pauseStartDate).toBe("2026-10-01");
    expect(f.pauseEndDate).toBe("2026-10-31");
  });

  it("résiste à des réglages illisibles plutôt que de planter l'écran", () => {
    const f = clientFormula({ notes: "{pas du json", contract_start_date: null, contract_end_date: null });
    expect(f.cadence).toEqual({});
    expect(f.baseFeeCents).toBeNull();
    expect(f.pauseStartDate).toBeNull();
  });
});
