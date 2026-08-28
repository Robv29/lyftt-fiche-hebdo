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
  | "production_requested"
  | "production_delivered"
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
  /** Ce qui a accroché dans la semaine, et de quel côté. */
  assessment: WeekAssessment;
}

/**
 * Ce qui a accroché dans une semaine, et de quel côté.
 *
 * La qualification ne juge pas les intentions : elle constate des faits datés.
 * Un motif est retenu seulement s'il repose sur une trace — une relance
 * envoyée, une publication sortie après sa date, une coquille signalée. Une
 * semaine sans motif d'aucun côté s'est déroulée sans accroc.
 *
 * Les deux côtés peuvent être servis en même temps : une semaine où nous avons
 * laissé passer une coquille *et* où le client n'a pas validé à temps n'a pas à
 * choisir un coupable.
 */
export interface WeekAssessment {
  /** Ce qui nous revient : ce que nous aurions dû livrer autrement. */
  lyftt: string[];
  /** Ce qui revient au client : ce que nous attendions de lui. */
  client: string[];
  /** Vrai quand aucun motif n'est retenu de part et d'autre. */
  clean: boolean;
}

export const HISTORY_EVENT_LABELS: Record<HistoryEventKind, string> = {
  sheet_sent: "Planning envoyé",
  sheet_resent: "Fiche corrigée renvoyée",
  reminder: "Relance",
  client_feedback: "Retour client",
  feedback_resolved: "Retour traité",
  special_request: "Demande spéciale",
  production_requested: "Commande en production",
  production_delivered: "Production livrée",
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
  /** `graphic` ou `video` : le retour part en production, il ne se traite pas au bureau. */
  category: string | null;
}

/**
 * Commande passée à la production — visuel, montage — avec son échéance.
 *
 * Elle ne dépend d'aucune fiche : elle porte sa propre date de demande, sa date
 * limite et sa date de livraison. C'est le seul objet de l'application qui suit
 * ce cycle, et il manquait à l'historique.
 */
export interface ProductionRequestRow {
  title: string | null;
  kindLabel: string;
  created_at: string;
  due_on: string | null;
  delivered_at: string | null;
  validated_at: string | null;
}

export interface PublicationRow {
  published_at: string | null;
  /** Date prévue au format `AAAA-MM-JJ`, pour juger d'un retard. */
  scheduledDate: string;
  /** Date prévue, déjà mise en forme : le domaine n'a pas à connaître la locale. */
  scheduledLabel: string;
  formatLabel: string;
}

export interface SheetHistoryInput {
  sheetId: string;
  isoWeek: number;
  periodStart: string;
  periodEnd: string;
  approvedAt: string | null;
  /** Échéance de validation annoncée au client. */
  deadlineAt?: string | null;
  versions: VersionRow[];
  dispatches: DispatchRow[];
  tickets: TicketRow[];
  publications: PublicationRow[];
  /** Commandes en production tombant dans la semaine, rattachées par leur date. */
  productionRequests?: ProductionRequestRow[];
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
export function buildWeekHistory(input: SheetHistoryInput, now: Date = new Date()): WeekHistory {
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
    /*
     * Un retour qui demande un visuel ou un montage part en production ; les
     * autres se traitent au bureau. La distinction change qui doit agir, elle
     * mérite d'être lisible sans ouvrir le ticket.
     */
    const production = ticket.category === "graphic" || ticket.category === "video";
    const base = ticket.title?.trim() ? `${ticket.typeLabel} — ${ticket.title.trim()}` : ticket.typeLabel;
    events.push({
      at: ticket.submitted_at ?? ticket.created_at,
      kind: special ? "special_request" : "client_feedback",
      label: HISTORY_EVENT_LABELS[special ? "special_request" : "client_feedback"],
      detail: production ? `${base} · part en production` : base,
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

  for (const request of input.productionRequests ?? []) {
    const titre = request.title?.trim() || request.kindLabel;
    events.push({
      at: request.created_at,
      kind: "production_requested",
      label: HISTORY_EVENT_LABELS.production_requested,
      detail: `${request.kindLabel} — ${titre}`,
      // `due_on` est une date sans heure : elle reste telle quelle.
      dueAt: request.due_on,
    });
    if (request.delivered_at) {
      events.push({
        at: request.delivered_at,
        kind: "production_delivered",
        label: HISTORY_EVENT_LABELS.production_delivered,
        detail: titre,
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
      detail: `${publication.formatLabel} · prévue le ${publication.scheduledLabel}`,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    sheetId: input.sheetId,
    isoWeek: input.isoWeek,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    events,
    assessment: assessWeek(input, now),
  };
}

/**
 * Types de retour qui constatent une faute de notre part.
 *
 * Une coquille ou une information erronée n'aurait pas dû sortir de chez nous.
 * Un changement d'avis, un remplacement de photo ou un ajout de publication
 * n'est pas une faute : c'est la vie d'une validation, et le compter contre
 * nous rendrait la mesure inutilisable.
 */
const LYFTT_FAULT_TICKETS = new Set(["text_typo"]);

function assessWeek(input: SheetHistoryInput, now: Date): WeekAssessment {
  const lyftt: string[] = [];
  const client: string[] = [];
  const today = now.toISOString().slice(0, 10);
  const weekIsOver = input.periodEnd < today;

  const coquilles = input.tickets.filter((ticket) => LYFTT_FAULT_TICKETS.has(ticket.ticket_type)).length;
  if (coquilles > 0) {
    lyftt.push(`${coquilles} coquille${coquilles > 1 ? "s" : ""} signalée${coquilles > 1 ? "s" : ""}`);
  }

  const enRetard = input.publications.filter((publication) =>
    publication.published_at && publication.published_at.slice(0, 10) > publication.scheduledDate).length;
  if (enRetard > 0) {
    lyftt.push(`${enRetard} publication${enRetard > 1 ? "s" : ""} sortie${enRetard > 1 ? "s" : ""} après la date prévue`);
  }

  /*
   * Une publication non confirmée avant la fin de la semaine reste peut-être à
   * cocher : on ne la compte qu'une fois la semaine close, sinon toute semaine
   * en cours serait fautive.
   */
  if (weekIsOver) {
    const jamaisPubliees = input.publications.filter((publication) => !publication.published_at).length;
    if (jamaisPubliees > 0) {
      lyftt.push(`${jamaisPubliees} publication${jamaisPubliees > 1 ? "s" : ""} jamais confirmée${jamaisPubliees > 1 ? "s" : ""}`);
    }
  }

  const relances = input.dispatches.filter((d) => d.template_type === "reminder" || d.template_type === "overdue").length;
  if (relances > 0) {
    client.push(`${relances} relance${relances > 1 ? "s" : ""} nécessaire${relances > 1 ? "s" : ""}`);
  }

  if (input.deadlineAt) {
    if (input.approvedAt && input.approvedAt > input.deadlineAt) {
      client.push("validation après l'échéance");
    }
    // Sans validation ni échéance dépassée, rien à reprocher : le client a
    // peut-être encore le temps.
    if (!input.approvedAt && weekIsOver && input.deadlineAt < now.toISOString()) {
      client.push("aucune validation");
    }
  }

  return { lyftt, client, clean: lyftt.length === 0 && client.length === 0 };
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

/**
 * Familles d'événements, telles qu'on filtre l'historique.
 *
 * On ne cherche pas « les relances » et « les retours » séparément quand on
 * remonte le fil d'un client : on cherche ce qui vient de nous, ce qui vient
 * de lui, ou ce qui est sorti. Les familles suivent cette lecture, pas la
 * mécanique interne des tables.
 */
export type HistoryFamily = "envois" | "retours" | "production" | "validations" | "publications";

export const HISTORY_FAMILIES: ReadonlyArray<{ key: HistoryFamily; label: string; kinds: HistoryEventKind[] }> = [
  { key: "envois", label: "Envois et relances", kinds: ["sheet_sent", "sheet_resent", "reminder"] },
  { key: "retours", label: "Retours clients", kinds: ["client_feedback", "feedback_resolved", "special_request"] },
  { key: "production", label: "Production", kinds: ["production_requested", "production_delivered"] },
  { key: "validations", label: "Validations", kinds: ["approved"] },
  { key: "publications", label: "Publications", kinds: ["published"] },
];

const FAMILY_BY_KIND = HISTORY_FAMILIES.reduce<Record<HistoryEventKind, HistoryFamily>>((map, family) => {
  for (const kind of family.kinds) map[kind] = family.key;
  return map;
}, {} as Record<HistoryEventKind, HistoryFamily>);

export function familyForKind(kind: HistoryEventKind): HistoryFamily {
  return FAMILY_BY_KIND[kind];
}

export interface HistoryDay {
  /** Jour civil, `AAAA-MM-JJ`. */
  day: string;
  events: HistoryEvent[];
}

/**
 * Événements regroupés par jour.
 *
 * Une semaine chargée alignait quinze lignes horodatées d'affilée : l'œil ne
 * voyait plus où une journée finissait. Le jour devient le repère, l'heure
 * seule reste sur chaque ligne.
 */
export function groupEventsByDay(events: HistoryEvent[], newestFirst = true): HistoryDay[] {
  const byDay = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const day = event.at.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }

  return [...byDay.entries()]
    .map(([day, list]) => ({
      day,
      events: [...list].sort((a, b) => (newestFirst ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at))),
    }))
    .sort((a, b) => (newestFirst ? b.day.localeCompare(a.day) : a.day.localeCompare(b.day)));
}
