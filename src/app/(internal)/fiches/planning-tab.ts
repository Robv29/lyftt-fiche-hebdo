export type PlanningTab = "past" | "current" | "next";

const TAB_IDS: readonly PlanningTab[] = ["past", "current", "next"];

/*
 * Le garde vit dans ce module neutre, pas dans `PlanningTabs.tsx` : les exports
 * d'un fichier « use client » deviennent des références client, et les appeler
 * depuis la page (composant serveur) lève une erreur à l'exécution — invisible
 * au build, la route étant dynamique.
 */
export function isPlanningTab(value: string | undefined): value is PlanningTab {
  return TAB_IDS.includes(value as PlanningTab);
}

/**
 * Lien de retour vers le planning, sur l'onglet de la période d'une fiche.
 *
 * Un `/fiches` en dur ramenait toujours sur « Cette semaine » : ouvrir une
 * fiche depuis « Semaine prochaine » puis revenir faisait perdre l'onglet.
 * La période se déduit de la fiche elle-même, pas du chemin parcouru — le
 * retour est donc juste même en arrivant par un lien direct ou un favori.
 *
 * `later` n'a pas d'onglet à lui : une fiche au-delà de la semaine prochaine
 * n'apparaît dans aucune liste, et « Semaine prochaine » en est le plus proche.
 * `current` est l'onglet par défaut : inutile de le nommer dans l'URL.
 */
export function planningHrefForBucket(bucket: "past" | "current" | "next" | "later"): string {
  if (bucket === "current") return "/fiches";
  return `/fiches?tab=${bucket === "later" ? "next" : bucket}`;
}
