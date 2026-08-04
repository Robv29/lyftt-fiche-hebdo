import { describe, expect, it } from "vitest";
import {
  routeTicket,
  requiresProduction,
  evaluateEscalation,
  type EscalationContext,
} from "@/lib/domain/routing";
import type { AppRole } from "@/lib/domain/types";

const calm: EscalationContext = { priority: "normal" };

function roles(
  type: Parameters<typeof routeTicket>[0],
  context: EscalationContext = calm,
): AppRole[] {
  return routeTicket(type, context).targets.map((t) => t.role);
}

describe("§7 — routage automatique", () => {
  it("scénario 9 : une correction de texte n'est pas envoyée au graphiste", () => {
    const assigned = roles("text_typo");

    expect(assigned).toEqual(["community_manager"]);
    expect(assigned).not.toContain("graphic_designer");
    expect(assigned).not.toContain("video_editor");
    expect(requiresProduction("text_typo")).toBe(false);
  });

  it("garde les demandes éditoriales chez le community manager", () => {
    for (const type of ["text_edit", "text_information", "text_tone", "hashtags"] as const) {
      expect(roles(type)).toEqual(["community_manager"]);
    }
  });

  it("laisse date et réseau au community manager", () => {
    expect(roles("schedule_change")).toEqual(["community_manager"]);
    expect(roles("network_change")).toEqual(["community_manager"]);
  });

  it("scénario 10 : une correction photo part au graphiste et au community manager", () => {
    const result = routeTicket("photo_replace", calm);
    const assigned = result.targets.map((t) => t.role);

    expect(assigned).toContain("community_manager");
    expect(assigned).toContain("graphic_designer");
    expect(assigned).not.toContain("video_editor");
    expect(requiresProduction("photo_replace")).toBe(true);

    // Le community manager reste responsable éditorial.
    const owner = result.targets.find((t) => t.assignmentRole === "owner");
    expect(owner?.role).toBe("community_manager");
    const contributor = result.targets.find((t) => t.assignmentRole === "contributor");
    expect(contributor?.role).toBe("graphic_designer");
  });

  it("envoie retouches, créations graphiques et ordre des visuels au graphiste", () => {
    for (const type of ["photo_retouch", "graphic_edit", "image_order"] as const) {
      expect(roles(type)).toContain("graphic_designer");
    }
  });

  it("envoie les demandes vidéo au vidéaste, pas au graphiste", () => {
    for (const type of ["video_edit", "video_replace"] as const) {
      const assigned = roles(type);
      expect(assigned).toContain("video_editor");
      expect(assigned).not.toContain("graphic_designer");
    }
  });
});

describe("§7 — notification du responsable de production", () => {
  it("n'alerte pas sur une demande ordinaire", () => {
    expect(roles("text_edit")).not.toContain("production_manager");
  });

  it("alerte sur un ticket urgent", () => {
    expect(roles("text_edit", { priority: "urgent" })).toContain("production_manager");
  });

  it("alerte quand plusieurs contenus sont touchés", () => {
    expect(
      roles("text_edit", { priority: "normal", affectsMultipleItems: true }),
    ).toContain("production_manager");
  });

  it("alerte quand la demande touche le périmètre commercial", () => {
    // « Ajouter une publication » modifie le périmètre par nature.
    expect(roles("publication_add")).toContain("production_manager");
    expect(roles("publication_remove")).toContain("production_manager");
  });

  it("alerte après l'échéance, sur réouverture et sur délai dépassé", () => {
    const cases = [
      { priority: "normal", submittedAfterDeadline: true },
      { priority: "normal", isReopened: true },
      { priority: "normal", correctionOverdue: true },
    ] as const;

    for (const context of cases) {
      expect(roles("text_edit", context)).toContain("production_manager");
    }
  });

  it("cumule les motifs d'escalade", () => {
    const escalation = evaluateEscalation("photo_replace", {
      priority: "urgent",
      affectsMultipleItems: true,
      submittedAfterDeadline: true,
    });

    expect(escalation.escalate).toBe(true);
    expect(escalation.reasons).toHaveLength(3);
  });
});
