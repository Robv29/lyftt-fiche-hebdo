import { describe, expect, it } from "vitest";
import {
  planShootingDecision,
  shootingDecisionSuggestion,
  shootingPlanFromNotes,
} from "@/lib/domain/shooting-decision";

const plan = { serviceKey: "shooting_demi", everyMonths: 4 } as const;
const forfaitLine = { lineServiceKey: "shooting_forfait", lineLabel: "Shooting ½ journée du forfait" };

describe("classement d'un shooting tourné", () => {
  it("compris au forfait : inscrit à 0 €, rien à facturer", () => {
    const result = planShootingDecision({ ...forfaitLine, decision: "compris", plan, soldServiceKey: null, billedDirectly: true });
    expect(result).toMatchObject({
      ok: true, cancelled: false,
      update: { unit_price_cents: 0, forfait_included: true, billed_directly: false, service_key: "shooting_forfait" },
    });
  });

  it("refuse « compris » pour un client sans forfait : ce serait offrir le shooting", () => {
    expect(planShootingDecision({ ...forfaitLine, decision: "compris", plan: null, soldServiceKey: null, billedDirectly: false }).ok)
      .toBe(false);
  });

  it("vendu en plus : la prestation choisie, au prix du catalogue", () => {
    const result = planShootingDecision({ ...forfaitLine, decision: "supplementaire", plan, soldServiceKey: "shooting_jour", billedDirectly: true });
    expect(result).toMatchObject({
      ok: true,
      update: { service_key: "shooting_jour", unit_price_cents: 85_000, forfait_included: false, billed_directly: true },
    });
  });

  it("vendu en plus sans choix : la prestation de la ligne, sinon celle du forfait", () => {
    expect(planShootingDecision({ lineServiceKey: "shooting_express", lineLabel: "Shooting express", decision: "supplementaire", plan, soldServiceKey: null, billedDirectly: false }))
      .toMatchObject({ ok: true, update: { service_key: "shooting_express", unit_price_cents: 22_500 } });
    expect(planShootingDecision({ ...forfaitLine, decision: "supplementaire", plan, soldServiceKey: null, billedDirectly: false }))
      .toMatchObject({ ok: true, update: { service_key: "shooting_demi", unit_price_cents: 45_000 } });
  });

  it("vendu en plus sans aucune prestation connue : on demande laquelle", () => {
    expect(planShootingDecision({ ...forfaitLine, decision: "supplementaire", plan: null, soldServiceKey: null, billedDirectly: false }).ok)
      .toBe(false);
  });

  it("n'a pas eu lieu : rien facturé, et noté comme annulé", () => {
    const result = planShootingDecision({ lineServiceKey: "shooting_demi", lineLabel: "Shooting ½ journée", decision: "annule", plan, soldServiceKey: null, billedDirectly: true });
    expect(result).toMatchObject({ ok: true, cancelled: true, update: { unit_price_cents: 0, billed_directly: false } });
  });
});

describe("proposition de classement", () => {
  it("le premier de la période est celui du forfait, le suivant est vendu en plus", () => {
    const dates = ["2026-08-10", "2026-09-02"];
    const base = { plan, contractStartDate: "2026-07-23", dates };
    expect(shootingDecisionSuggestion({ ...base, date: "2026-08-10" }).decision).toBe("compris");
    const second = shootingDecisionSuggestion({ ...base, date: "2026-09-02" });
    expect(second.decision).toBe("supplementaire");
    expect(second.reason).toContain("2e shooting de la période du 23 juillet au 22 novembre");
  });

  it("sans forfait, propose de facturer ; sans début de gestion, ne propose rien", () => {
    expect(shootingDecisionSuggestion({ plan: null, contractStartDate: "2026-07-23", date: "2026-08-10", dates: ["2026-08-10"] }).decision)
      .toBe("supplementaire");
    expect(shootingDecisionSuggestion({ plan, contractStartDate: null, date: "2026-08-10", dates: ["2026-08-10"] }).decision)
      .toBeNull();
  });

  it("lit le forfait dans des réglages même mal formés", () => {
    expect(shootingPlanFromNotes(JSON.stringify({ shootingPlan: plan }))).toEqual(plan);
    expect(shootingPlanFromNotes("pas du json")).toBeNull();
    expect(shootingPlanFromNotes(null)).toBeNull();
  });
});
