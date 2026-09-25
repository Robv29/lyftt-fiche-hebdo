/**
 * Le calendrier de la production : quel jour porte quoi.
 *
 * La file dit ce qu'il y a à faire, le calendrier dit *quand*. Les deux lisent
 * les mêmes commandes et les mêmes corrections — il faut donc qu'elles
 * s'accordent, et qu'aucune des deux n'invente sa propre définition :
 *
 *   1. Le jour d'une tâche. Une date civile est une chaîne `YYYY-MM-DD`, jamais
 *      une `Date` locale : un fuseau en retard sur UTC ferait glisser la moitié
 *      du mois d'une case vers la gauche. Tout se lit et s'écrit en UTC, et
 *      « aujourd'hui » vient de `todayInParis()`.
 *   2. L'urgence d'une tâche — dépassée, demain, ni l'un ni l'autre. C'est
 *      `ProductionUrgency`, le même type que la carte, la pastille de
 *      navigation et le sous-menu : la couleur d'une case ne peut pas diverger
 *      de celle de la carte qu'elle représente.
 *   3. Ce que valent « Pour vous », « Mes demandes », « À confier », « En
 *      retard » et les trois menus de la barre de filtres : `inBoardScope` et
 *      `matchesBoardFilters`, importés de la file, pas récrits ici.
 *
 * Module pur : aucune lecture, aucun accès réseau, aucun « use client ». La
 * page, le composant et l'action de déplacement l'importent tous les trois.
 */

import { nextDay, todayInParis } from "./client-lifecycle";
import { productionUrgency, type ProductionUrgency } from "./production";
import { inBoardScope, type BoardScope } from "./production-board";
import type { ProductionRequestKind, ProductionRequestStatus } from "./production-requests";
import { PRODUCTION_KIND_LABELS } from "./production-requests";

// ---------------------------------------------------------------------------
// Dates civiles
// ---------------------------------------------------------------------------

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date civile réelle ?
 *
 * L'expression régulière seule laisse passer le 31 février : l'action de
 * déplacement rendrait alors le message d'erreur de PostgreSQL à l'écran. Le
 * retour à l'identique écarte aussi bien les jours inexistants que les mois
 * hors bornes.
 */
export function isCivilDate(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Mois d'une date civile, au format `YYYY-MM`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** 1 = lundi … 7 = dimanche, comme partout ailleurs dans l'application. */
function isoDayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Mois voisin : `shiftMonth("2026-01", -1)` vaut `"2025-12"`. */
export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, index! - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Dernier jour du mois, en date civile. */
export function monthEnd(month: string): string {
  const [year, index] = month.split("-").map(Number);
  // Jour 0 du mois suivant : le dernier du mois demandé, années bissextiles comprises.
  return new Date(Date.UTC(year!, index!, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// La grille
// ---------------------------------------------------------------------------

export interface CalendarDay {
  date: string;
  /** Faux pour les jours d'un mois voisin qui complètent la première et la dernière semaine. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

export interface CalendarGrid {
  month: string;
  /** Semaines pleines de sept jours, lundi en tête. */
  weeks: CalendarDay[][];
}

/** En-têtes de colonnes, lundi d'abord — le même départ que `isoWeekStart`. */
export const WEEKDAY_HEADS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

/**
 * Grille d'un mois : des semaines entières, du lundi au dimanche.
 *
 * Le nombre de semaines suit le mois — quatre à six —, et non un carré fixe :
 * une sixième ligne vide en bas se lirait comme une semaine sans travail.
 */
export function monthGrid(month: string, today: string = todayInParis()): CalendarGrid {
  const first = `${month}-01`;
  const last = monthEnd(month);
  let cursor = addDays(first, -(isoDayOf(first) - 1));
  const weeks: CalendarDay[][] = [];

  do {
    const week: CalendarDay[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push({
        date: cursor,
        inMonth: monthOf(cursor) === month,
        isToday: cursor === today,
        isWeekend: isoDayOf(cursor) >= 6,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (weeks[weeks.length - 1]![6]!.date < last);

  return { month, weeks };
}

// ---------------------------------------------------------------------------
// Les tâches
// ---------------------------------------------------------------------------

/** D'où vient la tâche : une commande interne, ou une correction demandée par un client. */
export type CalendarSource = "commande" | "correction";

/**
 * Les quatre états que la grille sait peindre, dans l'ordre où ils appellent un
 * geste. « Demain » n'est pas « en retard » : l'un se rattrape encore, et les
 * deux ne peuvent pas partager la même couleur.
 */
export type CalendarState = "en_retard" | "demain" | "a_faire" | "livree";

export const CALENDAR_STATE_LABELS: Record<CalendarState, string> = {
  en_retard: "En retard",
  demain: "Demain",
  a_faire: "À produire",
  livree: "En attente de validation",
};

const STATE_RANK: Record<CalendarState, number> = { en_retard: 0, demain: 1, a_faire: 2, livree: 3 };

export interface CalendarTask {
  id: string;
  source: CalendarSource;
  clientId: string;
  clientName: string;
  title: string;
  /** « Vidéo », « Correction graphique » : ce que la tâche demande de produire. */
  kindLabel: string;
  /** Jour civil de l'échéance, ou `null` — une correction peut n'en pas avoir. */
  dueOn: string | null;
  /**
   * Où en est la tâche, dans le vocabulaire de la file : ce qui reste à
   * produire, ce qui attend d'être validé. Le menu « Tous les états » dit ainsi
   * la même chose des deux côtés.
   */
  status: "a_faire" | "livree";
  /** Même type et même sens que sur la carte : la case ne repeint rien. */
  urgency: ProductionUrgency;
  assignedToId: string | null;
  assigneeLabel: string | null;
  /** Commande passée par la personne qui regarde. */
  isMine: boolean;
  assignedToViewer: boolean;
  /**
   * Déplaçable par la personne qui regarde — décidé côté serveur par
   * `productionRequestRights`, jamais déduit ici ni dans le composant.
   */
  canReschedule: boolean;
}

/**
 * Couleur de la tâche. Une tâche livrée n'a plus d'échéance qui vaille : elle
 * attend un contrôle, et c'est ce qu'elle doit dire — pas « en retard ».
 */
export function calendarState(task: Pick<CalendarTask, "status" | "urgency">): CalendarState {
  if (task.status === "livree") return "livree";
  if (task.urgency === "overdue") return "en_retard";
  if (task.urgency === "due_tomorrow") return "demain";
  return "a_faire";
}

export interface RequestTaskInput {
  id: string;
  clientId: string;
  clientName: string;
  kind: ProductionRequestKind;
  title: string;
  dueOn: string;
  status: ProductionRequestStatus;
  assignedToId: string | null;
  assigneeLabel: string | null;
  isMine: boolean;
  assignedToViewer: boolean;
  canReschedule: boolean;
}

/** Commande interne posée sur son échéance. */
export function taskFromRequest(input: RequestTaskInput, today: string = todayInParis()): CalendarTask {
  return {
    id: input.id,
    source: "commande",
    clientId: input.clientId,
    clientName: input.clientName,
    title: input.title,
    kindLabel: PRODUCTION_KIND_LABELS[input.kind],
    dueOn: input.dueOn,
    status: input.status === "a_faire" ? "a_faire" : "livree",
    urgency: productionUrgency({ dueOn: input.dueOn, status: input.status }, today),
    assignedToId: input.assignedToId,
    assigneeLabel: input.assigneeLabel,
    isMine: input.isMine,
    assignedToViewer: input.assignedToViewer,
    canReschedule: input.canReschedule,
  };
}

/**
 * Statuts d'une correction dont le fichier est déposé : elle ne se produit
 * plus, elle attend un contrôle puis part au client. Mêmes statuts que les
 * pieds de carte des corrections — « en attente de validation », « version
 * corrigée prête ».
 */
const CORRECTION_PRODUCED = [
  "ready_for_review",
  "internally_reviewed",
  "new_version_generated",
  "sent_back_to_client",
];

export interface CorrectionTaskInput {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  category: "graphic" | "video";
  /** Jour civil Europe/Paris de `due_at`, ou `null` : la colonne est nullable. */
  dueOn: string | null;
  status: string;
  /**
   * Retard sur lequel on peut encore agir — `isActionableOverdue`, calculé en
   * amont. Ne jamais le recalculer par `dueOn < today` : toutes les corrections
   * d'une semaine déjà publiée repeindraient le passé en rouge.
   */
  overdue: boolean;
  assignedToId: string | null;
  assigneeLabel: string | null;
  assignedToViewer: boolean;
}

/** Correction client posée sur l'échéance de validation dont elle est née. */
export function taskFromCorrection(input: CorrectionTaskInput, today: string = todayInParis()): CalendarTask {
  const produced = CORRECTION_PRODUCED.includes(input.status);
  return {
    id: input.id,
    source: "correction",
    clientId: input.clientId,
    clientName: input.clientName,
    title: input.title,
    kindLabel: input.category === "video" ? "Correction vidéo" : "Correction graphique",
    dueOn: input.dueOn,
    status: produced ? "livree" : "a_faire",
    urgency: produced ? null
      : input.overdue ? "overdue"
      : input.dueOn !== null && input.dueOn === nextDay(today) ? "due_tomorrow"
      : null,
    assignedToId: input.assignedToId,
    assigneeLabel: input.assigneeLabel,
    // Une correction vient du client : personne ici ne l'a « demandée ».
    isMine: false,
    assignedToViewer: input.assignedToViewer,
    // L'échéance d'une correction est celle de la validation client : elle ne se déplace pas ici.
    canReschedule: false,
  };
}

// ---------------------------------------------------------------------------
// Filtrer, comme la file
// ---------------------------------------------------------------------------

/**
 * La tâche entre-t-elle dans la vue choisie par les pastilles ?
 *
 * Les cinq vues sont celles de la file, et c'est `inBoardScope` qui les
 * définit. Une seule nuance, et elle tient à la donnée : « À confier » ne parle
 * que des commandes. Une correction sans affectation n'atteint jamais cet
 * écran — la jointure sur `client_ticket_assignments` l'écarte en amont —, donc
 * une correction qu'on voit ici est forcément confiée à quelqu'un, et la faire
 * figurer parmi ce qui reste à confier serait un mensonge.
 */
export function inCalendarScope(task: CalendarTask, scope: BoardScope): boolean {
  if (scope === "a_confier" && task.source !== "commande") return false;
  return inBoardScope(task, scope);
}

// ---------------------------------------------------------------------------
// Poser les tâches sur les jours
// ---------------------------------------------------------------------------

export interface CalendarPlacement {
  byDay: Map<string, CalendarTask[]>;
  /**
   * Tâches sans échéance. Elles ne tiennent dans aucune case et ne doivent pas
   * pour autant disparaître : une bande à part les porte.
   */
  undated: CalendarTask[];
}

function compareTasks(a: CalendarTask, b: CalendarTask): number {
  return STATE_RANK[calendarState(a)] - STATE_RANK[calendarState(b)]
    || a.clientName.localeCompare(b.clientName, "fr")
    || a.title.localeCompare(b.title, "fr")
    // Départage stable : deux tâches jumelles ne doivent pas changer de place d'un rendu à l'autre.
    || a.id.localeCompare(b.id);
}

/** Range les tâches par jour, le plus urgent d'abord dans chaque journée. */
export function placeTasks(tasks: readonly CalendarTask[]): CalendarPlacement {
  const byDay = new Map<string, CalendarTask[]>();
  const undated: CalendarTask[] = [];

  for (const task of tasks) {
    if (task.dueOn === null) {
      undated.push(task);
      continue;
    }
    const day = byDay.get(task.dueOn);
    if (day) day.push(task);
    else byDay.set(task.dueOn, [task]);
  }

  for (const day of byDay.values()) day.sort(compareTasks);
  undated.sort(compareTasks);
  return { byDay, undated };
}

export interface DayWorkload {
  date: string;
  tasks: CalendarTask[];
  total: number;
  late: number;
  /** Commandes que personne n'a prises : ce que la journée attend encore de quelqu'un. */
  unassigned: number;
}

/** Ce que pèse une journée : de quoi remplir la pastille d'une case. */
export function dayWorkload(date: string, placement: CalendarPlacement): DayWorkload {
  const tasks = placement.byDay.get(date) ?? [];
  return {
    date,
    tasks,
    total: tasks.length,
    late: tasks.filter((task) => calendarState(task) === "en_retard").length,
    unassigned: tasks.filter((task) => inCalendarScope(task, "a_confier")).length,
  };
}

/**
 * Agenda des jours chargés — la réponse de l'écran étroit, où une grille de
 * sept colonnes ne tient pas. Mêmes jours que la grille, jours vides écartés :
 * rien de ce qui se voit sur ordinateur ne manque sur téléphone.
 */
export function monthAgenda(grid: CalendarGrid, placement: CalendarPlacement): DayWorkload[] {
  return grid.weeks
    .flat()
    .map((day) => dayWorkload(day.date, placement))
    .filter((day) => day.total > 0);
}

/** Ce que pèse le mois affiché : la ligne de résumé sous le titre. */
export function monthWorkload(grid: CalendarGrid, placement: CalendarPlacement): { total: number; late: number } {
  const days = grid.weeks.flat().map((day) => dayWorkload(day.date, placement));
  return {
    total: days.reduce((sum, day) => sum + day.total, 0),
    late: days.reduce((sum, day) => sum + day.late, 0),
  };
}

// ---------------------------------------------------------------------------
// Naviguer
// ---------------------------------------------------------------------------

/**
 * Mois entre lesquels il y a quelque chose à voir.
 *
 * Le mois courant en fait toujours partie, même vide : c'est celui sur lequel
 * le calendrier s'ouvre. Au-delà, la pagination s'arrête — la page ne charge
 * que les commandes ouvertes, aller plus loin ne montrerait jamais rien.
 */
export function monthRange(
  tasks: readonly CalendarTask[],
  today: string = todayInParis(),
): { first: string; last: string } {
  let first = monthOf(today);
  let last = first;
  for (const task of tasks) {
    if (task.dueOn === null) continue;
    const month = monthOf(task.dueOn);
    if (month < first) first = month;
    if (month > last) last = month;
  }
  return { first, last };
}

// ---------------------------------------------------------------------------
// Dire les dates en français
// ---------------------------------------------------------------------------

/*
 * Toutes les dates civiles se formatent en UTC : lues dans le fuseau du
 * navigateur, elles afficheraient la veille à l'ouest de Greenwich.
 */
const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function asDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** « septembre 2026 ». */
export function monthLabel(month: string): string {
  return MONTH_FORMAT.format(asDate(`${month}-01`));
}

/** « lundi 28 septembre ». */
export function dayLabel(date: string): string {
  return DAY_FORMAT.format(asDate(date));
}

/** Numéro du jour, pour la tête de case. */
export function dayNumber(date: string): number {
  return Number(date.slice(8));
}
