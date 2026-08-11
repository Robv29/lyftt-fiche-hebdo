import { describe, expect, it } from "vitest";
import { canConfirmPublication, missingNetworks, publicationReadiness } from "../../src/lib/domain/publication-checklist";

describe("publicationReadiness",()=>{
  it("passe au vert uniquement après média et copie",()=>{
    expect(publicationReadiness({mediaRequired:true,mediaAvailable:true,mediaDownloaded:false,contentCopied:false},"media").published).toBe(false);
    expect(publicationReadiness({mediaRequired:true,mediaAvailable:true,mediaDownloaded:true,contentCopied:false},"content").published).toBe(true);
  });
  it("ne demande pas de média pour un texte seul",()=>{
    expect(publicationReadiness({mediaRequired:false,mediaAvailable:false,mediaDownloaded:false,contentCopied:false},"content").published).toBe(true);
  });
  it("bloque un téléchargement sans média",()=>{
    expect(publicationReadiness({mediaRequired:true,mediaAvailable:false,mediaDownloaded:false,contentCopied:true},"media")).toEqual({allowed:false,published:false});
  });
});

describe("confirmation de publication", () => {
  it("attend que le média soit téléchargé et le texte copié", () => {
    expect(canConfirmPublication({ mediaRequired: true, mediaDownloaded: false, contentCopied: true })).toBe(false);
    expect(canConfirmPublication({ mediaRequired: true, mediaDownloaded: true, contentCopied: false })).toBe(false);
    expect(canConfirmPublication({ mediaRequired: true, mediaDownloaded: true, contentCopied: true })).toBe(true);
  });

  it("n'exige aucun média pour un texte seul", () => {
    expect(canConfirmPublication({ mediaRequired: false, mediaDownloaded: false, contentCopied: true })).toBe(true);
  });
});

describe("réseaux restants", () => {
  it("liste ce qui n'a pas encore été publié", () => {
    expect(missingNetworks(["instagram", "facebook", "tiktok"], ["instagram"]))
      .toEqual(["facebook", "tiktok"]);
  });

  it("ne renvoie rien quand tout est publié", () => {
    expect(missingNetworks(["instagram"], ["instagram", "facebook"])).toEqual([]);
  });

  it("ne renvoie rien sans réseau prévu", () => {
    expect(missingNetworks([], ["instagram"])).toEqual([]);
  });
});
