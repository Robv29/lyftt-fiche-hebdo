/**
 * Budget client : consommation des prestations jusqu'à la fin de gestion.
 *
 * Un budget de financement n'est pas reportable. L'enjeu n'est donc pas de
 * rester sous le plafond, mais de le consommer **entièrement** avant la date
 * de fin — un reliquat est de l'argent perdu pour le client, et une prestation
 * non vendue pour l'agence. Les alertes servent les deux sens : trop vite, et
 * le budget s'épuise avant la fin ; trop lentement, et il en restera.
 *
 * Tout est calculé, rien n'est stocké : un total figé en base se désynchronise
 * dès qu'une ligne est ajoutée ou une date modifiée.
 */

import type { MonthlyCadence } from "./planning";

/**
 * Qui paie quoi.
 *
 * - `comptant` : tout est facturé au client, il n'y a pas d'enveloppe.
 * - `financement` : tout est pris sur l'enveloppe accordée.
 * - `hybride` : la gestion mensuelle est facturée, les prestations ponctuelles
 *   — shootings, site, stratégie — passent sur l'enveloppe.
 *
 * Une seule règle sépare les trois : ce qui est récurrent et ce qui ne l'est
 * pas. Le drapeau `billedDirectly` reste l'exception ligne à ligne.
 */
export type BillingMode = "comptant" | "financement" | "hybride";

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  comptant: "Comptant",
  financement: "Financement",
  hybride: "Hybride",
};
export type ServiceBilling = "ponctuel" | "mensuel";

export interface ServiceDefinition {
  key: string;
  label: string;
  /** Regroupement commercial, repris de la carte LYFTT. */
  category: "entree" | "plat" | "dessert";
  billing: ServiceBilling;
  /** Prix unitaire en centimes, hors taxes. */
  unitPriceCents: number;
  /** Ce que couvre une unité, affiché à côté du prix. */
  unitLabel: string;
  description: string;
}

/*
 * Catalogue LYFTT. Les tarifs publics de la carte sont volontairement doublés :
 * ceux-ci sont les tarifs réels, soit la moitié.
 *
 * Les prix sont **recopiés** sur chaque ligne au moment de l'ajout. Une
 * révision tarifaire ne doit jamais réécrire une addition déjà établie.
 */
export const SERVICE_CATALOGUE: readonly ServiceDefinition[] = [
  {
    key: "strategie",
    label: "Stratégie de communication",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 150_000,
    unitLabel: "la prestation",
    description: "Réflexion globale, positionnement, recommandations.",
  },
  {
    key: "shooting_express",
    label: "Shooting express",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 22_500,
    unitLabel: "le shooting",
    description: "Format court, sur un point précis.",
  },
  {
    key: "shooting_demi",
    label: "Shooting ½ journée",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 45_000,
    unitLabel: "le shooting",
    description: "Une demi-journée de prises de vue.",
  },
  {
    key: "shooting_jour",
    label: "Shooting 1 journée",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 85_000,
    unitLabel: "le shooting",
    description: "Journée complète de prises de vue.",
  },
  {
    key: "site_one_page",
    label: "Site web one page",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 125_000,
    unitLabel: "le site",
    description: "Site une page clé en main.",
  },
  {
    key: "accompagnement",
    label: "Accompagnement stratégique personnalisé",
    category: "entree",
    billing: "ponctuel",
    unitPriceCents: 5_000,
    unitLabel: "la séance",
    description: "1 h en visio pour affiner la stratégie.",
  },

  {
    key: "post_photo",
    label: "Post photo",
    category: "plat",
    billing: "mensuel",
    unitPriceCents: 8_000,
    unitLabel: "par photo / semaine",
    description: "Tri, retouche, texte et hashtags.",
  },
  {
    key: "visuel",
    label: "Visuel",
    category: "plat",
    billing: "mensuel",
    unitPriceCents: 15_000,
    unitLabel: "par visuel / semaine",
    description: "Design, colorimétrie, légendes.",
  },
  {
    key: "video",
    label: "Vidéo / Reel",
    category: "plat",
    billing: "mensuel",
    unitPriceCents: 22_000,
    unitLabel: "par vidéo / semaine",
    description: "Montage, texte et hashtags.",
  },
  {
    key: "story",
    label: "Story",
    category: "plat",
    billing: "mensuel",
    unitPriceCents: 2_500,
    unitLabel: "par story / semaine",
    description: "Photo ou visuel, retouche rapide et appel à l'action.",
  },

  {
    key: "community",
    label: "Gestion de la communauté",
    category: "dessert",
    billing: "mensuel",
    unitPriceCents: 10_000,
    unitLabel: "par mois",
    description: "Messages, avis Google, republications.",
  },
  {
    key: "influenceurs",
    label: "Influenceurs",
    category: "dessert",
    billing: "mensuel",
    unitPriceCents: 15_000,
    unitLabel: "par mois",
    description: "Identification, négociation, suivi, analyse.",
  },
  {
    key: "reseau_supplementaire",
    label: "Réseau social supplémentaire",
    category: "dessert",
    billing: "mensuel",
    unitPriceCents: 4_000,
    unitLabel: "par réseau / mois",
    description: "Instagram est géré par défaut.",
  },
  {
    key: "maj_site",
    label: "Mise à jour du site web",
    category: "dessert",
    billing: "mensuel",
    unitPriceCents: 5_000,
    unitLabel: "par mois",
    description: "Texte, photo, maintenance.",
  },
  {
    key: "google_business",
    label: "Google My Business",
    category: "dessert",
    billing: "mensuel",
    unitPriceCents: 8_000,
    unitLabel: "par mois",
    description: "Articles, photos, réponses aux avis.",
  },
];

export const CATEGORY_LABELS: Record<ServiceDefinition["category"], string> = {
  entree: "Prestations ponctuelles",
  plat: "Production hebdomadaire",
  dessert: "Accompagnement mensuel",
};

export function findService(key: string): ServiceDefinition | undefined {
  return SERVICE_CATALOGUE.find((service) => service.key === key);
}

/**
 * Clé des lignes de production mensuelle.
 *
 * Ces lignes ne sont pas choisies dans le catalogue : elles sont inscrites
 * automatiquement dès qu'un mois de gestion est écoulé, au tarif du rythme
 * vendu à ce moment-là. Une fois posées, elles ne bougent plus — un
 * changement de formule ne réécrit pas les mois déjà facturés.
 */
export const MANAGEMENT_MONTH_KEY = "production_mensuelle";

export interface BudgetLine {
  id: string;
  serviceKey: string;
  label: string;
  billing: ServiceBilling;
  unitPriceCents: number;
  quantity: number;
  /** Nombre de mois d'engagement, pour une prestation mensuelle. */
  months: number | null;
  /** Date du shooting, ou date de mise à jour de la formule. */
  performedOn: string;
  /**
   * Prestation facturée au client plutôt que prise sur son enveloppe.
   *
   * Un organisme de financement peut refuser une prestation ; elle est alors
   * facturée directement. Elle ne consomme donc pas le budget, et rejoint le
   * circuit de facturation. Soit l'un, soit l'autre — jamais les deux.
   */
  billedDirectly?: boolean;
}

/** Montant d'une ligne. Une prestation mensuelle court sur son engagement. */
export function lineTotalCents(line: BudgetLine): number {
  const months = line.billing === "mensuel" ? Math.max(1, line.months ?? 1) : 1;
  return Math.round(line.unitPriceCents * line.quantity * months);
}

export function totalCents(lines: BudgetLine[]): number {
  return lines.reduce((total, line) => total + lineTotalCents(line), 0);
}

export function isManagementMonth(line: BudgetLine): boolean {
  return line.serviceKey === MANAGEMENT_MONTH_KEY;
}

/** Lignes imputées sur l'enveloppe de financement. */
export function envelopeLines(lines: BudgetLine[], mode: BillingMode): BudgetLine[] {
  if (mode === "comptant") return [];
  const charged = lines.filter((line) => !line.billedDirectly);
  // En hybride, la gestion mensuelle est facturée : elle ne touche pas l'enveloppe.
  return mode === "hybride" ? charged.filter((line) => !isManagementMonth(line)) : charged;
}

/**
 * Lignes à facturer.
 *
 * Au comptant, tout se facture — y compris la gestion mensuelle des réseaux,
 * qui est précisément la prestation récurrente à facturer chaque mois. En
 * financement, seules les prestations refusées par l'organisme le sont ; le
 * reste est pris sur l'enveloppe.
 */
export function billableLines(lines: BudgetLine[], mode: BillingMode): BudgetLine[] {
  if (mode === "comptant") return lines;
  // En hybride, le récurrent se facture et le ponctuel part sur l'enveloppe.
  if (mode === "hybride") {
    return lines.filter((line) => isManagementMonth(line) || line.billedDirectly);
  }
  return lines.filter((line) => line.billedDirectly);
}

/** Même jour, n mois plus tard. Un 31 tombe sur le dernier jour du mois visé. */
export function addMonths(date: string, months: number): string {
  const origin = new Date(`${date}T00:00:00Z`);
  const day = origin.getUTCDate();
  const shifted = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Part du mois restant à courir quand la gestion démarre.
 *
 * Le mois se découpe en quatre semaines de prestation. Une gestion qui
 * commence dans la deuxième semaine n'en couvre plus que trois : on ne
 * facture pas une semaine qui a déjà passé. Seul le premier mois est
 * concerné, les suivants étant entiers.
 */
export function monthStartFraction(date: string): number {
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(day) || day <= 7) return 1;
  if (day <= 14) return 0.75;
  if (day <= 21) return 0.5;
  return 0.25;
}

export interface ManagementMonth {
  /** Rang du mois de gestion, à partir de 1. */
  index: number;
  /** Jour où le mois est dû : c'est la date portée par la ligne. */
  dueOn: string;
  amountCents: number;
  /** Part du mois facturée : inférieure à 1 pour un démarrage en cours de mois. */
  fraction: number;
}

/**
 * Mois de gestion dus à ce jour.
 *
 * La gestion se règle **d'avance**, comme un abonnement : le mois est dû le
 * jour où il commence, pas le jour où il s'achève. Une gestion démarrée le
 * 15 février est donc déjà facturée six fois au 11 août — février à juillet —
 * la septième tombant le 15 août.
 *
 * Les mois courent d'anniversaire à anniversaire, pas en mois calendaires : le
 * 15 reste le 15. Le décompte s'arrête à la fin de gestion, un mois qui
 * commencerait après elle n'étant jamais produit.
 */
export function dueManagementMonths(input: {
  contractStartDate: string | null;
  contractEndDate: string | null;
  monthlyCostCents: number;
  today: string;
}): ManagementMonth[] {
  if (!input.contractStartDate || input.monthlyCostCents <= 0) return [];

  const limit = input.contractEndDate && input.contractEndDate < input.today
    ? input.contractEndDate
    : input.today;

  const months: ManagementMonth[] = [];
  // Une gestion de plusieurs années reste bornée : 120 mois suffisent.
  for (let index = 1; index <= 120; index += 1) {
    const dueOn = addMonths(input.contractStartDate, index - 1);
    if (dueOn > limit) break;
    // Seul le premier mois peut être entamé ; les suivants tombent entiers.
    const fraction = index === 1 ? monthStartFraction(dueOn) : 1;
    months.push({
      index,
      dueOn,
      fraction,
      amountCents: Math.round(input.monthlyCostCents * fraction),
    });
  }
  return months;
}

/**
 * Forfait de base de la gestion des réseaux sociaux.
 *
 * Il couvre ce qui ne dépend pas du volume produit : pilotage du compte,
 * échanges, suivi. Toute gestion le porte, même sans publication vendue.
 */
export const BASE_MONTHLY_FEE_CENTS = 5_000;

/**
 * Coût mensuel qu'implique le rythme vendu au client.
 *
 * La fiche client exprime des volumes **mensuels** ; le catalogue, des prix
 * par unité **hebdomadaire**. Quatre semaines par mois, comme la répartition
 * du planning, pour que les deux écrans racontent la même chose. Le forfait
 * de base s'ajoute par-dessus.
 */
export function cadenceMonthlyCostCents(cadence: MonthlyCadence): number {
  const perWeek = (monthly: number | undefined) => Math.max(0, Number(monthly ?? 0)) / 4;
  return BASE_MONTHLY_FEE_CENTS + Math.round(
    perWeek(cadence.photo) * priceOf("post_photo")
    + perWeek(cadence.video) * priceOf("video")
    + perWeek(cadence.story) * priceOf("story")
    + perWeek(cadence.visual) * priceOf("visuel"),
  );
}

function priceOf(key: string): number {
  return findService(key)?.unitPriceCents ?? 0;
}

/** Mois pleins restants entre deux dates civiles, jamais négatif. */
export function monthsBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return Math.max(0, days / 30.44);
}

/**
 * Mois de gestion restant à facturer d'ici la fin.
 *
 * La facturation tombe à date fixe, pas au prorata : entre le 11 août et le
 * 30 novembre il reste trois échéances — 4 septembre, 4 octobre, 4 novembre —
 * et non 3,6 mois. Projeter sur une fraction de mois donnait un reliquat et un
 * rythme à tenir faux de près de 20 %.
 */
export function monthsRemainingToBill(input: {
  contractStartDate: string | null;
  contractEndDate: string | null;
  today: string;
}): number {
  if (!input.contractEndDate) return 0;
  if (!input.contractStartDate) {
    // Sans date de début, aucune échéance connue : on retombe sur la durée.
    return monthsBetween(input.today, input.contractEndDate);
  }

  let count = 0;
  for (let index = 1; index <= 120; index += 1) {
    const dueOn = addMonths(input.contractStartDate, index - 1);
    if (dueOn > input.contractEndDate) break;
    if (dueOn > input.today) count += 1;
  }
  return count;
}

/**
 * Écart entre les mois attendus et ceux déjà inscrits.
 *
 * Rend la synchronisation idempotente et auto-corrective : ce qui manque est
 * ajouté, ce qui ne devrait plus exister est retiré.
 */
export function reconcileManagementMonths(
  expected: ManagementMonth[],
  existing: { id: string; performedOn: string }[],
): { toInsert: ManagementMonth[]; staleIds: string[] } {
  const expectedDates = new Set(expected.map((month) => month.dueOn));
  const presentDates = new Set(
    existing.filter((row) => expectedDates.has(row.performedOn)).map((row) => row.performedOn),
  );
  return {
    toInsert: expected.filter((month) => !presentDates.has(month.dueOn)),
    staleIds: existing.filter((row) => !expectedDates.has(row.performedOn)).map((row) => row.id),
  };
}

/*
 * Un dépassement est une erreur à corriger : rouge. Un reliquat est un manque
 * à gagner, ennuyeux mais sans rien de cassé, et il reste du temps pour le
 * rattraper : orange.
 */
export type BudgetAlertLevel = "critique" | "attention" | "reliquat" | "info";

export interface BudgetAlert {
  level: BudgetAlertLevel;
  title: string;
  detail: string;
}

export interface BudgetInput {
  billingMode: BillingMode;
  annualBudgetCents: number;
  lines: BudgetLine[];
  cadence: MonthlyCadence;
  /** Début de gestion, repris de la fiche client. */
  contractStartDate: string | null;
  /** Fin de gestion, reprise de la fiche client. */
  contractEndDate: string | null;
  today: string;
}

export interface BudgetSummary {
  applicable: boolean;
  budgetCents: number;
  /** Total de l'addition, mois de gestion compris. */
  lineCents: number;
  /** Part des mois de gestion déjà inscrits. */
  recurringConsumedCents: number;
  /** Mois écoulés depuis le début de gestion. */
  monthsElapsed: number;
  consumedCents: number;
  remainingCents: number;
  /** Part du budget déjà engagée, bornée à 100 pour l'affichage. */
  consumedPercentage: number;
  monthlyCadenceCostCents: number;
  monthsRemaining: number;
  /** Consommation prévue à la date de fin si le rythme actuel se poursuit. */
  projectedCents: number;
  /** Écart à la fin : positif = reliquat perdu, négatif = dépassement. */
  projectedGapCents: number;
  /** Budget mensuel qu'il faudrait tenir pour tout consommer. */
  targetMonthlyCents: number;
  alerts: BudgetAlert[];
}

export function budgetSummary(input: BudgetInput): BudgetSummary {
  // Une prestation facturée à part ne touche pas à l'enveloppe.
  const charged = envelopeLines(input.lines, input.billingMode);
  const lineCents = totalCents(charged);
  const budgetCents = Math.max(0, input.annualBudgetCents);
  const monthlyCadenceCostCents = cadenceMonthlyCostCents(input.cadence);

  /*
   * Chaque mois de gestion écoulé est inscrit à l'addition dès qu'il s'achève.
   * Le consommé se lit donc entièrement dans les lignes — rien n'est ajouté
   * par-dessus, sans quoi la production serait comptée deux fois.
   */
  const recurringConsumedCents = charged
    .filter(isManagementMonth)
    .reduce((total, line) => total + lineTotalCents(line), 0);
  const consumedCents = lineCents;

  const measuredUpTo = input.contractEndDate && input.today > input.contractEndDate
    ? input.contractEndDate
    : input.today;
  const monthsElapsed = input.contractStartDate
    ? monthsBetween(input.contractStartDate, measuredUpTo)
    : 0;

  // Un client comptant est facturé à la prestation : aucun plafond à suivre.
  if (input.billingMode === "comptant") {
    return {
      applicable: false,
      budgetCents: 0,
      lineCents,
      recurringConsumedCents,
      monthsElapsed,
      consumedCents,
      remainingCents: 0,
      consumedPercentage: 0,
      monthlyCadenceCostCents,
      monthsRemaining: 0,
      projectedCents: consumedCents,
      projectedGapCents: 0,
      targetMonthlyCents: 0,
      alerts: [],
    };
  }

  const remainingCents = budgetCents - consumedCents;
  const monthsRemaining = monthsRemainingToBill({
    contractStartDate: input.contractStartDate,
    contractEndDate: input.contractEndDate,
    today: input.today,
  });
  /*
   * Seul un financement complet voit son enveloppe grignotée par la production
   * récurrente. En hybride, celle-ci est facturée au client : l'enveloppe ne
   * bouge que si l'on y place des prestations ponctuelles.
   */
  const recurringDrainsEnvelope = input.billingMode === "financement";
  const projectedCents = consumedCents
    + (recurringDrainsEnvelope ? monthlyCadenceCostCents * monthsRemaining : 0);
  const targetMonthlyCents = monthsRemaining > 0
    ? Math.round(remainingCents / monthsRemaining)
    : 0;

  const alerts: BudgetAlert[] = [];

  if (!input.contractEndDate) {
    alerts.push({
      level: "critique",
      title: "Date de fin de gestion manquante",
      detail:
        "Sans date de fin, impossible de savoir en combien de temps ce budget "
        + "doit être consommé : ni le rythme ni le reliquat ne peuvent être calculés. "
        + "Renseignez-la sur la fiche client.",
    });
  }

  if (!input.contractStartDate && monthlyCadenceCostCents > 0) {
    alerts.push({
      level: "attention",
      title: "Date de début de gestion manquante",
      detail:
        "La production déjà livrée n'est donc pas décomptée du budget : le "
        + "restant affiché est surévalué. Renseignez-la sur la fiche client.",
    });
  }

  if (budgetCents === 0) {
    alerts.push({
      level: "critique",
      title: "Budget non renseigné",
      detail: "Indiquez le budget de financement accordé à ce client.",
    });
  }

  if (budgetCents > 0 && remainingCents < 0) {
    alerts.push({
      level: "critique",
      title: "Budget dépassé",
      detail: `Les prestations engagées dépassent le budget de ${formatEuros(-remainingCents)}.`,
    });
  }

  if (input.contractEndDate && budgetCents > 0 && monthsRemaining > 0) {
    const gap = projectedCents - budgetCents;
    const tolerance = Math.max(budgetCents * 0.05, 5_000);

    if (gap > tolerance && recurringDrainsEnvelope) {
      alerts.push({
        level: "attention",
        title: "Rythme trop élevé pour la durée restante",
        detail:
          `Au rythme actuel de ${formatEuros(monthlyCadenceCostCents)} par mois, le budget `
          + `sera dépassé de ${formatEuros(gap)} d'ici le ${formatDay(input.contractEndDate)}. `
          + `Tenez ${formatEuros(targetMonthlyCents)} par mois pour rester dans l'enveloppe.`,
      });
    } else if (gap < -tolerance) {
      alerts.push({
        level: "reliquat",
        title: "Budget non consommé à la fin",
        detail:
          `Au rythme actuel, il restera ${formatEuros(-gap)} au `
          + `${formatDay(input.contractEndDate)}. Ce reliquat est perdu : ajoutez des `
          + `prestations, ou montez le rythme à ${formatEuros(targetMonthlyCents)} par mois.`,
      });
    } else {
      alerts.push({
        level: "info",
        title: "Trajectoire cohérente",
        detail:
          `Le rythme actuel consomme le budget à ${formatEuros(0)} près d'ici le `
          + `${formatDay(input.contractEndDate)}.`,
      });
    }
  }

  return {
    applicable: true,
    budgetCents,
    lineCents,
    recurringConsumedCents,
    monthsElapsed,
    consumedCents,
    remainingCents,
    consumedPercentage: budgetCents === 0
      ? 0
      : Math.min(100, Math.round((consumedCents / budgetCents) * 100)),
    monthlyCadenceCostCents,
    monthsRemaining,
    projectedCents,
    projectedGapCents: projectedCents - budgetCents,
    targetMonthlyCents,
    alerts,
  };
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(cents) / 100);
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
