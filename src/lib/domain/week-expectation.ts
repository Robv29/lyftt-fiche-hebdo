import { clientFormula, type ClientFormula, type ClientFormulaRow } from "./client-formula";
import { clientLifecycleForWeek, parseClientKind, type ClientLifecycle } from "./client-lifecycle";
import { isoWeekIdentity, weeklyFormatsForCadence } from "./planning";
import type { MediaFormat } from "./types";

/**
 * Ce qu'on attend d'un client pour une semaine donnée.
 *
 * Trois écrans posaient la question chacun à leur manière : le planning
 * proposait une fiche selon le contrat de la semaine, la production selon le
 * contrat et le rythme, le tableau de bord selon le contrat du jour — sans
 * rythme ni date de début. Un client vendu à deux vidéos par mois se voyait
 * donc réclamer une fiche chaque semaine, et « Fiches à préparer » ne tombait
 * jamais d'accord avec « à créer » du planning. Une seule réponse, ici.
 *
 * - `off_contract` : hors gestion cette semaine (pas commencé, terminé, en
 *   pause, archivé, prestation ponctuelle) ;
 * - `off_week` : en gestion, mais le rythme vendu ne prévoit rien cette
 *   semaine ;
 * - `publish` : une fiche est attendue, avec ces formats.
 */
export type WeekExpectation =
  | { kind: "off_contract" }
  | { kind: "off_week" }
  | { kind: "publish"; formats: MediaFormat[] };

export interface WeekExpectationRow extends ClientFormulaRow {
  is_active: boolean;
}

/**
 * Le client est-il en gestion cette semaine-là ? Lu depuis sa ligne en base.
 *
 * Seul endroit où une ligne client devient l'entrée de
 * `clientLifecycleForWeek`. Chaque écran assemblait cette entrée à la main, et
 * le jour où la fin de contrat s'est jugée sur les jours de publication, il
 * aurait fallu penser à les ajouter partout : un oubli, et le planning, la
 * production et la création de fiche ne s'accordaient plus sur la semaine où
 * la gestion s'arrête.
 */
export function weekLifecycle(row: WeekExpectationRow, weekStart: string): ClientLifecycle {
  return lifecycleOf(row, clientFormula(row), weekStart);
}

/**
 * Une fiche existante reste-t-elle affichée pour cette semaine ?
 *
 * Une fiche déjà partie chez le client reste visible quoi qu'il arrive : le
 * filtre sert à ne pas proposer de travail hors gestion, pas à escamoter un
 * travail réel sur la foi d'une date de contrat mal saisie. Seul un brouillon
 * jamais transmis disparaît quand le client n'est pas en gestion cette
 * semaine-là. Client inconnu (inactif, hors liste) : visible, comme avant.
 *
 * Partagé par le Planning et le tableau de bord, pour que « à préparer » ne
 * compte pas un brouillon que le Planning ne montre plus.
 */
export function sheetShownForWeek(
  status: string,
  client: WeekExpectationRow | undefined,
  weekStart: string,
): boolean {
  if (!["draft", "internal_review", "ready_to_send"].includes(status)) return true;
  return !client || weekLifecycle(client, weekStart).canProduce;
}

function lifecycleOf(row: WeekExpectationRow, formula: ClientFormula, weekStart: string): ClientLifecycle {
  return clientLifecycleForWeek({
    isActive: row.is_active,
    kind: parseClientKind(row.client_kind),
    contractStartDate: formula.contractStartDate,
    contractEndDate: formula.contractEndDate,
    pauseStartDate: formula.pauseStartDate,
    pauseEndDate: formula.pauseEndDate,
    publicationWeekdays: formula.publicationWeekdays,
  }, weekStart);
}

/**
 * @param weekStart lundi de la semaine, en date civile. Le numéro de semaine
 * ISO en est déduit : le passer à part laissait la porte ouverte à un lundi et
 * un numéro qui ne se correspondent pas.
 */
export function weekExpectation(row: WeekExpectationRow, weekStart: string): WeekExpectation {
  const formula = clientFormula(row);
  if (!lifecycleOf(row, formula, weekStart).canProduce) return { kind: "off_contract" };

  const { week } = isoWeekIdentity(new Date(`${weekStart}T00:00:00Z`));
  const formats = weeklyFormatsForCadence(formula.cadence, week);
  return formats.length ? { kind: "publish", formats } : { kind: "off_week" };
}

/**
 * Clients à qui proposer une fiche pour la semaine : ceux qui publient cette
 * semaine-là et n'ont pas encore de fiche.
 *
 * Partagé par le planning (« à créer ») et le tableau de bord (« Fiches à
 * préparer ») : deux calculs donnaient deux chiffres pour la même question.
 */
export function sheetsToCreate<T extends WeekExpectationRow & { id: string }>(
  clients: readonly T[],
  coveredClientIds: ReadonlySet<string>,
  weekStart: string,
): Array<{ client: T; formats: MediaFormat[] }> {
  const proposals: Array<{ client: T; formats: MediaFormat[] }> = [];
  for (const client of clients) {
    if (coveredClientIds.has(client.id)) continue;
    const expectation = weekExpectation(client, weekStart);
    if (expectation.kind === "publish") proposals.push({ client, formats: expectation.formats });
  }
  return proposals;
}
