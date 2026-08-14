import { describe, expect, it } from "vitest";
import {
  buildClientHashtagLibrary,
  hashtagsForClientType,
  LYFTT_CLIENT_TYPE_IDS,
  normalizeHashtag,
} from "../../src/lib/domain/hashtags";

describe("bibliothèque de hashtags LYFTT", () => {
  it.each(LYFTT_CLIENT_TYPE_IDS)("propose exactement 15 hashtags uniques pour %s", (clientType) => {
    const tags = hashtagsForClientType(clientType);

    expect(tags).toHaveLength(15);
    expect(new Set(tags.map((tag) => tag.toLowerCase())).size).toBe(15);
    expect(tags.every((tag) => /^#[A-Za-z0-9]+$/.test(tag))).toBe(true);
  });

  it("nettoie les hashtags saisis manuellement", () => {
    expect(normalizeHashtag("  #été en terrasse  ")).toBe("#EteEnTerrasse");
    expect(normalizeHashtag("nom_du_client")).toBe("#NomDuClient");
  });

  it("réunit les 15 hashtags métier et les 5 hashtags client", () => {
    const tags = buildClientHashtagLibrary("restaurant", [
      "Canal du Midi",
      "Brigitte cuisine",
      "Terrasse du Canal",
      "Menu du Midi",
      "Cassoulet maison",
    ]);

    expect(tags).toHaveLength(20);
    expect(tags.slice(-5)).toEqual([
      "#CanalDuMidi",
      "#BrigitteCuisine",
      "#TerrasseDuCanal",
      "#MenuDuMidi",
      "#CassouletMaison",
    ]);
  });

  it("supprime les doublons sans appel externe", () => {
    const tags = buildClientHashtagLibrary("restaurant", ["Restaurant", "Restaurant", "Maison", "Local", "Canal"]);
    expect(tags.filter((tag) => tag.toLowerCase() === "#restaurant")).toHaveLength(1);
  });
});

describe("hashtags de métier", () => {
  it("ne porte aucun nom de ville", () => {
    /*
     * Ces listes servent des clients répartis sur des communes différentes :
     * un hashtag de ville y serait faux pour la plupart d'entre eux.
     */
    // Le nom doit former un mot entier : « Agencement » n'est pas « Agen ».
    const villes = /(Toulouse|Montauban|Castres|Albi|Agen|Paris|Bordeaux)(?![a-z])/;
    for (const type of LYFTT_CLIENT_TYPE_IDS) {
      for (const hashtag of hashtagsForClientType(type)) {
        expect(hashtag, `${type} : ${hashtag}`).not.toMatch(villes);
      }
    }
  });
});
