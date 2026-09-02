import { describe, expect, it } from "vitest";
import { productionUrgency } from "@/lib/domain/production";

const AUJOURDHUI = "2026-09-02";

describe("productionUrgency", () => {
  it("signale l'échéance du lendemain", () => {
    expect(productionUrgency({ dueOn: "2026-09-03", status: "a_faire" }, AUJOURDHUI))
      .toBe("due_tomorrow");
  });

  it("ne signale rien pour après-demain", () => {
    expect(productionUrgency({ dueOn: "2026-09-04", status: "a_faire" }, AUJOURDHUI)).toBeNull();
  });

  it("ne confond pas le jour même avec le lendemain", () => {
    // Échéance aujourd'hui : ni en retard, ni « demain ».
    expect(productionUrgency({ dueOn: AUJOURDHUI, status: "a_faire" }, AUJOURDHUI)).toBeNull();
  });

  it("signale le retard une fois l'échéance passée", () => {
    expect(productionUrgency({ dueOn: "2026-09-01", status: "a_faire" }, AUJOURDHUI)).toBe("overdue");
  });

  it("franchit les fins de mois", () => {
    expect(productionUrgency({ dueOn: "2026-10-01", status: "a_faire" }, "2026-09-30"))
      .toBe("due_tomorrow");
    expect(productionUrgency({ dueOn: "2027-01-01", status: "a_faire" }, "2026-12-31"))
      .toBe("due_tomorrow");
  });

  it("se tait sur une commande déjà livrée ou validée", () => {
    for (const status of ["livree", "validee"] as const) {
      expect(productionUrgency({ dueOn: "2026-09-03", status }, AUJOURDHUI)).toBeNull();
      // Même en retard : ce qui est fait n'attend plus rien.
      expect(productionUrgency({ dueOn: "2026-08-01", status }, AUJOURDHUI)).toBeNull();
    }
  });
});
