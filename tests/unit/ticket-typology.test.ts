import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contributorAssignment } from "@/lib/domain/workflow";
import {
  TICKET_TYPES,
  getTicketTypeDefinition,
  groupedTicketTypes,
  isClientRequestableType,
  isHashtagCorrection,
  isRequalifiableType,
  isServiceRequest,
} from "@/lib/domain/ticket-types";

/**
 * FIX A — la typologie des demandes client.
 *
 * 55 demandes sur 96 arrivaient en « modifier le texte », présélectionné dans
 * le portail, et une vingtaine parlaient en réalité d'une image, d'une vidéo ou
 * des hashtags. Comme le routage et l'écran de production lisent la catégorie
 * du type, aucune de celles-là n'a reçu de graphiste ni de monteur.
 */
describe("requalification du type d’une demande", () => {
  it("accepte tout type portant sur un contenu de la semaine", () => {
    for (const type of TICKET_TYPES.filter((type) => !isServiceRequest(type))) {
      expect(isRequalifiableType(type)).toBe(true);
    }
  });

  /*
   * Les demandes hors publication en sont exclues : leur écran se résume à un
   * bouton « c'est fait », et basculer un ticket vers l'une d'elles ferait
   * disparaître tout le circuit de correction sous les pieds de la personne qui
   * le traite. `isClientRequestableType` ne refusait que l'envie de la semaine.
   */
  it("refuse les demandes hors publication, l’envie comprise", () => {
    for (const type of ["quote_request", "shooting_request", "side_service", "weekly_wish"]) {
      expect(isRequalifiableType(type)).toBe(false);
    }
    expect(isClientRequestableType("quote_request")).toBe(true);
  });

  it("refuse un type inconnu", () => {
    expect(isRequalifiableType("")).toBe(false);
    expect(isRequalifiableType("text_edition")).toBe(false);
  });

  /* Tout ce que le sélecteur du portail propose doit pouvoir être requalifié. */
  it("couvre tout le sélecteur du portail client", () => {
    for (const group of groupedTicketTypes()) {
      for (const definition of group.types) {
        expect(isRequalifiableType(definition.type)).toBe(true);
      }
    }
  });
});

describe("demande portant sur les hashtags", () => {
  it("se reconnaît à son type", () => {
    expect(isHashtagCorrection({ type: "hashtags" })).toBe(true);
    expect(isHashtagCorrection({ type: "hashtags", clientSuggestion: null })).toBe(true);
  });

  /*
   * Treize demandes de hashtags sont arrivées typées « modifier le texte » : le
   * « # » de la proposition les trahit, et c'est ce qui déclenche l'offre de
   * retenir la liste pour le client.
   */
  it("se reconnaît au « # » d’une demande de texte mal typée", () => {
    expect(isHashtagCorrection({ type: "text_edit", clientSuggestion: "Enlever #rayban" })).toBe(true);
    expect(isHashtagCorrection({ type: "text_edit", clientSuggestion: "Corriger la faute" })).toBe(false);
    expect(isHashtagCorrection({ type: "text_edit" })).toBe(false);
  });

  /*
   * Un « # » dans une demande de photo ou de montage ne parle pas des hashtags
   * de la publication : la catégorie tranche.
   */
  it("ne se déclenche pas hors du registre éditorial", () => {
    expect(isHashtagCorrection({ type: "photo_replace", clientSuggestion: "la photo #2" })).toBe(false);
    expect(isHashtagCorrection({ type: "video_edit", clientSuggestion: "couper à #00:12" })).toBe(false);
  });
});

describe("formulaire client du type hashtags", () => {
  /*
   * Le formulaire texte générique ne montrait pas les hashtags de la
   * publication : pour en retirer un, le client devait recopier la liste à la
   * main — d'où « retirer tous les # et remplacer par… », puis la même demande
   * la semaine suivante.
   */
  it("a son propre formulaire, pas celui du texte", () => {
    expect(getTicketTypeDefinition("hashtags").form).toBe("hashtags");
    expect(getTicketTypeDefinition("text_edit").form).toBe("text");
  });

  it("reste une demande éditoriale", () => {
    expect(getTicketTypeDefinition("hashtags").category).toBe("editorial");
  });
});

/*
 * FIX A bis — requalifier conduit à confier.
 *
 * `requalifyTicketType` recopiait sa propre liste de statuts clos, puis posait
 * la ligne d'affectation à la main : la demande restait « Nouvelle » et l'écran
 * de production la disait « pas encore confiée », refusant le dépôt du
 * fichier — le défaut corrigé en bd0355d, revenu par une autre porte.
 */
describe("requalification : la porte de l’affectation", () => {
  const actionsSource = readFileSync(
    fileURLToPath(new URL("../../src/lib/internal/actions.ts", import.meta.url)),
    "utf8",
  );
  const requalify = actionsSource
    .split("export async function requalifyTicketType")[1]
    ?.split("\n}\n")[0];

  it("refuse les statuts que le domaine refuse de confier, « hors périmètre » compris", () => {
    for (const status of ["closed", "cancelled", "rejected", "approved_by_client", "out_of_scope"] as const) {
      expect(contributorAssignment(status).allowed, status).toBe(false);
    }
  });

  it("interroge le domaine au lieu de recopier la liste des statuts clos", () => {
    expect(requalify).toBeDefined();
    expect(requalify).toContain("contributorAssignment(ticket.status");
    expect(requalify).not.toContain('["closed", "cancelled", "rejected", "approved_by_client"]');
  });

  /*
   * Une demande nouvelle ne devient pas « Affectée » toute seule : seules les
   * étapes du domaine l'y conduisent, et c'est `assignTicketContributor` qui
   * les franchit.
   */
  it("confie par la porte qui fait passer la demande en « Affecté »", () => {
    expect(contributorAssignment("new")).toEqual({ allowed: true, path: ["to_qualify", "assigned"] });
    expect(requalify).toContain("assignTicketContributor(");
    // Plus aucune écriture d'affectation en direct depuis la requalification.
    expect(requalify).not.toContain("client_ticket_assignments");
  });
});
