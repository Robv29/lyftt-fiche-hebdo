import { describe, expect, it } from "vitest";
import { AGENCY_APPROVAL_LABEL, HISTORY_EVENT_LABELS, buildWeekHistory } from "@/lib/domain/history";

const base = {
  sheetId: "s1",
  isoWeek: 38,
  periodStart: "2026-09-14",
  periodEnd: "2026-09-20",
  approvedAt: null,
  versions: [],
  dispatches: [],
  tickets: [],
  publications: [],
};

describe("validation par l'agence dans l'historique", () => {
  it("trace la validation, nominative, sans renvoi au client", () => {
    const week = buildWeekHistory({
      ...base,
      staffValidations: [{ at: "2026-09-16T10:00:00Z", byName: "Robin Vergnes" }],
    });
    const event = week.events.find((e) => e.kind === "staff_validated");
    expect(event?.label).toBe(HISTORY_EVENT_LABELS.staff_validated);
    expect(event?.detail).toBe("par Robin Vergnes");
  });

  it("ne fait pas passer une validation de l'agence pour une validation du client", () => {
    const week = buildWeekHistory({
      ...base,
      approvedAt: "2026-09-16T10:00:01Z",
      staffValidations: [{ at: "2026-09-16T10:00:00Z", byName: "Robin Vergnes" }],
    });
    expect(week.events.find((e) => e.kind === "approved")?.label).toBe(AGENCY_APPROVAL_LABEL);
  });

  it("garde « Validation du client » quand le client a validé lui-même, plus tard", () => {
    const week = buildWeekHistory({
      ...base,
      approvedAt: "2026-09-18T09:00:00Z",
      staffValidations: [{ at: "2026-09-16T10:00:00Z", byName: "Robin Vergnes" }],
    });
    expect(week.events.find((e) => e.kind === "approved")?.label).toBe(HISTORY_EVENT_LABELS.approved);
  });

  it("n'impute pas au client un retard de validation faite par l'agence", () => {
    const late = { ...base, deadlineAt: "2026-09-15T18:00:00Z", approvedAt: "2026-09-16T10:00:01Z" };
    const byAgency = buildWeekHistory({ ...late, staffValidations: [{ at: "2026-09-16T10:00:00Z", byName: "Robin Vergnes" }] });
    expect(byAgency.assessment.client).not.toContain("validation après l'échéance");
    const byClient = buildWeekHistory(late);
    expect(byClient.assessment.client).toContain("validation après l'échéance");
  });
});
