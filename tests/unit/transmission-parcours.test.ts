import { describe, expect, it } from "vitest";
import {
  compareTransmissions,
  menuAffiche,
  menuDivergeDepuisValidation,
  prochaineEtapeTransmission,
  transmissionAvancement,
  transmissionEtapes,
  type TransmissionTriable,
} from "@/lib/domain/crm-transmission";
import {
  buildRecapHtml,
  buildRecapSubject,
  buildRecapText,
} from "@/lib/notifications/transmission-recap";

/** Fiche neuve : rien n'a encore été fait. */
function fiche(overrides: Partial<TransmissionTriable> = {}): TransmissionTriable {
  return {
    menuValideLe: null,
    recapEnvoyeLe: null,
    clientId: null,
    clientCreeLe: null,
    dateRdv: null,
    menuComposeLe: null,
    ...overrides,
  };
}

describe("parcours de validation d’une fiche transmise", () => {
  it("expose trois étapes, dans l’ordre", () => {
    const etapes = transmissionEtapes(fiche());
    expect(etapes.map((etape) => etape.key)).toEqual(["menu", "recap", "client"]);
    expect(etapes.every((etape) => !etape.franchie)).toBe(true);
  });

  it("date chaque étape franchie", () => {
    const etapes = transmissionEtapes(
      fiche({
        menuValideLe: "2026-09-02T10:00:00Z",
        recapEnvoyeLe: "2026-09-02T11:00:00Z",
        clientId: "5f0a8d2e-1c3b-4a5d-9e7f-0b1c2d3e4f5a",
        clientCreeLe: "2026-09-03T09:00:00Z",
      }),
    );
    expect(etapes.map((etape) => etape.le)).toEqual([
      "2026-09-02T10:00:00Z",
      "2026-09-02T11:00:00Z",
      "2026-09-03T09:00:00Z",
    ]);
  });

  it("compte l’avancement et désigne l’étape suivante", () => {
    expect(transmissionAvancement(fiche())).toBe(0);
    expect(prochaineEtapeTransmission(fiche())?.key).toBe("menu");

    const envoye = fiche({ recapEnvoyeLe: "2026-09-02T11:00:00Z" });
    // Étape sautée : le récapitulatif est parti sans relecture du menu. C'est
    // permis, donc l'avancement le compte — et l'étape suivante reste le menu.
    expect(transmissionAvancement(envoye)).toBe(1);
    expect(prochaineEtapeTransmission(envoye)?.key).toBe("menu");

    const bouclee = fiche({
      menuValideLe: "2026-09-02T10:00:00Z",
      recapEnvoyeLe: "2026-09-02T11:00:00Z",
      clientId: "5f0a8d2e-1c3b-4a5d-9e7f-0b1c2d3e4f5a",
    });
    expect(transmissionAvancement(bouclee)).toBe(3);
    expect(prochaineEtapeTransmission(bouclee)).toBeNull();
  });

  it("marque l’étape 3 franchie dès que le client est rattaché, même sans date", () => {
    const etapes = transmissionEtapes(fiche({ clientId: "5f0a8d2e-1c3b-4a5d-9e7f-0b1c2d3e4f5a" }));
    expect(etapes[2].franchie).toBe(true);
    // Le client peut être hors périmètre du lecteur : la date manque alors,
    // sans que l'étape cesse d'être franchie.
    expect(etapes[2].le).toBeNull();
  });
});

describe("ordre d’affichage des fiches", () => {
  it("place devant ce que personne n’a encore regardé", () => {
    const neuve = fiche({ menuComposeLe: "2026-09-01T08:00:00Z" });
    const relue = fiche({ menuValideLe: "2026-09-02T10:00:00Z" });
    const bouclee = fiche({
      menuValideLe: "2026-09-02T10:00:00Z",
      recapEnvoyeLe: "2026-09-02T11:00:00Z",
      clientId: "5f0a8d2e-1c3b-4a5d-9e7f-0b1c2d3e4f5a",
    });

    expect([bouclee, relue, neuve].sort(compareTransmissions)).toEqual([neuve, relue, bouclee]);
  });

  it("à avancement égal, le rendez-vous le plus proche passe devant", () => {
    const tot = fiche({ dateRdv: "2026-09-08T09:30:00Z" });
    const tard = fiche({ dateRdv: "2026-09-20T09:30:00Z" });
    // Sans créneau, la fiche passe derrière : il n'y a pas d'échéance à tenir.
    const sansRdv = fiche({ dateRdv: null });

    expect([sansRdv, tard, tot].sort(compareTransmissions)).toEqual([tot, tard, sansRdv]);
  });

  it("à rendez-vous égal, la fiche la plus fraîche passe devant", () => {
    const ancienne = fiche({ menuComposeLe: "2026-08-01T08:00:00Z" });
    const recente = fiche({ menuComposeLe: "2026-09-01T08:00:00Z" });
    expect([ancienne, recente].sort(compareTransmissions)).toEqual([recente, ancienne]);
  });
});

describe("menu du CRM et menu corrigé", () => {
  const crm = "MENU LYFTT\n• Post photo\n• Base obligatoire";
  const corrige = "MENU LYFTT\n• Post photo\n• Base obligatoire\n• Reportage inauguration";

  it("affiche la correction quand elle existe", () => {
    expect(menuAffiche({ ficheMission: crm, menuCorrige: corrige })).toEqual({
      texte: corrige,
      corrige: true,
    });
  });

  it("retombe sur le CRM quand la correction est absente ou vidée", () => {
    // Vider la correction est le geste qui rend la main au CRM : le prochain
    // envoi doit à nouveau s'afficher.
    expect(menuAffiche({ ficheMission: crm, menuCorrige: null }).corrige).toBe(false);
    expect(menuAffiche({ ficheMission: crm, menuCorrige: "   " })).toEqual({
      texte: crm,
      corrige: false,
    });
  });

  it("ne prétend pas afficher un menu inexistant", () => {
    expect(menuAffiche({ ficheMission: null, menuCorrige: null }).texte).toBeNull();
    expect(menuAffiche({ ficheMission: "  ", menuCorrige: null }).texte).toBeNull();
  });

  it("signale un menu du CRM plus récent que la relecture", () => {
    expect(
      menuDivergeDepuisValidation({
        menuValideLe: "2026-09-02T10:00:00Z",
        ficheMissionMajLe: "2026-09-03T08:00:00Z",
      }),
    ).toBe(true);

    // Menu reçu avant la relecture : c'est celui qui a été relu, rien à dire.
    expect(
      menuDivergeDepuisValidation({
        menuValideLe: "2026-09-02T10:00:00Z",
        ficheMissionMajLe: "2026-09-01T08:00:00Z",
      }),
    ).toBe(false);

    // Sans relecture, il n'y a pas de divergence à signaler : l'étape 1 s'en
    // charge déjà en restant ouverte.
    expect(
      menuDivergeDepuisValidation({
        menuValideLe: null,
        ficheMissionMajLe: "2026-09-03T08:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("récapitulatif envoyé au client", () => {
  const base = {
    entreprise: "Un été à la campagne",
    contactPrenom: "Jean",
    menu: "• Post photo (2/sem)\n• Base obligatoire",
    rendezVousLabel: "08/09/2026 à 11h30",
    chefDeProjet: "Théo Martin",
  };

  it("annonce l’entreprise dans l’objet", () => {
    expect(buildRecapSubject(base)).toContain("Un été à la campagne");
  });

  it("reprend le menu, le rendez-vous et la signature", () => {
    const texte = buildRecapText(base);
    expect(texte).toContain("Bonjour Jean,");
    expect(texte).toContain("• Post photo (2/sem)");
    expect(texte).toContain("08/09/2026 à 11h30");
    expect(texte).toContain("Théo Martin");
  });

  it("reste lisible sans prénom et sans rendez-vous", () => {
    const texte = buildRecapText({ ...base, contactPrenom: null, rendezVousLabel: null });
    expect(texte).toContain("Bonjour,");
    expect(texte).not.toContain("Bonjour ,");
    expect(texte).toContain("caler votre rendez-vous de lancement");
  });

  it("annonce que le menu reste à arrêter quand le client n’en a pas composé", () => {
    expect(buildRecapText({ ...base, menu: null })).toContain("n’a pas encore été arrêté");
  });

  it("échappe le menu avant de l’injecter dans le HTML", () => {
    // Le menu vient du CRM, donc d'une saisie humaine : injecté brut, il
    // casserait le message — au mieux.
    const html = buildRecapHtml({ ...base, menu: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
