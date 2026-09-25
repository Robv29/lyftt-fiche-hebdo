import { describe, expect, it } from "vitest";
import {
  isShootingUnclassified,
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

  it("accepte « compris » sans forfait enregistré : la formule du client peut l'inclure", () => {
    expect(planShootingDecision({ lineServiceKey: "shooting_demi", lineLabel: "Shooting ½ journée", decision: "compris", plan: null, soldServiceKey: null, billedDirectly: false }))
      .toMatchObject({ ok: true, update: { unit_price_cents: 0, forfait_included: true } });
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

  it("sans forfait ni début de gestion, ne pré-coche rien : c'est à la direction de dire", () => {
    expect(shootingDecisionSuggestion({ plan: null, contractStartDate: "2026-07-23", date: "2026-08-10", dates: ["2026-08-10"] }).decision)
      .toBeNull();
    expect(shootingDecisionSuggestion({ plan, contractStartDate: null, date: "2026-08-10", dates: ["2026-08-10"] }).decision)
      .toBeNull();
  });

  it("lit le forfait dans des réglages même mal formés", () => {
    expect(shootingPlanFromNotes(JSON.stringify({ shootingPlan: plan }))).toEqual(plan);
    expect(shootingPlanFromNotes("pas du json")).toBeNull();
    expect(shootingPlanFromNotes(null)).toBeNull();
  });
});

describe("shooting non classé : le point rouge", () => {
  const today = "2026-09-25";
  /* Gestion démarrée en juillet, aucune facture partie. */
  const open = { today, contractStartDate: "2026-07-01", invoiceStatuses: {} };
  const tourne = { serviceKey: "shooting_forfait", performedOn: "2026-09-14", forfaitIncluded: null };

  it("tourné et sans décision : non classé", () => {
    expect(isShootingUnclassified(tourne, open)).toBe(true);
    /* Une ligne sans le champ du tout vaut une ligne non tranchée. */
    expect(isShootingUnclassified({ serviceKey: "shooting_demi", performedOn: "2026-09-14" }, open)).toBe(true);
  });

  it("déjà tranché : classé, dans un sens comme dans l'autre", () => {
    expect(isShootingUnclassified({ ...tourne, forfaitIncluded: true }, open)).toBe(false);
    expect(isShootingUnclassified({ ...tourne, forfaitIncluded: false }, open)).toBe(false);
  });

  it("annulé : rien à facturer, donc rien à classer", () => {
    expect(isShootingUnclassified({ ...tourne, cancelled: true }, open)).toBe(false);
  });

  it("calé pour plus tard : rien à trancher tant qu'il n'a pas été tourné", () => {
    expect(isShootingUnclassified({ ...tourne, performedOn: "2026-10-12" }, open)).toBe(false);
    /* Le jour même compte : il a eu lieu. */
    expect(isShootingUnclassified({ ...tourne, performedOn: today }, open)).toBe(true);
  });

  it("facture partie : le tri est figé, l'action le refuse, la liste se tait", () => {
    const facturee = { ...open, invoiceStatuses: { "2026-09-01": "faite" as const } };
    const prelevee = { ...open, invoiceStatuses: { "2026-09-01": "prelevement_programme" as const } };
    expect(isShootingUnclassified(tourne, facturee)).toBe(false);
    expect(isShootingUnclassified(tourne, prelevee)).toBe(false);
    /* Une facture encore à faire ne fige rien. */
    expect(isShootingUnclassified(tourne, { ...open, invoiceStatuses: { "2026-09-01": "a_faire" } })).toBe(true);
  });

  it("tourné avant le début de gestion : c'est la facture du mois de démarrage qui fige", () => {
    const avant = { ...tourne, performedOn: "2026-06-23" };
    expect(isShootingUnclassified(avant, open)).toBe(true);
    expect(isShootingUnclassified(avant, { ...open, invoiceStatuses: { "2026-07-01": "faite" } })).toBe(false);
    /* Sa propre facture de juin, si elle est partie, fige aussi. */
    expect(isShootingUnclassified(avant, { ...open, invoiceStatuses: { "2026-06-01": "faite" } })).toBe(false);
  });

  it("ne concerne que les shootings", () => {
    expect(isShootingUnclassified({ serviceKey: "post_supplementaire", performedOn: "2026-09-14" }, open)).toBe(false);
  });
});
