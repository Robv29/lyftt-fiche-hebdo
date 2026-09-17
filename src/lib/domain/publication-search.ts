/**
 * Recherche dans les publications du jour.
 *
 * Insensible aux accents et à la casse : on tape « etienne » pour trouver
 * « Étienne », « cafe » pour « café ». Chaque mot doit se retrouver quelque
 * part — client, texte, hashtags, format ou réseaux — sans forcément au même
 * endroit : « muratet reels » trouve le reel de Muratet.
 */

export interface SearchablePublication {
  clientName: string;
  caption: string | null;
  hashtags: readonly string[];
  formatLabel: string;
  networks: readonly string[];
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").trim();
}

export function matchesPublicationSearch(item: SearchablePublication, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearch([
    item.clientName,
    item.caption ?? "",
    item.hashtags.join(" "),
    item.formatLabel,
    item.networks.join(" "),
  ].join(" "));
  return words.every((word) => haystack.includes(word));
}
