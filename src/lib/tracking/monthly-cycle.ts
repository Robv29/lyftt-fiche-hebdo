import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseClientKind, todayInParis, type ClientKind } from "@/lib/domain/client-lifecycle";
import { fallbackRolesFor } from "@/lib/domain/routing";
import { isOnSettledInvoice, type InvoiceStatus } from "@/lib/domain/invoicing";
import {
  TRACKING_REPORT_TARGET,
  TRACKING_SERVICE_KEYS,
  dueTrackingLines,
  findTrackingProduct,
  reconcileTrackingMonths,
  trackingLineLabel,
  trackingReportDueOn,
  trackingReportTitle,
  trackingMonthStart,
  trackingReportsToOpen,
  type TrackingLineRow,
  type TrackingSubscription,
} from "@/lib/domain/monthly-tracking";

/**
 * Cycle mensuel des produits de suivi : les lignes, puis les comptes rendus.
 *
 * Deux opérations, toutes deux **rejouables sans précaution** — la tâche
 * planifiée passe chaque nuit, et l'écran budget rattrape à l'ouverture. Leur
 * idempotence est portée par la base : un index unique par (client, produit,
 * mois) sur les lignes, une contrainte d'unicité de même forme sur les comptes
 * rendus. C'est le motif des mois de gestion, pour la même raison.
 */

export interface TrackingCycleClient {
  id: string;
  isActive: boolean;
  kind: ClientKind;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
}

/** Les colonnes de `clients` dont le cycle a besoin, et rien de plus. */
export const TRACKING_CYCLE_CLIENT_COLUMNS =
  "id, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date";

/**
 * Une ligne de `clients` telle que le cycle la lit.
 *
 * Une seule conversion pour les deux appelants — la tâche planifiée et l'écran
 * budget : deux lectures écrites séparément sont le plus court chemin pour que
 * l'une oublie la pause et l'autre non.
 */
export function trackingCycleClient(row: Record<string, unknown>): TrackingCycleClient {
  return {
    id: row.id as string,
    isActive: row.is_active !== false,
    kind: parseClientKind(row.client_kind),
    contractStartDate: (row.contract_start_date as string | null) ?? null,
    contractEndDate: (row.contract_end_date as string | null) ?? null,
    pauseStartDate: (row.pause_start_date as string | null) ?? null,
    pauseEndDate: (row.pause_end_date as string | null) ?? null,
  };
}

/**
 * Inscription à l'addition des mois dus par les prestations de suivi.
 *
 * La ligne est `ponctuel`, posée au premier du mois, quantité = fréquence
 * vendue, prix = prix d'un rendez-vous : le mois coûte donc prix × fréquence,
 * ce que `lineTotalCents` calcule déjà. Rien n'est à changer dans la
 * composition des factures.
 *
 * Écrit avec le client passé en paramètre : celui de l'utilisateur depuis
 * l'écran budget — où la RLS `super_admin` garde le dernier mot —, celui de la
 * clé service depuis la tâche planifiée.
 */
export async function syncTrackingLines(
  supabase: SupabaseClient,
  client: TrackingCycleClient,
  today: string = todayInParis(),
): Promise<number> {
  /*
   * Dossier archivé : on ne touche à rien. La réconciliation retirerait ses
   * mois non facturés, alors qu'un archivage n'annule pas une prestation déjà
   * vendue — il met seulement le dossier de côté.
   */
  if (!client.isActive) return 0;

  const subscriptions = await readSubscriptions(supabase, client.id);
  const [{ data: existing }, { data: settled }] = await Promise.all([
    supabase
      .from("client_budget_lines")
      .select("id, service_key, performed_on, unit_price_cents, quantity")
      .eq("client_id", client.id)
      .in("service_key", TRACKING_SERVICE_KEYS),
    /*
     * Factures du client, tous statuts : une facture partie ne se recalcule
     * pas, et c'est `isOnSettledInvoice` qui dit sur laquelle une ligne tombe —
     * un mois antérieur au démarrage de gestion est reporté sur le mois de
     * démarrage. Filtrer ici sur les seuls statuts figés aurait privé ce calcul
     * de ce qu'il lui faut pour trancher.
     */
    supabase
      .from("client_invoices")
      .select("period_month, status")
      .eq("client_id", client.id),
  ]);

  const lines: TrackingLineRow[] = (existing ?? []).map((row) => ({
    id: row.id as string,
    serviceKey: row.service_key as string,
    performedOn: row.performed_on as string,
    unitPriceCents: row.unit_price_cents as number,
    quantity: Number(row.quantity),
  }));

  // Rien de vendu, rien d'inscrit : on s'arrête avant d'écrire quoi que ce soit.
  if (subscriptions.length === 0 && lines.length === 0) return 0;

  const due = dueTrackingLines({ subscriptions, client, today });
  /*
   * Un mois est verrouillé dès que sa ligne tomberait sur une facture établie,
   * son mois propre ou le mois de démarrage de gestion. On teste les mois dus
   * comme les mois déjà inscrits : ni réécriture, ni ajout sur une facture
   * partie.
   */
  const statuses = Object.fromEntries(
    (settled ?? []).map((row) => [String(row.period_month).slice(0, 10), row.status as InvoiceStatus]),
  );
  const lockedMonths = [...new Set([
    ...due.map((month) => month.month),
    ...lines.map((row) => trackingMonthStart(row.performedOn)),
  ])].filter((month) => isOnSettledInvoice({ performedOn: month }, client.contractStartDate, statuses));
  const { toInsert, toUpdate, staleIds } = reconcileTrackingMonths(due, lines, { lockedMonths });

  if (staleIds.length > 0) {
    await supabase.from("client_budget_lines").delete().in("id", staleIds);
  }

  for (const { id, month } of toUpdate) {
    const { error } = await supabase
      .from("client_budget_lines")
      .update({
        unit_price_cents: month.unitPriceCents,
        quantity: month.frequency,
        label: trackingLineLabel(month.label, month.month),
      })
      .eq("id", id);
    if (error) console.error("[suivi mensuel] mois non recalé", id, error.message);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("client_budget_lines").insert(
      toInsert.map((month) => ({
        client_id: client.id,
        service_key: month.serviceKey,
        label: trackingLineLabel(month.label, month.month),
        billing: "ponctuel",
        unit_price_cents: month.unitPriceCents,
        quantity: month.frequency,
        months: null,
        performed_on: month.month,
        note: `${month.frequency} rendez-vous de suivi ce mois-ci. Inscrit automatiquement au premier jour du mois.`,
      })),
    );
    /*
     * Un conflit signifie qu'une autre exécution a déjà inscrit le mois :
     * c'est exactement ce que l'index unique doit produire.
     */
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  return toInsert.length + toUpdate.length + staleIds.length;
}

/**
 * Ouverture des comptes rendus des mois clos.
 *
 * Un compte rendu par client, par produit et par mois, dû le 8 du mois
 * suivant — avant le premier rendez-vous proposé au client. L'insertion est
 * rejouable : la contrainte d'unicité écarte les doublons, et un conflit n'est
 * pas une erreur.
 *
 * Écrit avec la clé service : la table est en lecture et mise à jour pour
 * l'équipe, mais seule la tâche planifiée y crée des lignes.
 */
export async function openTrackingReports(
  admin: SupabaseClient,
  client: TrackingCycleClient,
  today: string = todayInParis(),
): Promise<number> {
  if (!client.isActive) return 0;

  const subscriptions = await readSubscriptions(admin, client.id);
  if (subscriptions.length === 0) return 0;

  const due = trackingReportsToOpen(dueTrackingLines({ subscriptions, client, today }), today);
  if (due.length === 0) return 0;

  const { data: existing } = await admin
    .from("client_tracking_reports")
    .select("service_key, period_month")
    .eq("client_id", client.id)
    .in("service_key", TRACKING_SERVICE_KEYS);

  const already = new Set(
    (existing ?? []).map((row) => `${row.service_key as string}|${String(row.period_month).slice(0, 10)}`),
  );
  const missing = due.filter((month) => !already.has(`${month.serviceKey}|${month.month}`));
  if (missing.length === 0) return 0;

  // Un seul responsable par client : la même personne pour ses deux produits.
  const assignee = await resolveReportOwner(admin, client.id);

  const { error } = await admin.from("client_tracking_reports").insert(
    missing.map((month) => ({
      client_id: client.id,
      service_key: month.serviceKey,
      period_month: month.month,
      due_on: trackingReportDueOn(month.month),
      assigned_to: assignee,
    })),
  );
  if (error && error.code !== "23505") throw new Error(error.message);

  /*
   * Notification interne, au mieux : la carte du tableau de bord, la pastille
   * de navigation et le calendrier de production suffisent à faire voir la
   * tâche. Un échec ici ne défait pas l'ouverture du compte rendu.
   */
  if (assignee) {
    for (const month of missing) {
      const product = findTrackingProduct(month.serviceKey);
      if (!product) continue;
      const { error: notifyError } = await admin.from("internal_notifications").insert({
        profile_id: assignee,
        title: "Compte rendu mensuel à remplir",
        body: `${trackingReportTitle(product, month.month)} — à rendre le ${trackingReportDueOn(month.month)}.`,
      });
      if (notifyError) console.error("[suivi mensuel] notification non envoyée", notifyError.message);
    }
  }

  return missing.length;
}

/** Prestations de suivi vendues à un client, closes comprises. */
async function readSubscriptions(
  supabase: SupabaseClient,
  clientId: string,
): Promise<TrackingSubscription[]> {
  const { data, error } = await supabase
    .from("client_tracking_services")
    .select("id, service_key, label, unit_price_cents, frequency, started_on, ended_on")
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  return (data ?? [])
    // Une clé retirée du catalogue ne doit plus rien inscrire.
    .filter((row) => TRACKING_SERVICE_KEYS.includes(row.service_key as string))
    .map((row) => ({
      id: row.id as string,
      serviceKey: row.service_key as string,
      label: row.label as string,
      unitPriceCents: row.unit_price_cents as number,
      frequency: Number(row.frequency),
      startedOn: String(row.started_on).slice(0, 10),
      endedOn: row.ended_on ? String(row.ended_on).slice(0, 10) : null,
    }));
}

/**
 * À qui revient le compte rendu de ce client.
 *
 * Par rôle, jamais par personne, et dans cet ordre :
 *   1. l'affectation portée par le client pour ce rôle — c'est elle qui permet
 *      de désigner nommément quelqu'un sans l'écrire dans le code ;
 *   2. à défaut, un profil actif du rôle, pris dans un ordre **déterministe** :
 *      deux profils portent `super_admin`, et « le premier venu » aurait donné
 *      un responsable différent d'un mois à l'autre ;
 *   3. à défaut, le repli d'encadrement des tickets (`fallbackRolesFor`), qui
 *      ne vaut que pour un responsable : une tâche sans responsable n'est vue
 *      de personne.
 */
async function resolveReportOwner(
  admin: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data: assigned } = await admin
    .from("client_assignments")
    .select("profile_id")
    .eq("client_id", clientId)
    .eq("role", TRACKING_REPORT_TARGET.role)
    .limit(1);
  const designated = assigned?.[0]?.profile_id as string | undefined;
  if (designated) return designated;

  for (const role of [TRACKING_REPORT_TARGET.role, ...fallbackRolesFor(TRACKING_REPORT_TARGET)]) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("role", role)
      .eq("is_active", true)
      // Ordre déterministe : le même responsable tous les mois.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);
    const profileId = data?.[0]?.id as string | undefined;
    if (profileId) return profileId;
  }

  console.error("[suivi mensuel] aucun profil pour le compte rendu", { clientId });
  return null;
}
