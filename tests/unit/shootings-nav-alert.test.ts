import { describe, expect, it } from "vitest";
import { filterUnclassifiedShootings } from "@/lib/domain/shooting-decision";

/**
 * Le tri d'un lot de shootings appartenant à plusieurs clients — celui que
 * lisent l'encart « à classer » de l'onglet et la pastille de la navigation.
 *
 * Ce qui se joue ici n'est pas la règle elle-même (déjà tenue par
 * `isShootingUnclassified`), mais le branchement : chaque shooting doit être
 * jugé dans le dossier de SON client. Un dossier pris pour un autre allumait
 * la pastille sur un shooting déjà facturé, ou la taisait sur un shooting
 * ouvert.
 */

const today = "2026-10-26";

const books = {
  today,
  contractStartByClient: new Map([
    ["c1", "2026-07-01"],
    ["c2", "2026-09-15"],
  ]),
  invoiceStatusesByClient: new Map([
    // Septembre est parti chez le client 1, et chez lui seulement.
    ["c1", { "2026-09-01": "faite" as const }],
  ]),
};

const tourne = { serviceKey: "shooting_forfait", forfaitIncluded: null };

describe("shootings non classés d'un lot de clients", () => {
  it("juge chaque shooting dans le dossier de son client", () => {
    const rows = [
      { ...tourne, clientId: "c1", performedOn: "2026-09-14", ref: "c1-septembre" },
      { ...tourne, clientId: "c2", performedOn: "2026-09-14", ref: "c2-septembre" },
    ];
    /* Même date, même absence de décision : seule la facture de c1 fige la sienne. */
    expect(filterUnclassifiedShootings(rows, books).map((row) => row.ref)).toEqual(["c2-septembre"]);
  });

  it("rend les lignes de l'appelant, pour que l'écran puisse les lister", () => {
    const rows = [{ ...tourne, clientId: "c1", performedOn: "2026-10-12", label: "Shooting d'octobre" }];
    expect(filterUnclassifiedShootings(rows, books)).toEqual(rows);
  });

  it("laisse dehors l'annulé, le pas encore tourné et le déjà tranché", () => {
    const rows = [
      { ...tourne, clientId: "c2", performedOn: "2026-10-01", cancelled: true },
      { ...tourne, clientId: "c2", performedOn: "2026-11-02" },
      { ...tourne, clientId: "c2", performedOn: "2026-10-01", forfaitIncluded: true },
      { ...tourne, clientId: "c2", performedOn: "2026-10-01", forfaitIncluded: false },
    ];
    expect(filterUnclassifiedShootings(rows, books)).toEqual([]);
  });

  it("client inconnu des dossiers : jugé sans début de gestion ni facture, donc à classer", () => {
    /*
     * C'est ce qui arrive à un client désactivé, absent de la lecture : la
     * requête de la pastille l'écarte en amont, mais la règle ne doit pas
     * inventer un dossier vide pour autant — elle le signale, elle ne le tait pas.
     */
    const rows = [{ ...tourne, clientId: "inconnu", performedOn: "2026-09-14" }];
    expect(filterUnclassifiedShootings(rows, books)).toHaveLength(1);
  });

  it("lot vide : rien à classer, et donc pas de pastille", () => {
    expect(filterUnclassifiedShootings([], books)).toEqual([]);
  });
});
