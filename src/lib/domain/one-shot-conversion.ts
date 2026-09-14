import { formatEuros } from "./budget";
import type { ClientKind } from "./client-lifecycle";

/**
 * Passage d'un client en prestation ponctuelle depuis son budget.
 *
 * Le geste corrige une erreur de saisie : un client créé en gestion qui
 * n'achète en réalité qu'une prestation unique. Il retire de l'addition ses
 * mois de gestion — c'est tout son intérêt, et tout son danger sur un client
 * réellement suivi. D'où trois garde-fous, du plus fort au plus souple.
 */

export type OneShotConversionCheck =
  | { status: "allowed" }
  | { status: "refused"; message: string }
  /** Autorisé, mais seulement une fois ce nombre exact de mois confirmé. */
  | { status: "confirm"; months: number; message: string };

export function oneShotConversionCheck(input: {
  kind: ClientKind;
  /*
   * Le client a-t-il déjà eu des fiches hebdomadaires, même supprimées depuis ?
   * Le nombre de fiches du jour ne suffit pas : l'entretien de nuit efface les
   * fiches passées, et un client suivi depuis un an en affiche souvent zéro.
   */
  hadSheets: boolean;
  /** Factures de gestion établies ou prélevées. */
  issuedInvoices: number;
  /** Mois de gestion inscrits, qui quitteraient l'addition. */
  managementMonths: number;
  managementTotalCents: number;
  /** Nombre de mois confirmé par la personne, ou null avant toute confirmation. */
  confirmedMonths: number | null;
}): OneShotConversionCheck {
  if (input.kind === "ponctuel") return { status: "allowed" };

  if (input.hadSheets) {
    return {
      status: "refused",
      message: "Ce client a déjà eu des fiches hebdomadaires : il est bien en gestion des réseaux, ses mois de gestion restent dus.",
    };
  }

  if (input.issuedInvoices > 0) {
    return {
      status: "refused",
      message: "Ce client a déjà été facturé pour sa gestion : il ne peut pas passer en prestation ponctuelle d'ici.",
    };
  }

  /*
   * Des mois de gestion partiraient. On ne le fait qu'en connaissance de
   * cause, chiffres sous les yeux — et sur le nombre exact : un formulaire
   * resté ouvert ne doit pas retirer un mois inscrit depuis.
   */
  if (input.managementMonths > 0 && input.confirmedMonths !== input.managementMonths) {
    const plural = input.managementMonths > 1 ? "s" : "";
    return {
      status: "confirm",
      months: input.managementMonths,
      message: `${input.managementMonths} mois de gestion inscrit${plural} (${formatEuros(input.managementTotalCents)}) `
        + `${plural ? "seront" : "sera"} retiré${plural} de l’addition, et les dates de gestion effacées. `
        + "Confirmez seulement si ce client n’a jamais eu de gestion des réseaux.",
    };
  }

  return { status: "allowed" };
}
