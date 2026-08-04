import type { TicketType } from "./ticket-types";
import { isTicketOpen } from "./workflow";
import type { ItemApprovalStatus, TicketStatus } from "./types";

/**
 * §24 — Cas particuliers.
 *
 * Chaque situation listée dans la spec reçoit ici un comportement explicite,
 * plutôt que d'être laissée au hasard de l'implémentation.
 */

// ---------------------------------------------------------------------------
// Le client crée deux tickets identiques
// ---------------------------------------------------------------------------

export interface ExistingTicketSummary {
  id: string;
  ticketNumber: string;
  itemId: string | null;
  type: TicketType;
  description: string;
  status: TicketStatus;
  createdAt: Date;
}

export interface DuplicateCheck {
  isDuplicate: boolean;
  existing?: ExistingTicketSummary;
  /** Message proposé au client : on n'interdit pas, on demande confirmation. */
  message?: string;
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similarité de Jaccard sur les mots : robuste aux reformulations mineures. */
export function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForComparison(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeForComparison(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / (wordsA.size + wordsB.size - shared);
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function detectDuplicateTicket(
  candidate: { itemId: string | null; type: TicketType; description: string },
  existing: ExistingTicketSummary[],
  now: Date = new Date(),
): DuplicateCheck {
  for (const ticket of existing) {
    if (!isTicketOpen(ticket.status)) continue;
    if (ticket.itemId !== candidate.itemId) continue;
    if (ticket.type !== candidate.type) continue;
    if (now.getTime() - ticket.createdAt.getTime() > DUPLICATE_WINDOW_MS) continue;

    if (
      textSimilarity(ticket.description, candidate.description) >=
      DUPLICATE_SIMILARITY_THRESHOLD
    ) {
      return {
        isDuplicate: true,
        existing: ticket,
        message: `Une demande très proche est déjà enregistrée (${ticket.ticketNumber}). Souhaitez-vous ajouter une précision à cette demande plutôt que d'en créer une nouvelle ?`,
      };
    }
  }

  return { isDuplicate: false };
}

// ---------------------------------------------------------------------------
// Le client valide puis demande une modification
// ---------------------------------------------------------------------------

export interface ReopenApprovalDecision {
  allowed: boolean;
  /** Nouveau statut à poser sur le contenu. */
  nextItemStatus: ItemApprovalStatus;
  /** Le responsable de production doit-il être prévenu ? */
  notifyProductionManager: boolean;
  message?: string;
}

/**
 * Revenir sur une validation reste possible tant que le contenu n'est pas
 * publié : c'est plus utile qu'un blocage, à condition de tracer et d'alerter.
 */
export function requestChangeAfterApproval(item: {
  approvalStatus: ItemApprovalStatus;
  publishedAt: Date | null;
  scheduledAt: Date;
}, now: Date = new Date()): ReopenApprovalDecision {
  if (item.publishedAt !== null) {
    return {
      allowed: false,
      nextItemStatus: item.approvalStatus,
      notifyProductionManager: true,
      message:
        "Ce contenu a déjà été publié. Votre demande est transmise à votre community manager, qui vous rappellera pour décider de la suite (modification, suppression ou republication).",
    };
  }

  const hoursBeforePublication =
    (item.scheduledAt.getTime() - now.getTime()) / (60 * 60 * 1000);

  return {
    allowed: true,
    nextItemStatus: "changes_requested",
    // Revenir sur une validation, ou demander tard, mérite un arbitrage humain.
    notifyProductionManager:
      item.approvalStatus === "approved" ||
      item.approvalStatus === "approved_after_fix" ||
      hoursBeforePublication < 24,
    message:
      hoursBeforePublication < 24
        ? "La publication est prévue dans moins de 24 h : nous ne pouvons pas garantir la correction avant l'heure prévue. Votre community manager revient vers vous rapidement."
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Le client ouvre un ancien lien alors qu'une nouvelle version existe
// ---------------------------------------------------------------------------

export interface VersionFreshness {
  isStale: boolean;
  banner?: string;
}

export function checkVersionFreshness(
  linkVersionNumber: number | null,
  currentVersionNumber: number | null,
): VersionFreshness {
  if (linkVersionNumber === null || currentVersionNumber === null) {
    return { isStale: false };
  }
  if (linkVersionNumber >= currentVersionNumber) return { isStale: false };

  return {
    isStale: true,
    banner: `Une version plus récente de cette fiche existe (version ${currentVersionNumber}). Vous consultez désormais la dernière version.`,
  };
}

// ---------------------------------------------------------------------------
// §14 — Empêcher l'envoi d'un export obsolète
// ---------------------------------------------------------------------------

export interface ExportSendCheck {
  allowed: boolean;
  requiresConfirmation: boolean;
  warning?: string;
}

export function checkExportBeforeSend(exportRecord: {
  isObsolete: boolean;
  versionNumber: number;
}, currentVersionNumber: number): ExportSendCheck {
  if (!exportRecord.isObsolete && exportRecord.versionNumber === currentVersionNumber) {
    return { allowed: true, requiresConfirmation: false };
  }

  return {
    allowed: true,
    requiresConfirmation: true,
    warning: `Attention : une version plus récente de cette fiche existe (version ${currentVersionNumber}). Vous êtes sur le point d'envoyer la version ${exportRecord.versionNumber}.`,
  };
}

/** Mention de version imprimée dans le PDF (§11). */
export function exportVersionLabel(
  versionNumber: number,
  generatedAt: Date,
  timezone = "Europe/Paris",
): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(generatedAt);

  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  })
    .format(generatedAt)
    .replace(":", " h ");

  return `Version ${versionNumber} — mise à jour le ${date} à ${time}`;
}

// ---------------------------------------------------------------------------
// Publication trop proche, annulée, ou déjà publiée
// ---------------------------------------------------------------------------

export type ItemRequestability =
  | "open"
  | "tight_deadline"
  | "already_published"
  | "cancelled";

export function itemRequestability(
  item: { publishedAt: Date | null; isCancelled: boolean; scheduledAt: Date },
  now: Date = new Date(),
): { state: ItemRequestability; notice?: string } {
  if (item.isCancelled) {
    return {
      state: "cancelled",
      notice: "Cette publication a été annulée. Elle ne sera pas publiée.",
    };
  }
  if (item.publishedAt !== null) {
    return {
      state: "already_published",
      notice:
        "Cette publication est déjà en ligne. Une demande reste possible, elle sera traitée comme une correction après publication.",
    };
  }

  const hours = (item.scheduledAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hours < 24) {
    return {
      state: "tight_deadline",
      notice:
        "Publication prévue dans moins de 24 h : la correction ne pourra pas toujours être faite à temps.",
    };
  }

  return { state: "open" };
}
