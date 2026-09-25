import {
  SHOOTING_PLAN_SERVICES,
  awaitsShootingDecision,
  classifyShootings,
  findService,
  formatEuros,
  parseShootingPlan,
  type ShootingPlan,
} from "./budget";
import { isOnSettledInvoice, type InvoiceStatus } from "./invoicing";

/**
 * Classement d'un shooting tourné : ce que devient sa ligne au budget.
 *
 * Trois issues, et chacune dit tout ce qu'il faut pour que la facturation
 * suive sans qu'on ouvre le budget du client :
 *   - compris au forfait : déjà payé par le lissage mensuel, inscrit à 0 € ;
 *   - vendu en plus : la prestation du catalogue réellement tournée, à son prix ;
 *   - n'a pas eu lieu : rien n'est facturé, et le shooting ne compte plus dans
 *     le cycle du forfait.
 */

export type ShootingDecision = "compris" | "supplementaire" | "annule";

export type SoldShootingService = (typeof SHOOTING_PLAN_SERVICES)[number];

export function isSoldShootingService(value: string | null | undefined): value is SoldShootingService {
  return (SHOOTING_PLAN_SERVICES as readonly string[]).includes(value ?? "");
}

export interface ShootingLineUpdate {
  service_key: string;
  label: string;
  unit_price_cents: number;
  forfait_included: boolean;
  billed_directly: boolean;
}

export function planShootingDecision(input: {
  decision: ShootingDecision;
  lineServiceKey: string;
  lineLabel: string;
  /** Forfait shooting vendu au client, s'il en a un. */
  plan: ShootingPlan | null;
  /** Prestation tournée en plus, choisie à l'écran. */
  soldServiceKey: string | null;
  /** Facturée directement au client plutôt que prise sur l'enveloppe. */
  billedDirectly: boolean;
}):
  | { ok: true; update: ShootingLineUpdate; cancelled: boolean; message: string }
  | { ok: false; message: string } {
  if (input.decision === "compris") {
    /*
     * Accepté même sans forfait shooting enregistré : la plupart des clients
     * ont leurs shootings inclus dans leur formule sans que le forfait soit
     * saisi sur leur fiche. Le refuser bloquait le classement de presque tous.
     * C'est un choix explicite de la direction, fait à l'écran.
     */
    return {
      ok: true,
      cancelled: false,
      update: {
        service_key: input.lineServiceKey,
        label: input.lineLabel,
        unit_price_cents: 0,
        forfait_included: true,
        billed_directly: false,
      },
      message: "Shooting compris dans le forfait : inscrit à 0 €.",
    };
  }

  if (input.decision === "annule") {
    return {
      ok: true,
      cancelled: true,
      update: {
        service_key: input.lineServiceKey,
        label: input.lineLabel,
        unit_price_cents: 0,
        // Tranché : il ne doit plus attendre de décision, ni rien facturer.
        forfait_included: true,
        billed_directly: false,
      },
      message: "Shooting noté comme n'ayant pas eu lieu : rien n'est facturé.",
    };
  }

  /*
   * Vendu en plus : la prestation choisie, sinon celle de la ligne, sinon
   * celle du forfait. Le prix vient du catalogue, jamais d'une saisie : un
   * zéro tapé par erreur se lirait comme une décision d'offrir le shooting.
   */
  const sold = [input.soldServiceKey, input.lineServiceKey, input.plan?.serviceKey]
    .find(isSoldShootingService);
  const service = sold ? findService(sold) : undefined;
  if (!service || service.unitPriceCents <= 0) {
    return { ok: false, message: "Choisissez la prestation tournée : Express, demi-journée ou journée." };
  }
  return {
    ok: true,
    cancelled: false,
    update: {
      service_key: service.key,
      label: service.label,
      unit_price_cents: service.unitPriceCents,
      forfait_included: false,
      billed_directly: input.billedDirectly,
    },
    message: `${service.label} vendu en plus : ${formatEuros(service.unitPriceCents)}${input.billedDirectly ? " à facturer directement au client" : " inscrit au budget"}.`,
  };
}

function formatShortDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

/**
 * Proposition de classement, avec la raison en clair.
 *
 * La période du forfait tranche : le premier shooting d'une période est celui
 * du forfait, les suivants ont été vendus en plus. La personne n'a plus qu'à
 * confirmer — ou à corriger si la réalité a été autre.
 */
export function shootingDecisionSuggestion(input: {
  plan: ShootingPlan | null;
  contractStartDate: string | null;
  date: string;
  /** Dates des shootings du client qui ont eu lieu, celui-ci compris. */
  dates: readonly string[];
}): { decision: ShootingDecision | null; reason: string } {
  /*
   * Sans forfait enregistré, rien ne permet de trancher : on ne pré-coche
   * rien. Proposer « vendu en plus » faisait facturer 225 à 850 € d'un simple
   * clic sur « Enregistrer », pour des shootings souvent compris dans la formule.
   */
  if (!input.plan) {
    return {
      decision: null,
      reason: "Aucun forfait shooting enregistré pour ce client : dites s'il était compris dans sa formule ou vendu en plus.",
    };
  }
  if (!input.contractStartDate) {
    return { decision: null, reason: "Début de gestion inconnu : impossible de situer ce shooting dans le forfait." };
  }

  const entry = classifyShootings({ plan: input.plan, contractStartDate: input.contractStartDate, dates: input.dates })
    .get(input.date);
  if (!entry) {
    return { decision: null, reason: "Tourné avant le début de gestion : hors forfait, à vous de dire." };
  }

  const period = `du ${formatShortDay(entry.periodStart)} au ${formatShortDay(entry.periodEnd)}`;
  return entry.rankInPeriod === 1
    ? { decision: "compris", reason: `Premier shooting de la période ${period} : celui du forfait.` }
    : { decision: "supplementaire", reason: `${entry.rankInPeriod}e shooting de la période ${period} : le forfait était déjà utilisé.` };
}

/** Forfait shooting lu dans les réglages du client (texte JSON libre). */
export function shootingPlanFromNotes(notes: string | null | undefined): ShootingPlan | null {
  try {
    const settings = typeof notes === "string" ? JSON.parse(notes) : {};
    return parseShootingPlan(settings?.shootingPlan);
  } catch {
    return null;
  }
}

/** Un shooting inscrit, vu par la règle du classement. */
export interface ClassifiableShooting {
  serviceKey: string;
  performedOn: string;
  /** Tri déjà fait : compris au forfait, vendu en plus, ou pas encore tranché. */
  forfaitIncluded?: boolean | null;
  /** Annulé : consigné sur la fiche, jamais déduit d'une date. */
  cancelled?: boolean;
}

/** Ce que le dossier du client dit de la facturation de ses mois. */
export interface ShootingBillingContext {
  /** Dernier jour tourné. Une date calée d'avance n'a rien à trancher. */
  today: string;
  contractStartDate: string | null;
  /** Statut de facture par mois de période, tel qu'il est stocké. */
  invoiceStatuses: Record<string, InvoiceStatus>;
}

/**
 * Shooting non classé : celui qui attend encore sa décision de facturation.
 *
 * C'est le seul endroit où cette question se tranche. Le point rouge de la
 * liste, le compteur, l'encart « à classer » et la fiche du shooting lisent
 * tous cette fonction : un écran qui refabriquerait la règle finirait par
 * signaler un travail que l'action refuse, ou par taire celui qu'elle accepte.
 *
 * Trois conditions, dans l'ordre où elles coupent :
 *   - annulé : le shooting n'a pas eu lieu, il n'y a rien à facturer ;
 *   - tourné et non tranché : c'est la définition même, et une date à venir
 *     n'a encore rien à dire ;
 *   - facture non partie : une facture établie ou prélevée fige le tri, et
 *     `classifyShooting` refuse de reclasser la ligne. La signaler promettrait
 *     un geste impossible.
 */
export function isShootingUnclassified(
  shooting: ClassifiableShooting,
  context: ShootingBillingContext,
): boolean {
  if (shooting.cancelled) return false;
  if (!awaitsShootingDecision(shooting, context.today)) return false;
  return !isOnSettledInvoice(
    { performedOn: shooting.performedOn },
    context.contractStartDate,
    context.invoiceStatuses,
  );
}
