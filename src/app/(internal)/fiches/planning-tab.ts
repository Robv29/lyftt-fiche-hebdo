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
