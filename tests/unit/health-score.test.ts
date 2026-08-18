import { describe, expect, it } from "vitest";
import { delayScore, healthActions, healthScore, MIN_SATISFACTION_ANSWERS } from "@/lib/domain/health-score";

const vide = {
  satisfactionPercentage: null, satisfactionAnswers: 0,
  viewRate: null, noCorrectionRate: null,
  sentBeforeDeadlineRate: null, correctionHours: null, productionPunctuality: null,
  budgetsComplete: null, shootingsCategorised: null, ticketsOnTime: null,
};

describe("délai converti en note", () => {
  it("donne cent tant que l'objectif est tenu", () => {
    expect(delayScore(12, 24, 72)).toBe(100);
    expect(delayScore(24, 24, 72)).toBe(100);
  });

  it("tombe à zéro au-delà du seuil intolérable", () => {
    expect(delayScore(72, 24, 72)).toBe(0);
    expect(delayScore(200, 24, 72)).toBe(0);
  });

  it("descend proportionnellement entre les deux", () => {
    expect(delayScore(48, 24, 72)).toBe(50);
  });

  it("ne note pas un délai inconnu", () => {
    expect(delayScore(null, 24, 72)).toBeNull();
  });
});

describe("score de santé", () => {
  it("pondère les trois piliers quand tout est mesuré", () => {
    const result = healthScore({
      ...vide,
      satisfactionPercentage: 100, satisfactionAnswers: 5,
      viewRate: 100, noCorrectionRate: 100,
      sentBeforeDeadlineRate: 100, correctionHours: 1, productionPunctuality: 100,
      budgetsComplete: 100, shootingsCategorised: 100, ticketsOnTime: 100,
    });
    expect(result.score).toBe(100);
    expect(result.pillars.map((pillar) => pillar.percentage)).toEqual([100, 100, 100]);
  });

  /*
   * Le poids d'un pilier compte : une agence lente mais aimée n'a pas la même
   * note qu'une agence rapide et détestée.
   */
  it("fait peser la satisfaction plus lourd que la rapidité", () => {
    const aimee = healthScore({
      ...vide,
      satisfactionPercentage: 100, satisfactionAnswers: 5, viewRate: 100, noCorrectionRate: 100,
      sentBeforeDeadlineRate: 0, correctionHours: 200, productionPunctuality: 0,
    });
    const rapide = healthScore({
      ...vide,
      satisfactionPercentage: 0, satisfactionAnswers: 5, viewRate: 0, noCorrectionRate: 0,
      sentBeforeDeadlineRate: 100, correctionHours: 1, productionPunctuality: 100,
    });
    expect(aimee.score).toBeGreaterThan(rapide.score!);
    // 40 contre 30 : 57 pour l'une, 43 pour l'autre.
    expect(aimee.score).toBe(57);
    expect(rapide.score).toBe(43);
  });

  it("écarte une mesure absente au lieu de la compter zéro", () => {
    const result = healthScore({ ...vide, noCorrectionRate: 80, viewRate: 100 });
    // Seule la satisfaction est mesurable : elle porte le score entier.
    expect(result.pillars[0]!.percentage).toBe(90);
    expect(result.score).toBe(90);
  });

  it("ne note pas la satisfaction sur trop peu de réponses", () => {
    const result = healthScore({
      ...vide,
      satisfactionPercentage: 0,
      satisfactionAnswers: MIN_SATISFACTION_ANSWERS - 1,
      noCorrectionRate: 100,
    });
    // La note client est ignorée : le pilier ne retient que le reste.
    expect(result.pillars[0]!.percentage).toBe(100);
    expect(result.pillars[0]!.parts[0]!.detail).toContain("trop peu");
  });

  it("redistribue les poids sur les piliers mesurables", () => {
    const result = healthScore({ ...vide, budgetsComplete: 60, productionPunctuality: 100 });
    // Rapidité 100 (poids 30) et suivi 60 (poids 30) : la moyenne est 80.
    expect(result.score).toBe(80);
  });

  it("ne note rien quand la période est vide", () => {
    expect(healthScore(vide).score).toBeNull();
  });
});

describe("conseils pour atteindre l'objectif", () => {
  const complet = {
    ...vide,
    satisfactionPercentage: 80, satisfactionAnswers: 5,
    viewRate: 100, noCorrectionRate: 100,
    sentBeforeDeadlineRate: 100, correctionHours: 1, productionPunctuality: 100,
    budgetsComplete: 100, shootingsCategorised: 20, ticketsOnTime: 100,
  };

  it("ne retient que les mesures sous l'objectif", () => {
    const actions = healthActions(healthScore(complet)).filter((action) => action.percentage !== null);
    expect(actions.map((action) => action.key)).toEqual(["shootings", "satisfaction-note"]);
  });

  it("chiffre le gain réel sur le score global, pas le gain brut", () => {
    const [premier] = healthActions(healthScore(complet));
    // 70 points manquants, sur un tiers d'un pilier qui pèse 30 % du score.
    expect(premier.key).toBe("shootings");
    expect(premier.gain).toBeCloseTo(7, 1);
  });

  it("classe les mesures absentes en dernier, sans promettre de points", () => {
    const actions = healthActions(healthScore({ ...complet, productionPunctuality: null }));
    const absente = actions.find((action) => action.key === "prod-interne");
    expect(absente?.gain).toBe(0);
    expect(actions.at(-1)?.percentage).toBeNull();
  });

  it("ne conseille rien quand tout est au-dessus de l'objectif", () => {
    const actions = healthActions(healthScore({
      ...complet, satisfactionPercentage: 95, shootingsCategorised: 95,
    }));
    expect(actions.filter((action) => action.percentage !== null)).toHaveLength(0);
  });
});
