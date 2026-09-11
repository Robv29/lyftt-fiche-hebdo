import {
  parseBaseFee,
  parseCustomMonthly,
  parseShootingPlan,
  type CustomMonthlyService,
  type ShootingPlan,
} from "./budget";
import type { MonthlyCadence } from "./planning";

/**
 * Formule de facturation d'un client, lue une seule fois depuis sa fiche.
 *
 * Neuf endroits reconstruisaient cette formule à la main — trois écrans budget,
 * le tableau de bord, les indicateurs, la tâche de nuit, l'enregistrement d'un
 * client. Chaque ajout (forfait shooting, prestation sur mesure, forfait de
 * base négocié, pause) devait être répercuté partout, et ne l'était jamais
 * partout : ouvrir la liste des budgets réinscrivait E-MOVE à 50 € de base
 * au lieu des 25 € négociés, et refacturait les mois de pause, que l'écran du
 * client retirait aussitôt. Le montant dépendait de l'écran ouvert en dernier.
 *
 * Toute lecture de formule passe désormais par ici. Ajouter un paramètre se
 * fait à un seul endroit.
 */

export interface ClientFormulaRow {
  notes: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
}

export interface ClientFormula {
  cadence: MonthlyCadence;
  shooting: ShootingPlan | null;
  customMonthly: CustomMonthlyService | null;
  baseFeeCents: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
}

function settingsOf(notes: string | null): Record<string, unknown> {
  try {
    const parsed = typeof notes === "string" ? JSON.parse(notes) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function clientFormula(row: ClientFormulaRow): ClientFormula {
  const settings = settingsOf(row.notes);
  const cadence = settings.monthlyCadence;
  return {
    cadence: cadence && typeof cadence === "object" ? (cadence as MonthlyCadence) : {},
    shooting: parseShootingPlan(settings.shootingPlan),
    customMonthly: parseCustomMonthly(settings.customMonthlyService),
    baseFeeCents: parseBaseFee(settings.baseMonthlyFeeCents),
    contractStartDate: row.contract_start_date,
    contractEndDate: row.contract_end_date,
    pauseStartDate: row.pause_start_date ?? null,
    pauseEndDate: row.pause_end_date ?? null,
  };
}

/** Colonnes qu'une requête doit ramener pour que la formule soit complète. */
export const CLIENT_FORMULA_COLUMNS =
  "notes, contract_start_date, contract_end_date, pause_start_date, pause_end_date";
