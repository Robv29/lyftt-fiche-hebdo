import { describe, expect, it } from "vitest";
import {
  checkExportBeforeSend,
  checkVersionFreshness,
  detectDuplicateTicket,
  exportVersionLabel,
  itemRequestability,
  requestChangeAfterApproval,
  textSimilarity,
  type ExistingTicketSummary,
} from "@/lib/domain/edge-cases";

const now = new Date("2026-08-10T09:00:00Z");

const existing = (overrides: Partial<ExistingTicketSummary> = {}): ExistingTicketSummary => ({
  id: "t1",
  ticketNumber: "LYF-000012",
  itemId: "item-1",
  type: "photo_replace",
  description: "La photo du mardi ne me plaît pas, il faudrait la remplacer",
  status: "new",
  createdAt: new Date("2026-08-10T08:00:00Z"),
  ...overrides,
});

describe("§24 — deux tickets identiques", () => {
  it("détecte une demande quasi identique et propose de compléter l'existante", () => {
    const result = detectDuplicateTicket(
      {
        itemId: "item-1",
        type: "photo_replace",
        description: "La photo du mardi ne me plaît pas il faudrait la remplacer",
      },
      [existing()],
      now,
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.existing?.ticketNumber).toBe("LYF-000012");
    expect(result.message).toContain("LYF-000012");
  });

  it("ne bloque pas une demande différente sur le même contenu", () => {
    const result = detectDuplicateTicket(
      {
        itemId: "item-1",
        type: "photo_replace",
        description: "Merci de recadrer l'image pour qu'on voie mieux la terrasse",
      },
      [existing()],
      now,
    );

    expect(result.isDuplicate).toBe(false);
  });

  it("ne compare pas des contenus ni des types différents", () => {
    const sameText = {
      itemId: "item-2",
      type: "photo_replace" as const,
      description: existing().description,
    };
    expect(detectDuplicateTicket(sameText, [existing()], now).isDuplicate).toBe(false);

    expect(
      detectDuplicateTicket(
        { ...sameText, itemId: "item-1", type: "text_edit" },
        [existing()],
        now,
      ).isDuplicate,
    ).toBe(false);
  });

  it("ignore les tickets déjà fermés et les demandes anciennes", () => {
    const candidate = {
      itemId: "item-1",
      type: "photo_replace" as const,
      description: existing().description,
    };

    expect(
      detectDuplicateTicket(candidate, [existing({ status: "closed" })], now).isDuplicate,
    ).toBe(false);

    expect(
      detectDuplicateTicket(
        candidate,
        [existing({ createdAt: new Date("2026-08-01T08:00:00Z") })],
        now,
      ).isDuplicate,
    ).toBe(false);
  });

  it("mesure la similarité indépendamment des accents et de la ponctuation", () => {
    expect(textSimilarity("La photo est trop sombre", "la photo est trop sombre !")).toBe(1);
    expect(textSimilarity("Changer la photo", "Modifier le texte")).toBeLessThan(0.3);
  });
});

describe("§24 — le client valide puis demande une modification", () => {
  const scheduledLater = new Date("2026-08-14T16:00:00Z");

  it("autorise le retour en arrière et alerte le responsable de production", () => {
    const decision = requestChangeAfterApproval(
      { approvalStatus: "approved", publishedAt: null, scheduledAt: scheduledLater },
      now,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.nextItemStatus).toBe("changes_requested");
    expect(decision.notifyProductionManager).toBe(true);
  });

  it("refuse la modification d'un contenu déjà publié mais transmet la demande", () => {
    const decision = requestChangeAfterApproval(
      {
        approvalStatus: "approved",
        publishedAt: new Date("2026-08-09T16:00:00Z"),
        scheduledAt: new Date("2026-08-09T16:00:00Z"),
      },
      now,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.notifyProductionManager).toBe(true);
    expect(decision.message).toContain("déjà été publié");
  });

  it("prévient quand la publication est imminente", () => {
    const decision = requestChangeAfterApproval(
      {
        approvalStatus: "pending",
        publishedAt: null,
        scheduledAt: new Date("2026-08-10T18:00:00Z"),
      },
      now,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.notifyProductionManager).toBe(true);
    expect(decision.message).toContain("moins de 24 h");
  });
});

describe("§24 — ancien lien et version plus récente", () => {
  it("signale que le client consultait une version dépassée", () => {
    const freshness = checkVersionFreshness(1, 3);

    expect(freshness.isStale).toBe(true);
    expect(freshness.banner).toContain("version 3");
  });

  it("ne signale rien sur la version courante", () => {
    expect(checkVersionFreshness(3, 3).isStale).toBe(false);
    expect(checkVersionFreshness(null, 3).isStale).toBe(false);
  });
});

describe("§14 — envoi d'un export obsolète", () => {
  it("laisse passer l'export à jour sans confirmation", () => {
    expect(checkExportBeforeSend({ isObsolete: false, versionNumber: 2 }, 2)).toEqual({
      allowed: true,
      requiresConfirmation: false,
    });
  });

  it("avertit avant d'envoyer un export dépassé", () => {
    const check = checkExportBeforeSend({ isObsolete: true, versionNumber: 1 }, 2);

    expect(check.requiresConfirmation).toBe(true);
    expect(check.warning).toContain("Attention");
    expect(check.warning).toContain("version 2");
  });

  it("imprime la mention de version dans le PDF", () => {
    expect(exportVersionLabel(2, new Date("2026-08-11T12:30:00Z"))).toBe(
      "Version 2 — mise à jour le 11 août 2026 à 14 h 30",
    );
  });
});

describe("§24 — publication annulée, publiée ou imminente", () => {
  it("signale une publication annulée", () => {
    const result = itemRequestability(
      { publishedAt: null, isCancelled: true, scheduledAt: new Date("2026-08-14T16:00:00Z") },
      now,
    );
    expect(result.state).toBe("cancelled");
  });

  it("signale une publication déjà en ligne sans interdire la demande", () => {
    const result = itemRequestability(
      {
        publishedAt: new Date("2026-08-09T16:00:00Z"),
        isCancelled: false,
        scheduledAt: new Date("2026-08-09T16:00:00Z"),
      },
      now,
    );

    expect(result.state).toBe("already_published");
    expect(result.notice).toContain("déjà en ligne");
  });

  it("signale un délai trop court", () => {
    expect(
      itemRequestability(
        {
          publishedAt: null,
          isCancelled: false,
          scheduledAt: new Date("2026-08-10T18:00:00Z"),
        },
        now,
      ).state,
    ).toBe("tight_deadline");
  });

  it("laisse la demande ouverte quand il reste du temps", () => {
    expect(
      itemRequestability(
        {
          publishedAt: null,
          isCancelled: false,
          scheduledAt: new Date("2026-08-14T16:00:00Z"),
        },
        now,
      ).state,
    ).toBe("open");
  });
});
