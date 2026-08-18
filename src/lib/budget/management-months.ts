import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MANAGEMENT_MONTH_KEY,
  cadenceMonthlyCostCents,
  dueManagementMonths,
  parseShootingPlan,
  reconcileManagementMonths,
  type ShootingPlan,
} from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";

/**
 * Inscription des mois de gestion dus à l'addition du client.
 *
 * La gestion se règle d'avance : le mois est inscrit le jour où il commence,
 * au tarif du rythme vendu ce jour-là, puis figé.
 * Écrire la ligne plutôt que recalculer un total a une conséquence voulue :
 * un changement de formule en cours de contrat ne réécrit pas les mois déjà
 * passés, qui ont bien été produits à l'ancien rythme.
 *
 * L'opération est rejouable sans précaution : un index unique en base écarte
 * les doublons, ce qui permet de l'appeler aussi bien depuis la tâche
 * planifiée qu'à l'ouverture de l'écran budget.
 */
export async function syncManagementMonths(
  supabase: SupabaseClient,
  client: {
    id: string;
    contractStartDate: string | null;
    contractEndDate: string | null;
    cadence: MonthlyCadence;
    /** Forfait shooting vendu, lissé sur sa période. */
    shooting?: ShootingPlan | null;
  },
  today: string = todayInParis(),
): Promise<number> {
  const monthlyCostCents = cadenceMonthlyCostCents(client.cadence, client.shooting ?? null);
  const expected = dueManagementMonths({
    contractStartDate: client.contractStartDate,
    contractEndDate: client.contractEndDate,
    monthlyCostCents,
    today,
  });
  if (expected.length === 0) return 0;

  const [{ data: existing }, { data: settled }] = await Promise.all([
    supabase
      .from("client_budget_lines")
      .select("id, performed_on")
      .eq("client_id", client.id)
      .eq("service_key", MANAGEMENT_MONTH_KEY),
    /*
     * Mois dont la facture est établie ou prélevée : ils sortent du champ de la
     * réconciliation. Une facture partie chez le client ne se recalcule pas —
     * une règle corrigée aujourd'hui réécrirait sinon des années d'historique
     * au tarif du jour, et l'addition ne correspondrait plus aux prélèvements.
     */
    supabase
      .from("client_invoices")
      .select("period_month")
      .eq("client_id", client.id)
      .in("status", ["faite", "prelevement_programme"]),
  ]);

  /*
   * Réconciliation, et pas seulement ajout.
   *
   * Une ligne posée à une date qui n'est plus attendue — règle de facturation
   * corrigée, date de début rectifiée, fin de gestion avancée — resterait
   * sinon en place indéfiniment, et s'ajouterait aux nouvelles. On la retire :
   * l'ensemble des mois dus est entièrement déterminé par la fiche client.
   */
  const { toInsert: missing, staleIds } = reconcileManagementMonths(
    expected,
    (existing ?? []).map((row) => ({ id: row.id as string, performedOn: row.performed_on as string })),
    { lockedMonths: (settled ?? []).map((row) => row.period_month as string) },
  );

  if (staleIds.length > 0) {
    await supabase.from("client_budget_lines").delete().in("id", staleIds);
  }
  if (missing.length === 0) return staleIds.length;

  const { error } = await supabase.from("client_budget_lines").insert(
    missing.map((month) => ({
      client_id: client.id,
      service_key: MANAGEMENT_MONTH_KEY,
      label: month.fraction < 1
        ? `Gestion des réseaux · mois ${month.index} (prorata ${Math.round(month.fraction * 4)}/4)`
        : `Gestion des réseaux · mois ${month.index}`,
      billing: "ponctuel",
      unit_price_cents: month.amountCents,
      quantity: 1,
      months: null,
      performed_on: month.dueOn,
      note: month.fraction < 1
        ? "Premier mois entamé : facturé au prorata des semaines restantes."
        : "Inscrit automatiquement au premier jour du mois.",
    })),
  );

  // Un conflit signifie qu'une autre exécution a déjà inscrit le mois : c'est
  // exactement ce que l'index unique doit produire, il n'y a rien à signaler.
  if (error && error.code !== "23505") throw new Error(error.message);
  return missing.length + staleIds.length;
}

/** Parse le rythme mensuel stocké dans les réglages du client. */
export function cadenceFromNotes(notes: string | null): MonthlyCadence {
  try {
    const settings = typeof notes === "string" ? JSON.parse(notes) : {};
    return (settings?.monthlyCadence ?? {}) as MonthlyCadence;
  } catch {
    return {};
  }
}

/** Parse le forfait shooting stocké dans les réglages du client. */
export function shootingPlanFromNotes(notes: string | null): ShootingPlan | null {
  try {
    const settings = typeof notes === "string" ? JSON.parse(notes) : {};
    return parseShootingPlan(settings?.shootingPlan);
  } catch {
    return null;
  }
}

/**
 * Même synchronisation, pour tout un portefeuille.
 *
 * La liste des budgets affichait les montants tels qu'ils étaient stockés :
 * une échéance tombée depuis le dernier passage de la tâche planifiée n'y
 * apparaissait pas, et le consommé était donc sous-évalué jusqu'à ce qu'on
 * ouvre la fiche du client. On remet tout à jour avant d'afficher.
 */
export async function syncAllManagementMonths(
  supabase: SupabaseClient,
  clients: Array<{
    id: string;
    notes: string | null;
    contract_start_date: string | null;
    contract_end_date: string | null;
  }>,
  today: string = todayInParis(),
): Promise<number> {
  const results = await Promise.all(
    clients
      .filter((client) => client.contract_start_date)
      .map(async (client) => {
        try {
          return await syncManagementMonths(supabase, {
            id: client.id,
            contractStartDate: client.contract_start_date,
            contractEndDate: client.contract_end_date,
            cadence: cadenceFromNotes(client.notes),
            shooting: shootingPlanFromNotes(client.notes),
          }, today);
        } catch {
          // Un client en échec ne doit pas vider l'écran des autres.
          return 0;
        }
      }),
  );
  return results.reduce((total, count) => total + count, 0);
}
