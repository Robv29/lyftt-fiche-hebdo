import type { AppRole, TicketStatus } from "./types";

/**
 * §10 — Machine à états des tickets.
 *
 * Deux garde-fous portés par cette table :
 *  - un ticket ne se ferme qu'après validation client ou décision interne explicite ;
 *  - graphistes et vidéastes ne peuvent pas renvoyer eux-mêmes au client (§22).
 */

export interface TicketTransition {
  from: TicketStatus;
  to: TicketStatus;
  label: string;
  /** Rôles autorisés à déclencher la transition. */
  allowedRoles: readonly AppRole[];
  /** Une justification écrite est obligatoire. */
  requiresReason?: boolean;
}

const EDITORIAL: readonly AppRole[] = [
  "super_admin",
  "production_manager",
  "community_manager",
];

const PRODUCTION: readonly AppRole[] = [
  "super_admin",
  "production_manager",
  "community_manager",
  "graphic_designer",
  "video_editor",
];

export const TICKET_TRANSITIONS: readonly TicketTransition[] = [
  { from: "new", to: "to_qualify", label: "Prendre en compte", allowedRoles: EDITORIAL },
  { from: "new", to: "out_of_scope", label: "Hors périmètre", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "to_qualify", to: "assigned", label: "Affecter", allowedRoles: EDITORIAL },
  { from: "to_qualify", to: "out_of_scope", label: "Hors périmètre", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "to_qualify", to: "billing_review", label: "Facturation à valider", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "to_qualify", to: "rejected", label: "Refuser", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "billing_review", to: "assigned", label: "Facturation validée, affecter", allowedRoles: EDITORIAL },
  { from: "billing_review", to: "rejected", label: "Refuser", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "assigned", to: "in_progress", label: "Prendre en charge", allowedRoles: PRODUCTION },
  { from: "assigned", to: "assigned", label: "Réaffecter", allowedRoles: EDITORIAL },
  { from: "in_progress", to: "ready_for_review", label: "Prêt à contrôler", allowedRoles: PRODUCTION },
  { from: "in_progress", to: "awaiting_client", label: "Attendre une précision du client", allowedRoles: EDITORIAL },
  { from: "awaiting_client", to: "in_progress", label: "Reprendre", allowedRoles: PRODUCTION },
  // Le contrôle éditorial appartient au community manager, pas à la production.
  { from: "ready_for_review", to: "internally_reviewed", label: "Valider le contrôle interne", allowedRoles: EDITORIAL },
  { from: "ready_for_review", to: "in_progress", label: "Renvoyer en correction", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "internally_reviewed", to: "new_version_generated", label: "Générer la version corrigée", allowedRoles: EDITORIAL },
  { from: "new_version_generated", to: "sent_back_to_client", label: "Renvoyer au client", allowedRoles: EDITORIAL },
  { from: "sent_back_to_client", to: "approved_by_client", label: "Validé par le client", allowedRoles: EDITORIAL },
  { from: "sent_back_to_client", to: "in_progress", label: "Nouvelle demande du client", allowedRoles: EDITORIAL },
  { from: "approved_by_client", to: "closed", label: "Fermer", allowedRoles: EDITORIAL },
  { from: "out_of_scope", to: "closed", label: "Fermer", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "rejected", to: "closed", label: "Fermer", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "cancelled", to: "closed", label: "Fermer", allowedRoles: EDITORIAL },
  // Réouverture après fermeture (§24).
  { from: "closed", to: "reopened", label: "Rouvrir", allowedRoles: EDITORIAL, requiresReason: true },
  { from: "reopened", to: "to_qualify", label: "Requalifier", allowedRoles: EDITORIAL },
];

/** Annulation possible depuis tout état non terminal. */
const CANCELLABLE_FROM: readonly TicketStatus[] = [
  "new",
  "to_qualify",
  "assigned",
  "in_progress",
  "ready_for_review",
  "awaiting_client",
  "billing_review",
];

export function availableTransitions(
  from: TicketStatus,
  role: AppRole,
): TicketTransition[] {
  const transitions = TICKET_TRANSITIONS.filter(
    (t) => t.from === from && t.allowedRoles.includes(role),
  );

  if (CANCELLABLE_FROM.includes(from) && EDITORIAL.includes(role)) {
    transitions.push({
      from,
      to: "cancelled",
      label: "Annuler",
      allowedRoles: EDITORIAL,
      requiresReason: true,
    });
  }

  return transitions;
}

export interface TransitionCheck {
  allowed: boolean;
  requiresReason: boolean;
  error?: string;
}

export function canTransition(
  from: TicketStatus,
  to: TicketStatus,
  role: AppRole,
): TransitionCheck {
  if (from === to) {
    const selfLoop = TICKET_TRANSITIONS.find(
      (t) => t.from === from && t.to === to && t.allowedRoles.includes(role),
    );
    if (!selfLoop) {
      return { allowed: false, requiresReason: false, error: "Statut inchangé." };
    }
    return { allowed: true, requiresReason: Boolean(selfLoop.requiresReason) };
  }

  const match = availableTransitions(from, role).find((t) => t.to === to);
  if (!match) {
    const existsForOtherRole = TICKET_TRANSITIONS.some(
      (t) => t.from === from && t.to === to,
    );
    return {
      allowed: false,
      requiresReason: false,
      error: existsForOtherRole
        ? "Votre rôle ne permet pas cette action."
        : "Transition impossible depuis ce statut.",
    };
  }

  return { allowed: true, requiresReason: Boolean(match.requiresReason) };
}

/** Le ticket pèse-t-il encore sur la fiche ? */
export function isTicketOpen(status: TicketStatus): boolean {
  return !["closed", "cancelled", "rejected", "approved_by_client"].includes(status);
}

/** Le ticket attend-il une action de la production ? */
export function isAwaitingProduction(status: TicketStatus): boolean {
  return ["assigned", "in_progress"].includes(status);
}
