import { describe, expect, it } from "vitest";
import { matchesPublicationSearch } from "@/lib/domain/publication-search";

const item = {
  clientName: "Étienne Coffee Shop Castres",
  caption: "Le café de la rentrée est arrivé",
  hashtags: ["#castres", "#coffeelover"],
  formatLabel: "Reels",
  networks: ["Instagram", "Facebook"],
};

describe("recherche dans les publications", () => {
  it("trouve sans accents ni majuscules", () => {
    expect(matchesPublicationSearch(item, "etienne")).toBe(true);
    expect(matchesPublicationSearch(item, "CAFE rentree")).toBe(true);
  });

  it("cherche dans le client, le texte, les hashtags, le format et les réseaux", () => {
    expect(matchesPublicationSearch(item, "coffeelover")).toBe(true);
    expect(matchesPublicationSearch(item, "reels")).toBe(true);
    expect(matchesPublicationSearch(item, "facebook")).toBe(true);
  });

  it("chaque mot doit se retrouver, pas forcément au même endroit", () => {
    expect(matchesPublicationSearch(item, "castres reels")).toBe(true);
    expect(matchesPublicationSearch(item, "castres linkedin")).toBe(false);
  });

  it("une recherche vide garde tout, un texte absent ne gêne pas", () => {
    expect(matchesPublicationSearch(item, "   ")).toBe(true);
    expect(matchesPublicationSearch({ ...item, caption: null }, "castres")).toBe(true);
  });
});
