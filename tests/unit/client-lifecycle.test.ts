import { describe, expect, it } from "vitest";
import {
  clientLifecycle,
  productionBlockedMessage,
  type ClientLifecycleInput,
} from "@/lib/domain/client-lifecycle";

const base: ClientLifecycleInput = {
  isActive: true,
  contractEndDate: null,
  pauseStartDate: null,
  pauseEndDate: null,
};

const today = "2026-08-10";

describe("fin de gestion", () => {
  it("laisse le client actif sans date de fin", () => {
    expect(clientLifecycle(base, today).state).toBe("active");
    expect(clientLifecycle(base, today).canProduce).toBe(true);
  });

  it("reste actif le dernier jour de gestion", () => {
    // La journée de fin doit rester pleinement exploitable.
    const lifecycle = clientLifecycle({ ...base, contractEndDate: today }, today);
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.canProduce).toBe(true);
  });

  it("archive le lendemain de la fin de gestion", () => {
    const lifecycle = clientLifecycle({ ...base, contractEndDate: "2026-08-09" }, today);
    expect(lifecycle.state).toBe("ended");
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toContain("9 août 2026");
  });

  it("annonce la fin à venir tant qu'elle n'est pas atteinte", () => {
    expect(clientLifecycle({ ...base, contractEndDate: "2026-12-31" }, today).detail)
      .toContain("31 décembre 2026");
  });
});

describe("pause", () => {
  it("archive pendant la pause, bornes incluses", () => {
    const paused = { ...base, pauseStartDate: "2026-08-10", pauseEndDate: "2026-08-20" };

    expect(clientLifecycle(paused, "2026-08-10").state).toBe("paused");
    expect(clientLifecycle(paused, "2026-08-15").state).toBe("paused");
    expect(clientLifecycle(paused, "2026-08-20").state).toBe("paused");
  });

  it("réactive le lendemain de la fin de pause", () => {
    const lifecycle = clientLifecycle(
      { ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-09" },
      today,
    );
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.canProduce).toBe(true);
  });

  it("reste actif avant le début de la pause, en l'annonçant", () => {
    const lifecycle = clientLifecycle({ ...base, pauseStartDate: "2026-09-01" }, today);
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.detail).toContain("1 septembre 2026");
  });

  it("gère une pause sans date de reprise", () => {
    const lifecycle = clientLifecycle({ ...base, pauseStartDate: "2026-08-01" }, today);
    expect(lifecycle.state).toBe("paused");
    expect(lifecycle.detail).toContain("sans date de reprise");
  });

  it("annonce la date exacte de reprise", () => {
    const lifecycle = clientLifecycle(
      { ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-20" },
      today,
    );
    expect(lifecycle.detail).toContain("21 août 2026");
  });
});

describe("priorités entre états", () => {
  it("l'archivage manuel prime sur tout", () => {
    expect(
      clientLifecycle({ ...base, isActive: false, pauseStartDate: "2026-09-01" }, today).state,
    ).toBe("archived");
  });

  it("la fin de gestion prime sur une pause en cours", () => {
    // Inutile d'annoncer une reprise pour un contrat déjà terminé.
    expect(
      clientLifecycle(
        { ...base, contractEndDate: "2026-08-01", pauseStartDate: "2026-08-05" },
        today,
      ).state,
    ).toBe("ended");
  });
});

describe("blocage de la production", () => {
  it("explique pourquoi aucune fiche ne peut être créée", () => {
    const paused = clientLifecycle({ ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-20" }, today);
    expect(productionBlockedMessage(paused)).toContain("en pause");

    const ended = clientLifecycle({ ...base, contractEndDate: "2026-08-01" }, today);
    expect(productionBlockedMessage(ended)).toContain("terminée");

    const archived = clientLifecycle({ ...base, isActive: false }, today);
    expect(productionBlockedMessage(archived)).toContain("archivé");
  });

  it("ne dit rien pour un client actif", () => {
    expect(productionBlockedMessage(clientLifecycle(base, today))).toBe("");
  });
});

describe("gestion pas encore commencée", () => {
  it("écarte un client dont la date de début n'est pas atteinte", () => {
    const lifecycle = clientLifecycle({ ...base, contractStartDate: "2026-08-17" }, today);
    expect(lifecycle.state).toBe("not_started");
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toContain("17 août 2026");
  });

  it("produit dès le premier jour de gestion", () => {
    expect(clientLifecycle({ ...base, contractStartDate: today }, today).canProduce).toBe(true);
  });

  it("ne change rien sans date de début", () => {
    expect(clientLifecycle({ ...base, contractStartDate: null }, today).state).toBe("active");
  });

  it("explique pourquoi aucune fiche ne peut être créée", () => {
    const lifecycle = clientLifecycle({ ...base, contractStartDate: "2026-09-01" }, today);
    expect(productionBlockedMessage(lifecycle)).toContain("pas encore commencé");
  });
});
