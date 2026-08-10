import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MANAGEMENT_MONTH_KEY,
  cadenceMonthlyCostCents,
  closedManagementMonths,
} from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";

/**
 * Inscription des mois de gestion écoulés à l'addition du client.
 *
 * Dès qu'un mois s'achève, il est facturé au tarif du rythme vendu, puis figé.
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
  },
  today: string = todayInParis(),
): Promise<number> {
  const monthlyCostCents = cadenceMonthlyCostCents(client.cadence);
  const expected = closedManagementMonths({
    contractStartDate: client.contractStartDate,
    contractEndDate: client.contractEndDate,
    monthlyCostCents,
    today,
  });
  if (expected.length === 0) return 0;

  const { data: existing } = await supabase
    .from("client_budget_lines")
    .select("performed_on")
    .eq("client_id", client.id)
    .eq("service_key", MANAGEMENT_MONTH_KEY);

  const already = new Set((existing ?? []).map((row) => row.performed_on as string));
  const missing = expected.filter((month) => !already.has(month.closedOn));
  if (missing.length === 0) return 0;

  const { error } = await supabase.from("client_budget_lines").insert(
    missing.map((month) => ({
      client_id: client.id,
      service_key: MANAGEMENT_MONTH_KEY,
      label: `Production du mois ${month.index}`,
      billing: "ponctuel",
      unit_price_cents: month.amountCents,
      quantity: 1,
      months: null,
      performed_on: month.closedOn,
      note: "Inscrit automatiquement à la fin du mois de gestion.",
    })),
  );

  // Un conflit signifie qu'une autre exécution a déjà inscrit le mois : c'est
  // exactement ce que l'index unique doit produire, il n'y a rien à signaler.
  if (error && error.code !== "23505") throw new Error(error.message);
  return missing.length;
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
