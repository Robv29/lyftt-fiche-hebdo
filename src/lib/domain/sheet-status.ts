import { isTicketOpen } from "./workflow";
import type { ItemApprovalStatus, SheetStatus, TicketStatus } from "./types";

/**
 * §15 — Agrégation du statut de la fiche.
 *
 * Reproduit `recompute_sheet_status()` (migration 20260803090300) pour permettre
 * l'affichage immédiat côté interface. La base reste la source de vérité.
 */

export interface SheetAggregationInput {
  currentStatus: SheetStatus;
  items: { approvalStatus: ItemApprovalStatus; isCancelled: boolean }[];
  ticketStatuses: TicketStatus[];
}

/** Statuts posés explicitement : jamais recalculés automatiquement. */
const TERMINAL_OR_PRE_SEND: readonly SheetStatus[] = [
  "draft",
  "internal_review",
  "ready_to_send",
  "tacitly_approved",
  "rejected",
  "expired",
];

export function computeSheetStatus(input: SheetAggregationInput): SheetStatus {
  if (TERMINAL_OR_PRE_SEND.includes(input.currentStatus)) {
    return input.currentStatus;
  }

  const active = input.items.filter((item) => !item.isCancelled);
  if (active.length === 0) {
    return input.currentStatus;
  }

  const count = (...statuses: ItemApprovalStatus[]) =>
    active.filter((item) => statuses.includes(item.approvalStatus)).length;

  const approved = count("approved", "approved_after_fix");
  const requested = count("changes_requested");
  const corrected = count("corrected", "resent");
  const openTickets = input.ticketStatuses.filter(isTicketOpen).length;

  if (approved === active.length) return "approved_by_client";
  if (requested > 0) {
    return openTickets === 0 ? "new_version_to_send" : "changes_requested";
  }
  if (corrected > 0) {
    return openTickets > 0 ? "corrections_in_progress" : "awaiting_revalidation";
  }
  if (approved > 0) return "partially_approved";
  return "sent_to_client";
}

/**
 * Statuts signifiant que le client a donné son accord sur toute la fiche.
 * La validation tacite en fait partie : elle vaut accord contractuel (§16).
 */
export const CLIENT_VALIDATED_STATUSES: readonly SheetStatus[] = [
  "approved_by_client",
  "tacitly_approved",
];

/** La fiche est-elle entièrement validée par le client ? */
export function isClientValidated(status: SheetStatus): boolean {
  return CLIENT_VALIDATED_STATUSES.includes(status);
}

/**
 * La rédaction reste possible à tout stade vivant de la fiche : avant l'envoi,
 * une fois partie chez le client, pendant les corrections, et jusqu'après la
 * validation. Dès que le client a vu la fiche, l'enregistrement crée une
 * nouvelle version et redemande sa validation.
 *
 * Seules les fins de parcours en sont exclues — une fiche rejetée ou périmée
 * ne se reprend pas, elle se refait.
 */
export const DIRECTLY_EDITABLE_SHEET_STATUSES: readonly SheetStatus[] = [
  "draft",
  "internal_review",
  "ready_to_send",
  "sent_to_client",
  "partially_approved",
  "changes_requested",
  "corrections_in_progress",
  "new_version_to_send",
  "awaiting_revalidation",
  "approved_by_client",
  "tacitly_approved",
];

export function canEditSheetContent(status: SheetStatus): boolean {
  return DIRECTLY_EDITABLE_SHEET_STATUSES.includes(status);
}

/**
 * Une modification de ce statut rend nécessaire une nouvelle validation.
 *
 * Le critère est simple : le client a-t-il déjà vu la fiche ? Si oui, ce qu'il
 * a sous les yeux vient de changer, et son accord — donné ou en cours — ne
 * porte plus sur le même contenu.
 */
export function editRequiresRevalidation(status: SheetStatus): boolean {
  return ![
    "draft",
    "internal_review",
    "ready_to_send",
  ].includes(status) && canEditSheetContent(status);
}

/** Part des fiches validées, pour le suivi hebdomadaire. */
export function validationRate(statuses: SheetStatus[]): {
  validated: number;
  total: number;
  percentage: number;
} {
  // Les brouillons ne comptent pas : ils n'ont jamais été soumis au client.
  const submitted = statuses.filter((status) => status !== "draft" && status !== "internal_review");
  const validated = submitted.filter(isClientValidated).length;

  return {
    validated,
    total: submitted.length,
    percentage: submitted.length ? Math.round((validated / submitted.length) * 100) : 0,
  };
}

/**
 * §15 — La fiche n'est réellement validée que si tous les contenus le sont, ou
 * si une règle explicite s'applique (tacite, forçage justifié).
 */
export interface FullyApprovedCheck {
  approved: boolean;
  reason:
    | "all_items_approved"
    | "tacit_rule"
    | "forced_by_manager"
    | "items_pending"
    | "open_tickets";
}

export function isSheetFullyApproved(input: {
  items: { approvalStatus: ItemApprovalStatus; isCancelled: boolean }[];
  ticketStatuses: TicketStatus[];
  tacitApplied?: boolean;
  forcedBy?: { profileId: string; justification: string } | null;
}): FullyApprovedCheck {
  if (input.tacitApplied) return { approved: true, reason: "tacit_rule" };
  if (input.forcedBy && input.forcedBy.justification.trim().length > 0) {
    return { approved: true, reason: "forced_by_manager" };
  }

  if (input.ticketStatuses.some(isTicketOpen)) {
    return { approved: false, reason: "open_tickets" };
  }

  const active = input.items.filter((item) => !item.isCancelled);
  const allApproved =
    active.length > 0 &&
    active.every((item) =>
      ["approved", "approved_after_fix"].includes(item.approvalStatus),
    );

  return allApproved
    ? { approved: true, reason: "all_items_approved" }
    : { approved: false, reason: "items_pending" };
}

/**
 * §5 — « Tout valider » n'est proposé que si aucune demande de modification
 * n'est ouverte.
 */
export function canApproveAll(input: {
  items: { approvalStatus: ItemApprovalStatus; isCancelled: boolean }[];
  ticketStatuses: TicketStatus[];
}): boolean {
  const active = input.items.filter((item) => !item.isCancelled);
  if (active.length === 0) return false;
  if (active.some((item) => item.approvalStatus === "changes_requested")) return false;
  if (input.ticketStatuses.some(isTicketOpen)) return false;
  return active.some((item) =>
    ["pending", "corrected", "resent"].includes(item.approvalStatus),
  );
}
