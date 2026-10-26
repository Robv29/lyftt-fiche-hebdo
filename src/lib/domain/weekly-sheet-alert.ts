import { parisFields } from "./paris-time";
import type { SheetStatus } from "./types";
import { weekExpectation, type WeekExpectationRow } from "./week-expectation";

/**
 * Alerte du vendredi : les fiches de la semaine prochaine qui ne sont pas
 * parties.
 *
 * La fiche se prépare le vendredi pour la semaine suivante, et le client valide
 * avant le mardi 10 h (`deadline.ts`) : le vendredi après-midi est donc le
 * dernier moment où l'on peut encore agir avant le week-end. Passé cette heure,
 * une fiche non envoyée ne se rattrape plus avant lundi, et la validation du
 * mardi devient intenable.
 *
 * Logique pure, sans réseau ni base : c'est ce qui permet de rejouer un vendredi
 * d'hiver, un vendredi d'été et un jeudi sans rien envoyer à personne.
 */

/** Vendredi, en jour de semaine ISO. */
export const ALERT_WEEKDAY = 5;

/**
 * L'heure demandée : vendredi 16 h, heure de Paris.
 *
 * Une seule constante pour toute la règle. Si l'heure doit bouger — l'usage
 * observé montre des envois jusqu'à 17 h 30 le vendredi —, c'est ici et nulle
 * part ailleurs.
 */
export const ALERT_HOUR = 16;

/**
 * Fin du créneau où la tâche peut encore agir (exclue).
 *
 * Le garde répond à « cette exécution a-t-elle le droit d'alerter ? », pas à
 * « est-il exactement 16 h ? ». Une tâche planifiée peut glisser, être rejouée
 * après une erreur, ou être appelée à la main : avec un `=== 16`, un retard de
 * soixante minutes faisait sauter l'alerte du vendredi en silence — le pire
 * défaut possible pour une alerte. Le créneau s'arrête à la fin de la journée
 * de travail (`WORK_END_HOUR`, `ticket-sla.ts`) : après 18 h, plus personne
 * n'enverra de fiche, et l'alerte n'aurait plus d'objet.
 *
 * Un seul e-mail part malgré tout : c'est l'unicité de la ligne de trace en
 * base qui le garantit, jamais l'horloge.
 */
export const ALERT_UNTIL_HOUR = 18;

/**
 * Cette exécution doit-elle agir ?
 *
 * Heure civile parisienne, heure d'été comprise : 16 h à Paris vaut 14 h UTC
 * en été et 15 h UTC en hiver. La tâche est donc planifiée aux deux heures UTC,
 * en deux entrées quotidiennes distinctes, et c'est ce garde qui tranche — `getDay()` et `getHours()`, eux, répondraient
 * selon le fuseau de la machine, c'est-à-dire UTC en production.
 */
export function isAlertWindow(now: Date): boolean {
  const { weekday, hour } = parisFields(now);
  return weekday === ALERT_WEEKDAY && hour >= ALERT_HOUR && hour < ALERT_UNTIL_HOUR;
}

/**
 * Date civile parisienne du vendredi : la clé de dédoublonnage.
 *
 * Lue à Paris et non en UTC : le 2 janvier à 00 h 30 à Paris est encore le
 * 1er janvier en UTC. Le créneau d'alerte est en milieu d'après-midi, loin de
 * cette frontière, mais la clé d'unicité d'une alerte ne doit pas dépendre de
 * l'endroit où tourne la machine.
 */
export function alertDate(now: Date): string {
  return parisFields(now).day;
}

/**
 * Pourquoi la fiche n'est pas partie. Un seul motif par client, et il est dit
 * dans l'e-mail : « il en manque quatre » sans dire lesquelles ni pourquoi
 * obligerait à ouvrir le planning pour savoir si c'est grave.
 */
export type MissingReason =
  /** Prête à envoyer : le travail est fait, personne n'a cliqué. */
  | "prete_non_envoyee"
  /** Le client détient une version que nous avons modifiée depuis. */
  | "a_renvoyer"
  /** En préparation ou en contrôle interne : jamais soumise. */
  | "brouillon"
  /** Aucune fiche n'existe pour cette semaine. */
  | "aucune_fiche"
  /** Refusée ou périmée : elle ne se reprend pas, elle se refait. */
  | "a_refaire";

/** Libellés français, affichés tels quels dans l'e-mail. */
export const MISSING_REASON_LABELS: Record<MissingReason, string> = {
  prete_non_envoyee: "prête, pas envoyée",
  a_renvoyer: "à renvoyer",
  brouillon: "brouillon",
  aucune_fiche: "aucune fiche",
  a_refaire: "à refaire",
};

/**
 * Ordre d'affichage : du plus vite rattrapable au plus long.
 *
 * À 16 h un vendredi, ce qui compte est ce qui peut encore partir avant le
 * week-end. Une fiche « prête » ou « à renvoyer » part en un clic ; un
 * brouillon demande de finir le travail ; sans fiche, tout reste à faire.
 */
export const MISSING_REASON_ORDER: readonly MissingReason[] = [
  "prete_non_envoyee",
  "a_renvoyer",
  "brouillon",
  "aucune_fiche",
  "a_refaire",
];

/**
 * Le statut de la fiche, et lui seul, dit si elle est partie.
 *
 * Ni `weekly_sheets.sent_to_client_at`, ni les lignes de
 * `client_message_dispatches` : la base contient des fiches validées par le
 * client dont ces deux traces sont vides — le lien a été envoyé à la main sur
 * WhatsApp et « Marquer comme envoyé » n'a jamais été cliqué. Alerter sur
 * elles serait une fausse alerte sur une fiche déjà approuvée. Le statut, lui,
 * ne quitte les trois statuts d'avant-envoi que par l'envoi lui-même.
 *
 * Table exhaustive et non liste de statuts « fautifs » : le jour où
 * `rejected` ou `expired` sera réellement écrit — l'énumération les déclare,
 * aucun code ne les pose aujourd'hui —, le compilateur réclamera une décision
 * au lieu de les ranger en silence du côté « envoyée ».
 */
const REASON_BY_STATUS: Record<SheetStatus, MissingReason | null> = {
  draft: "brouillon",
  internal_review: "brouillon",
  ready_to_send: "prete_non_envoyee",
  // Partie chez le client : la question posée est « est-elle partie ? », pas
  // « où en est la validation ? ». Un retour en cours a son propre délai
  // (`ticket-sla.ts`), et la fiche, elle, est bien arrivée.
  sent_to_client: null,
  partially_approved: null,
  changes_requested: null,
  corrections_in_progress: null,
  // Une version corrigée existe et n'est pas partie : le client garde tout le
  // week-end un contenu que nous avons remplacé.
  new_version_to_send: "a_renvoyer",
  awaiting_revalidation: null,
  approved_by_client: null,
  tacitly_approved: null,
  rejected: "a_refaire",
  expired: "a_refaire",
};

/** Motif d'alerte d'une fiche, ou `null` si elle est bien partie. */
export function missingReasonForStatus(status: SheetStatus): MissingReason | null {
  return REASON_BY_STATUS[status];
}

export interface WeeklySheetAlertClient extends WeekExpectationRow {
  id: string;
  name: string;
  /**
   * Faux : le dossier n'entre pas dans l'alerte. L'agence gère ses propres
   * réseaux sous le nom LYFTT et « aneto » est un compte d'essai — deux fiches
   * en brouillon permanent, donc deux fausses alertes chaque vendredi.
   */
  alertEnabled: boolean;
}

export interface MissingSheet {
  clientId: string;
  clientName: string;
  reason: MissingReason;
}

/**
 * Les fiches qui devaient partir et ne sont pas marquées comme envoyées.
 *
 * Le périmètre vient de `weekExpectation`, l'unique règle qui dit ce qu'on
 * attend d'un client une semaine donnée : un client hors contrat, en pause,
 * ponctuel, archivé ou dont le rythme vendu ne prévoit rien cette semaine-là
 * (deux vidéos par mois : une semaine sur deux) n'est jamais signalé. Le
 * recalculer ici, c'était promettre de reproduire à l'identique la fin de
 * contrat jugée sur les jours de publication, et réclamer tôt ou tard une fiche
 * que personne n'a vendue.
 *
 * @param sheets fiches de la semaine visée, déjà bornées à `(iso_year,
 * iso_week)`. La base garantit au plus une fiche par client et par semaine ;
 * si plusieurs arrivaient malgré tout, une seule partie suffit à ne pas
 * alerter — on ne réveille personne pour un doublon.
 */
export function missingWeeklySheets(input: {
  clients: readonly WeeklySheetAlertClient[];
  sheets: readonly { clientId: string; status: SheetStatus }[];
  /** Lundi de la semaine visée, en date civile. */
  weekStart: string;
}): MissingSheet[] {
  const statusesByClient = new Map<string, SheetStatus[]>();
  for (const sheet of input.sheets) {
    const statuses = statusesByClient.get(sheet.clientId) ?? [];
    statuses.push(sheet.status);
    statusesByClient.set(sheet.clientId, statuses);
  }

  const missing: MissingSheet[] = [];
  for (const client of input.clients) {
    if (!client.alertEnabled) continue;
    if (weekExpectation(client, input.weekStart).kind !== "publish") continue;

    const statuses = statusesByClient.get(client.id) ?? [];
    let reason: MissingReason;
    if (statuses.length === 0) {
      reason = "aucune_fiche";
    } else {
      const reasons = statuses.map(missingReasonForStatus);
      if (reasons.some((value) => value === null)) continue;
      // Doublon improbable (la base l'interdit) : le motif le plus proche de
      // l'envoi, pour ne pas annoncer « aucune fiche » quand un brouillon existe.
      reason = MISSING_REASON_ORDER.find((candidate) => reasons.includes(candidate))!;
    }
    missing.push({ clientId: client.id, clientName: client.name, reason });
  }

  return missing.sort((first, second) =>
    MISSING_REASON_ORDER.indexOf(first.reason) - MISSING_REASON_ORDER.indexOf(second.reason)
    || first.clientName.localeCompare(second.clientName, "fr"));
}

/**
 * Compte par motif, dans l'ordre d'affichage.
 *
 * Résume vingt lignes en une : « 2 sans fiche, 17 en brouillon » se lit sur un
 * téléphone, la liste complète non.
 */
export function missingCountsByReason(
  missing: readonly MissingSheet[],
): Array<{ reason: MissingReason; count: number }> {
  return MISSING_REASON_ORDER
    .map((reason) => ({ reason, count: missing.filter((sheet) => sheet.reason === reason).length }))
    .filter((entry) => entry.count > 0);
}
