import { describe, expect, it } from "vitest";
import { productionPunctuality } from "@/lib/domain/production-requests";

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

  it("donne la part tenue et le retard moyen des seules livraisons en retard", () => {
    const result = productionPunctuality([
      { dueOn: "2026-08-10", deliveredAt: "2026-08-09T10:00:00Z" },
      { dueOn: "2026-08-10", deliveredAt: "2026-08-10T23:00:00Z" },
      { dueOn: "2026-08-10", deliveredAt: "2026-08-12T12:00:00Z" },
      { dueOn: "2026-08-10", deliveredAt: "2026-08-14T12:00:00Z" },
    ]);
    expect(result).toMatchObject({ percentage: 50, delivered: 4, onTime: 2, late: 2 });
    // Deux retards comptés depuis la fin du jour d'échéance : 1,5 et 3,5 jours.
    expect(result.averageDelayDays).toBe(2.5);
  });

  it("n'invente aucun taux sans livraison", () => {
    expect(productionPunctuality([])).toEqual({
      percentage: null, delivered: 0, onTime: 0, late: 0, averageDelayDays: null,
    });
  });
});
