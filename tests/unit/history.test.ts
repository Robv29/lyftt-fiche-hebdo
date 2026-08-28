import { describe, expect, it } from "vitest";
import {
  buildWeekHistory,
  familyForKind,
  groupEventsByDay,
  validationDelayHours,
  type SheetHistoryInput,
} from "@/lib/domain/history";

const base: SheetHistoryInput = {
  sheetId: "s1",
  isoWeek: 35,
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  approvedAt: null,
  versions: [],
  dispatches: [],
  tickets: [],
  publications: [],
};

describe("historique d'une semaine", () => {
  it("ordonne les événements dans le temps, quel que soit l'ordre des sources", () => {
    const week = buildWeekHistory({
      ...base,
      approvedAt: "2026-08-26T14:00:00Z",
      publications: [{ published_at: "2026-08-27T18:05:00Z", scheduledLabel: "27 août", formatLabel: "Photo" }],
      versions: [{ version_number: 1, sent_to_client_at: "2026-08-24T09:00:00Z" }],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["sheet_sent", "approved", "published"]);
  });

  it("distingue le premier envoi d'un renvoi après correction", () => {
    const week = buildWeekHistory({
      ...base,
      versions: [
        { version_number: 1, sent_to_client_at: "2026-08-24T09:00:00Z" },
        { version_number: 2, sent_to_client_at: "2026-08-25T16:00:00Z" },
      ],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["sheet_sent", "sheet_resent"]);
    expect(week.events[1]!.detail).toBe("version 2");
  });

  it("ignore une version jamais envoyée", () => {
    // Une version préparée mais pas transmise n'est pas un événement pour le client.
    const week = buildWeekHistory({
      ...base,
      versions: [{ version_number: 1, sent_to_client_at: null }],
    });
    expect(week.events).toEqual([]);
  });

  it("ne retient des messages que les relances", () => {
    // Les autres accompagnent une version, déjà présente : ils feraient doublon.
    const week = buildWeekHistory({
      ...base,
      versions: [{ version_number: 1, sent_to_client_at: "2026-08-24T09:00:00Z" }],
      dispatches: [
        { template_type: "standard", sent_at: "2026-08-24T09:01:00Z" },
        { template_type: "reminder", sent_at: "2026-08-26T09:00:00Z" },
        { template_type: "overdue", sent_at: "2026-08-27T09:00:00Z" },
      ],
    });

    expect(week.events.filter((e) => e.kind === "reminder")).toHaveLength(2);
    expect(week.events.find((e) => e.detail === "échéance dépassée")).toBeDefined();
  });

  it("sépare un retour sur contenu d'une demande spéciale", () => {
    const week = buildWeekHistory({
      ...base,
      tickets: [
        {
          id: "t1", title: "Changer la photo", ticket_type: "photo_replace", typeLabel: "Remplacement de photo",
          submitted_at: "2026-08-25T10:00:00Z", created_at: "2026-08-25T10:00:00Z",
          resolved_at: null, due_at: "2026-08-26T10:00:00Z", weekly_sheet_item_id: "i1", category: "editorial",
        },
        {
          id: "t2", title: "Devis pour un shooting", ticket_type: "other", typeLabel: "Autre demande",
          submitted_at: "2026-08-25T11:00:00Z", created_at: "2026-08-25T11:00:00Z",
          resolved_at: null, due_at: null, weekly_sheet_item_id: null, category: null,
        },
      ],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["client_feedback", "special_request"]);
    expect(week.events[0]!.detail).toBe("Remplacement de photo — Changer la photo");
    expect(week.events[0]!.dueAt).toBe("2026-08-26T10:00:00Z");
  });

  it("ajoute la résolution d'un retour comme événement distinct", () => {
    const week = buildWeekHistory({
      ...base,
      tickets: [{
        id: "t1", title: null, ticket_type: "text_edit", typeLabel: "Correction de texte",
        submitted_at: "2026-08-25T10:00:00Z", created_at: "2026-08-25T10:00:00Z",
        resolved_at: "2026-08-25T15:00:00Z", due_at: null, weekly_sheet_item_id: "i1", category: "graphic",
      }],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["client_feedback", "feedback_resolved"]);
  });

  it("retient l'heure réelle de publication, pas la date prévue", () => {
    const week = buildWeekHistory({
      ...base,
      publications: [
        { published_at: "2026-08-27T18:05:00Z", scheduledLabel: "26 août", formatLabel: "Photo" },
        { published_at: null, scheduledLabel: "28 août", formatLabel: "Vidéo" },
      ],
    });

    // La publication non confirmée n'apparaît pas : rien ne dit qu'elle est sortie.
    expect(week.events).toHaveLength(1);
    expect(week.events[0]!.at).toBe("2026-08-27T18:05:00Z");
    expect(week.events[0]!.detail).toContain("prévue le 26 août");
  });
});

describe("commandes en production", () => {
  it("inscrit la demande, son échéance et sa livraison", () => {
    const week = buildWeekHistory({
      ...base,
      productionRequests: [{
        title: "Visuels épinglés",
        kindLabel: "Visuel",
        created_at: "2026-08-19T15:56:10Z",
        due_on: "2026-08-26",
        delivered_at: "2026-08-26T10:03:20Z",
        validated_at: "2026-08-26T13:39:00Z",
      }],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["production_requested", "production_delivered"]);
    expect(week.events[0]!.detail).toBe("Visuel — Visuels épinglés");
    expect(week.events[0]!.dueAt).toBe("2026-08-26");
  });

  it("n'invente pas de livraison pour une commande encore à faire", () => {
    const week = buildWeekHistory({
      ...base,
      productionRequests: [{
        title: "annonce site web", kindLabel: "Visuel",
        created_at: "2026-08-18T13:17:22Z", due_on: null, delivered_at: null, validated_at: null,
      }],
    });

    expect(week.events).toHaveLength(1);
    expect(week.events[0]!.kind).toBe("production_requested");
  });

  it("signale qu'un retour part en production", () => {
    const week = buildWeekHistory({
      ...base,
      tickets: [{
        id: "t1", title: "Refaire le visuel", ticket_type: "photo_replace", typeLabel: "Remplacement de photo",
        submitted_at: "2026-08-25T10:00:00Z", created_at: "2026-08-25T10:00:00Z",
        resolved_at: null, due_at: null, weekly_sheet_item_id: "i1", category: "graphic",
      }],
    });
    expect(week.events[0]!.detail).toContain("part en production");
  });

  it("ne le signale pas pour un retour traité au bureau", () => {
    const week = buildWeekHistory({
      ...base,
      tickets: [{
        id: "t1", title: "Corriger une faute", ticket_type: "text_typo", typeLabel: "Coquille",
        submitted_at: "2026-08-25T10:00:00Z", created_at: "2026-08-25T10:00:00Z",
        resolved_at: null, due_at: null, weekly_sheet_item_id: "i1", category: "editorial",
      }],
    });
    expect(week.events[0]!.detail).not.toContain("part en production");
  });
});

describe("premier envoi réel", () => {
  it("traite comme premier envoi la première version transmise, même si ce n'est pas la v1", () => {
    /*
     * Cas observé en production : une v1 préparée puis corrigée avant d'être
     * transmise n'atteint jamais le client. La v2 est alors son premier
     * contact, et l'annoncer comme une correction inventerait un aller-retour.
     */
    const week = buildWeekHistory({
      ...base,
      versions: [
        { version_number: 1, sent_to_client_at: null },
        { version_number: 2, sent_to_client_at: "2026-08-14T15:16:00Z" },
        { version_number: 3, sent_to_client_at: "2026-08-19T08:27:00Z" },
      ],
    });

    expect(week.events.map((e) => e.kind)).toEqual(["sheet_sent", "sheet_resent"]);
    expect(week.events[1]!.detail).toBe("version 3");
  });
});

describe("délai de validation", () => {
  it("compte les heures entre l'envoi et la validation", () => {
    const week = buildWeekHistory({
      ...base,
      approvedAt: "2026-08-25T09:00:00Z",
      versions: [{ version_number: 1, sent_to_client_at: "2026-08-24T09:00:00Z" }],
    });
    expect(validationDelayHours(week)).toBe(24);
  });

  it("ne renvoie rien tant qu'il manque un des deux bouts", () => {
    // Zéro laisserait croire à une validation immédiate.
    expect(validationDelayHours(buildWeekHistory({ ...base, approvedAt: "2026-08-25T09:00:00Z" }))).toBeNull();
    expect(validationDelayHours(buildWeekHistory({
      ...base,
      versions: [{ version_number: 1, sent_to_client_at: "2026-08-24T09:00:00Z" }],
    }))).toBeNull();
  });
});

describe("familles d'événements", () => {
  it("range chaque nature dans la lecture attendue", () => {
    // On remonte le fil d'un client par ce qui vient de nous, de lui, ou de
    // ce qui est sorti — pas par la mécanique des tables.
    expect(familyForKind("sheet_sent")).toBe("envois");
    expect(familyForKind("reminder")).toBe("envois");
    expect(familyForKind("client_feedback")).toBe("retours");
    expect(familyForKind("special_request")).toBe("retours");
    expect(familyForKind("production_delivered")).toBe("production");
    expect(familyForKind("approved")).toBe("validations");
    expect(familyForKind("published")).toBe("publications");
  });
});

describe("groupement par jour", () => {
  const events = [
    { at: "2026-08-18T14:08:00Z", kind: "sheet_sent" as const, label: "Planning envoyé" },
    { at: "2026-08-18T17:12:00Z", kind: "client_feedback" as const, label: "Retour client" },
    { at: "2026-08-19T08:51:00Z", kind: "approved" as const, label: "Validation du client" },
  ];

  it("réunit les événements d'une même journée", () => {
    const days = groupEventsByDay(events);
    expect(days.map((d) => d.day)).toEqual(["2026-08-19", "2026-08-18"]);
    expect(days[1]!.events).toHaveLength(2);
  });

  it("ordonne du plus récent au plus ancien par défaut, dans le jour comme entre les jours", () => {
    const days = groupEventsByDay(events);
    expect(days[1]!.events[0]!.at).toBe("2026-08-18T17:12:00Z");
  });

  it("sait remonter le temps dans l'autre sens", () => {
    const days = groupEventsByDay(events, false);
    expect(days.map((d) => d.day)).toEqual(["2026-08-18", "2026-08-19"]);
    expect(days[0]!.events[0]!.at).toBe("2026-08-18T14:08:00Z");
  });

  it("ne perd aucun événement", () => {
    const days = groupEventsByDay(events);
    expect(days.reduce((n, d) => n + d.events.length, 0)).toBe(events.length);
  });
});
