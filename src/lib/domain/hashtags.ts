export interface HashtagProfile {
  brand: string;
  activity: string;
  city: string;
  audience: string;
  keywords: string;
}

const SECTOR_TAGS: Record<string, string[]> = {
  restaurant: ["Restaurant", "FoodLovers", "CuisineMaison", "BonnesAdresses"],
  bar: ["Bar", "Afterwork", "Sortir", "Convivialite"],
  artisan: ["Artisan", "SavoirFaire", "FaitMain", "ArtisanatFrancais"],
  immobilier: ["Immobilier", "ProjetImmobilier", "Maison", "ConseilImmobilier"],
  beaute: ["Beaute", "BienEtre", "PrendreSoinDeSoi", "InstitutDeBeaute"],
  coiffure: ["Coiffure", "HairStyle", "SalonDeCoiffure", "InspirationCoiffure"],
  sport: ["Sport", "Fitness", "Motivation", "Bouger"],
  tourisme: ["Tourisme", "VoyageEnFrance", "Decouverte", "Escapade"],
  hotel: ["Hotel", "Sejour", "Hospitalite", "WeekendEnFrance"],
  commerce: ["CommerceLocal", "AcheterLocal", "Proximite", "EntrepriseLocale"],
};

function words(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 1);
}

function tag(value: string): string {
  const parts = words(value);
  return parts.length ? `#${parts.map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase()).join("")}` : "";
}

/** Recommandation déterministe : marque + métier + zone + intention, sans API externe. */
export function recommendHashtags(profile: HashtagProfile, limit = 18): string[] {
  const activity = words(profile.activity).join(" ").toLowerCase();
  const sector = Object.entries(SECTOR_TAGS).find(([key]) => activity.includes(key))?.[1] ?? ["EntrepriseLocale", "SavoirFaire", "Proximite"];
  const candidates = [
    tag(profile.brand),
    tag(profile.activity),
    tag(profile.city),
    ...sector.map((value) => `#${value}`),
    ...profile.keywords.split(/[,;\n]/).map(tag),
    ...profile.audience.split(/[,;\n]/).slice(0, 3).map(tag),
    tag(`${profile.activity} ${profile.city}`),
    tag(`Sortir ${profile.city}`),
    "#LYFTT",
  ];
  return [...new Set(candidates.filter((value) => value.length > 3))].slice(0, limit);
}
