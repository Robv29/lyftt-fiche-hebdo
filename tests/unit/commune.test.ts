import { describe, expect, it } from "vitest";
import { primaryCommune } from "@/lib/geo/commune";

describe("primaryCommune", () => {
  it("retient la première ville d'une saisie multiple", () => {
    expect(primaryCommune("MONT DE MARSAN ET DAX")).toBe("MONT DE MARSAN");
    expect(primaryCommune("MARSEILLE, NICE, BORDEAUX ET LYON")).toBe("MARSEILLE");
    expect(primaryCommune("Toulouse / Blagnac")).toBe("Toulouse");
  });

  it("ne coupe pas un nom de commune contenant « et »", () => {
    /*
     * Cas réels relevés dans le référentiel des communes : couper sur « et »
     * sans exiger d'espaces cherchait « Val- », qui n'existe pas.
     */
    for (const nom of [
      "Val-et-Châtillon",
      "Saint-Germain-et-Mons",
      "Saint-Jean-et-Saint-Paul",
      "Étaves-et-Bocquiaux",
      "Villers-Chemin-et-Mont-lès-Étrelles",
      "Champagne-et-Fontaine",
      "Ormes-et-Ville",
    ]) {
      expect(primaryCommune(nom)).toBe(nom);
    }
  });

  it("laisse intactes les communes sans séparateur", () => {
    expect(primaryCommune("Aix-en-Provence")).toBe("Aix-en-Provence");
    expect(primaryCommune("Étretat")).toBe("Étretat");
    expect(primaryCommune("Bourg-en-Bresse")).toBe("Bourg-en-Bresse");
  });

  it("rend une chaîne vide plutôt que d'inventer une commune", () => {
    expect(primaryCommune(null)).toBe("");
    expect(primaryCommune(undefined)).toBe("");
    expect(primaryCommune("   ")).toBe("");
  });

  it("nettoie les espaces autour", () => {
    expect(primaryCommune("  Toulouse  ")).toBe("Toulouse");
    expect(primaryCommune("Toulouse  et  Blagnac")).toBe("Toulouse");
  });
});
