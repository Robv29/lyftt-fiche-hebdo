import { describe, expect, it } from "vitest";
import { recommendHashtags } from "../../src/lib/domain/hashtags";

describe("recommendHashtags", () => {
  it("combine la marque, le métier, la ville et les mots-clés sans doublon", () => {
    const tags = recommendHashtags({ brand:"Canal du Midi", activity:"Restaurant", city:"Toulouse", audience:"familles", keywords:"terrasse, cuisine maison, terrasse" });
    expect(tags).toContain("#CanalDuMidi");
    expect(tags).toContain("#Restaurant");
    expect(tags).toContain("#Toulouse");
    expect(tags).toContain("#CuisineMaison");
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("retire les accents et respecte la limite", () => {
    const tags = recommendHashtags({ brand:"L'été doré", activity:"Beauté", city:"Montauban", audience:"jeunes adultes", keywords:"été, beauté, détente" }, 5);
    expect(tags).toHaveLength(5);
    expect(tags.every((value) => !/[éèêà]/i.test(value))).toBe(true);
  });
});
