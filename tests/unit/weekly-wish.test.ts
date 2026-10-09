import { describe, expect, it } from "vitest";
import {
  canSubmitWish,
  nextWeekRange,
  wishTicketTitle,
  WISH_MAX_LENGTH,
  WISH_MIN_LENGTH,
} from "@/lib/domain/weekly-wish";
import {
  getTicketTypeDefinition,
  groupedTicketTypes,
  isClientRequestableType,
  isServiceRequest,
  TICKET_TYPES,
  serviceRequestAlertDays,
  WEEKLY_WISH_ALERT_DAYS,
} from "@/lib/domain/ticket-types";
import { fallbackRolesFor, routeTicket } from "@/lib/domain/routing";

describe("semaine visée par une envie", () => {
  it("prend la semaine qui suit la fiche consultée", () => {
    // Fiche du lundi 5 au dimanche 11 octobre 2026.
    expect(nextWeekRange("2026-10-11")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("traverse un changement de mois sans se tromper", () => {
    expect(nextWeekRange("2026-10-25")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });

  it("ne suppose rien d'une date illisible", () => {
    expect(nextWeekRange("pas une date")).toBeNull();
  });
});

describe("titre du ticket", () => {
  it("nomme la semaine suivante, pas celle de la fiche", () => {
    expect(wishTicketTitle("2026-10-11")).toBe("Semaine du 12 au 18 octobre");
  });

  it("nomme les deux mois quand la semaine les chevauche", () => {
    expect(wishTicketTitle("2026-10-25")).toBe("Semaine du 26 octobre au 1 novembre");
  });

  it("reste lisible quand la période est illisible", () => {
    expect(wishTicketTitle("")).toBe("Semaine prochaine");
  });
});

describe("plafond d'une envie par fiche", () => {
  it("laisse passer la première", () => {
    expect(canSubmitWish(null)).toEqual({ allowed: true });
  });

  it("refuse la seconde et nomme la référence déjà enregistrée", () => {
    const guard = canSubmitWish({ ticketNumber: "LYF-000123", isOpen: true });

    expect(guard.allowed).toBe(false);
    expect(guard.allowed === false && guard.message).toContain("LYF-000123");
    expect(guard.allowed === false && guard.message).toContain("déjà noté");
  });

  it("dit au client qu'une envie déjà prise en compte l'a bien été", () => {
    const guard = canSubmitWish({ ticketNumber: "LYF-000124", isOpen: false });

    expect(guard.allowed).toBe(false);
    expect(guard.allowed === false && guard.message).toContain("déjà été prise en compte");
  });
});

describe("bornes du texte", () => {
  it("exige quelques mots sans brider le client", () => {
    expect(WISH_MIN_LENGTH).toBe(10);
    expect(WISH_MAX_LENGTH).toBe(1500);
  });
});

describe("le type « envie » dans le circuit des tickets", () => {
  const definition = getTicketTypeDefinition("weekly_wish");

  it("ne porte sur aucune publication", () => {
    // Sans ce drapeau, l'action serveur refuserait une demande sans contenu
    // visé, et l'historique ne la rangerait pas dans la semaine.
    expect(definition.sheetLevel).toBe(true);
  });

  it("ne part jamais en production", () => {
    expect(definition.category).toBe("scope");
    expect(routeTicket("weekly_wish", { priority: "normal" }).targets.map((t) => t.role))
      .toEqual(["community_manager"]);
  });

  it("n'escalade pas d'office vers le responsable de production", () => {
    // `mayAffectScope` aurait ajouté une escalade à *chaque* envie.
    expect(definition.mayAffectScope).toBeUndefined();
    expect(routeTicket("weekly_wish", { priority: "normal" }).escalation.escalate).toBe(false);
  });

  it("suit le parcours « c'est noté » des demandes hors publication", () => {
    expect(isServiceRequest("weekly_wish")).toBe(true);
  });

  it("n'est pas proposée dans le sélecteur de modification du portail", () => {
    const offered = groupedTicketTypes().flatMap((group) => group.types.map((t) => t.type));

    expect(offered).not.toContain("weekly_wish");
    // Les autres demandes hors publication ont aussi leur propre écran.
    expect(offered).not.toContain("quote_request");
    expect(offered).toContain("publication_add");
  });

  it("attend la fiche suivante, pas une réponse sous trois jours", () => {
    expect(serviceRequestAlertDays("weekly_wish")).toBe(WEEKLY_WISH_ALERT_DAYS);
    expect(serviceRequestAlertDays("quote_request")).toBe(3);
  });
});

describe("repli d'affectation", () => {
  it("donne un responsable de secours quand personne ne porte le rôle visé", () => {
    // Aucun profil ne porte `community_manager` : sans repli, une envie
    // arrivait sans responsable, sans notification et sans e-mail.
    expect(fallbackRolesFor({ role: "community_manager", assignmentRole: "owner" }))
      .toEqual(["super_admin", "production_manager"]);
  });

  it("ne désigne personne d'office comme contributeur", () => {
    expect(fallbackRolesFor({ role: "graphic_designer", assignmentRole: "contributor" }))
      .toEqual([]);
    expect(fallbackRolesFor({ role: "production_manager", assignmentRole: "watcher" }))
      .toEqual([]);
  });

  it("ne se replie pas sur le rôle déjà cherché", () => {
    expect(fallbackRolesFor({ role: "super_admin", assignmentRole: "owner" }))
      .toEqual(["production_manager"]);
  });
});

describe("l'envie n'entre que par son propre formulaire", () => {
  it("est refusée par les points d'entrée des demandes clients", () => {
    expect(isClientRequestableType("weekly_wish")).toBe(false);
    // Tout autre motif reste soumissible : une envie exclue ne doit pas en exclure d'autres.
    for (const type of TICKET_TYPES.filter((value) => value !== "weekly_wish")) {
      expect(isClientRequestableType(type)).toBe(true);
    }
  });
});
