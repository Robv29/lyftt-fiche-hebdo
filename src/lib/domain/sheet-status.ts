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
 * Statuts d'avant l'envoi : le client n'a jamais rien reçu.
 *
 * `recompute_sheet_status()` refuse de les quitter (migration 20260803090300),
 * et `computeSheetStatus` fait de même ci-dessus : une fiche n'en sort que par
 * « Marquer comme envoyé ». C'est donc la frontière de l'envoi, et le planning,
 * la revalidation et l'alerte du vendredi doivent la lire au même endroit —
 * trois copies de ce triplet circulaient, et la première oubliée aurait suffi à
 * faire passer une fiche jamais partie pour envoyée.
 */
export const PRE_SEND_SHEET_STATUSES: readonly SheetStatus[] = [
  "draft",
  "internal_review",
  "ready_to_send",
];

export function isPreSendSheetStatus(status: string): boolean {
  return (PRE_SEND_SHEET_STATUSES as readonly string[]).includes(status);
}

/**
 * La signature du client entre-t-elle dans le calcul de complétude ?
 *
 * Une légende réduite à la signature préremplie n'est pas un texte rédigé
 * (`hasWrittenCaption`). Mais appliquer ce durcissement partout faisait
 * retomber sous les 100 % onze fiches déjà envoyées ou validées : trois en
 * cours de correction, à qui le verrou des 100 % aurait alors refusé le renvoi
 * au client — dont une portant un lien encore vivant, qui aurait expiré — et
 * cinq validées, dont l'historique se serait réécrit à l'écran. Leur histoire
 * est écrite. Ce qui compte, c'est que la suivante ne parte pas avec une
 * signature pour seul texte.
 *
 * La frontière est donc celle de l'envoi, et non `sent_to_client_at` : une
 * fiche validée sans jamais avoir été envoyée a cette date à nul, et un test
 * sur la date l'aurait perturbée quand même.
 *
 * Renvoie `null` dès que la fiche est partie : les appelants retombent à
 * l'octet près sur l'ancien calcul.
 */
export function captionSignatureFor(
  status: string,
  signature: string | null | undefined,
): string | null {
  return isPreSendSheetStatus(status) ? (signature ?? null) : null;
}

/**
 * Une modification de ce statut rend nécessaire une nouvelle validation.
 *
 * Le critère est simple : le client a-t-il déjà vu la fiche ? Si oui, ce qu'il
 * a sous les yeux vient de changer, et son accord — donné ou en cours — ne
 * porte plus sur le même contenu.
 */
export function editRequiresRevalidation(status: SheetStatus): boolean {
  return !isPreSendSheetStatus(status) && canEditSheetContent(status);
}

/**
 * Le sujet de la semaine se modifie-t-il encore, et faut-il le dire ?
 *
 * Le sujet n'est pas un contenu : c'est la consigne interne que la production
 * lit avant de produire. Le client ne le voit nulle part — ni sur son lien de
 * validation, ni dans les messages envoyés — donc le corriger après coup ne
 * touche pas à ce qu'il a validé et n'appelle aucune nouvelle version. C'est
 * précisément pourquoi il reste modifiable une fois la fiche partie : la
 * semaine se prépare souvent après l'accord du client, et la consigne devait
 * pouvoir suivre.
 *
 * - `editable` : la fiche n'est pas encore partie, rien de plus à dire ;
 * - `internal_notice` : le client a la fiche sous les yeux ; l'écran précise
 *   que le sujet lui reste invisible, pour qu'on ne croie pas toucher à sa
 *   validation ;
 * - `locked` : fiche refusée ou périmée — elle ne se reprend pas, elle se
 *   refait. Écrire une consigne que personne n'exécutera ne rend service à
 *   personne : même frontière que le contenu, pour ne pas avoir deux réponses
 *   à « cette fiche est-elle encore vivante ? ».
 */
export type SheetTopicEditState = "editable" | "internal_notice" | "locked";

export function sheetTopicEditState(status: SheetStatus): SheetTopicEditState {
  if (!canEditSheetContent(status)) return "locked";
  return editRequiresRevalidation(status) ? "internal_notice" : "editable";
}

export function canEditSheetTopic(status: SheetStatus): boolean {
  return sheetTopicEditState(status) !== "locked";
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
