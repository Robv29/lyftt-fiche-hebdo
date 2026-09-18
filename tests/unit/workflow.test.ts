import { describe, expect, it } from "vitest";
import {
  availableTransitions,
  canTransition,
  contributorAssignment,
  isAwaitingProduction,
  isTicketOpen,
} from "@/lib/domain/workflow";
import { TICKET_STATUS_LABELS, type AppRole, type TicketStatus } from "@/lib/domain/types";

describe("§10 — workflow des tickets", () => {
  it("suit le séquencement nominal de la spec", () => {
    const sequence: TicketStatus[] = [
      "new",
      "to_qualify",
      "assigned",
      "in_progress",
      "ready_for_review",
      "internally_reviewed",
      "new_version_generated",
      "sent_back_to_client",
      "approved_by_client",
      "closed",
    ];

    for (let i = 0; i < sequence.length - 1; i++) {
      const check = canTransition(sequence[i], sequence[i + 1], "community_manager");
      expect(check.allowed, `${sequence[i]} → ${sequence[i + 1]}`).toBe(true);
    }
  });

  it("interdit de sauter des étapes", () => {
    expect(canTransition("new", "closed", "community_manager").allowed).toBe(false);
    expect(canTransition("assigned", "sent_back_to_client", "community_manager").allowed).toBe(
      false,
    );
  });

  it("§22 : le graphiste ne peut pas renvoyer la version au client", () => {
    const check = canTransition(
      "new_version_generated",
      "sent_back_to_client",
      "graphic_designer",
    );

    expect(check.allowed).toBe(false);
    expect(check.error).toBe("Votre rôle ne permet pas cette action.");
  });

  it("§22 : le graphiste ne fait pas le contrôle éditorial", () => {
    expect(
      canTransition("ready_for_review", "internally_reviewed", "graphic_designer").allowed,
    ).toBe(false);
    expect(
      canTransition("ready_for_review", "internally_reviewed", "community_manager").allowed,
    ).toBe(true);
  });

  it("laisse le graphiste prendre en charge et rendre sa correction", () => {
    expect(canTransition("assigned", "in_progress", "graphic_designer").allowed).toBe(true);
    expect(canTransition("in_progress", "ready_for_review", "video_editor").allowed).toBe(true);
  });

  it("exige une justification pour les décisions unilatérales", () => {
    expect(canTransition("to_qualify", "rejected", "community_manager").requiresReason).toBe(
      true,
    );
    expect(canTransition("to_qualify", "out_of_scope", "community_manager").requiresReason).toBe(
      true,
    );
    expect(canTransition("closed", "reopened", "community_manager").requiresReason).toBe(true);
  });

  it("§24 : un ticket fermé peut être rouvert puis requalifié", () => {
    expect(canTransition("closed", "reopened", "community_manager").allowed).toBe(true);
    expect(canTransition("reopened", "to_qualify", "community_manager").allowed).toBe(true);
  });

  it("permet la réaffectation sans changer d'étape", () => {
    expect(canTransition("assigned", "assigned", "community_manager").allowed).toBe(true);
    expect(canTransition("in_progress", "in_progress", "community_manager").allowed).toBe(false);
  });

  it("propose l'annulation depuis les états non terminaux uniquement", () => {
    const fromNew = availableTransitions("new", "community_manager").map((t) => t.to);
    expect(fromNew).toContain("cancelled");

    const fromClosed = availableTransitions("closed", "community_manager").map((t) => t.to);
    expect(fromClosed).not.toContain("cancelled");
  });

  it("passe par une validation de facturation quand le périmètre change", () => {
    expect(canTransition("to_qualify", "billing_review", "community_manager").allowed).toBe(true);
    expect(canTransition("billing_review", "assigned", "community_manager").allowed).toBe(true);
  });

  it("distingue les tickets ouverts et ceux en attente de production", () => {
    expect(isTicketOpen("new")).toBe(true);
    expect(isTicketOpen("closed")).toBe(false);
    expect(isTicketOpen("cancelled")).toBe(false);
    expect(isTicketOpen("approved_by_client")).toBe(false);

    expect(isAwaitingProduction("assigned")).toBe(true);
    expect(isAwaitingProduction("in_progress")).toBe(true);
    expect(isAwaitingProduction("ready_for_review")).toBe(false);
  });
});

describe("Confier une correction à la production", () => {
  const ENCADREMENT: AppRole[] = ["super_admin", "production_manager", "community_manager"];

  it("un ticket nouveau passe en « Affecté » par les étapes de la machine à états", () => {
    const plan = contributorAssignment("new");
    expect(plan).toEqual({ allowed: true, path: ["to_qualify", "assigned"] });
  });

  it("un ticket à qualifier ou rouvert rejoint aussi « Affecté »", () => {
    expect(contributorAssignment("to_qualify")).toEqual({ allowed: true, path: ["assigned"] });
    expect(contributorAssignment("reopened")).toEqual({ allowed: true, path: ["to_qualify", "assigned"] });
  });

  it("chaque étape est une transition permise à l'encadrement, sans justification", () => {
    for (const from of Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]) {
      const plan = contributorAssignment(from);
      if (!plan.allowed) continue;
      for (const role of ENCADREMENT) {
        let current = from;
        for (const next of plan.path) {
          const check = canTransition(current, next, role);
          expect(check.allowed, `${role} : ${current} → ${next}`).toBe(true);
          expect(check.requiresReason, `${role} : ${current} → ${next}`).toBe(false);
          current = next;
        }
        if (plan.path.length > 0) expect(current).toBe("assigned");
      }
    }
  });

  it("ailleurs, la correction change de mains sans changer d'étape", () => {
    for (const status of ["assigned", "in_progress", "awaiting_client", "ready_for_review", "billing_review"] as const) {
      expect(contributorAssignment(status), status).toEqual({ allowed: true, path: [] });
    }
  });

  it("un ticket terminé ne se confie plus", () => {
    for (const status of ["closed", "cancelled", "rejected", "out_of_scope", "approved_by_client"] as const) {
      expect(contributorAssignment(status).allowed, status).toBe(false);
    }
  });
});
