/**
 * Cycle de vie d'un client : actif, en pause, ou fin de gestion atteinte.
 *
 * L'état est **calculé** à partir des dates, jamais stocké. Un indicateur
 * figé en base dériverait dès qu'une date est modifiée, ou si la tâche
 * planifiée ne tourne pas un jour : le client resterait archivé après la fin
 * de sa pause, ou continuerait d'apparaître après la fin de son contrat.
 * Ici, la lecture est toujours juste.
 */

import { normalizeWeekdays, publicationDatesForWeek } from "./planning";

export type ClientLifecycleState = "active" | "not_started" | "paused" | "ended" | "archived" | "one_shot";

/**
 * Nature de la relation.
 *
 * `gestion` : gestion des réseaux sociaux, avec fiches hebdomadaires et mois
 * facturés. `ponctuel` : une prestation one-shot — un shooting, un site —
 * sans rien de tout cela.
 */
export type ClientKind = "gestion" | "ponctuel";

/** Lecture tolérante d'une valeur venue de la base : l'inconnu vaut gestion. */
export function parseClientKind(value: unknown): ClientKind {
  return value === "ponctuel" ? "ponctuel" : "gestion";
}

export interface ClientLifecycleInput {
  /** Archivage manuel, qui prime sur tout le reste. */
  isActive: boolean;
  /*
   * Obligatoire, et c'est voulu. Un appelant qui l'omettrait traiterait un
   * client ponctuel comme une gestion : il lui proposerait des fiches, le
   * compterait « en gestion », le mettrait en retard. Le rendre obligatoire
   * fait trouver chaque appelant par le compilateur plutôt que par un bug.
   */
  kind: ClientKind;
  /** Début de gestion. Rien n'est produit avant cette date. */
  contractStartDate?: string | null;
  /** Fin de gestion. Le client est archivé le lendemain de cette date. */
  contractEndDate: string | null;
  pauseStartDate: string | null;
  /** Dernier jour de pause inclus. */
  pauseEndDate: string | null;
}

/**
 * Entrée du cycle de vie **à la semaine** : il y faut en plus les jours de
 * publication, sur lesquels se juge la fin du contrat (voir
 * `clientLifecycleForWeek`).
 */
export interface ClientWeekLifecycleInput extends ClientLifecycleInput {
  /*
   * Jours de publication du client, en numérotation ISO (1 = lundi), tels que
   * lus dans ses réglages. Obligatoire pour la même raison que `kind` : un
   * appelant qui l'oublierait jugerait la fin de contrat au lundi, et
   * réclamerait de nouveau une publication après la fin du contrat. Une liste
   * vide est une réponse valable : pas de jour renseigné.
   */
  publicationWeekdays: readonly number[];
}

export interface ClientLifecycle {
  state: ClientLifecycleState;
  /** Le client peut-il recevoir de nouvelles fiches ? */
  canProduce: boolean;
  label: string;
  /** Explication courte, affichée sur la carte. */
  detail: string | null;
}

/** Date civile du jour dans le fuseau de travail. */
export function todayInParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function clientLifecycle(
  input: ClientLifecycleInput,
  today: string = todayInParis(),
): ClientLifecycle {
  if (!input.isActive) {
    return {
      state: "archived",
      canProduce: false,
      label: "Archivé",
      detail: "Archivé manuellement.",
    };
  }

  /*
   * Prestation ponctuelle : pas de gestion, donc pas de fiche à produire.
   * Placée juste après l'archivage, qui prime sur tout ; avant les dates de
   * gestion, qui n'ont pas de sens pour un one-shot.
   */
  if (input.kind === "ponctuel") {
    return {
      state: "one_shot",
      canProduce: false,
      label: "Prestation ponctuelle",
      detail: "Sans gestion des réseaux : aucune fiche hebdomadaire.",
    };
  }

  /*
   * Gestion pas encore commencée : le contrat est signé, la date de départ
   * n'est pas atteinte. Proposer une fiche à ce client remplirait le planning
   * de travail qu'on n'a pas à faire.
   */
  if (input.contractStartDate && today < input.contractStartDate) {
    return {
      state: "not_started",
      canProduce: false,
      label: "Pas encore commencé",
      detail: `Gestion à partir du ${formatDay(input.contractStartDate)}.`,
    };
  }

  /*
   * Fin de gestion : l'archivage prend effet le lendemain, pour que la
   * dernière journée du contrat reste pleinement exploitable.
   */
  if (input.contractEndDate && today > input.contractEndDate) {
    return endedLifecycle(input.contractEndDate);
  }

  // Pause en cours : bornes incluses.
  const startedPause = input.pauseStartDate !== null && today >= input.pauseStartDate;
  const endedPause = input.pauseEndDate !== null && today > input.pauseEndDate;

  if (startedPause && !endedPause) {
    return {
      state: "paused",
      canProduce: false,
      label: "En pause",
      detail: input.pauseEndDate
        ? `Reprise le ${formatDay(nextDay(input.pauseEndDate))}.`
        : "Pause sans date de reprise.",
    };
  }

  const upcomingPause =
    input.pauseStartDate !== null && today < input.pauseStartDate
      ? `Pause prévue du ${formatDay(input.pauseStartDate)}.`
      : null;

  const upcomingEnd = input.contractEndDate
    ? `Gestion jusqu'au ${formatDay(input.contractEndDate)}.`
    : null;

  return {
    state: "active",
    canProduce: true,
    label: "Actif",
    detail: upcomingPause ?? upcomingEnd,
  };
}

function endedLifecycle(contractEndDate: string): ClientLifecycle {
  return {
    state: "ended",
    canProduce: false,
    label: "Gestion terminée",
    detail: `Fin de gestion le ${formatDay(contractEndDate)}.`,
  };
}

/** Lendemain d'une date civile. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Premier lundi strictement postérieur à une date. */
function mondayAfter(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const isoDay = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  return addDays(date, 8 - isoDay);
}

/**
 * Cycle de vie d'un client pour une **semaine** de production.
 *
 * On ne produit pas à la journée mais à la semaine : une fiche couvre du lundi
 * au dimanche, et se prépare plusieurs jours à l'avance. Juger la pause sur une
 * seule date donnait deux erreurs symétriques. Pendant une pause, la fiche de la
 * semaine suivante était refusée alors que la pause y était terminée — il
 * fallait attendre la reprise pour préparer, c'est-à-dire trop tard. Et une
 * pause commençant un mercredi laissait produire la semaine entière, y compris
 * les jours pausés.
 *
 * La règle est donc : une semaine touchée par la pause, même d'un seul jour,
 * n'est pas produite ; la production reprend à la semaine suivante.
 *
 * **Fin de contrat : jugée sur les jours de publication.** Jugée au lundi, une
 * semaine qui commence le dernier jour du contrat restait « en gestion » : le
 * contrat d'E-MOVE s'arrête le lundi 30 novembre, E-MOVE publie le mercredi,
 * et une vidéo était réclamée pour le 2 décembre, après la fin du contrat. Une
 * semaine est donc hors contrat quand **toutes** ses dates de publication
 * tombent après la fin. Sans jour de publication renseigné, rien ne permet de
 * dire quand on publie : la fin se juge au lundi, comme avant.
 *
 * Le début du contrat, lui, reste jugé au lundi. C'est voulu : cette règle ne
 * porte que sur la fin.
 */
export function clientLifecycleForWeek(
  input: ClientWeekLifecycleInput,
  weekStart: string,
): ClientLifecycle {
  const base = clientLifecycle(input, weekStart);
  // L'archivage et les bornes du contrat gardent la main : ils ne se rattrapent pas.
  if (base.state !== "active" && base.state !== "paused") return base;

  // Même préséance qu'au jour : la fin du contrat passe avant la pause.
  if (input.contractEndDate
    && publishesOnlyAfter(input.contractEndDate, input.publicationWeekdays, weekStart)) {
    return endedLifecycle(input.contractEndDate);
  }

  const weekEnd = addDays(weekStart, 6);
  const pauseOverlapsWeek = input.pauseStartDate !== null
    && input.pauseStartDate <= weekEnd
    && (input.pauseEndDate === null || input.pauseEndDate >= weekStart);

  if (!pauseOverlapsWeek) return base;

  return {
    state: "paused",
    canProduce: false,
    label: "En pause",
    detail: input.pauseEndDate
      ? `Reprise de la production la semaine du ${formatDay(mondayAfter(input.pauseEndDate))}.`
      : "Pause sans date de reprise.",
  };
}

/**
 * Toutes les publications de la semaine tombent-elles après cette date ?
 *
 * Les dates sont celles que la création de fiche poserait
 * (`publicationDatesForWeek`) : la question et la fiche parlent des mêmes
 * jours. Faux sans jour renseigné — l'appelant garde alors la règle du lundi.
 */
function publishesOnlyAfter(date: string, weekdays: readonly number[], weekStart: string): boolean {
  const days = normalizeWeekdays(weekdays);
  if (days.length === 0) return false;
  return publicationDatesForWeek(days.length, days, new Date(`${weekStart}T00:00:00Z`))
    .every((publication) => publication > date);
}

/** Message affiché quand on tente de produire pour un client indisponible. */
export function productionBlockedMessage(lifecycle: ClientLifecycle): string {
  switch (lifecycle.state) {
    case "paused":
      return `Ce client est en pause. ${lifecycle.detail ?? ""}`.trim();
    case "ended":
      return `La gestion de ce client est terminée. ${lifecycle.detail ?? ""}`.trim();
    case "not_started":
      return `La gestion de ce client n'a pas encore commencé. ${lifecycle.detail ?? ""}`.trim();
    case "archived":
      return "Ce client est archivé. Réactivez-le pour préparer une fiche.";
    default:
      return "";
  }
}
