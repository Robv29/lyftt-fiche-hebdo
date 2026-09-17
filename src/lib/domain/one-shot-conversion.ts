import { formatEuros } from "./budget";
import type { ClientKind } from "./client-lifecycle";

/**
 * Passage d'un client en prestation ponctuelle — « client sans gestion RS ».
 *
 * Le geste corrige une erreur de saisie : un client créé en gestion qui
 * n'achète en réalité qu'une prestation unique. Il retire de l'addition ses
 * mois de gestion — c'est tout son intérêt, et tout son danger sur un client
 * réellement suivi. D'où des garde-fous, du plus fort au plus souple.
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
  /*
   * Geste délibéré — le bouton « Client sans gestion RS » du budget. Des fiches
   * passées n'y bloquent pas : elles s'annoncent dans la confirmation. La case
   * glissée dans l'ajout d'une prestation reste un raccourci, et refuse.
   */
  explicit?: boolean;
}): OneShotConversionCheck {
  if (input.kind === "ponctuel") return { status: "allowed" };

  if (input.hadSheets && !input.explicit) {
    return {
      status: "refused",
      message: "Ce client a déjà eu des fiches hebdomadaires : il est bien en gestion des réseaux, ses mois de gestion restent dus.",
    };
  }

  // Une facture de gestion partie chez le client est un fait : ce n'est pas une erreur de saisie.
  if (input.issuedInvoices > 0) {
    return {
      status: "refused",
      message: "Ce client a déjà été facturé pour sa gestion : il ne peut pas passer en client sans gestion RS.",
    };
  }

  /*
   * Des mois de gestion partiraient, ou le client a déjà eu des fiches. On ne
   * le fait qu'en connaissance de cause, chiffres sous les yeux — et sur le
   * nombre exact : un formulaire resté ouvert ne doit pas retirer un mois
   * inscrit depuis.
   */
  const needsConfirmation = input.managementMonths > 0 || (Boolean(input.explicit) && input.hadSheets);
  if (needsConfirmation && input.confirmedMonths !== input.managementMonths) {
    const plural = input.managementMonths > 1 ? "s" : "";
    const parts: string[] = [];
    if (input.hadSheets) {
      parts.push("Ce client a déjà eu des fiches hebdomadaires : il semble suivi en gestion des réseaux.");
    }
    parts.push(input.managementMonths > 0
      ? `${input.managementMonths} mois de gestion inscrit${plural} (${formatEuros(input.managementTotalCents)}) `
        + `${plural ? "seront" : "sera"} retiré${plural} de l’addition, et les dates de gestion effacées.`
      : "Ses dates de gestion seront effacées.");
    parts.push("Confirmez seulement si ce client n’a pas de gestion des réseaux.");
    return { status: "confirm", months: input.managementMonths, message: parts.join(" ") };
  }

  return { status: "allowed" };
}
