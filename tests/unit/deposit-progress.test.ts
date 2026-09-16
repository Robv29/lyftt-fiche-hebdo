import { describe, expect, it } from "vitest";
import { contentBucketProgress, contentBucketStatuses, depositSummary, visualsValidationState } from "@/lib/domain/planning";

const photo = (overrides: Partial<{ caption: string | null; hashtags: string[] | null; mediaAssetId: string | null; isCancelled: boolean }> = {}) => ({
  format: "photo" as const, caption: null, hashtags: null, mediaAssetId: null, mediaExternalUrl: null, isCancelled: false, ...overrides,
});

describe("fichiers et textes suivis séparément", () => {
  it("un fichier déposé se voit même quand le texte manque", () => {
    const items = [photo({ mediaAssetId: "m1" })];
    expect(contentBucketProgress(items).photo).toEqual({ files: "ready", texts: "pending" });
    // La famille n'est « prête » qu'avec les deux : la règle d'ensemble ne change pas.
    expect(contentBucketStatuses(items).photo).toBe("pending");
  });

  it("un texte rédigé se voit même quand le fichier manque", () => {
    const items = [photo({ caption: "Légende", hashtags: ["#lyftt"] })];
    expect(contentBucketProgress(items).photo).toEqual({ files: "pending", texts: "ready" });
  });

  it("les deux réunis rendent la famille prête", () => {
    const items = [photo({ caption: "Légende", hashtags: ["#lyftt"], mediaAssetId: "m1" })];
    expect(contentBucketProgress(items).photo).toEqual({ files: "ready", texts: "ready" });
    expect(contentBucketStatuses(items).photo).toBe("ready");
  });

  it("un texte seul n'a aucun fichier à déposer ; une story n'attend que ses hashtags", () => {
    const texte = { format: "texte_seul" as const, caption: "Post", hashtags: ["#a"], mediaAssetId: null, mediaExternalUrl: null };
    expect(contentBucketProgress([texte]).texte).toEqual({ files: "none", texts: "ready" });
    const story = { format: "story" as const, caption: null, hashtags: ["#a"], mediaAssetId: "m2", mediaExternalUrl: null };
    expect(contentBucketProgress([story]).story).toEqual({ files: "ready", texts: "ready" });
  });

  it("compte ce qui reste à déposer et à rédiger, sans les contenus annulés", () => {
    const items = [
      photo({ mediaAssetId: "m1" }),
      photo({ caption: "Légende", hashtags: ["#a"] }),
      photo({ isCancelled: true }),
      { format: "texte_seul" as const, caption: null, hashtags: null, mediaAssetId: null, mediaExternalUrl: null },
    ];
    expect(depositSummary(items)).toEqual({ filesTotal: 2, filesMissing: 1, textsTotal: 3, textsMissing: 2 });
  });
});

describe("validation des visuels", () => {
  const deposit = (filesTotal: number, filesMissing: number) => ({ filesTotal, filesMissing, textsTotal: 3, textsMissing: 3 });

  it("ne se propose qu'une fois tous les fichiers déposés, textes ou pas", () => {
    expect(visualsValidationState(deposit(3, 1), null)).toBe("missing");
    expect(visualsValidationState(deposit(3, 0), null)).toBe("to_validate");
    expect(visualsValidationState(deposit(3, 0), "2026-09-16T10:00:00Z")).toBe("validated");
  });

  it("une validation ne couvre pas un fichier manquant", () => {
    expect(visualsValidationState(deposit(3, 1), "2026-09-16T10:00:00Z")).toBe("missing");
  });

  it("une fiche sans fichier attendu n'a rien à valider", () => {
    expect(visualsValidationState(deposit(0, 0), null)).toBe("no_files");
  });
});
