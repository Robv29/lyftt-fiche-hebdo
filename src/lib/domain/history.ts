/**
 * Historique d'un client, semaine par semaine.
 *
 * Chaque écran de l'application montre un instant : ce qui attend une
 * validation, ce qui reste à publier, ce qui est en retard. Aucun ne raconte ce
 * qui s'est passé — quand le planning est parti, si le client a répondu, ce
 * qu'il a demandé, quand la correction est repartie, quand il a validé, et à
 * quelle heure les publications sont réellement sorties.
 *
 * Ce module ne lit pas la base : il assemble et ordonne des faits déjà
 * enregistrés. Aucune date n'est inventée ni déduite — une étape sans trace
 * reste absente de la chronologie plutôt que d'être supposée.
 */

export type HistoryEventKind =
  | "sheet_sent"
  | "sheet_resent"
  | "reminder"
  | "client_feedback"
  | "feedback_resolved"
  | "special_request"
  | "approved"
  | "published";

export interface HistoryEvent {
  /** Horodatage ISO. C'est lui qui ordonne la chronologie. */
  at: string;
  kind: HistoryEventKind;
  label: string;
  /** Précision libre : thème d'un retour, format d'une publication… */
  detail?: string | null;
  /** Échéance associée, pour une demande spéciale ou un retour. */
  dueAt?: string | null;
}

export interface WeekHistory {
  sheetId: string;
  isoWeek: number;
  periodStart: string;
  periodEnd: string;
  events: HistoryEvent[];
}

export const HISTORY_EVENT_LABELS: Record<HistoryEventKind, string> = {
  sheet_sent: "Planning envoyé",
  sheet_resent: "Fiche corrigée renvoyée",
  reminder: "Relance",
  client_feedback: "Retour client",
  feedback_resolved: "Retour traité",
  special_request: "Demande spéciale",
  approved: "Validation du client",
  published: "Publication",
};

/** Envois enregistrés pour une fiche, tels qu'ils sortent de la base. */
export interface DispatchRow {
  template_type: string;
  sent_at: string;
}

/** Versions successives d'une fiche : la première est l'envoi, les suivantes des corrections. */
export interface VersionRow {
  version_number: number;
  sent_to_client_at: string | null;
}

export interface TicketRow {
  id: string;
  title: string | null;
  ticket_type: string;
  typeLabel: string;
  submitted_at: string | null;
  created_at: string;
  resolved_at: string | null;
  due_at: string | null;
  /** Nul quand la demande ne vise aucun contenu : c'est une demande spéciale. */
  weekly_sheet_item_id: string | null;
}

export interface PublicationRow {
  published_at: string | null;
  scheduled_date: string;
  formatLabel: string;
}

export interface SheetHistoryInput {
  sheetId: string;
  isoWeek: number;
  periodStart: string;
  periodEnd: string;
  approvedAt: string | null;
  versions: VersionRow[];
  dispatches: DispatchRow[];
  tickets: TicketRow[];
  publications: PublicationRow[];
}

/**
 * Chronologie d'une semaine.
 *
 * Les envois sont lus dans `weekly_sheet_versions` plutôt que dans les messages
 * partis : une version porte la date à laquelle la fiche a été mise à
 * disposition, là où un message peut être renvoyé plusieurs fois pour la même
 * version. Les relances, elles, n'existent que comme messages — elles ne créent
 * pas de version.
 */
export function buildWeekHistory(input: SheetHistoryInput): WeekHistory {
  const events: HistoryEvent[] = [];

  /*
   * Le premier envoi est la première version **effectivement envoyée**, pas la
   * version numéro un. Une v1 préparée puis corrigée avant d'être transmise
   * n'atteint jamais le client : c'est alors la v2 qui est son premier contact,
   * et l'annoncer comme une correction laisserait croire à un aller-retour qui
   * n'a pas eu lieu. Cas observé en production.
   */
  const sent = input.versions
    .filter((version) => version.sent_to_client_at)
    .sort((a, b) => (a.sent_to_client_at as string).localeCompare(b.sent_to_client_at as string));

  sent.forEach((version, index) => {
    const first = index === 0;
    events.push({
      at: version.sent_to_client_at as string,
      kind: first ? "sheet_sent" : "sheet_resent",
      label: HISTORY_EVENT_LABELS[first ? "sheet_sent" : "sheet_resent"],
      detail: first ? null : `version ${version.version_number}`,
    });
  });

  for (const dispatch of input.dispatches) {
    // Seules les relances sont retenues : les autres messages accompagnent une
    // version, déjà présente ci-dessus, et feraient doublon.
    if (dispatch.template_type !== "reminder" && dispatch.template_type !== "overdue") continue;
    events.push({
      at: dispatch.sent_at,
      kind: "reminder",
      label: HISTORY_EVENT_LABELS.reminder,
      detail: dispatch.template_type === "overdue" ? "échéance dépassée" : null,
    });
  }

  for (const ticket of input.tickets) {
    const special = ticket.weekly_sheet_item_id === null;
    events.push({
      at: ticket.submitted_at ?? ticket.created_at,
      kind: special ? "special_request" : "client_feedback",
      label: HISTORY_EVENT_LABELS[special ? "special_request" : "client_feedback"],
      detail: ticket.title?.trim() ? `${ticket.typeLabel} — ${ticket.title.trim()}` : ticket.typeLabel,
      dueAt: ticket.due_at,
    });
    if (ticket.resolved_at) {
      events.push({
        at: ticket.resolved_at,
        kind: "feedback_resolved",
        label: HISTORY_EVENT_LABELS.feedback_resolved,
        detail: ticket.typeLabel,
      });
    }
  }

  if (input.approvedAt) {
    events.push({
      at: input.approvedAt,
      kind: "approved",
      label: HISTORY_EVENT_LABELS.approved,
    });
  }

  for (const publication of input.publications) {
    // L'heure réelle, celle du clic sur « publié » — pas la date planifiée.
    if (!publication.published_at) continue;
    events.push({
      at: publication.published_at,
      kind: "published",
      label: HISTORY_EVENT_LABELS.published,
      detail: `${publication.formatLabel} · prévue le ${publication.scheduled_date}`,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    sheetId: input.sheetId,
    isoWeek: input.isoWeek,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    events,
  };
}

/**
 * Délai entre l'envoi d'un planning et la validation du client.
 *
 * Nul tant que l'un des deux manque : une fiche jamais envoyée ou jamais validée
 * n'a pas de délai, et afficher zéro laisserait croire à une validation
 * immédiate.
 */
export function validationDelayHours(week: WeekHistory): number | null {
  const sent = week.events.find((event) => event.kind === "sheet_sent");
  const approved = week.events.find((event) => event.kind === "approved");
  if (!sent || !approved) return null;
  const delta = new Date(approved.at).getTime() - new Date(sent.at).getTime();
  return delta < 0 ? null : Math.round(delta / 3_600_000);
}
