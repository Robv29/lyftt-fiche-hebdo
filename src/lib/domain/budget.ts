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

export type BillingMode = "comptant" | "financement";
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

export interface BudgetLine {
  id: string;
  label: string;
  billing: ServiceBilling;
  unitPriceCents: number;
  quantity: number;
  /** Nombre de mois d'engagement, pour une prestation mensuelle. */
  months: number | null;
  /** Date du shooting, ou date de mise à jour de la formule. */
  performedOn: string;
}

/** Montant d'une ligne. Une prestation mensuelle court sur son engagement. */
export function lineTotalCents(line: BudgetLine): number {
  const months = line.billing === "mensuel" ? Math.max(1, line.months ?? 1) : 1;
  return Math.round(line.unitPriceCents * line.quantity * months);
}

export function totalCents(lines: BudgetLine[]): number {
  return lines.reduce((total, line) => total + lineTotalCents(line), 0);
}

/**
 * Coût mensuel qu'implique le rythme vendu au client.
 *
 * La fiche client exprime des volumes **mensuels** ; le catalogue, des prix
 * par unité **hebdomadaire**. Quatre semaines par mois, comme la répartition
 * du planning, pour que les deux écrans racontent la même chose.
 */
export function cadenceMonthlyCostCents(cadence: MonthlyCadence): number {
  const perWeek = (monthly: number | undefined) => Math.max(0, Number(monthly ?? 0)) / 4;
  return Math.round(
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

export type BudgetAlertLevel = "critique" | "attention" | "info";

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
  /** Prestations inscrites à l'addition. */
  lineCents: number;
  /** Production récurrente déjà livrée depuis le début de gestion. */
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
  const lineCents = totalCents(input.lines);
  const budgetCents = Math.max(0, input.annualBudgetCents);
  const monthlyCadenceCostCents = cadenceMonthlyCostCents(input.cadence);

  /*
   * La production récurrente consomme le budget mois après mois, qu'on pense
   * à l'inscrire ou non. Sans elle, le restant serait systématiquement
   * surévalué : on croirait disposer d'une enveloppe déjà largement entamée.
   *
   * Elle est bornée à la fin de gestion : après cette date, plus rien n'est
   * produit, et le compteur ne doit pas continuer de tourner.
   */
  const measuredUpTo = input.contractEndDate && input.today > input.contractEndDate
    ? input.contractEndDate
    : input.today;
  const monthsElapsed = input.contractStartDate
    ? monthsBetween(input.contractStartDate, measuredUpTo)
    : 0;
  const recurringConsumedCents = Math.round(monthlyCadenceCostCents * monthsElapsed);
  const consumedCents = lineCents + recurringConsumedCents;

  // Un client comptant est facturé à la prestation : aucun plafond à suivre.
  if (input.billingMode !== "financement") {
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
  const monthsRemaining = input.contractEndDate
    ? monthsBetween(input.today, input.contractEndDate)
    : 0;
  const projectedCents = consumedCents + monthlyCadenceCostCents * monthsRemaining;
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

    if (gap > tolerance) {
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
        level: "attention",
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
