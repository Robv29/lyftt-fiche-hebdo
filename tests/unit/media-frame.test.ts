import { describe, expect, it } from "vitest";
import { mediaFrame, mediaFrameBackground, mediaFrameClass } from "@/lib/domain/media-frame";
import { MEDIA_FORMATS } from "@/lib/domain/types";

describe("cadre d'aperçu", () => {
  it("affiche les formats téléphone en vertical", () => {
    expect(mediaFrame("story")).toBe("vertical");
    expect(mediaFrame("reels")).toBe("vertical");
    expect(mediaFrame("video")).toBe("vertical");
  });

  it("garde le carré pour les formats de feed", () => {
    expect(mediaFrame("photo")).toBe("square");
    expect(mediaFrame("visuel")).toBe("square");
    expect(mediaFrame("carrousel")).toBe("square");
    expect(mediaFrame("texte_seul")).toBe("square");
  });

  it("donne un cadre à chaque format connu", () => {
    for (const format of MEDIA_FORMATS) {
      expect(mediaFrameClass(format)).toMatch(/^aspect-/);
      expect(mediaFrameBackground(format)).toMatch(/^bg-/);
    }
  });

  it("pose les verticaux sur du noir", () => {
    expect(mediaFrameBackground("story")).toBe("bg-black");
    expect(mediaFrameBackground("photo")).toBe("bg-canvas");
  });
});
