import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateReviewToken,
  hashToken,
  validateLinkState,
} from "@/lib/domain/tokens";
import { DEFAULT_TEMPLATES, isRenderComplete, renderTemplate } from "@/lib/domain/templates";
import { computeValidationDeadline, formatDeadline, formatPeriod } from "@/lib/domain/deadline";
import { canApproveAll, computeSheetStatus } from "@/lib/domain/sheet-status";
import { requiresProduction, routeTicket } from "@/lib/domain/routing";
import { canTransition } from "@/lib/domain/workflow";
import { checkExportBeforeSend, exportVersionLabel } from "@/lib/domain/edge-cases";

/**
 * §25 — Les dix scénarios obligatoires de la spec.
 *
 * Ce fichier vérifie la logique métier de bout en bout, sans base de données.
 * Les mêmes scénarios sont rejoués dans un navigateur par tests/e2e, une fois
 * un projet Supabase provisionné.
 */

const monday = new Date(Date.UTC(2026, 7, 10));

describe("Scénario 1 — lien sécurisé et message personnalisé", () => {
  it("génère un lien unique et un message complet, prêt à copier", () => {
    const { token, tokenHash } = generateReviewToken();
    const reviewLink = `https://app.lyftt.fr/client-review/${token}`;

    // Le lien est unique, difficile à deviner, et seul son hash sera stocké.
    expect(token).toHaveLength(43);
    expect(tokenHash).toBe(hashToken(token));
    expect(generateReviewToken().token).not.toBe(token);

    const deadline = computeValidationDeadline(monday);
    const message = renderTemplate(DEFAULT_TEMPLATES.standard, {
      contact_first_name: "Brigitte",
      client_name: "Un été à la campagne",
      publication_week: formatPeriod(monday, new Date(Date.UTC(2026, 7, 16))),
      publication_start_date: "10/08/2026",
      publication_end_date: "16/08/2026",
      validation_deadline: formatDeadline(deadline),
      review_link: reviewLink,
      request_link: `${reviewLink}/demandes`,
      community_manager_name: "Élena",
    });

    expect(isRenderComplete(message)).toBe(true);
    expect(message.body).toContain("Bonjour Brigitte,");
    expect(message.body).toContain("du 10 au 16 août");
    expect(message.body).toContain("mardi 11 août à 10 h");
    expect(message.body).toContain(reviewLink);
  });
});

describe("Scénario 2 — le client valide toute la fiche", () => {
  it("propose la validation globale puis passe la fiche en validée", () => {
    const items = [
      { approvalStatus: "pending" as const, isCancelled: false },
      { approvalStatus: "pending" as const, isCancelled: false },
      { approvalStatus: "pending" as const, isCancelled: false },
    ];

    expect(canApproveAll({ items, ticketStatuses: [] })).toBe(true);

    const afterApproval = items.map(() => ({
      approvalStatus: "approved" as const,
      isCancelled: false,
    }));

    expect(
      computeSheetStatus({
        currentStatus: "sent_to_client",
        items: afterApproval,
        ticketStatuses: [],
      }),
    ).toBe("approved_by_client");
  });
});

describe("Scénario 3 — demande de modification de texte", () => {
  it("affecte le community manager seul et passe la fiche en partiellement validée", () => {
    const routing = routeTicket("text_edit", { priority: "normal" });

    // Ticket créé, community manager affecté.
    expect(routing.targets.map((t) => t.role)).toEqual(["community_manager"]);
    expect(routing.escalation.escalate).toBe(false);

    // Un contenu validé, un contenu en demande de modification.
    const status = computeSheetStatus({
      currentStatus: "sent_to_client",
      items: [
        { approvalStatus: "approved", isCancelled: false },
        { approvalStatus: "changes_requested", isCancelled: false },
      ],
      ticketStatuses: ["new"],
    });

    expect(status).toBe("changes_requested");

    // Et la validation globale n'est plus proposée.
    expect(
      canApproveAll({
        items: [
          { approvalStatus: "approved", isCancelled: false },
          { approvalStatus: "changes_requested", isCancelled: false },
        ],
        ticketStatuses: ["new"],
      }),
    ).toBe(false);
  });
});

describe("Scénario 4 — demande de remplacement de photo", () => {
  it("notifie le community manager et affecte le graphiste", () => {
    const routing = routeTicket("photo_replace", { priority: "normal" });
    const byRole = new Map(routing.targets.map((t) => [t.role, t.assignmentRole]));

    expect(byRole.get("community_manager")).toBe("owner");
    expect(byRole.get("graphic_designer")).toBe("contributor");
    // Le ticket apparaît dans l'espace production.
    expect(requiresProduction("photo_replace")).toBe(true);
  });
});

describe("Scénario 5 — le graphiste dépose une nouvelle version", () => {
  it("peut faire avancer le ticket jusqu'à « Prêt à contrôler », pas au-delà", () => {
    expect(canTransition("assigned", "in_progress", "graphic_designer").allowed).toBe(true);
    expect(canTransition("in_progress", "ready_for_review", "graphic_designer").allowed).toBe(
      true,
    );

    // Il ne contrôle pas et ne renvoie pas au client.
    expect(
      canTransition("ready_for_review", "internally_reviewed", "graphic_designer").allowed,
    ).toBe(false);
    expect(
      canTransition("new_version_generated", "sent_back_to_client", "graphic_designer").allowed,
    ).toBe(false);
  });
});

describe("Scénario 6 — contrôle interne et nouvelle version", () => {
  it("enchaîne contrôle, génération de version et renvoi au client", () => {
    const steps = [
      ["ready_for_review", "internally_reviewed"],
      ["internally_reviewed", "new_version_generated"],
      ["new_version_generated", "sent_back_to_client"],
    ] as const;

    for (const [from, to] of steps) {
      expect(canTransition(from, to, "community_manager").allowed, `${from} → ${to}`).toBe(
        true,
      );
    }
  });

  it("marque l'ancien export comme obsolète et l'annonce avant tout envoi", () => {
    const stale = checkExportBeforeSend({ isObsolete: true, versionNumber: 1 }, 2);

    expect(stale.requiresConfirmation).toBe(true);
    expect(stale.warning).toContain("version 2");

    expect(checkExportBeforeSend({ isObsolete: false, versionNumber: 2 }, 2)).toEqual({
      allowed: true,
      requiresConfirmation: false,
    });

    expect(exportVersionLabel(2, new Date("2026-08-11T12:30:00Z"))).toContain("Version 2");
  });
});

describe("Scénario 7 — lien révoqué ou expiré", () => {
  it("refuse l'accès dans les deux cas", () => {
    const now = new Date("2026-08-12T09:00:00Z");

    expect(
      validateLinkState(
        { revokedAt: new Date("2026-08-11T09:00:00Z"), expiresAt: new Date("2026-09-01T00:00:00Z") },
        now,
      ),
    ).toEqual({ valid: false, reason: "revoked" });

    expect(
      validateLinkState({ revokedAt: null, expiresAt: new Date("2026-08-11T09:00:00Z") }, now),
    ).toEqual({ valid: false, reason: "expired" });
  });
});

describe("Scénario 8 — le client n'accède jamais aux notes internes", () => {
  const accessSource = readFileSync(
    fileURLToPath(new URL("../../src/lib/review/access.ts", import.meta.url)),
    "utf8",
  );

  it("ne sélectionne pas internal_notes dans les requêtes du portail", () => {
    // La requête du portail est explicite : toute colonne interne ajoutée par
    // mégarde ferait échouer ce test.
    expect(accessSource).not.toMatch(/select\([^)]*internal_notes/s);
  });

  it("n'expose pas de champ de notes internes dans le type envoyé au client", () => {
    const reviewItemType = accessSource
      .split("export interface ReviewItem")[1]
      ?.split("}")[0];

    expect(reviewItemType).toBeDefined();
    expect(reviewItemType).not.toContain("internalNotes");
    expect(reviewItemType).not.toContain("internal_notes");
  });
});

describe("Scénario 9 — une correction de texte ne part pas au graphiste", () => {
  it("n'affecte aucun rôle de production pour les demandes éditoriales", () => {
    for (const type of [
      "text_edit",
      "text_typo",
      "text_information",
      "text_tone",
      "hashtags",
    ] as const) {
      const assigned = routeTicket(type, { priority: "normal" }).targets.map((t) => t.role);

      expect(assigned, type).not.toContain("graphic_designer");
      expect(assigned, type).not.toContain("video_editor");
      expect(requiresProduction(type), type).toBe(false);
    }
  });
});

describe("Scénario 10 — une correction photo part au graphiste et au community manager", () => {
  it("affecte les deux rôles, et le vidéaste n'est pas sollicité", () => {
    for (const type of ["photo_replace", "photo_retouch", "graphic_edit"] as const) {
      const assigned = routeTicket(type, { priority: "normal" }).targets.map((t) => t.role);

      expect(assigned, type).toContain("community_manager");
      expect(assigned, type).toContain("graphic_designer");
      expect(assigned, type).not.toContain("video_editor");
    }
  });
});
