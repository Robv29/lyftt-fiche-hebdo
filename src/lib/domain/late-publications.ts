import { isItemApprovedByClient, isPreSendSheetStatus } from "./sheet-status";
import type { ItemApprovalStatus, MediaFormat, SheetStatus } from "./types";

/**
 * Publications en retard : l'unique règle, pour l'écran comme pour la pop-up.
 *
 * Une publication est « en retard » quand sa date est passée et que personne
 * n'a coché « publié ». Trois filtres séparent le vrai retard du bruit, et
 * chacun a été mesuré sur la base :
 *
 * - **la fiche doit être partie chez le client** — 160 des 300 contenus en
 *   retard brut appartiennent à une fiche encore en brouillon : le planning de
 *   la semaine est saisi, la fiche n'est jamais envoyée, et les dates passent
 *   sans que rien ne soit publiable. C'est de loin la première source de fausse
 *   alerte, et c'est ce qui fait dire 37 à la pastille de l'écran là où 10
 *   seulement sont pertinents ;
 * - **le contenu doit être validé par le client** — sinon la case « Confirmer
 *   la publication » est grisée (`locked` dans `PublicationChecklist`). Nommer
 *   ces contenus, c'est réclamer un geste que l'écran refuse. Ils sont comptés
 *   à part (`awaitingApproval`) : le retard est réel, mais le geste est d'aller
 *   chercher la validation, pas de cocher ;
 * - **le dossier doit vouloir l'alerte** (`clients.weekly_sheet_alert`) — même
 *   raison que l'alerte du vendredi : LYFTT est l'agence elle-même et « aneto »
 *   un compte d'essai, deux dossiers en brouillon permanent.
 *
 * **Le jour même n'est pas une faute.** 527 des 533 contenus actifs sont
 * programmés à 18 h : un contenu daté d'aujourd'hui n'est pas en retard, la
 * journée n'est pas finie. Il entre dans `today` — une ligne de rappel dans une
 * fenêtre déjà ouverte — et jamais dans le compte ni dans le déclenchement.
 * Sinon la pop-up s'ouvrirait à 00 h 01 chaque matin pour le programme du jour.
 *
 * Aucun calcul de date ne passe par `weekly_sheets.period_start` ni par la
 * semaine ISO de la fiche : 9 contenus sont datés hors de la semaine de leur
 * propre fiche, et une reprogrammation déplace réellement `scheduled_date`.
 * Seule `scheduled_date` fait foi.
 */

/**
 * Largeur de la fenêtre de retard, en jours révolus avant aujourd'hui.
 *
 * Fenêtre glissante, et non semaine ISO. La semaine ISO rend l'alerte aveugle
 * tous les lundis — rien n'y est à la fois « cette semaine » et « avant
 * aujourd'hui » —, et ce n'est pas une hypothèse : le lundi 26 octobre, trois
 * contenus du vendredi 23 étaient réellement en retard et invisibles.
 *
 * Et elle reste videable. Tout le retard, sans borne, fait 68 contenus
 * remontant au 13 août : une fenêtre qu'on ne peut jamais ramener à zéro
 * s'apprend à ignorer, et emporte avec elle les alertes qui comptent — c'est
 * l'argument déjà écrit dans la coquille pour réserver la pastille des
 * shootings à ceux qui peuvent trancher.
 */
export const LATE_WINDOW_DAYS = 7;

/** Décalage de date civile, en UTC pour ne jamais croiser un changement d'heure. */
function shiftCivilDay(day: string, days: number): string {
  const result = new Date(`${day}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export interface LatePublicationWindow {
  /** Premier jour regardé, inclus. */
  since: string;
  /** Dernier jour regardé, inclus : hier. */
  until: string;
}

/** Fenêtre de retard pour une date civile parisienne donnée. */
export function latePublicationWindow(
  today: string,
  days: number = LATE_WINDOW_DAYS,
): LatePublicationWindow {
  return { since: shiftCivilDay(today, -days), until: shiftCivilDay(today, -1) };
}

/**
 * La fiche est-elle arrivée chez le client ?
 *
 * Les trois statuts d'avant-envoi sont lus à l'endroit unique qui les déclare
 * (`isPreSendSheetStatus`) : le commentaire de `sheet-status.ts` raconte
 * l'incident qu'avaient causé trois copies de ce triplet.
 *
 * La table reste exhaustive malgré cela, et c'est voulu : le jour où un statut
 * sera ajouté à l'énumération, le compilateur réclamera une décision au lieu de
 * le ranger en silence du côté « publiable ». `rejected` et `expired` y sont
 * faux — une fiche refusée ou périmée ne se reprend pas, elle se refait, et
 * l'alerte du vendredi les classe déjà ainsi.
 */
const REACHED_CLIENT: Record<SheetStatus, boolean> = {
  draft: false,
  internal_review: false,
  ready_to_send: false,
  sent_to_client: true,
  partially_approved: true,
  changes_requested: true,
  corrections_in_progress: true,
  new_version_to_send: true,
  awaiting_revalidation: true,
  approved_by_client: true,
  tacitly_approved: true,
  rejected: false,
  expired: false,
};

export function sheetReachedClient(status: SheetStatus): boolean {
  if (isPreSendSheetStatus(status)) return false;
  return REACHED_CLIENT[status];
}

/** Une ligne de `weekly_sheet_items`, telle que l'écran ou la coquille la lit. */
export interface LatePublicationRow {
  id: string;
  /** Date civile `YYYY-MM-DD`. */
  scheduledDate: string;
  scheduledTime: string | null;
  clientName: string;
  format: MediaFormat;
  approvalStatus: ItemApprovalStatus;
  sheetStatus: SheetStatus;
  /** `weekly_sheet_items.published_at` : la case « publié », et rien d'autre. */
  publishedAt: string | null;
  isCancelled: boolean;
  /** `clients.weekly_sheet_alert` — faux : le dossier n'entre pas dans l'alerte. */
  alertEnabled: boolean;
}

export interface LatePublicationEntry {
  id: string;
  scheduledDate: string;
  scheduledTime: string | null;
  clientName: string;
  format: MediaFormat;
}

export interface LatePublicationsView extends LatePublicationWindow {
  /** En retard et cochable, du plus ancien au plus récent. */
  late: LatePublicationEntry[];
  /**
   * En retard aussi, mais case grisée : le client n'a pas validé le contenu.
   * Comptés, jamais nommés — le geste n'est pas le même.
   */
  awaitingApproval: number;
  /** Programmées aujourd'hui, pas encore postées. Un rappel, pas une faute. */
  today: LatePublicationEntry[];
}

function entry(row: LatePublicationRow): LatePublicationEntry {
  return {
    id: row.id,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    clientName: row.clientName,
    format: row.format,
  };
}

/** Du plus ancien au plus récent : la date, puis l'heure, puis le dossier. */
function byDateThenClient(first: LatePublicationEntry, second: LatePublicationEntry): number {
  return first.scheduledDate.localeCompare(second.scheduledDate)
    || (first.scheduledTime ?? "").localeCompare(second.scheduledTime ?? "")
    || first.clientName.localeCompare(second.clientName, "fr");
}

/**
 * Les publications en retard, pour une date civile parisienne.
 *
 * @param input.rows contenus dont `scheduledDate` tombe dans la fenêtre ou
 * aujourd'hui. La requête borne la fenêtre ; la règle, elle, revérifie tout —
 * y compris `publishedAt` et `isCancelled` — pour qu'un appelant ne puisse pas
 * la contourner en oubliant un filtre.
 */
export function latePublications(input: {
  rows: readonly LatePublicationRow[];
  /** Date civile du jour à Paris, `YYYY-MM-DD`. */
  today: string;
  windowDays?: number;
}): LatePublicationsView {
  const window = latePublicationWindow(input.today, input.windowDays);

  const late: LatePublicationEntry[] = [];
  const today: LatePublicationEntry[] = [];
  let awaitingApproval = 0;

  for (const row of input.rows) {
    if (row.publishedAt !== null) continue;
    if (row.isCancelled) continue;
    if (!row.alertEnabled) continue;
    if (!sheetReachedClient(row.sheetStatus)) continue;

    const isToday = row.scheduledDate === input.today;
    const isLate = row.scheduledDate >= window.since && row.scheduledDate <= window.until;
    if (!isToday && !isLate) continue;

    if (!isItemApprovedByClient(row.approvalStatus)) {
      // Le jour même en attente de validation n'est ni un retard ni un rappel :
      // la journée n'est pas finie et la case serait grisée de toute façon.
      if (isLate) awaitingApproval += 1;
      continue;
    }

    (isToday ? today : late).push(entry(row));
  }

  late.sort(byDateThenClient);
  today.sort(byDateThenClient);

  return { ...window, late, awaitingApproval, today };
}

/**
 * La pop-up doit-elle s'ouvrir ?
 *
 * Le compte seul décide : ni `awaitingApproval`, qui ne se coche pas, ni
 * `today`, qui n'est pas encore en retard. Les deux n'apparaissent qu'à
 * l'intérieur d'une fenêtre ouverte pour autre chose.
 */
export function hasLatePublications(view: LatePublicationsView): boolean {
  return view.late.length > 0;
}
