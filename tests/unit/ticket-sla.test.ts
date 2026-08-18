import { describe, expect, it } from "vitest";
import {
  TICKET_SLA_HOURS,
  ticketDeadline,
  ticketHoursLeft,
  ticketSlaState,
  ticketSlaSummary,
} from "@/lib/domain/ticket-sla";

const recu = "2026-08-17T16:00:00.000Z";
const echeance = "2026-08-18T12:00:00.000Z";

describe("échéance d'un retour client", () => {
  it("part de l'heure d'arrivée, pas de la fiche", () => {
    expect(ticketDeadline(recu).toISOString()).toBe(echeance);
    expect(TICKET_SLA_HOURS).toBe(20);
  });

  it("compte tenu une correction envoyée avant l'heure", () => {
    expect(ticketSlaState({ submittedAt: recu, respondedAt: "2026-08-18T09:30:00Z" })).toBe("tenu");
    expect(ticketSlaState({ submittedAt: recu, respondedAt: echeance })).toBe("tenu");
  });

  it("compte dépassée une correction envoyée après", () => {
    expect(ticketSlaState({ submittedAt: recu, respondedAt: "2026-08-18T12:01:00Z" })).toBe("depasse");
  });

  it("ne juge pas un ticket dont le compteur tourne encore", () => {
    const now = new Date("2026-08-18T08:00:00Z");
    expect(ticketSlaState({ submittedAt: recu, respondedAt: null }, now)).toBe("en_cours");
  });

  it("compte en faute un ticket ouvert dont l'heure est passée", () => {
    const now = new Date("2026-08-19T08:00:00Z");
    expect(ticketSlaState({ submittedAt: recu, respondedAt: null }, now)).toBe("depasse");
  });

  it("dit les heures restantes, négatives une fois l'heure passée", () => {
    expect(ticketHoursLeft(recu, new Date("2026-08-18T10:00:00Z"))).toBe(2);
    expect(ticketHoursLeft(recu, new Date("2026-08-18T15:00:00Z"))).toBe(-3);
  });
});

describe("bilan des délais de retour", () => {
  const now = new Date("2026-08-19T08:00:00Z");

  it("exclut du calcul les compteurs qui tournent encore", () => {
    const bilan = ticketSlaSummary([
      { submittedAt: recu, respondedAt: "2026-08-18T09:00:00Z" },
      { submittedAt: "2026-08-19T06:00:00Z", respondedAt: null },
    ], now);
    expect(bilan).toMatchObject({ measured: 1, onTime: 1, running: 1, percentage: 100 });
  });

  it("mesure l'ampleur du pire retard, pas seulement leur nombre", () => {
    const bilan = ticketSlaSummary([
      { submittedAt: recu, respondedAt: "2026-08-18T18:00:00Z" },
      { submittedAt: recu, respondedAt: null },
    ], now);
    expect(bilan).toMatchObject({ measured: 2, onTime: 0, late: 2, percentage: 0 });
    expect(bilan.worstLateHours).toBe(20);
  });

  it("ne note rien quand aucun ticket n'est jugeable", () => {
    expect(ticketSlaSummary([], now).percentage).toBeNull();
  });
});
