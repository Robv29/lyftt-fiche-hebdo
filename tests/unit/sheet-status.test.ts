import { describe, expect, it } from "vitest";
import {
  canApproveAll,
  canEditSheetContent,
  computeSheetStatus,
  editRequiresRevalidation,
  isClientValidated,
  isSheetFullyApproved,
  validationRate,
} from "@/lib/domain/sheet-status";
import type { ItemApprovalStatus } from "@/lib/domain/types";

const item = (approvalStatus: ItemApprovalStatus, isCancelled = false) => ({
  approvalStatus,
  isCancelled,
});

describe("édition du planning", () => {
  it("autorise les fiches en préparation, envoyées ou validées", () => {
    for (const status of [
      "draft",
      "internal_review",
      "ready_to_send",
      "sent_to_client",
      "approved_by_client",
      "tacitly_approved",
    ] as const) {
      expect(canEditSheetContent(status)).toBe(true);
    }
  });

  it("demande une nouvelle validation après l'envoi ou la validation", () => {
    expect(editRequiresRevalidation("draft")).toBe(false);
    expect(editRequiresRevalidation("ready_to_send")).toBe(false);
    expect(editRequiresRevalidation("sent_to_client")).toBe(true);
    expect(editRequiresRevalidation("approved_by_client")).toBe(true);
    expect(editRequiresRevalidation("tacitly_approved")).toBe(true);
  });

  it("laisse aussi corriger une fiche en cours de correction", () => {
    /*
     * Le circuit de correction sert les demandes du client ; il ne doit pas
     * empêcher de rattraper nos propres oublis sur la même fiche.
     */
    expect(canEditSheetContent("changes_requested")).toBe(true);
    expect(canEditSheetContent("corrections_in_progress")).toBe(true);
    expect(canEditSheetContent("awaiting_revalidation")).toBe(true);
    expect(canEditSheetContent("partially_approved")).toBe(true);
    expect(editRequiresRevalidation("changes_requested")).toBe(true);
  });

  it("ne reprend pas une fiche dont le parcours est terminé", () => {
    expect(canEditSheetContent("rejected")).toBe(false);
    expect(canEditSheetContent("expired")).toBe(false);
  });
});

describe("§15 — statut global de la fiche", () => {
  it("reste « envoyée » tant que rien n'est validé", () => {
    expect(
      computeSheetStatus({
        currentStatus: "sent_to_client",
        items: [item("pending"), item("pending")],
        ticketStatuses: [],
      }),
    ).toBe("sent_to_client");
  });

  it("scénario 3 : passe en partiellement validée dès qu'un contenu est validé", () => {
    expect(
      computeSheetStatus({
        currentStatus: "sent_to_client",
        items: [item("approved"), item("pending")],
        ticketStatuses: [],
      }),
    ).toBe("partially_approved");
  });

  it("signale les modifications demandées tant qu'un ticket est ouvert", () => {
    expect(
      computeSheetStatus({
        currentStatus: "partially_approved",
        items: [item("approved"), item("changes_requested")],
        ticketStatuses: ["in_progress"],
      }),
    ).toBe("changes_requested");
  });

  it("bascule en corrections en cours quand la production travaille", () => {
    expect(
      computeSheetStatus({
        currentStatus: "changes_requested",
        items: [item("approved"), item("corrected")],
        ticketStatuses: ["ready_for_review"],
      }),
    ).toBe("corrections_in_progress");
  });

  it("réclame une nouvelle validation une fois les tickets refermés", () => {
    expect(
      computeSheetStatus({
        currentStatus: "corrections_in_progress",
        items: [item("approved"), item("resent")],
        ticketStatuses: ["closed"],
      }),
    ).toBe("awaiting_revalidation");
  });

  it("ne valide la fiche que si tous les contenus le sont", () => {
    expect(
      computeSheetStatus({
        currentStatus: "awaiting_revalidation",
        items: [item("approved"), item("approved_after_fix")],
        ticketStatuses: ["closed"],
      }),
    ).toBe("approved_by_client");
  });

  it("ignore les publications annulées dans le calcul", () => {
    expect(
      computeSheetStatus({
        currentStatus: "sent_to_client",
        items: [item("approved"), item("pending", true)],
        ticketStatuses: [],
      }),
    ).toBe("approved_by_client");
  });

  it("ne recalcule pas un statut posé explicitement", () => {
    for (const status of ["tacitly_approved", "rejected", "expired", "draft"] as const) {
      expect(
        computeSheetStatus({
          currentStatus: status,
          items: [item("pending")],
          ticketStatuses: [],
        }),
      ).toBe(status);
    }
  });
});

describe("§15 — conditions de validation complète", () => {
  it("exige que tous les contenus soient validés", () => {
    expect(
      isSheetFullyApproved({
        items: [item("approved"), item("pending")],
        ticketStatuses: [],
      }),
    ).toEqual({ approved: false, reason: "items_pending" });
  });

  it("refuse tant qu'un ticket est ouvert", () => {
    expect(
      isSheetFullyApproved({
        items: [item("approved"), item("approved")],
        ticketStatuses: ["in_progress"],
      }),
    ).toEqual({ approved: false, reason: "open_tickets" });
  });

  it("accepte la validation tacite quand la règle s'applique", () => {
    expect(
      isSheetFullyApproved({
        items: [item("pending")],
        ticketStatuses: [],
        tacitApplied: true,
      }),
    ).toEqual({ approved: true, reason: "tacit_rule" });
  });

  it("accepte un forçage seulement s'il est justifié", () => {
    expect(
      isSheetFullyApproved({
        items: [item("pending")],
        ticketStatuses: [],
        forcedBy: { profileId: "p1", justification: "Accord oral confirmé par téléphone" },
      }).approved,
    ).toBe(true);

    expect(
      isSheetFullyApproved({
        items: [item("pending")],
        ticketStatuses: [],
        forcedBy: { profileId: "p1", justification: "   " },
      }).approved,
    ).toBe(false);
  });
});

describe("§5 — bouton « Tout valider »", () => {
  it("est proposé quand tout est en attente", () => {
    expect(
      canApproveAll({ items: [item("pending"), item("pending")], ticketStatuses: [] }),
    ).toBe(true);
  });

  it("est masqué si une modification est demandée", () => {
    expect(
      canApproveAll({ items: [item("pending"), item("changes_requested")], ticketStatuses: [] }),
    ).toBe(false);
  });

  it("est masqué si un ticket est encore ouvert", () => {
    expect(
      canApproveAll({ items: [item("pending")], ticketStatuses: ["to_qualify"] }),
    ).toBe(false);
  });

  it("est masqué si tout est déjà validé", () => {
    expect(
      canApproveAll({ items: [item("approved"), item("approved")], ticketStatuses: [] }),
    ).toBe(false);
  });

  it("reste proposé après correction, pour la nouvelle validation", () => {
    expect(
      canApproveAll({ items: [item("approved"), item("resent")], ticketStatuses: ["closed"] }),
    ).toBe(true);
  });
});

describe("fiches validées par le client", () => {
  it("reconnaît la validation explicite et la validation tacite", () => {
    expect(isClientValidated("approved_by_client")).toBe(true);
    expect(isClientValidated("tacitly_approved")).toBe(true);
    expect(isClientValidated("partially_approved")).toBe(false);
    expect(isClientValidated("awaiting_revalidation")).toBe(false);
    expect(isClientValidated("rejected")).toBe(false);
  });

  it("calcule la part de fiches validées", () => {
    expect(
      validationRate([
        "approved_by_client",
        "tacitly_approved",
        "sent_to_client",
        "changes_requested",
      ]),
    ).toEqual({ validated: 2, total: 4, percentage: 50 });
  });

  it("exclut les fiches jamais soumises au client", () => {
    // Un brouillon n'a pas encore été proposé : le compter fausserait le taux.
    expect(
      validationRate(["approved_by_client", "draft", "internal_review"]),
    ).toEqual({ validated: 1, total: 1, percentage: 100 });
  });

  it("ne divise pas par zéro quand rien n'a été envoyé", () => {
    expect(validationRate(["draft"])).toEqual({ validated: 0, total: 0, percentage: 0 });
  });
});
