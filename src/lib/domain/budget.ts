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

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
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
export function cadenceMonthlyCostCents(
  cadence: MonthlyCadence,
  shooting?: ShootingPlan | null,
): number {
  const perWeek = (monthly: number | undefined) => Math.max(0, Number(monthly ?? 0)) / 4;
  return BASE_MONTHLY_FEE_CENTS + Math.round(
    perWeek(cadence.photo) * priceOf("post_photo")
    + perWeek(cadence.video) * priceOf("video")
    + perWeek(cadence.story) * priceOf("story")
    + perWeek(cadence.visual) * priceOf("visuel"),
  ) + shootingMonthlyCostCents(shooting ?? null);
}

/**
 * Shooting vendu dans la formule : un shooting de X heures tous les N mois.
 *
 * Son prix est lissé sur la période — un shooting à 450 € tous les quatre mois
 * se paie 112,50 € par mois. Il entre ainsi dans le coût mensuel de la
 * gestion, donc dans l'enveloppe d'un financement, la facture d'un comptant
 * et la gestion facturée d'un hybride, sans traitement particulier.
 */
export interface ShootingPlan {
  /** Prestation du catalogue : express, demi-journée ou journée. */
  serviceKey: "shooting_express" | "shooting_demi" | "shooting_jour";
  /** Un shooting tous les N mois. */
  everyMonths: number;
}

export const SHOOTING_PLAN_SERVICES = [
  "shooting_express",
  "shooting_demi",
  "shooting_jour",
] as const;

/** Clé des lignes posées quand un shooting du forfait est réalisé. */
export const SHOOTING_FORFAIT_KEY = "shooting_forfait";

/**
 * Toute ligne qui atteste d'un shooting, quelle que soit sa provenance.
 *
 * Un shooting s'inscrit de deux façons : par le bouton « Date calée », qui pose
 * une ligne `shooting_forfait`, ou depuis l'écran budget, en choisissant la
 * prestation dans le catalogue. Le rappel ne regardait que la première, et
 * réclamait donc un shooting à des clients qui en avaient déjà eu trois —
 * inscrits, mais sous l'autre nom.
 */
export function isShootingLine(serviceKey: string): boolean {
  return serviceKey === SHOOTING_FORFAIT_KEY
    || (SHOOTING_PLAN_SERVICES as readonly string[]).includes(serviceKey);
}

/** Clés reconnues comme un shooting réalisé, pour les requêtes. */
export const SHOOTING_LINE_KEYS: readonly string[] = [
  SHOOTING_FORFAIT_KEY,
  ...SHOOTING_PLAN_SERVICES,
];

export function shootingMonthlyCostCents(plan: ShootingPlan | null): number {
  if (!plan || !Number.isInteger(plan.everyMonths) || plan.everyMonths < 1) return 0;
  const price = findService(plan.serviceKey)?.unitPriceCents ?? 0;
  return Math.round(price / plan.everyMonths);
}

/**
 * Lecture d'un forfait shooting venu des réglages du client.
 *
 * Les réglages sont un texte JSON libre : une valeur incomplète ou fantaisiste
 * ne doit pas faire tomber un écran de budget. Tout ce qui n'est pas un forfait
 * exploitable devient l'absence de forfait.
 */
export function parseShootingPlan(value: unknown): ShootingPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { serviceKey?: unknown; everyMonths?: unknown };
  const serviceKey = SHOOTING_PLAN_SERVICES.find((key) => key === raw.serviceKey);
  const everyMonths = Number(raw.everyMonths);
  if (!serviceKey) return null;
  if (!Number.isInteger(everyMonths) || everyMonths < 1 || everyMonths > 24) return null;
  return { serviceKey, everyMonths };
}

/** Formulation du forfait, telle qu'elle a été vendue. */
export function shootingPlanSummary(plan: ShootingPlan): string {
  const label = findService(plan.serviceKey)?.label ?? "Shooting";
  const rhythm = plan.everyMonths === 1 ? "chaque mois" : `tous les ${plan.everyMonths} mois`;
  return `${label} ${rhythm}`;
}

/** Nombre de shootings que le forfait représente sur une année. */
export function shootingsPerYear(plan: ShootingPlan): number {
  if (plan.everyMonths < 1) return 0;
  return Math.round((12 / plan.everyMonths) * 10) / 10;
}

export interface ShootingSchedule {
  /** Date à laquelle le prochain shooting devrait avoir lieu. */
  dueOn: string;
  /** Un mois avant : le moment de le caler avec le client. */
  remindFrom: string;
  /** Le rappel est-il actif à la date donnée ? */
  remindNow: boolean;
  /** L'échéance est-elle dépassée sans shooting calé ? */
  overdue: boolean;
}

/**
 * Cycle de planification du shooting.
 *
 * Le prochain shooting se déduit du dernier réalisé — ou du début de gestion
 * s'il n'y en a pas encore eu — plus la période. Le rappel s'ouvre un mois
 * avant l'échéance : c'est le délai qu'il faut pour trouver une date avec le
 * client.
 */
export function shootingSchedule(input: {
  plan: ShootingPlan | null;
  lastDoneOn: string | null;
  contractStartDate: string | null;
  today: string;
}): ShootingSchedule | null {
  if (!input.plan) return null;
  const anchor = input.lastDoneOn ?? input.contractStartDate;
  if (!anchor) return null;

  const dueOn = addMonths(anchor, input.plan.everyMonths);
  /*
   * Un mois d'avance sur un forfait mensuel, c'est un rappel permanent : il
   * s'ouvrirait le jour même du shooting précédent. Le délai ne dépasse donc
   * jamais la moitié de la période.
   */
  const remindFrom = input.plan.everyMonths >= 2
    ? addMonths(dueOn, -1)
    : addDays(dueOn, -15);
  return {
    dueOn,
    remindFrom,
    remindNow: input.today >= remindFrom,
    overdue: input.today > dueOn,
  };
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
  /** Shooting vendu dans la formule, lissé sur sa période. */
  shooting?: ShootingPlan | null;
  /** Début de gestion, repris de la fiche client. */
  contractStartDate: string | null;
  /** Fin de gestion, reprise de la fiche client. */
  contractEndDate: string | null;
  /**
   * Le RIB du client est-il déposé ?
   *
   * Dès qu'une part est facturée au client — comptant, ou gestion mensuelle
   * d'un hybride — le prélèvement suppose un RIB. Son absence n'empêche rien,
   * elle se signale : c'est la facturation qui se bloquerait plus tard.
   */
  ribOnFile?: boolean;
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
  const monthlyCadenceCostCents = cadenceMonthlyCostCents(input.cadence, input.shooting ?? null);

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

  /*
   * Le RIB manquant se signale dans les deux modes qui prélèvent le client,
   * y compris au comptant où il n'y a pourtant aucune enveloppe à suivre :
   * c'est le seul écran où l'on regarde l'argent de ce client.
   */
  const ribAlerts: BudgetAlert[] = [];
  if (input.billingMode !== "financement" && input.ribOnFile === false) {
    ribAlerts.push({
      level: "critique",
      title: "RIB manquant",
      detail: input.billingMode === "comptant"
        ? "Ce client est facturé au comptant : sans RIB déposé, aucun prélèvement "
          + "ne peut être mis en place. Déposez-le sur cet écran."
        : "En hybride, la gestion mensuelle est prélevée au client : sans RIB "
          + "déposé, la facturation restera bloquée. Déposez-le sur cet écran.",
    });
  }

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
      alerts: ribAlerts,
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

  const alerts: BudgetAlert[] = [...ribAlerts];

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

/**
 * Malus appliqué au score de pilotage pour les budgets mal tenus.
 *
 * Un score qui ne regarde que la relation client raconte une moitié de
 * l'histoire : une agence peut valider vite et bien tout en pilotant ses
 * enveloppes à l'aveugle. Chaque dossier en défaut retire des points, dans la
 * limite d'un tiers du score — le reste du travail continue de compter.
 */
export function budgetPenalty(input: {
  clientsWithIssue: number;
  clientsTotal: number;
}): number {
  if (input.clientsTotal <= 0 || input.clientsWithIssue <= 0) return 0;
  const share = Math.min(1, input.clientsWithIssue / input.clientsTotal);
  return Math.round(share * 33);
}

/**
 * Un shooting est-il compris dans le forfait, ou vendu en plus ?
 *
 * Le forfait donne droit à **un shooting par période**. Le premier inscrit dans
 * une période est celui du forfait : il est déjà payé par le lissage mensuel,
 * le compter une seconde fois doublerait la facture. Tout shooting suivant dans
 * la même période a été vendu en plus, et doit partir au tarif du catalogue.
 *
 * La règle ne repose donc sur la mémoire de personne : c'est la période qui
 * tranche, et la saisie n'a plus qu'à confirmer.
 */
export interface ShootingClassification {
  /** Rang de la période depuis le début de gestion, à partir de 1. */
  periodIndex: number;
  /** Premier jour de la période concernée. */
  periodStart: string;
  /** Dernier jour inclus de la période. */
  periodEnd: string;
  /** Position du shooting dans sa période, à partir de 1. */
  rankInPeriod: number;
  /** Proposition : le premier de la période est compris, les autres sont vendus en plus. */
  suggestedIncluded: boolean;
}

/**
 * Classement de chaque shooting dans le cycle du forfait.
 *
 * Les périodes se posent depuis le début de gestion, d'anniversaire en
 * anniversaire : un shooting fait le 3 août appartient à la période ouverte le
 * 23 juillet, quelle que soit la date à laquelle le précédent a eu lieu. Compter
 * depuis le dernier shooting réalisé ferait dériver les périodes à chaque écart.
 */
export function classifyShootings(input: {
  plan: ShootingPlan | null;
  contractStartDate: string | null;
  /** Dates des shootings inscrits, dans n'importe quel ordre. */
  dates: readonly string[];
}): Map<string, ShootingClassification> {
  const result = new Map<string, ShootingClassification>();
  if (!input.plan || !input.contractStartDate) return result;

  const seenByPeriod = new Map<number, number>();
  for (const date of [...input.dates].sort()) {
    if (date < input.contractStartDate) continue;
    /*
     * Rang de la période : on avance de forfait en forfait jusqu'à contenir la
     * date. Une gestion de plusieurs années reste bornée.
     */
    let index = 1;
    let periodStart = input.contractStartDate;
    let periodEnd = addMonths(periodStart, input.plan.everyMonths);
    while (date >= periodEnd && index <= 240) {
      index += 1;
      periodStart = periodEnd;
      periodEnd = addMonths(periodStart, input.plan.everyMonths);
    }

    const rank = (seenByPeriod.get(index) ?? 0) + 1;
    seenByPeriod.set(index, rank);
    result.set(date, {
      periodIndex: index,
      periodStart,
      // La fin est le jour précédant l'ouverture de la période suivante.
      periodEnd: addDays(periodEnd, -1),
      rankInPeriod: rank,
      suggestedIncluded: rank === 1,
    });
  }

  return result;
}

/** Ce qu'un forfait a consommé et ce qu'il a fait facturer en plus. */
export interface ShootingTally {
  included: number;
  extra: number;
  extraCents: number;
  /** Shootings dont personne n'a encore dit s'ils étaient compris ou vendus. */
  pending: number;
}

export function shootingTally(
  lines: readonly (BudgetLine & { forfaitIncluded?: boolean | null })[],
): ShootingTally {
  const shootings = lines.filter((line) => isShootingLine(line.serviceKey));
  const extras = shootings.filter((line) => line.forfaitIncluded === false);
  return {
    included: shootings.filter((line) => line.forfaitIncluded === true).length,
    extra: extras.length,
    extraCents: extras.reduce((total, line) => total + lineTotalCents(line), 0),
    pending: shootings.filter((line) => line.forfaitIncluded === null
      || line.forfaitIncluded === undefined).length,
  };
}
