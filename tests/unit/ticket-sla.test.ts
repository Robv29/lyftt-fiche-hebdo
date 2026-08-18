import { describe, expect, it } from "vitest";
import {
  TICKET_SLA_HOURS,
  addWorkingHours,
  frenchHolidays,
  ticketDeadline,
  ticketHoursLeft,
  ticketSlaState,
  ticketSlaSummary,
  workingHoursBetween,
} from "@/lib/domain/ticket-sla";

/** Heure parisienne lisible, pour que les attentes se relisent sans calcul. */
const paris = (date: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);

describe("heures ouvrées", () => {
  it("compte neuf heures par jour, de 9 h à 18 h", () => {
    // Lundi 9 h → mardi 9 h : une seule journée de travail entre les deux.
    expect(workingHoursBetween(new Date("2026-08-17T07:00:00Z"), new Date("2026-08-18T07:00:00Z"))).toBe(9);
  });

  it("ignore la nuit, le week-end et les jours fériés", () => {
    // Du vendredi 17 h au lundi 10 h : 1 h le vendredi + 1 h le lundi.
    expect(workingHoursBetween(new Date("2026-08-21T15:00:00Z"), new Date("2026-08-24T08:00:00Z"))).toBe(2);
  });

  it("connaît les fériés français, mobiles compris", () => {
    const jours = frenchHolidays(2026);
    expect(jours.has("2026-08-15")).toBe(true);  // Assomption
    expect(jours.has("2026-04-06")).toBe(true);  // lundi de Pâques 2026
    expect(jours.has("2026-05-14")).toBe(true);  // Ascension 2026
  });

  it("démarre le compteur à l'ouverture suivante quand le retour arrive hors horaires", () => {
    // Mardi 6 h 42 → le compteur ne part qu'à 9 h : une heure plus tard, il est 10 h.
    expect(paris(addWorkingHours(new Date("2026-08-18T04:42:00Z"), 1))).toContain("10:00");
  });
});

describe("échéance d'un retour client", () => {
  it("laisse vingt heures ouvrées, soit deux jours et deux heures", () => {
    expect(TICKET_SLA_HOURS).toBe(20);
    // Lundi 11 h 09 → mardi (9 h) → mercredi 13 h 09.
    expect(paris(ticketDeadline("2026-08-17T09:09:00Z"))).toBe("mer. 19/08 13:09");
  });

  it("ne fait pas courir le compteur pendant un week-end férié", () => {
    // Samedi 15 août : rien avant lundi 9 h, puis 9 h + 9 h + 2 h.
    expect(paris(ticketDeadline("2026-08-15T07:54:00Z"))).toBe("mer. 19/08 11:00");
  });

  it("compte tenu une correction envoyée avant l'heure", () => {
    expect(ticketSlaState({ submittedAt: "2026-08-17T09:09:00Z", respondedAt: "2026-08-18T08:05:00Z" })).toBe("tenu");
  });

  it("compte dépassée une correction envoyée après", () => {
    expect(ticketSlaState({ submittedAt: "2026-08-17T09:09:00Z", respondedAt: "2026-08-19T15:00:00Z" })).toBe("depasse");
  });

  it("ne juge pas un ticket dont le compteur tourne encore", () => {
    const now = new Date("2026-08-18T08:00:00Z");
    expect(ticketSlaState({ submittedAt: "2026-08-17T09:09:00Z", respondedAt: null }, now)).toBe("en_cours");
  });

  it("compte en faute un ticket ouvert dont l'heure est passée", () => {
    const now = new Date("2026-08-20T08:00:00Z");
    expect(ticketSlaState({ submittedAt: "2026-08-17T09:09:00Z", respondedAt: null }, now)).toBe("depasse");
  });

  it("dit les heures ouvrées restantes, négatives une fois l'heure passée", () => {
    expect(ticketHoursLeft("2026-08-17T09:09:00Z", new Date("2026-08-19T09:09:00Z"))).toBe(2);
    expect(ticketHoursLeft("2026-08-17T09:09:00Z", new Date("2026-08-19T13:09:00Z"))).toBe(-2);
  });
});

describe("bilan des délais de retour", () => {
  const now = new Date("2026-08-21T08:00:00Z");

  it("exclut du calcul les compteurs qui tournent encore", () => {
    const bilan = ticketSlaSummary([
      { submittedAt: "2026-08-17T09:09:00Z", respondedAt: "2026-08-18T08:00:00Z" },
      { submittedAt: "2026-08-21T06:00:00Z", respondedAt: null },
    ], now);
    expect(bilan).toMatchObject({ measured: 1, onTime: 1, running: 1, percentage: 100 });
  });

  it("mesure l'ampleur du pire retard en heures ouvrées", () => {
    const bilan = ticketSlaSummary([
      // Échéance mercredi 13 h 09, correction partie à 17 h 09 : quatre heures.
      { submittedAt: "2026-08-17T09:09:00Z", respondedAt: "2026-08-19T15:09:00Z" },
    ], now);
    expect(bilan).toMatchObject({ measured: 1, late: 1, percentage: 0, worstLateHours: 4 });
  });

  it("ne note rien quand aucun ticket n'est jugeable", () => {
    expect(ticketSlaSummary([], now).percentage).toBeNull();
  });
});
