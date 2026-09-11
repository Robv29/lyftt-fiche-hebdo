import { describe, expect, it } from "vitest";
import { originalDate, reprogrammingRefusal } from "@/lib/domain/reprogramming";

const item = { scheduledDate: "2026-09-10", publishedAt: null, isCancelled: false };
const AUJOURDHUI = "2026-09-09";

describe("reprogrammingRefusal", () => {
  it("autorise un report à un jour suivant", () => {
    expect(reprogrammingRefusal(item, "2026-09-11", AUJOURDHUI)).toBeNull();
    expect(reprogrammingRefusal(item, "2026-09-20", AUJOURDHUI)).toBeNull();
  });

  it("refuse d'avancer une publication, même d'un jour", () => {
    /*
     * Publier plus tôt que ce que le client a vu modifierait ce qu'il a
     * validé : le changement de programme ne fait que reporter.
     */
    expect(reprogrammingRefusal(item, "2026-09-09", AUJOURDHUI)).toBe("not_later");
    expect(reprogrammingRefusal(item, "2026-09-10", AUJOURDHUI)).toBe("not_later");
  });

  it("refuse une date déjà passée", () => {
    const enRetard = { ...item, scheduledDate: "2026-09-01" };
    expect(reprogrammingRefusal(enRetard, "2026-09-05", AUJOURDHUI)).toBe("in_the_past");
  });

  it("accepte un post en retard reporté à aujourd'hui", () => {
    // Un post du 1er non publié peut être reporté au jour même.
    const enRetard = { ...item, scheduledDate: "2026-09-01" };
    expect(reprogrammingRefusal(enRetard, AUJOURDHUI, AUJOURDHUI)).toBeNull();
  });

  it("refuse ce qui est déjà publié ou annulé", () => {
    expect(reprogrammingRefusal({ ...item, publishedAt: "2026-09-10T10:00:00Z" }, "2026-09-12", AUJOURDHUI))
      .toBe("published");
    expect(reprogrammingRefusal({ ...item, isCancelled: true }, "2026-09-12", AUJOURDHUI))
      .toBe("cancelled");
  });

  it("rejette une date illisible", () => {
    expect(reprogrammingRefusal(item, "12/09/2026", AUJOURDHUI)).toBe("invalid_date");
    expect(reprogrammingRefusal(item, "2026-13-40", AUJOURDHUI)).toBe("invalid_date");
  });
});

describe("originalDate", () => {
  it("retient la première date prévue quand on reporte deux fois", () => {
    // Prévu le 10, reporté au 12, puis au 15 : la pastille rappelle le 10.
    expect(originalDate("2026-09-12", "2026-09-10")).toBe("2026-09-10");
  });

  it("prend la date courante au premier report", () => {
    expect(originalDate("2026-09-10", null)).toBe("2026-09-10");
  });
});
