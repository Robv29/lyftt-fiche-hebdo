/**
 * Cycle de vie d'un client : actif, en pause, ou fin de gestion atteinte.
 *
 * L'état est **calculé** à partir des dates, jamais stocké. Un indicateur
 * figé en base dériverait dès qu'une date est modifiée, ou si la tâche
 * planifiée ne tourne pas un jour : le client resterait archivé après la fin
 * de sa pause, ou continuerait d'apparaître après la fin de son contrat.
 * Ici, la lecture est toujours juste.
 */

export type ClientLifecycleState = "active" | "paused" | "ended" | "archived";

export interface ClientLifecycleInput {
  /** Archivage manuel, qui prime sur tout le reste. */
  isActive: boolean;
  /** Fin de gestion. Le client est archivé le lendemain de cette date. */
  contractEndDate: string | null;
  pauseStartDate: string | null;
  /** Dernier jour de pause inclus. */
  pauseEndDate: string | null;
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
   * Fin de gestion : l'archivage prend effet le lendemain, pour que la
   * dernière journée du contrat reste pleinement exploitable.
   */
  if (input.contractEndDate && today > input.contractEndDate) {
    return {
      state: "ended",
      canProduce: false,
      label: "Gestion terminée",
      detail: `Fin de gestion le ${formatDay(input.contractEndDate)}.`,
    };
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

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Message affiché quand on tente de produire pour un client indisponible. */
export function productionBlockedMessage(lifecycle: ClientLifecycle): string {
  switch (lifecycle.state) {
    case "paused":
      return `Ce client est en pause. ${lifecycle.detail ?? ""}`.trim();
    case "ended":
      return `La gestion de ce client est terminée. ${lifecycle.detail ?? ""}`.trim();
    case "archived":
      return "Ce client est archivé. Réactivez-le pour préparer une fiche.";
    default:
      return "";
  }
}
