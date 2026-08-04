import { describe, expect, it } from "vitest";
import { publicationReadiness } from "../../src/lib/domain/publication-checklist";

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
