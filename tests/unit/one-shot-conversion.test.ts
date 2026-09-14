import { describe, expect, it } from "vitest";
import { oneShotConversionCheck } from "@/lib/domain/one-shot-conversion";

const base = {
  kind: "gestion" as const,
  hadSheets: false,
  issuedInvoices: 0,
  managementMonths: 0,
  managementTotalCents: 0,
  confirmedMonths: null,
};

describe("passage d'un client en prestation ponctuelle", () => {
  it("accepte sans détour un client en gestion qui n'a rien d'inscrit", () => {
    expect(oneShotConversionCheck(base)).toEqual({ status: "allowed" });
  });

  it("refuse un client qui a déjà eu des fiches, même effacées depuis", () => {
    expect(oneShotConversionCheck({ ...base, hadSheets: true }).status).toBe("refused");
  });

  it("refuse un client déjà facturé pour sa gestion", () => {
    expect(oneShotConversionCheck({ ...base, issuedInvoices: 1 }).status).toBe("refused");
  });

  it("demande de confirmer le nombre exact de mois retirés, chiffres à l'appui", () => {
    const check = oneShotConversionCheck({ ...base, managementMonths: 5, managementTotalCents: 58_725 });
    expect(check.status).toBe("confirm");
    if (check.status !== "confirm") return;
    expect(check.months).toBe(5);
    expect(check.message).toContain("5 mois de gestion inscrits");
    expect(check.message).toContain("587,25");
    expect(check.message).toContain("seront retirés");
  });

  it("accepte une fois le bon nombre confirmé, pas un nombre périmé", () => {
    const months = { ...base, managementMonths: 5, managementTotalCents: 58_725 };
    expect(oneShotConversionCheck({ ...months, confirmedMonths: 5 })).toEqual({ status: "allowed" });
    // Formulaire resté ouvert : un sixième mois s'est inscrit depuis la confirmation.
    expect(oneShotConversionCheck({ ...months, managementMonths: 6, confirmedMonths: 5 }).status).toBe("confirm");
  });

  it("accorde le singulier pour un seul mois", () => {
    const check = oneShotConversionCheck({ ...base, managementMonths: 1, managementTotalCents: 13_050 });
    expect(check.status === "confirm" && check.message).toContain("1 mois de gestion inscrit (");
    expect(check.status === "confirm" && check.message).toContain("sera retiré de");
  });

  it("n'a rien à vérifier pour un client déjà ponctuel", () => {
    expect(oneShotConversionCheck({ ...base, kind: "ponctuel", hadSheets: true, issuedInvoices: 3 }))
      .toEqual({ status: "allowed" });
  });
});
