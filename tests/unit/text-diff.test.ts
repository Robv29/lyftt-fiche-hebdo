import { describe, expect, it } from "vitest";
import { diffWords, excerptAround, summarizeDiff } from "@/lib/domain/text-diff";

const render = (segments: ReturnType<typeof diffWords>) =>
  segments
    .map((s) => (s.op === "equal" ? s.value : `[${s.op === "insert" ? "+" : "-"}${s.value}]`))
    .join("");

describe("§12 — comparaison des textes", () => {
  it("isole le mot corrigé", () => {
    const segments = diffWords(
      "Des souvenirs d'été à la guingette",
      "Des souvenirs d'été à la guinguette",
    );

    expect(render(segments)).toBe("Des souvenirs d'été à la [-guingette][+guinguette]");
  });

  it("ne signale aucun changement sur un texte identique", () => {
    const segments = diffWords("Bonjour tout le monde", "Bonjour tout le monde");

    expect(segments.every((s) => s.op === "equal")).toBe(true);
    expect(summarizeDiff(segments)).toEqual({
      hasChanges: false,
      wordsAdded: 0,
      wordsRemoved: 0,
    });
  });

  it("compte les mots ajoutés et supprimés", () => {
    const segments = diffWords(
      "Rendez-vous à 18h",
      "Rendez-vous à 19h au bord du canal",
    );
    const summary = summarizeDiff(segments);

    expect(summary.hasChanges).toBe(true);
    expect(summary.wordsAdded).toBeGreaterThan(0);
    expect(summary.wordsRemoved).toBeGreaterThan(0);
  });

  it("gère un texte vidé", () => {
    const segments = diffWords("Ancien texte", "");
    expect(segments.every((s) => s.op === "delete")).toBe(true);
  });

  it("gère un texte créé de toutes pièces", () => {
    const segments = diffWords("", "Nouveau texte");
    expect(segments.every((s) => s.op === "insert")).toBe(true);
  });

  it("conserve les sauts de ligne des légendes", () => {
    const before = "Des souvenirs d'été\n@uneteaalacampagne\n#Guinguette";
    const after = "Des souvenirs d'été\n@uneteaalacampagne\n#Guinguette #Montauban";
    const segments = diffWords(before, after);

    expect(render(segments)).toContain("[+ #Montauban]");
  });

  it("restitue le contexte autour d'une portion sélectionnée par le client", () => {
    const caption =
      "Des souvenirs d'été @uneteaalacampagne 1987 Rte d'Auch, 82000 Montauban #Guinguette";

    expect(excerptAround(caption, "1987 Rte d'Auch", 10)).toBe(
      "…acampagne 1987 Rte d'Auch, 82000 Mo…",
    );
    expect(excerptAround(caption, "introuvable")).toBeNull();
  });
});
