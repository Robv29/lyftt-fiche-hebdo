/**
 * Le plan de charge de la production : qui peut agir, et comment classer.
 *
 * Depuis que chacun voit les commandes de tous, deux questions se posent à
 * chaque carte, et elles n'ont qu'une réponse chacune dans toute
 * l'application :
 *
 *   1. « Qui est concerné par cette commande ? » — le demandeur, la personne à
 *      qui elle est confiée, et l'encadrement. Les autres la lisent, sans un
 *      seul bouton. Cette règle est appliquée par les actions serveur autant
 *      que par l'écran : cacher un bouton n'a jamais empêché personne d'appeler
 *      l'action. La base, elle, garde le dernier mot — `production_requests_write`
 *      reste bornée au périmètre client.
 *
 *   2. « Dans quel ordre, et quoi montrer ? » — une file qui portait les
 *      commandes d'un seul périmètre en porte maintenant celles de l'agence.
 *      Sans tri ni filtre, elle cesse d'être utilisable le jour où elle devient
 *      complète.
 *
 * Module pur : aucune lecture, aucun accès réseau, testable seul.
 */

import type { AppRole } from "./types";
import type { ProductionRequestStatus } from "./production-requests";
import { UNKNOWN_PERSON_KEY } from "./production-requests";
import type { ProductionUrgency } from "./production";

// ---------------------------------------------------------------------------
// Qui peut agir sur une commande
// ---------------------------------------------------------------------------

/**
 * L'encadrement, au sens des commandes de production : il valide, rouvre,
 * retire et réaffecte n'importe quelle commande.
 *
 * Volontairement plus étroit que `EDITORIAL_ROLES` : le community manager
 * décide de *ses* commandes, pas de celles des autres. Les actions serveur
 * employaient jusqu'ici deux définitions divergentes — `EDITORIAL_ROLES` pour
 * l'affectation, `["super_admin", "production_manager"]` pour la validation et
 * le retrait. Une seule subsiste, ici.
 */
export const PRODUCTION_LEAD_ROLES: readonly AppRole[] = ["super_admin", "production_manager"];

export interface ProductionViewer {
  id: string;
  role: AppRole;
}

/** Les seules colonnes dont la règle a besoin. */
export interface ProductionRequestParties {
  requestedBy: string | null;
  assignedTo: string | null;
  status: ProductionRequestStatus;
}

export interface ProductionRequestRights {
  /** La commande a été passée par la personne qui regarde. */
  isRequester: boolean;
  /** Elle lui est confiée. */
  isAssignee: boolean;
  isLead: boolean;
  /** Concernée à un titre ou à un autre : elle n'est pas en simple lecture. */
  isConcerned: boolean;
  /**
   * Qui décide du sort de la commande : son demandeur et l'encadrement. La
   * personne à qui elle est confiée produit, elle ne valide pas son propre
   * travail.
   */
  mayDecide: boolean;
  canDeliver: boolean;
  canValidate: boolean;
  canReopen: boolean;
  canDelete: boolean;
  canReassign: boolean;
}

const NO_RIGHTS: ProductionRequestRights = {
  isRequester: false,
  isAssignee: false,
  isLead: false,
  isConcerned: false,
  mayDecide: false,
  canDeliver: false,
  canValidate: false,
  canReopen: false,
  canDelete: false,
  canReassign: false,
};

/**
 * Droits d'une personne sur une commande.
 *
 * Unique définition : l'écran s'en sert pour n'afficher que des boutons qui
 * marchent, les six actions serveur pour refuser tout le reste.
 */
export function productionRequestRights(
  request: ProductionRequestParties,
  viewer: ProductionViewer | null,
): ProductionRequestRights {
  if (!viewer) return NO_RIGHTS;

  const isRequester = Boolean(request.requestedBy) && request.requestedBy === viewer.id;
  const isAssignee = Boolean(request.assignedTo) && request.assignedTo === viewer.id;
  const isLead = PRODUCTION_LEAD_ROLES.includes(viewer.role);
  const mayDecide = isRequester || isLead;

  return {
    isRequester,
    isAssignee,
    isLead,
    isConcerned: isRequester || isAssignee || isLead,
    mayDecide,
    // Livrer, c'est produire : le demandeur peut déposer lui-même ce qu'il a
    // sous la main, l'affectataire livre son travail. Une commande validée est
    // close — la rouvrir d'abord.
    canDeliver: (isRequester || isAssignee || isLead) && request.status !== "validee",
    canValidate: mayDecide && request.status === "livree",
    canReopen: mayDecide && request.status !== "a_faire",
    canDelete: mayDecide,
    // Tant que rien n'est livré : après, l'historique doit dire à qui la
    // commande était confiée quand elle a été rendue.
    canReassign: mayDecide && request.status === "a_faire",
  };
}

// ---------------------------------------------------------------------------
// Classer la file
// ---------------------------------------------------------------------------

/** Recherche insensible aux accents et à la casse : « aneto » doit trouver « Ánetô ». */
export function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Ce que la file montre : un sous-ensemble, choisi d'un geste. */
export type BoardScope = "toutes" | "pour_vous" | "mes_demandes" | "a_confier" | "en_retard";

export type BoardSort = "echeance" | "echeance_tard" | "client" | "personne" | "recentes";

export const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  echeance: "Échéance (au plus tôt)",
  echeance_tard: "Échéance (au plus tard)",
  client: "Client (A→Z)",
  personne: "Personne (A→Z)",
  recentes: "Plus récentes d’abord",
};

/** Ce qu'une ligne doit porter pour être classée. */
export interface BoardRow {
  clientId: string;
  clientName: string;
  title: string;
  dueOn: string;
  createdAt: string;
  status: ProductionRequestStatus;
  urgency: ProductionUrgency;
  assignedToId: string | null;
  assigneeLabel: string | null;
  /** Commande passée par la personne qui regarde. */
  isMine: boolean;
  /** Commande confiée à la personne qui regarde. */
  assignedToViewer: boolean;
}

export interface BoardFilters {
  /** Client, intitulé : ce qu'on tape quand on cherche « la vidéo de Muratet ». */
  query: string;
  /** Identifiant de client, ou "" pour tous. */
  clientId: string;
  /** Identifiant d'affectataire, `UNKNOWN_PERSON_KEY` pour « non confiée », ou "" pour tout le monde. */
  person: string;
  /** Statut, ou "" pour tous. Une commande validée ne figure jamais dans la file. */
  status: "" | "a_faire" | "livree";
}

export const EMPTY_BOARD_FILTERS: BoardFilters = { query: "", clientId: "", person: "", status: "" };

/** Clé de la personne à qui la commande est confiée, pour le filtre. */
export function assigneeKey(row: Pick<BoardRow, "assignedToId">): string {
  return row.assignedToId ?? UNKNOWN_PERSON_KEY;
}

/** La ligne entre-t-elle dans la vue choisie par les pastilles ? */
export function inBoardScope(row: BoardRow, scope: BoardScope): boolean {
  switch (scope) {
    case "toutes": return true;
    case "pour_vous": return row.assignedToViewer;
    case "mes_demandes": return row.isMine;
    case "a_confier": return row.status === "a_faire" && !row.assignedToId;
    case "en_retard": return row.urgency === "overdue";
  }
}

/** La ligne passe-t-elle la barre de recherche et les trois menus ? */
export function matchesBoardFilters(row: BoardRow, filters: BoardFilters): boolean {
  if (filters.clientId && row.clientId !== filters.clientId) return false;
  if (filters.person && assigneeKey(row) !== filters.person) return false;
  if (filters.status && row.status !== filters.status) return false;

  const needle = normalize(filters.query.trim());
  if (!needle) return true;
  // Client et intitulé : les deux façons dont on désigne une commande de vive voix.
  return normalize(`${row.clientName} ${row.title}`).includes(needle);
}

/**
 * Tri de la file. L'échéance au plus tôt est l'ordre par défaut — c'est celui
 * du serveur, et celui qui dit quoi faire maintenant. Les autres répondent à
 * une question précise : tout ce qui concerne un client, tout ce qui revient à
 * une personne, ce qui vient d'arriver.
 */
export function sortBoard<T extends BoardRow>(rows: readonly T[], sort: BoardSort): T[] {
  const byDue = (a: T, b: T) => a.dueOn.localeCompare(b.dueOn);
  // Un départage stable : sans lui, deux commandes du même jour changent de
  // place d'un rendu à l'autre, et l'œil croit que la liste a bougé.
  const tie = (a: T, b: T) => a.clientName.localeCompare(b.clientName, "fr") || a.title.localeCompare(b.title, "fr");

  const compare: Record<BoardSort, (a: T, b: T) => number> = {
    echeance: (a, b) => byDue(a, b) || tie(a, b),
    echeance_tard: (a, b) => byDue(b, a) || tie(a, b),
    client: (a, b) => a.clientName.localeCompare(b.clientName, "fr") || byDue(a, b) || tie(a, b),
    // Les commandes que personne n'a prises ferment la liste : elles n'ont pas de nom.
    personne: (a, b) => Number(a.assigneeLabel === null) - Number(b.assigneeLabel === null)
      || (a.assigneeLabel ?? "").localeCompare(b.assigneeLabel ?? "", "fr")
      || byDue(a, b) || tie(a, b),
    recentes: (a, b) => b.createdAt.localeCompare(a.createdAt) || tie(a, b),
  };

  return [...rows].sort(compare[sort]);
}
