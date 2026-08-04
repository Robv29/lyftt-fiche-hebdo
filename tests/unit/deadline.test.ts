import { describe, expect, it } from "vitest";
import {
  computeValidationDeadline,
  deadlineState,
  formatDeadline,
  formatPeriod,
  isoWeekStart,
  DEFAULT_DEADLINE_SETTINGS,
} from "@/lib/domain/deadline";

describe("§3 — échéance de validation", () => {
  const monday10August2026 = new Date(Date.UTC(2026, 7, 10));

  it("place l'échéance par défaut le mardi 10 h, heure de Paris", () => {
    const deadline = computeValidationDeadline(monday10August2026);

    // Paris est à UTC+2 en août : 10 h locales = 08 h UTC.
    expect(deadline.toISOString()).toBe("2026-08-11T08:00:00.000Z");
  });

  it("formule l'échéance comme dans le message client", () => {
    const deadline = computeValidationDeadline(monday10August2026);
    expect(formatDeadline(deadline)).toBe("mardi 11 août à 10 h");
  });

  it("formule la période de publication", () => {
    const end = new Date(Date.UTC(2026, 7, 16));
    expect(formatPeriod(monday10August2026, end)).toBe("du 10 au 16 août");
  });

  it("tient compte du changement d'heure", () => {
    // Semaine de janvier : Paris est à UTC+1.
    const winterMonday = new Date(Date.UTC(2026, 0, 12));
    const deadline = computeValidationDeadline(winterMonday);
    expect(deadline.toISOString()).toBe("2026-01-13T09:00:00.000Z");
    expect(formatDeadline(deadline)).toBe("mardi 13 janvier à 10 h");
  });

  it("respecte un jour et une heure personnalisés par client", () => {
    const deadline = computeValidationDeadline(monday10August2026, {
      weekday: 1, // lundi
      time: "17:30",
      timezone: "Europe/Paris",
    });

    expect(deadline.toISOString()).toBe("2026-08-10T15:30:00.000Z");
    expect(formatDeadline(deadline)).toBe("lundi 10 août à 17 h 30");
  });

  it("respecte le fuseau configuré", () => {
    const deadline = computeValidationDeadline(monday10August2026, {
      ...DEFAULT_DEADLINE_SETTINGS,
      timezone: "America/Martinique",
    });
    expect(deadline.toISOString()).toBe("2026-08-11T14:00:00.000Z");
  });

  it("rejette un jour de semaine hors bornes", () => {
    expect(() =>
      computeValidationDeadline(monday10August2026, {
        ...DEFAULT_DEADLINE_SETTINGS,
        weekday: 8,
      }),
    ).toThrow(/Jour d'échéance invalide/);
  });

  it("retrouve le lundi d'une semaine ISO", () => {
    expect(isoWeekStart(2026, 33).toISOString()).toBe("2026-08-10T00:00:00.000Z");
    // La semaine ISO 1 de 2026 commence le 29 décembre 2025.
    expect(isoWeekStart(2026, 1).toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });
});

describe("§17 — état de l'échéance pour les rappels", () => {
  const deadline = new Date("2026-08-11T08:00:00.000Z");

  it("qualifie une échéance lointaine", () => {
    const state = deadlineState(deadline, new Date("2026-08-07T08:00:00.000Z"));
    expect(state.urgency).toBe("comfortable");
    expect(state.label).toBe("dans 4 jours");
  });

  it("qualifie une échéance du lendemain", () => {
    const state = deadlineState(deadline, new Date("2026-08-10T14:00:00.000Z"));
    expect(state.urgency).toBe("approaching");
  });

  it("qualifie une échéance imminente", () => {
    const state = deadlineState(deadline, new Date("2026-08-11T06:00:00.000Z"));
    expect(state.urgency).toBe("imminent");
    expect(state.label).toBe("dans 2 h");
  });

  it("détecte le retard", () => {
    const state = deadlineState(deadline, new Date("2026-08-11T13:00:00.000Z"));
    expect(state.isOverdue).toBe(true);
    expect(state.label).toBe("en retard de 5 h");
  });
});
