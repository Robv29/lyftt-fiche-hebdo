import { describe, expect, it } from "vitest";
import {
  isServiceRequest,
  isServiceRequestOverdue,
  serviceRequestAgeInDays,
  serviceRequestAlertDays,
  SERVICE_REQUEST_ALERT_DAYS,
  WEEKLY_WISH_ALERT_DAYS,
} from "@/lib/domain/ticket-types";

const now = new Date("2026-08-14T10:00:00Z");

describe("demandes hors publication", () => {
  it("distingue une demande de service d'une correction de contenu", () => {
    expect(isServiceRequest("quote_request")).toBe(true);
    expect(isServiceRequest("shooting_request")).toBe(true);
    expect(isServiceRequest("side_service")).toBe(true);
    // Une envie pour la semaine suivante ne corrige rien non plus : même
    // parcours de clôture, un seul geste côté agence.
    expect(isServiceRequest("weekly_wish")).toBe(true);
    expect(isServiceRequest("text_edit")).toBe(false);
    expect(isServiceRequest("other")).toBe(false);
    expect(isServiceRequest("publication_add")).toBe(false);
  });
});

describe("ancienneté d'une demande", () => {
  it("compte les jours écoulés depuis l'envoi", () => {
    expect(serviceRequestAgeInDays("2026-08-11T10:00:00Z", now)).toBeCloseTo(3, 5);
  });

  it("ne descend jamais sous zéro", () => {
    expect(serviceRequestAgeInDays("2026-08-20T10:00:00Z", now)).toBe(0);
  });

  it("traite une date illisible comme une demande du jour", () => {
    expect(serviceRequestAgeInDays("pas une date", now)).toBe(0);
  });
});

describe("alerte de retard", () => {
  it("se déclenche au bout de trois jours sans résolution", () => {
    expect(SERVICE_REQUEST_ALERT_DAYS).toBe(3);
    expect(isServiceRequestOverdue({ type: "quote_request", submittedAt: "2026-08-11T10:00:00Z", resolvedAt: null }, now)).toBe(true);
  });

  it("laisse tranquille une demande récente", () => {
    expect(isServiceRequestOverdue({ type: "quote_request", submittedAt: "2026-08-13T10:00:00Z", resolvedAt: null }, now)).toBe(false);
  });

  it("ne s'applique pas à une demande déjà traitée", () => {
    expect(isServiceRequestOverdue(
      { type: "quote_request", submittedAt: "2026-07-01T10:00:00Z", resolvedAt: "2026-07-02T10:00:00Z" },
      now,
    )).toBe(false);
  });

  /*
   * Une envie vise la semaine suivante : elle reste utile tant que la fiche
   * n'est pas écrite. Lui appliquer les trois jours des devis aurait peint en
   * rouge une vingtaine de lignes par semaine.
   */
  it("laisse une semaine à une envie avant de s'inquiéter", () => {
    expect(WEEKLY_WISH_ALERT_DAYS).toBe(7);
    expect(serviceRequestAlertDays("weekly_wish")).toBe(7);
    expect(isServiceRequestOverdue({ type: "weekly_wish", submittedAt: "2026-08-11T10:00:00Z", resolvedAt: null }, now)).toBe(false);
    expect(isServiceRequestOverdue({ type: "weekly_wish", submittedAt: "2026-08-06T10:00:00Z", resolvedAt: null }, now)).toBe(true);
  });
});
