import { nextDay, todayInParis } from "./client-lifecycle";

/**
 * Urgence d'une commande de production.
 *
 * Deux états seulement, et une seule définition pour toute l'application : la
 * pastille de la navigation, la carte de la commande et le sous-menu doivent
 * dire la même chose. Deux calculs séparés finissent toujours par diverger —
 * une pastille qui s'allume sans qu'aucune carte ne s'explique.
 */
export type ProductionUrgency =
  /** L'échéance est passée. */
  | "overdue"
  /** L'échéance tombe demain : dernier jour utile pour s'y mettre. */
  | "due_tomorrow"
  | null;

/**
 * Une commande livrée ou validée n'a plus d'échéance qui vaille : elle est
 * faite. Ne reste que ce qui est encore à produire.
 */
export function productionUrgency(
  request: { dueOn: string; status: "a_faire" | "livree" | "validee" },
  today: string = todayInParis(),
): ProductionUrgency {
  if (request.status !== "a_faire") return null;
  if (request.dueOn < today) return "overdue";
  if (request.dueOn === nextDay(today)) return "due_tomorrow";
  return null;
}
