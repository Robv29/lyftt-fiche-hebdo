/**
 * Ponctualité des commandes de production internes.
 *
 * Une commande interne porte une date limite convenue entre collègues. Tenir
 * cette date est ce qui permet au community manager de préparer sa fiche à
 * temps ; la manquer décale toute la semaine, sans que rien ne le signale
 * aujourd'hui.
 *
 * Ce module est l'unique définition de « à l'heure » : l'indicateur de
 * l'agence, l'historique de production et ses synthèses par personne en
 * dérivent tous. Deux calculs séparés finissent toujours par diverger — un
 * taux à 56 % d'un côté, 60 % de l'autre, et plus personne ne croit aucun des
 * deux.
 */

import { todayInParis } from "./client-lifecycle";

export type ProductionRequestKind = "video" | "photo" | "visuel";
export type ProductionRequestStatus = "a_faire" | "livree" | "validee";

/** Natures de commande, telles que l'enum `production_request_kind` les nomme. */
export const PRODUCTION_KIND_LABELS: Record<ProductionRequestKind, string> = {
  video: "Vidéo",
  photo: "Photo",
  visuel: "Visuel",
};

/**
 * Rôles à qui l'on confie une commande. Même liste que la fonction SQL
 * `production_assignees()` et que le contrôle du déclencheur : ceux qui
 * produisent, encadrement de production compris.
 */
export const PRODUCTION_ASSIGNEE_ROLES = ["production_manager", "graphic_designer", "video_editor"] as const;

// ---------------------------------------------------------------------------
// Verdict d'une commande
// ---------------------------------------------------------------------------

export type ProductionVerdict =
  /** Livrée au plus tard le jour de l'échéance. */
  | { kind: "on_time" }
  /** Livrée après l'échéance ; `days` jours calendaires de retard. */
  | { kind: "late"; days: number }
  /** Pas encore livrée, et l'échéance n'est pas passée. */
  | { kind: "pending" }
  /** Pas livrée, échéance passée : le retard court encore. */
  | { kind: "overdue"; days: number }
  /** Close sans date de livraison : on ne peut rien en dire. */
  | { kind: "unknown" };

export interface VerdictInput {
  /** Date limite convenue à la commande (AAAA-MM-JJ). */
  dueOn: string;
  /** Instant de la livraison du fichier, ou null. */
  deliveredAt: string | null;
  /** Statut de la commande ; sert seulement à reconnaître une clôture sans livraison. */
  status?: ProductionRequestStatus;
}

const DAY_MS = 86_400_000;

/** Écart en jours calendaires entre deux dates AAAA-MM-JJ. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Verdict d'une commande, jugé au jour calendaire de Paris.
 *
 * L'échéance est une date, pas un instant : livrer à 18 h le jour dit, c'est
 * tenir sa parole ; livrer à 0 h 30 le lendemain, c'est un jour de retard —
 * même si l'horloge UTC dit encore la veille. Le retard se compte en jours
 * entiers, comme on le dit entre collègues : « livré avec deux jours de
 * retard », pas « 1,6 jour ».
 */
export function productionVerdict(
  request: VerdictInput,
  today: string = todayInParis(),
): ProductionVerdict {
  if (request.deliveredAt) {
    const deliveredOn = todayInParis(new Date(request.deliveredAt));
    const days = daysBetween(request.dueOn, deliveredOn);
    return days > 0 ? { kind: "late", days } : { kind: "on_time" };
  }
  // Validée sans livraison datée : un état que l'application n'autorise plus,
  // mais qu'une ligne ancienne pourrait porter. Ne pas l'inventer en retard.
  if (request.status === "validee") return { kind: "unknown" };
  const overdueDays = daysBetween(request.dueOn, today);
  return overdueDays > 0 ? { kind: "overdue", days: overdueDays } : { kind: "pending" };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

/** Libellé court du verdict, identique partout où il s'affiche. */
export function productionVerdictLabel(verdict: ProductionVerdict): string {
  switch (verdict.kind) {
    case "on_time": return "À l’heure";
    case "late": return `En retard de ${plural(verdict.days, "jour")}`;
    case "pending": return "En attente";
    case "overdue": return `Non livrée · ${plural(verdict.days, "jour")} de retard`;
    case "unknown": return "Livraison non datée";
  }
}

// ---------------------------------------------------------------------------
// Indicateur de l'agence
// ---------------------------------------------------------------------------

export interface DeliveredRequest {
  /** Date limite convenue à la commande. */
  dueOn: string;
  /** Instant de la livraison du fichier. */
  deliveredAt: string;
}

export interface ProductionPunctuality {
  /** Part des commandes livrées dans les temps, en pourcentage. Null sans livraison. */
  percentage: number | null;
  delivered: number;
  onTime: number;
  late: number;
  /** Retard moyen des livraisons en retard, en jours. Null s'il n'y en a aucune. */
  averageDelayDays: number | null;
}

function averageRounded(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

/**
 * Ponctualité des livraisons : ce qui a été **livré**, à la date de
 * livraison — pas ce qui traîne encore, qui se lit sur l'écran de production.
 */
export function productionPunctuality(
  requests: readonly DeliveredRequest[],
): ProductionPunctuality {
  const delivered = requests.length;
  if (delivered === 0) {
    return { percentage: null, delivered: 0, onTime: 0, late: 0, averageDelayDays: null };
  }

  const lateDays = requests
    .map((request) => productionVerdict(request))
    .flatMap((verdict) => (verdict.kind === "late" ? [verdict.days] : []));
  const onTime = delivered - lateDays.length;

  return {
    percentage: Math.round((onTime / delivered) * 100),
    delivered,
    onTime,
    late: lateDays.length,
    averageDelayDays: averageRounded(lateDays),
  };
}

// ---------------------------------------------------------------------------
// Historique de production
// ---------------------------------------------------------------------------

export interface ProductionHistoryInput {
  dueOn: string;
  deliveredAt: string | null;
  status: ProductionRequestStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  deliveredById: string | null;
  deliveredByName: string | null;
}

/** Filtre de statut de l'historique : un verdict, ou tout. */
export type ProductionVerdictFilter = "a_lheure" | "en_retard" | "en_attente" | "non_livree_en_retard";

export function matchesVerdictFilter(verdict: ProductionVerdict, filter: ProductionVerdictFilter): boolean {
  switch (filter) {
    case "a_lheure": return verdict.kind === "on_time";
    case "en_retard": return verdict.kind === "late";
    case "en_attente": return verdict.kind === "pending";
    case "non_livree_en_retard": return verdict.kind === "overdue";
  }
}

export interface ProductionTally {
  orders: number;
  /** Livrées avec une date : la base du taux. */
  delivered: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  unknown: number;
  /** Part des livraisons à l'heure, en pourcentage. Null sans livraison. */
  onTimeRate: number | null;
  /** Retard moyen des seules livraisons en retard, en jours. */
  averageDelayDays: number | null;
}

export interface ProductionPersonTally extends ProductionTally {
  /** Identifiant de profil, ou nom figé si le profil a disparu ; null = non renseigné. */
  key: string | null;
  name: string | null;
}

export interface ProductionHistorySummary {
  total: ProductionTally;
  byPerson: ProductionPersonTally[];
}

/**
 * Personne qui répond d'une commande : celle à qui elle a été confiée ; à
 * défaut — commandes passées avant l'affectation —, celle qui l'a livrée.
 */
export function responsibleOf(row: Pick<ProductionHistoryInput, "assignedToId" | "assignedToName" | "deliveredById" | "deliveredByName">): {
  key: string | null; name: string | null;
} {
  if (row.assignedToId || row.assignedToName) {
    return { key: row.assignedToId ?? `nom:${row.assignedToName}`, name: row.assignedToName };
  }
  if (row.deliveredById || row.deliveredByName) {
    return { key: row.deliveredById ?? `nom:${row.deliveredByName}`, name: row.deliveredByName };
  }
  return { key: null, name: null };
}

/** Clé réservée au filtre des commandes sans personne connue. */
export const UNKNOWN_PERSON_KEY = "non_renseigne";

/**
 * Personnes liées à une commande — confiée à, livrée par — pour le filtre
 * « personne » : chercher Sinclair montre ce qui lui était confié comme ce
 * qu'il a livré à la place d'un autre.
 */
export function involvedPeople(
  row: Pick<ProductionHistoryInput, "assignedToId" | "assignedToName" | "deliveredById" | "deliveredByName">,
): { key: string; name: string | null }[] {
  const people = new Map<string, string | null>();
  if (row.assignedToId || row.assignedToName) {
    people.set(row.assignedToId ?? `nom:${row.assignedToName}`, row.assignedToName);
  }
  if (row.deliveredById || row.deliveredByName) {
    const key = row.deliveredById ?? `nom:${row.deliveredByName}`;
    if (!people.has(key)) people.set(key, row.deliveredByName);
  }
  return [...people].map(([key, name]) => ({ key, name }));
}

/**
 * La commande compte-t-elle dans la ponctualité de cette personne ? Même règle
 * que le tableau « Par personne » : une commande ne compte que pour celui qui
 * en répond, jamais pour deux personnes à la fois.
 */
export function isResponsible(
  row: Pick<ProductionHistoryInput, "assignedToId" | "assignedToName" | "deliveredById" | "deliveredByName">,
  personKey: string,
): boolean {
  return (responsibleOf(row).key ?? UNKNOWN_PERSON_KEY) === personKey;
}

/** La commande concerne-t-elle la personne choisie dans le filtre ? */
export function matchesPerson(
  row: Pick<ProductionHistoryInput, "assignedToId" | "assignedToName" | "deliveredById" | "deliveredByName">,
  personKey: string,
): boolean {
  if (personKey === UNKNOWN_PERSON_KEY) return responsibleOf(row).key === null;
  return involvedPeople(row).some((person) => person.key === personKey);
}

function tally(verdicts: readonly ProductionVerdict[]): ProductionTally {
  const lateDays: number[] = [];
  const counts = { onTime: 0, late: 0, pending: 0, overdue: 0, unknown: 0 };
  for (const verdict of verdicts) {
    if (verdict.kind === "on_time") counts.onTime += 1;
    else if (verdict.kind === "late") { counts.late += 1; lateDays.push(verdict.days); }
    else if (verdict.kind === "pending") counts.pending += 1;
    else if (verdict.kind === "overdue") counts.overdue += 1;
    else counts.unknown += 1;
  }
  const delivered = counts.onTime + counts.late;
  return {
    orders: verdicts.length,
    delivered,
    ...counts,
    onTimeRate: delivered === 0 ? null : Math.round((counts.onTime / delivered) * 100),
    averageDelayDays: averageRounded(lateDays),
  };
}

/**
 * Synthèse de l'historique : le taux se calcule sur les seules commandes
 * livrées — une commande en attente n'a encore rien tenu ni manqué. Les
 * commandes non livrées en retard sont comptées à part, pour qu'un retard qui
 * court encore ne disparaisse pas du tableau faute de livraison.
 */
export function productionHistorySummary(
  rows: readonly ProductionHistoryInput[],
  today: string = todayInParis(),
): ProductionHistorySummary {
  const verdicts = rows.map((row) => productionVerdict(row, today));

  const groups = new Map<string, { key: string | null; name: string | null; verdicts: ProductionVerdict[] }>();
  rows.forEach((row, index) => {
    const person = responsibleOf(row);
    const groupKey = person.key ?? "";
    const group = groups.get(groupKey) ?? { key: person.key, name: person.name, verdicts: [] };
    // Un profil renommé ne se dédouble pas : le premier nom lu reste.
    group.name = group.name ?? person.name;
    group.verdicts.push(verdicts[index]);
    groups.set(groupKey, group);
  });

  const byPerson = [...groups.values()]
    .map((group) => ({ key: group.key, name: group.name, ...tally(group.verdicts) }))
    // Les personnes nommées d'abord, par volume ; « non renseigné » ferme la liste.
    .sort((a, b) => Number(a.key === null) - Number(b.key === null)
      || b.orders - a.orders
      || (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  return { total: tally(verdicts), byPerson };
}

// ---------------------------------------------------------------------------
// Qui produit
// ---------------------------------------------------------------------------

/** Prénom : le premier mot du nom complet. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * Libellés courts des personnes de production : le prénom seul — « Sinclair »,
 * « Simon » —, suivi de l'initiale du nom quand deux prénoms se confondent.
 */
export function assigneeLabels(people: readonly { id: string; fullName: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const person of people) {
    const first = (firstNameOf(person.fullName) ?? person.fullName).toLocaleLowerCase("fr");
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return new Map(people.map((person) => {
    const first = firstNameOf(person.fullName) ?? person.fullName;
    if ((counts.get(first.toLocaleLowerCase("fr")) ?? 0) < 2) return [person.id, first];
    const words = person.fullName.trim().split(/\s+/);
    const last = words.length > 1 ? words[words.length - 1] : "";
    return [person.id, last ? `${first} ${last.charAt(0).toLocaleUpperCase("fr")}.` : first];
  }));
}
