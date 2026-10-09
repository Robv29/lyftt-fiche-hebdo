import { getTicketTypeDefinition, type TicketType } from "./ticket-types";
import type { AppRole, AssignmentRole, TicketCategory, TicketPriority } from "./types";

/**
 * §7 — Routage automatique des tickets.
 *
 * Les règles sont des données, pas du code : elles peuvent être modifiées en
 * base ou en configuration sans retoucher la logique d'évaluation.
 */

export interface RoutingRule {
  id: string;
  /** Catégories concernées ; absent = toutes. */
  categories?: readonly TicketCategory[];
  role: AppRole;
  assignmentRole: AssignmentRole;
  reason: string;
}

export const DEFAULT_ROUTING_RULES: readonly RoutingRule[] = [
  {
    id: "cm-always-owner",
    role: "community_manager",
    assignmentRole: "owner",
    reason: "Le community manager reste responsable éditorial de chaque demande.",
  },
  {
    id: "graphic-to-designer",
    categories: ["graphic"],
    role: "graphic_designer",
    assignmentRole: "contributor",
    reason: "Demande portant sur un visuel ou une création graphique.",
  },
  {
    id: "video-to-editor",
    categories: ["video"],
    role: "video_editor",
    assignmentRole: "contributor",
    reason: "Demande portant sur un montage vidéo.",
  },
];

/** Conditions déclenchant la notification du responsable de production (§7). */
export interface EscalationContext {
  priority: TicketPriority;
  /** La demande touche plusieurs contenus. */
  affectsMultipleItems?: boolean;
  /** Le client demande un contenu supplémentaire. */
  requestsAdditionalContent?: boolean;
  /** La demande est arrivée après l'échéance de validation. */
  submittedAfterDeadline?: boolean;
  /** Le ticket a déjà été fermé puis rouvert. */
  isReopened?: boolean;
  /** Le délai de correction est dépassé. */
  correctionOverdue?: boolean;
}

export interface EscalationCheck {
  escalate: boolean;
  reasons: string[];
}

export function evaluateEscalation(
  type: TicketType,
  context: EscalationContext,
): EscalationCheck {
  const def = getTicketTypeDefinition(type);
  const reasons: string[] = [];

  if (context.priority === "urgent") {
    reasons.push("Ticket urgent");
  }
  if (context.affectsMultipleItems) {
    reasons.push("La modification touche plusieurs contenus");
  }
  if (context.requestsAdditionalContent || def.mayAffectScope) {
    reasons.push("La demande peut modifier le périmètre commercial");
  }
  if (context.submittedAfterDeadline) {
    reasons.push("Demande reçue après l'échéance de validation");
  }
  if (context.isReopened) {
    reasons.push("Ticket rouvert");
  }
  if (context.correctionOverdue) {
    reasons.push("Délai de correction dépassé");
  }

  return { escalate: reasons.length > 0, reasons };
}

export interface RoutingTarget {
  role: AppRole;
  assignmentRole: AssignmentRole;
  reason: string;
}

export interface RoutingResult {
  targets: RoutingTarget[];
  escalation: EscalationCheck;
}

/**
 * Détermine les rôles à affecter. Le résultat est une proposition : le
 * community manager peut toujours réaffecter (§10).
 */
export function routeTicket(
  type: TicketType,
  context: EscalationContext,
  rules: readonly RoutingRule[] = DEFAULT_ROUTING_RULES,
): RoutingResult {
  const def = getTicketTypeDefinition(type);

  const targets: RoutingTarget[] = rules
    .filter((rule) => !rule.categories || rule.categories.includes(def.category))
    .map((rule) => ({
      role: rule.role,
      assignmentRole: rule.assignmentRole,
      reason: rule.reason,
    }));

  const escalation = evaluateEscalation(type, context);
  if (escalation.escalate) {
    targets.push({
      role: "production_manager",
      assignmentRole: "watcher",
      reason: escalation.reasons.join(" · "),
    });
  }

  return { targets, escalation };
}

/**
 * Rôles d'encadrement, dans l'ordre où l'on se rabat sur eux.
 *
 * Ils ne sont *pas* une cible de routage : ils ne servent qu'à ne perdre
 * personne quand le rôle visé n'existe dans aucun profil.
 */
export const LEAD_FALLBACK_ROLES: readonly AppRole[] = ["super_admin", "production_manager"];

/**
 * Repli d'affectation quand aucun profil ne porte le rôle visé.
 *
 * Constat en base : le rôle `community_manager` n'est porté par aucun profil —
 * il n'existe que comme rôle d'affectation sur un client. Tant que chaque
 * client a bien sa ligne d'affectation, la recherche principale aboutit ; mais
 * un client créé sans elle produisait un ticket sans responsable, sans
 * notification et sans e-mail, et personne n'en savait rien.
 *
 * Le repli ne vaut que pour le responsable (`owner`). Un ticket sans
 * contributeur reste visible par son responsable, qui peut l'affecter ; un
 * ticket sans responsable, lui, n'est vu de personne. Désigner d'office un
 * dirigeant comme contributeur d'un visuel aurait au contraire faussé la
 * charge de chacun.
 */
export function fallbackRolesFor(
  target: Pick<RoutingTarget, "role" | "assignmentRole">,
): AppRole[] {
  if (target.assignmentRole !== "owner") return [];
  return LEAD_FALLBACK_ROLES.filter((role) => role !== target.role);
}

/**
 * Une correction purement rédactionnelle ne doit jamais partir en production
 * (scénarios 9 et 10 de la spec).
 */
export function requiresProduction(type: TicketType): boolean {
  const category = getTicketTypeDefinition(type).category;
  return category === "graphic" || category === "video";
}
