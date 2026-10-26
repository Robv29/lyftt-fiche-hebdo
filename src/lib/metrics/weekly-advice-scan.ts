import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_FORMULA_COLUMNS } from "@/lib/domain/client-formula";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { isServiceRequest, type TicketType } from "@/lib/domain/ticket-types";
import type { MediaFormat, SheetStatus } from "@/lib/domain/types";
import { captionSignatureFor } from "@/lib/domain/sheet-status";
import {
  adviceOpensAt,
  adviceWeek,
  weeklyAdvice,
  weeklyAdviceFacts,
  type AdviceClientRow,
  type AdviceItemRow,
  type WeeklyAdviceResult,
} from "@/lib/domain/weekly-advice";
import { readUnclassifiedShootings } from "@/lib/shootings/query";
import { defaultMetricsSince, readAgencyMetrics } from "./agency-metrics";

/**
 * La lecture du diagnostic hebdomadaire : requêtes, et rien d'autre.
 *
 * Tout ce qui compte, trie ou formule est dans `@/lib/domain/weekly-advice`.
 * Ce module ramène des lignes, les renomme, et appelle le module pur. La
 * frontière est la même que celle d'`agency-metrics.ts` : `server-only` d'un
 * côté, règle testable de l'autre.
 *
 * **Le score n'est pas recalculé ici.** `readAgencyMetrics` est la seule
 * lecture du score de l'agence, partagée par le tableau de bord et Indicateurs ;
 * en forker une seconde aurait donné deux notes à la même agence dès la
 * première règle corrigée d'un seul côté — ce qui est déjà arrivé dans cette
 * application. Elle est appelée **une** fois, en `isAdmin`, parce que le
 * diagnostic est désormais unique et complet : la note stockée doit être celle
 * qui porte les deux mesures budgétaires, sans quoi les deux conseils tirés du
 * budget annonceraient des points que la note affichée ne contient pas.
 */

export interface WeeklyAdviceScan {
  isoYear: number;
  isoWeek: number;
  /** Lundi civil parisien de la semaine diagnostiquée. */
  weekStart: string;
  /** Instant d'ouverture de la pop-up : lundi 14 h 30 à Paris. */
  opensAt: string;
  /** Fenêtre réellement analysée. */
  windowSince: string;
  /** Le diagnostic de la semaine. Un seul, complet, pour toute l'équipe. */
  advice: WeeklyAdviceResult;
}

/** Une fiche et ses publications, telles que la requête les ramène. */
type SheetWithItems = {
  id: string;
  client_id: string;
  status: string;
  period_start: string;
  clients: { post_signature: string | null } | null;
  weekly_sheet_items: Array<{
    caption: string | null;
    format: string;
    media_asset_id: string | null;
    media_external_url: string | null;
    is_cancelled: boolean;
  }> | null;
};

/** Nombre de hashtags figés sur la fiche d'un client, lu dans ses réglages. */
function pinnedHashtagCount(notes: string | null): number {
  try {
    const parsed = notes ? JSON.parse(notes) : null;
    const pinned = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).pinnedHashtags : null;
    return Array.isArray(pinned) ? pinned.length : 0;
  } catch {
    // Réglages illisibles : aucune liste validée, ce qui est la vérité utile.
    return 0;
  }
}

/**
 * Publications d'une fiche, avec la signature qu'il faut pour juger la légende.
 *
 * `signature` dit à la règle sur quoi comparer. Sur une fiche jamais partie, on
 * passe par `captionSignatureFor` — la même porte que le verrou des 100 %. Sur
 * une fiche déjà chez le client, `captionSignatureFor` renvoie `null` pour ne
 * pas réécrire son historique : mais ici on ne note rien, on **signale** une
 * publication partie avec la signature pour seul texte. La signature est donc
 * passée directement, et c'est tout l'objet du conseil.
 */
function itemsOf(sheet: SheetWithItems, options: { alreadySent: boolean }): AdviceItemRow[] {
  const signature = options.alreadySent
    ? (sheet.clients?.post_signature ?? null)
    : captionSignatureFor(sheet.status, sheet.clients?.post_signature);
  return (sheet.weekly_sheet_items ?? []).map((item) => ({
    clientId: sheet.client_id,
    format: item.format as MediaFormat,
    caption: item.caption,
    isCancelled: item.is_cancelled,
    hasMedia: Boolean(item.media_asset_id || item.media_external_url),
    signature,
  }));
}

/**
 * Le diagnostic de la semaine, calculé sur la production réelle.
 *
 * Lecture seule, du début à la fin : rien n'est écrit ici. Une lecture qui
 * échoue lève, et c'est l'appelant — la tâche planifiée — qui décide. C'est
 * exactement ce qu'il faut : une liste partielle produirait un diagnostic faux,
 * et un diagnostic faux lu par toute l'équipe coûte plus cher qu'un diagnostic
 * manquant.
 *
 * Le client passé ici doit être le client à privilèges : une tâche planifiée
 * n'a pas de session, `auth.uid()` est nul, et toutes les politiques de lecture
 * passent par `can_access_client`. Sous RLS, la lecture ne ramènerait aucune
 * ligne et le diagnostic conclurait que tout va bien.
 */
export async function scanWeeklyAdvice(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WeeklyAdviceScan> {
  const week = adviceWeek(now);
  const windowSince = defaultMetricsSince();
  const sinceTs = new Date(`${windowSince}T00:00:00Z`).toISOString();
  const today = todayInParis(now);

  const nextStart = new Date(`${week.weekStart}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() + 7);
  const nextWeekStart = nextStart.toISOString().slice(0, 10);
  const weekEnd = new Date(nextStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const SHEET_FIELDS = "id, client_id, status, sent_to_client_at, approved_at, validation_deadline_at, period_start";
  const SHEET_WITH_ITEMS = "id, client_id, status, period_start, clients ( post_signature ), "
    + "weekly_sheet_items ( caption, format, media_asset_id, media_external_url, is_cancelled )";

  /*
   * Deux requêtes par famille plutôt qu'un `or`, comme `agency-metrics.ts` :
   * un filtre composé mal interprété ne lève pas, il renvoie une liste vide —
   * et le diagnostic annoncerait « rien à signaler » un lundi où tout est en
   * retard. Chaque requête ne dit qu'une chose, les résultats se rejoignent en
   * mémoire.
   */
  const [
    metrics,
    clientRows,
    sentSheets,
    approvedSheets,
    receivedTickets,
    openTickets,
    versions,
    deliveredRequests,
    pendingRequests,
    weekSheets,
    sentItemSheets,
    trackingReports,
    unclassifiedShootings,
  ] = await Promise.all([
    readAgencyMetrics(supabase, { since: windowSince, isAdmin: true, withSatisfactionLogos: false }),
    unwrap(supabase.from("clients").select(`id, ${CLIENT_FORMULA_COLUMNS}, is_active`).eq("is_active", true)),
    unwrap(supabase.from("weekly_sheets").select(SHEET_FIELDS).gte("sent_to_client_at", sinceTs)),
    unwrap(supabase.from("weekly_sheets").select(SHEET_FIELDS).gte("approved_at", sinceTs)),
    unwrap(supabase
      .from("client_tickets")
      .select("id, client_id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at")
      .gte("submitted_at", sinceTs)),
    /*
     * Les retours encore ouverts, quelle que soit leur date : comme pour le
     * score, les borner à la fenêtre masquerait les plus anciens, c'est-à-dire
     * les pires.
     */
    unwrap(supabase
      .from("client_tickets")
      .select("id, client_id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at")
      .not("status", "in", "(approved_by_client,closed,rejected,out_of_scope,cancelled)")),
    unwrap(supabase.from("weekly_sheet_versions").select("weekly_sheet_id, source_ticket_id, sent_to_client_at")),
    unwrap(supabase.from("production_requests").select("client_id, due_on, delivered_at").gte("delivered_at", sinceTs)),
    unwrap(supabase
      .from("production_requests")
      .select("client_id, due_on, delivered_at")
      .is("delivered_at", null)
      .eq("status", "a_faire")),
    /*
     * Semaine en cours et semaine suivante en une seule lecture : ce sont les
     * deux semaines sur lesquelles on peut encore agir un lundi matin.
     */
    unwrap(supabase
      .from("weekly_sheets")
      .select(SHEET_WITH_ITEMS)
      .gte("period_start", week.weekStart)
      .lte("period_start", weekEnd.toISOString().slice(0, 10))),
    unwrap(supabase.from("weekly_sheets").select(SHEET_WITH_ITEMS).gte("sent_to_client_at", sinceTs)),
    count(supabase.from("client_tracking_reports").select("id", { count: "exact", head: true }).eq("status", "a_faire")),
    readUnclassifiedShootings(supabase, today),
  ]);

  const clients: AdviceClientRow[] = clientRows.map((row) => ({
    id: row.id as string,
    is_active: Boolean(row.is_active),
    client_kind: (row.client_kind as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    contract_start_date: (row.contract_start_date as string | null) ?? null,
    contract_end_date: (row.contract_end_date as string | null) ?? null,
    pause_start_date: (row.pause_start_date as string | null) ?? null,
    pause_end_date: (row.pause_end_date as string | null) ?? null,
    pinnedHashtags: pinnedHashtagCount((row.notes as string | null) ?? null),
  }));

  // Une fiche envoyée puis validée dans la fenêtre ne doit compter qu'une fois.
  const sheets = [...new Map([...sentSheets, ...approvedSheets].map((row) => [row.id as string, row])).values()]
    .map((row) => ({
      id: row.id as string,
      clientId: row.client_id as string,
      status: row.status as SheetStatus,
      sentToClientAt: (row.sent_to_client_at as string | null) ?? null,
      approvedAt: (row.approved_at as string | null) ?? null,
      validationDeadlineAt: (row.validation_deadline_at as string | null) ?? null,
      periodStart: row.period_start as string,
    }));

  /*
   * Les demandes hors publication sortent du diagnostic des corrections, comme
   * elles sortent du score : un devis ou une envie pour la semaine prochaine ne
   * corrige aucun contenu, et les compter ferait baisser une mesure nommée
   * « validées sans correction » parce qu'un client a partagé une idée. Elles
   * ont leur propre conseil.
   */
  const openIds = new Set(openTickets.map((row) => row.id as string));
  const tickets = [...new Map([...receivedTickets, ...openTickets].map((row) => [row.id as string, row])).values()]
    .filter((row) => !isServiceRequest(row.ticket_type as TicketType))
    .map((row) => ({
      id: row.id as string,
      clientId: row.client_id as string,
      sheetId: (row.weekly_sheet_id as string | null) ?? null,
      type: row.ticket_type as TicketType,
      submittedAt: row.submitted_at as string,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      open: openIds.has(row.id as string),
    }));

  const weekSheetRows = weekSheets as unknown as SheetWithItems[];
  const nextWeekSheets = weekSheetRows
    .filter((sheet) => sheet.period_start === nextWeekStart)
    .map((sheet) => ({
      status: sheet.status as SheetStatus,
      clientId: sheet.client_id,
      items: itemsOf(sheet, { alreadySent: false }),
    }));
  const currentWeekItems = weekSheetRows
    .filter((sheet) => sheet.period_start === week.weekStart)
    .flatMap((sheet) => itemsOf(sheet, { alreadySent: false }));
  const sentItems = (sentItemSheets as unknown as SheetWithItems[])
    .flatMap((sheet) => itemsOf(sheet, { alreadySent: true }));

  const shared = {
    windowSince,
    now,
    clients,
    sheets,
    tickets,
    versions: versions.map((row) => ({
      sheetId: row.weekly_sheet_id as string,
      sourceTicketId: (row.source_ticket_id as string | null) ?? null,
      sentToClientAt: (row.sent_to_client_at as string | null) ?? null,
    })),
    requests: [...deliveredRequests, ...pendingRequests].map((row) => ({
      clientId: (row.client_id as string | null) ?? null,
      dueOn: row.due_on as string,
      deliveredAt: (row.delivered_at as string | null) ?? null,
    })),
    sentItems,
    nextWeekSheets,
    currentWeekItems,
    trackingReportsToFill: trackingReports,
    /*
     * Les demandes hors publication encore ouvertes se lisent dans la liste des
     * retours ouverts déjà ramenée : une requête de plus pour le même filtre
     * aurait fini par ne plus dire la même chose.
     */
    openServiceRequests: openTickets.filter((row) => isServiceRequest(row.ticket_type as TicketType)).length,
  };

  /*
   * Le diagnostic complet, et la note qui lui correspond.
   *
   * Les deux comptes tirés du budget entrent dans les faits, et les mesures
   * budgétaires entrent dans la note : ce sont les deux faces de la même
   * décision. Les servir sans elles rendrait les pastilles « +n pts » fausses ;
   * garder la note sans eux cacherait deux écarts que la note reproche.
   *
   * Ce qui est stocké reste des comptes et des identifiants. Aucune colonne de
   * prix n'est lue par une règle, et aucun nom de dossier n'entre dans une
   * phrase : la résolution des noms est faite plus tard, sous la RLS de celui
   * qui lit.
   */
  const facts = weeklyAdviceFacts({
    ...shared,
    health: metrics.health,
    actions: metrics.healthActions,
    unclassifiedShootings,
    budgetIssueClientIds: metrics.budgetIssueClientIds,
  });

  return {
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    weekStart: week.weekStart,
    opensAt: adviceOpensAt(week.weekStart).toISOString(),
    windowSince,
    advice: weeklyAdvice(facts),
  };
}

/**
 * Lignes d'une requête, ou une erreur qui remonte.
 *
 * Une lecture muette produirait un diagnostic faux : « aucune fiche en
 * brouillon » parce que la requête a échoué se lit exactement comme « tout est
 * prêt ». L'appelant est une tâche planifiée, pas un écran : elle a le droit
 * d'échouer bruyamment.
 */
async function unwrap<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Lecture impossible : ${error.message}`);
  return data ?? [];
}

async function count(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count: total, error } = await query;
  if (error) throw new Error(`Comptage impossible : ${error.message}`);
  return total ?? 0;
}
