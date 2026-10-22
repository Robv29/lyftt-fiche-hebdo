/**
 * Produits de suivi mensuel : une mécanique, plusieurs produits.
 *
 * Deux prestations vendues au mois partagent exactement le même cycle :
 * « Gestion du budget publicitaire » et « Accompagnement marketing
 * externalisé ». Chaque mois, pour chaque client qui en détient une :
 *
 *   1. une ligne est inscrite à son addition, au prix et à la fréquence vendus ;
 *   2. un compte rendu est ouvert pour l'agence — les améliorations faites et
 *      les chiffres du mois ;
 *   3. une fois rempli, il rejoint l'historique du client ;
 *   4. le client reçoit une invitation à un rendez-vous de suivi, autant de
 *      fois dans le mois que sa fréquence l'indique.
 *
 * Tout cela est piloté par la **déclaration** du produit, plus bas : clé,
 * libellé, description, jeu de statistiques, formulation de l'e-mail. Ajouter
 * un troisième produit de la famille ne coûte qu'une entrée dans
 * `MONTHLY_TRACKING_PRODUCTS` — le catalogue, le plafond de fréquence, le
 * formulaire, la génération des lignes, la tâche, l'historique et la campagne
 * s'en déduisent.
 *
 * Module pur : aucune lecture, aucun réseau, testable seul.
 *
 * ── Ce que « mensuel » veut dire ici ────────────────────────────────────────
 * Surtout pas `billing: "mensuel"`. Dans ce dépôt, ce drapeau multiplie une
 * ligne unique par un nombre de mois d'engagement et la fait tomber en
 * **entier** sur la facture du mois de sa date (`lineTotalCents`,
 * `invoiceMonthFor`) : c'est un forfait d'engagement, pas une récurrence. La
 * vraie récurrence du dépôt est le motif des mois de gestion — une ligne
 * `ponctuel` par mois, posée au premier du mois, idempotente par un index
 * unique en base. Ces deux produits suivent ce motif, et rien n'a donc à
 * changer dans le calcul des additions ni dans la composition des factures.
 *
 * ── Ce que le prix et la quantité veulent dire ──────────────────────────────
 * La quantité d'une ligne est la **fréquence mensuelle** : le nombre de
 * rendez-vous de suivi du mois, de 1 à 3. Le prix saisi est donc celui d'**un**
 * rendez-vous, et le mois coûte prix × fréquence — exactement ce que
 * `lineTotalCents` calcule déjà. Ranger la fréquence dans la quantité sans le
 * dire aurait triplé la facture d'un client passé de 1 à 3 sans que personne
 * l'ait voulu : le formulaire l'écrit noir sur blanc.
 */

import { clientLifecycle, type ClientKind } from "./client-lifecycle";
import type { ServiceDefinition } from "./budget";

// ---------------------------------------------------------------------------
// La déclaration
// ---------------------------------------------------------------------------

/** Une statistique relevée à la main, dans l'unité où elle se lit. */
export interface TrackingStatField {
  /** Clé stable : elle est écrite dans le `jsonb` du compte rendu. */
  key: string;
  label: string;
  /**
   * `euros` : saisi en euros, stocké en centimes entiers.
   * `nombre` : entier positif.
   */
  unit: "euros" | "nombre";
  /**
   * Obligatoire quand un ratio en dépend : un ratio calculé sur une case vide
   * serait faux, et un chiffre faux est pire qu'un chiffre absent. Les autres
   * restent facultatives — le formulaire doit se remplir en deux minutes.
   */
  required: boolean;
  hint?: string;
}

export type TrackingRatioUnit = "pourcentage" | "euros" | "decimal";

/**
 * Un ratio, **calculé** et jamais demandé.
 *
 * Demander le coût par clic à quelqu'un qui vient de saisir le budget et les
 * clics, c'est demander une division — et accepter qu'elle soit fausse. Le
 * ratio est donc une donnée de déclaration : un numérateur, un dénominateur,
 * une unité.
 */
export interface TrackingRatio {
  key: string;
  label: string;
  unit: TrackingRatioUnit;
  /** Clés des statistiques : `[numérateur, dénominateur]`. */
  of: readonly [string, string];
}

export interface MonthlyTrackingProduct {
  /** Clé de service, celle de la ligne de budget et du compte rendu. */
  key: string;
  label: string;
  /** Libellé court : pastille de calendrier, titre de tâche. */
  shortLabel: string;
  description: string;
  /** Ce dont on parle au rendez-vous, tel que l'e-mail au client le nomme. */
  meetingTopic: string;
  stats: readonly TrackingStatField[];
  ratios: readonly TrackingRatio[];
}

/**
 * Les produits de la famille.
 *
 * Les jeux de statistiques diffèrent parce que les métiers diffèrent : un
 * budget publicitaire se juge sur ce qu'il a acheté d'attention et ce qu'elle a
 * rapporté ; un accompagnement marketing se juge sur ce qui a été entrepris et
 * ce que cela a produit comme affaires. Aucun des deux ne demande un ratio :
 * ils sont tous calculés.
 */
export const MONTHLY_TRACKING_PRODUCTS: readonly MonthlyTrackingProduct[] = [
  {
    key: "gestion_budget_pub",
    label: "Gestion du budget publicitaire",
    shortLabel: "Budget pub",
    description:
      "Pilotage des campagnes payantes : prix par rendez-vous de suivi, de 1 à 3 par mois.",
    meetingTopic: "votre budget publicitaire",
    stats: [
      {
        key: "budget_depense",
        label: "Budget dépensé",
        unit: "euros",
        required: true,
        hint: "Ce qui est réellement parti chez la régie sur le mois.",
      },
      { key: "impressions", label: "Impressions", unit: "nombre", required: true },
      { key: "clics", label: "Clics", unit: "nombre", required: true },
      {
        key: "contacts",
        label: "Contacts obtenus",
        unit: "nombre",
        required: true,
        hint: "Formulaires, appels, messages : ce qui est arrivé grâce aux campagnes.",
      },
    ],
    ratios: [
      { key: "ctr", label: "Taux de clic", unit: "pourcentage", of: ["clics", "impressions"] },
      { key: "cpc", label: "Coût par clic", unit: "euros", of: ["budget_depense", "clics"] },
      {
        key: "cpl",
        label: "Coût par contact",
        unit: "euros",
        of: ["budget_depense", "contacts"],
      },
    ],
  },
  {
    key: "marketing_externalise",
    label: "Accompagnement marketing externalisé",
    shortLabel: "Marketing ext.",
    description:
      "Direction marketing externalisée : prix par rendez-vous de suivi, de 1 à 3 par mois.",
    meetingTopic: "votre accompagnement marketing",
    stats: [
      {
        key: "actions",
        label: "Actions menées",
        unit: "nombre",
        required: true,
        hint: "Campagnes, supports, opérations lancées dans le mois.",
      },
      { key: "rendez_vous", label: "Rendez-vous obtenus", unit: "nombre", required: true },
      { key: "devis_envoyes", label: "Devis envoyés", unit: "nombre", required: true },
      { key: "devis_signes", label: "Devis signés", unit: "nombre", required: true },
      {
        key: "ca_signe",
        label: "Chiffre d’affaires signé",
        unit: "euros",
        required: false,
        hint: "Facultatif : seulement si le client le communique.",
      },
    ],
    ratios: [
      {
        key: "taux_signature",
        label: "Taux de signature",
        unit: "pourcentage",
        of: ["devis_signes", "devis_envoyes"],
      },
      {
        key: "devis_par_rdv",
        label: "Devis par rendez-vous",
        unit: "decimal",
        of: ["devis_envoyes", "rendez_vous"],
      },
    ],
  },
];

export const TRACKING_SERVICE_KEYS: readonly string[] =
  MONTHLY_TRACKING_PRODUCTS.map((product) => product.key);

export function isTrackingService(serviceKey: string): boolean {
  return TRACKING_SERVICE_KEYS.includes(serviceKey);
}

export function findTrackingProduct(serviceKey: string): MonthlyTrackingProduct | undefined {
  return MONTHLY_TRACKING_PRODUCTS.find((product) => product.key === serviceKey);
}

/**
 * Entrées de catalogue, déduites de la déclaration.
 *
 * `billing: "ponctuel"` est volontaire (voir l'en-tête) ; le tarif nul n'est
 * qu'un défaut de formulaire, le prix étant saisi à la vente. La catégorie
 * `dessert` — « Accompagnement mensuel » — est déjà exactement celle de ces
 * deux produits, et `CATEGORY_ORDER` du formulaire n'a donc pas à bouger.
 */
export function trackingServiceDefinitions(): ServiceDefinition[] {
  return MONTHLY_TRACKING_PRODUCTS.map((product) => ({
    key: product.key,
    label: product.label,
    category: "dessert",
    billing: "ponctuel",
    unitPriceCents: 0,
    unitLabel: "par rendez-vous de suivi",
    description: product.description,
  }));
}

// ---------------------------------------------------------------------------
// La fréquence : de 1 à 3 rendez-vous par mois
// ---------------------------------------------------------------------------

export const TRACKING_MIN_FREQUENCY = 1;
export const TRACKING_MAX_FREQUENCY = 3;

/**
 * Fréquence valide, ou `null`.
 *
 * Le plafond est tenu aux trois étages — champ `max` du formulaire, schéma de
 * l'action serveur, contrainte `check` en base — et c'est la même règle ici
 * pour les trois. Entier : un rendez-vous et demi n'existe pas.
 */
export function parseTrackingFrequency(value: unknown): number | null {
  const frequency = Number(value);
  if (!Number.isInteger(frequency)) return null;
  if (frequency < TRACKING_MIN_FREQUENCY || frequency > TRACKING_MAX_FREQUENCY) return null;
  return frequency;
}

// ---------------------------------------------------------------------------
// Les mois
// ---------------------------------------------------------------------------

/** Premier jour du mois d'une date civile. */
export function trackingMonthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Premier jour du mois suivant. */
function nextMonthStart(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, index!, 1)).toISOString().slice(0, 10);
}

/** Dernier jour du mois. */
function monthEnd(month: string): string {
  const next = new Date(`${nextMonthStart(month)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

/** Mois en toutes lettres : « septembre 2026 ». */
export function trackingMonthLabel(month: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}T00:00:00Z`));
}

/** Garde-fou : une souscription oubliée ne doit pas inscrire dix ans d'un coup. */
const MAX_TRACKING_MONTHS = 120;

export interface TrackingSubscriptionDates {
  /** Premier mois vendu, au format `AAAA-MM-01`. */
  startedOn: string;
  /** Dernier mois vendu, inclus, ou `null` tant que la prestation court. */
  endedOn: string | null;
  /** Fin de gestion du client : rien n'est dû au-delà. */
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
}

/**
 * Mois dus par une souscription, du premier au mois en cours.
 *
 * Le mois est inscrit dès qu'il commence, comme la gestion mensuelle : la
 * prestation se règle d'avance. Un mois entièrement couvert par une pause n'est
 * pas dû — il n'y a eu ni campagne à piloter, ni rendez-vous à tenir.
 */
export function dueTrackingMonths(
  input: TrackingSubscriptionDates & { today: string },
): string[] {
  const first = trackingMonthStart(input.startedOn);
  const last = [
    trackingMonthStart(input.today),
    input.endedOn ? trackingMonthStart(input.endedOn) : null,
    input.contractEndDate ? trackingMonthStart(input.contractEndDate) : null,
  ]
    .filter((month): month is string => month !== null)
    .sort()[0]!;

  const months: string[] = [];
  let month = first;
  for (let index = 0; index < MAX_TRACKING_MONTHS && month <= last; index += 1) {
    if (!pausedThroughMonth(month, input)) months.push(month);
    month = nextMonthStart(month);
  }
  return months;
}

/** Mois entièrement compris dans la pause du client. */
function pausedThroughMonth(
  month: string,
  input: Pick<TrackingSubscriptionDates, "pauseStartDate" | "pauseEndDate">,
): boolean {
  if (!input.pauseStartDate) return false;
  return input.pauseStartDate <= month
    && (input.pauseEndDate === null || input.pauseEndDate >= monthEnd(month));
}

/**
 * Une prestation de suivi vendue à un client.
 *
 * C'est la **seule** source de vérité de « ce client a ce produit, à ce prix,
 * à cette fréquence, de tel mois à tel mois ». Les lignes mensuelles de
 * l'addition en sont la conséquence, comme les mois de gestion sont la
 * conséquence de la formule du client. Sans elle, arrêter une prestation
 * n'aurait pas de formulation : supprimer la ligne du mois en cours l'aurait
 * vue réapparaître la nuit suivante, déduite de celle du mois précédent.
 */
export interface TrackingSubscription {
  id: string;
  serviceKey: string;
  /** Libellé saisi à la vente, figé : il figure sur l'addition du client. */
  label: string;
  /** Prix d'un rendez-vous de suivi, en centimes. */
  unitPriceCents: number;
  frequency: number;
  startedOn: string;
  endedOn: string | null;
}

/** Ce qu'un mois doit porter sur l'addition. */
export interface TrackingMonthAmount {
  serviceKey: string;
  month: string;
  label: string;
  unitPriceCents: number;
  frequency: number;
}

/** Une ligne de mois déjà inscrite, telle qu'elle sort de la base. */
export interface TrackingLineRow {
  id: string;
  serviceKey: string;
  performedOn: string;
  unitPriceCents: number;
  quantity: number;
}

/**
 * Mois dus par un client, tous produits de la famille confondus.
 *
 * Une prestation arrêtée puis revendue laisse deux souscriptions sur la même
 * clé : la plus récente décide du mois qu'elles se disputent, sans quoi une
 * revente à un nouveau tarif aurait été facturée à l'ancien.
 */
export function dueTrackingLines(input: {
  subscriptions: readonly TrackingSubscription[];
  client: Pick<TrackingSubscriptionDates, "contractEndDate" | "pauseStartDate" | "pauseEndDate">;
  today: string;
}): TrackingMonthAmount[] {
  const byMonth = new Map<string, TrackingMonthAmount>();
  const ordered = [...input.subscriptions].sort((first, second) =>
    first.startedOn.localeCompare(second.startedOn));

  for (const subscription of ordered) {
    const months = dueTrackingMonths({
      startedOn: subscription.startedOn,
      endedOn: subscription.endedOn,
      contractEndDate: input.client.contractEndDate,
      pauseStartDate: input.client.pauseStartDate,
      pauseEndDate: input.client.pauseEndDate,
      today: input.today,
    });
    for (const month of months) {
      byMonth.set(`${subscription.serviceKey}|${month}`, {
        serviceKey: subscription.serviceKey,
        month,
        label: subscription.label,
        unitPriceCents: subscription.unitPriceCents,
        frequency: subscription.frequency,
      });
    }
  }

  return [...byMonth.values()].sort((first, second) =>
    first.month.localeCompare(second.month) || first.serviceKey.localeCompare(second.serviceKey));
}

export interface TrackingMonthPlan {
  /** Ce qui manque à l'addition. */
  toInsert: TrackingMonthAmount[];
  /** Mois inscrits dont le prix ou la fréquence ne suit plus la vente. */
  toUpdate: { id: string; month: TrackingMonthAmount }[];
  /** Mois qui ne sont plus dus : prestation arrêtée, pause posée, fin avancée. */
  staleIds: string[];
}

/**
 * Écart entre les mois dus et ceux déjà inscrits.
 *
 * Même intention que `reconcileManagementMonths`, et pour la même raison : la
 * synchronisation tourne chaque nuit *et* à chaque ouverture de l'écran budget,
 * elle doit donc être rejouable sans précaution et se corriger d'elle-même.
 * Une différence : ici le prix **et** la fréquence peuvent changer, et les deux
 * se recalent.
 *
 * Les mois dont la facture est établie ou prélevée sont intouchables : ce qui
 * est parti chez le client est un fait, pas une valeur à recalculer.
 */
export function reconcileTrackingMonths(
  due: readonly TrackingMonthAmount[],
  existing: readonly TrackingLineRow[],
  options: { lockedMonths?: readonly string[] } = {},
): TrackingMonthPlan {
  const locked = new Set(options.lockedMonths ?? []);
  const isLocked = (date: string) => locked.has(trackingMonthStart(date));
  const keyOf = (serviceKey: string, date: string) => `${serviceKey}|${trackingMonthStart(date)}`;

  const dueByKey = new Map(due.map((month) => [keyOf(month.serviceKey, month.month), month]));
  const presentByKey = new Map(existing.map((row) => [keyOf(row.serviceKey, row.performedOn), row]));

  const toUpdate: { id: string; month: TrackingMonthAmount }[] = [];
  for (const month of due) {
    const row = presentByKey.get(keyOf(month.serviceKey, month.month));
    if (!row || isLocked(month.month)) continue;
    if (row.unitPriceCents === month.unitPriceCents && row.quantity === month.frequency) continue;
    toUpdate.push({ id: row.id, month });
  }

  return {
    toInsert: due.filter((month) =>
      !presentByKey.has(keyOf(month.serviceKey, month.month)) && !isLocked(month.month)),
    toUpdate,
    staleIds: existing
      .filter((row) =>
        !dueByKey.has(keyOf(row.serviceKey, row.performedOn)) && !isLocked(row.performedOn))
      .map((row) => row.id),
  };
}

/** Libellé porté par la ligne d'un mois : lisible seul sur l'addition. */
export function trackingLineLabel(label: string, month: string): string {
  return `${label} · ${trackingMonthLabel(month)}`;
}

/**
 * Mois clos dont le compte rendu est à ouvrir.
 *
 * Un mois ne se commente qu'une fois fini : seuls les mois strictement
 * antérieurs au mois en cours comptent. Le mois en cours figure déjà à
 * l'addition — il est vendu — mais son compte rendu n'a rien à dire.
 *
 * La fenêtre est bornée aux trois derniers mois clos. Une prestation
 * enregistrée rétroactivement sur un an n'ouvrirait sinon douze tâches d'un
 * coup, dont personne ne pourra reconstituer les chiffres : une tâche
 * irréalisable n'est pas une tâche, c'est du bruit dans la file.
 */
export const TRACKING_REPORT_BACKLOG_MONTHS = 3;

export function trackingReportsToOpen(
  due: readonly TrackingMonthAmount[],
  today: string,
): TrackingMonthAmount[] {
  const currentMonth = trackingMonthStart(today);
  const [year, month] = currentMonth.split("-").map(Number);
  const oldest = new Date(Date.UTC(year!, month! - 1 - TRACKING_REPORT_BACKLOG_MONTHS, 1))
    .toISOString()
    .slice(0, 10);
  return due.filter((entry) => entry.month < currentMonth && entry.month >= oldest);
}

// ---------------------------------------------------------------------------
// Le compte rendu : son mois, son échéance, son responsable
// ---------------------------------------------------------------------------

/**
 * Jour où le compte rendu est attendu.
 *
 * Le 8 : avant le premier créneau de rendez-vous du mois (le 9 ou le 10, voir
 * `monthly-tracking-slots`). Arriver au rendez-vous sans les chiffres du mois
 * écoulé est précisément ce que cette tâche doit empêcher.
 */
export const TRACKING_REPORT_DUE_DAY = 8;

/**
 * Mois sur lequel porte le compte rendu ouvert aujourd'hui : le précédent.
 *
 * Un mois ne se commente pas avant d'être fini. Le compte rendu de septembre
 * s'ouvre donc le 1er octobre et s'attend le 8.
 */
export function trackingReportPeriod(today: string): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 10);
}

/** Échéance du compte rendu d'un mois : le 8 du mois suivant. */
export function trackingReportDueOn(period: string): string {
  const next = nextMonthStart(trackingMonthStart(period));
  return `${next.slice(0, 7)}-${String(TRACKING_REPORT_DUE_DAY).padStart(2, "0")}`;
}

/**
 * Rôle à qui revient le compte rendu, et son repli.
 *
 * Un rôle, jamais une personne : une adresse en dur dans le code survit à son
 * titulaire. Le repli est celui des tickets (`fallbackRolesFor`), et il ne vaut
 * que pour un responsable — une tâche sans responsable n'est vue de personne.
 *
 * Attention à la résolution : deux profils portent aujourd'hui `super_admin`.
 * Prendre « le premier » sans ordre donnerait un responsable différent d'un
 * mois à l'autre. La recherche regarde donc d'abord l'affectation portée par le
 * client, puis les profils du rôle dans un ordre déterministe.
 */
export const TRACKING_REPORT_TARGET = {
  role: "super_admin",
  assignmentRole: "owner",
} as const;

/** Titre de la tâche, tel que la carte et le calendrier l'affichent. */
export function trackingReportTitle(product: MonthlyTrackingProduct, period: string): string {
  return `${product.label} — compte rendu ${trackingMonthLabel(period)}`;
}

// ---------------------------------------------------------------------------
// Les chiffres : saisie, ratios, lecture
// ---------------------------------------------------------------------------

/** Valeurs relevées, par clé de statistique. Centimes pour les euros. */
export type TrackingStatValues = Record<string, number>;

/**
 * Valeurs d'un compte rendu, lues depuis le `jsonb`.
 *
 * Tout ce qui n'est pas un nombre fini est écarté plutôt que converti : un
 * `null` devenu zéro se lirait « aucune impression » au lieu de « non relevé »,
 * et le ratio qui en dépend serait faux.
 */
export function parseTrackingStats(raw: unknown): TrackingStatValues {
  if (!raw || typeof raw !== "object") return {};
  const values: TrackingStatValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number") {
      if (Number.isFinite(value)) values[key] = value;
      continue;
    }
    /*
     * `Number(null)` et `Number("")` valent zéro : les convertir aurait écrit
     * « aucune impression » là où rien n'a été relevé, et le ratio qui en
     * dépend serait devenu faux au lieu de rester absent.
     */
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") continue;
    const number = Number(trimmed);
    if (Number.isFinite(number)) values[key] = number;
  }
  return values;
}

/** Statistiques obligatoires manquantes, par leur libellé. */
export function missingRequiredStats(
  product: MonthlyTrackingProduct,
  values: TrackingStatValues,
): string[] {
  return product.stats
    .filter((field) => field.required && !Number.isFinite(values[field.key]))
    .map((field) => field.label);
}

export interface TrackingRatioResult {
  key: string;
  label: string;
  /** Déjà mis en forme : « 2,4 % », « 0,42 € », « 1,8 ». Tiret si incalculable. */
  text: string;
}

function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Euros depuis des centimes, deux décimales : la même écriture partout. */
export function formatTrackingEuros(cents: number): string {
  return `${formatDecimal(cents / 100, 2)} €`;
}

/**
 * Ratios du mois, calculés — jamais saisis.
 *
 * Un dénominateur nul ou absent rend un tiret : zéro clic ne donne pas un coût
 * par clic de zéro, il n'en donne aucun.
 */
export function computeTrackingRatios(
  product: MonthlyTrackingProduct,
  values: TrackingStatValues,
): TrackingRatioResult[] {
  return product.ratios.map((ratio) => {
    const [numeratorKey, denominatorKey] = ratio.of;
    const numerator = values[numeratorKey];
    const denominator = values[denominatorKey];
    const computable = Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0;

    if (!computable) return { key: ratio.key, label: ratio.label, text: "—" };

    const quotient = numerator! / denominator!;
    const text = ratio.unit === "pourcentage"
      ? `${formatDecimal(quotient * 100, 2)} %`
      : ratio.unit === "euros"
        ? formatTrackingEuros(quotient)
        : formatDecimal(quotient, 1);
    return { key: ratio.key, label: ratio.label, text };
  });
}

/** Une statistique mise en forme pour la lecture. */
export function formatTrackingStat(field: TrackingStatField, value: number | undefined): string {
  if (!Number.isFinite(value)) return "—";
  return field.unit === "euros"
    ? formatTrackingEuros(value!)
    : new Intl.NumberFormat("fr-FR").format(value!);
}

// ---------------------------------------------------------------------------
// L'historique : un bloc par mois, et non une semaine inventée
// ---------------------------------------------------------------------------

/** Compte rendu rempli, tel qu'il sort de la base. */
export interface TrackingReportRow {
  id: string;
  serviceKey: string;
  periodMonth: string;
  improvements: string | null;
  stats: unknown;
  filledAt: string | null;
  filledByName: string | null;
}

export interface TrackingReportHistory {
  id: string;
  serviceKey: string;
  productLabel: string;
  periodMonth: string;
  monthLabel: string;
  improvements: string;
  filledAt: string | null;
  filledByName: string | null;
  figures: { label: string; text: string }[];
  ratios: TrackingRatioResult[];
}

/**
 * Comptes rendus d'un client, du plus récent au plus ancien.
 *
 * Volontairement **hors** de la chronologie par semaine. L'historique est
 * indexé sur `weekly_sheets`, dont les fiches sont purgées quatorze jours après
 * leur fin : un bilan accroché à une semaine serait lisible quelques jours puis
 * disparaîtrait avec elle, alors que la demande est de le relire mois après
 * mois. Il est donc relu dans sa propre table et rendu dans son propre bloc —
 * et un mois n'est pas présenté comme une semaine. La chronologie de la semaine
 * en porte seulement la mention (`tracking_report`), pour qui remonte le fil.
 */
export function buildTrackingReportHistory(
  rows: readonly TrackingReportRow[],
): TrackingReportHistory[] {
  return rows
    .map((row) => {
      const product = findTrackingProduct(row.serviceKey);
      const values = parseTrackingStats(row.stats);
      return {
        id: row.id,
        serviceKey: row.serviceKey,
        productLabel: product?.label ?? row.serviceKey,
        periodMonth: row.periodMonth,
        monthLabel: trackingMonthLabel(row.periodMonth),
        improvements: (row.improvements ?? "").trim(),
        filledAt: row.filledAt,
        filledByName: row.filledByName,
        figures: (product?.stats ?? [])
          // Une statistique facultative non relevée n'a pas à occuper une case vide.
          .filter((field) => field.required || Number.isFinite(values[field.key]))
          .map((field) => ({ label: field.label, text: formatTrackingStat(field, values[field.key]) })),
        ratios: product ? computeTrackingRatios(product, values) : [],
      };
    })
    .sort((first, second) =>
      second.periodMonth.localeCompare(first.periodMonth)
      || first.productLabel.localeCompare(second.productLabel, "fr"));
}

// ---------------------------------------------------------------------------
// Qui est encore servi
// ---------------------------------------------------------------------------

export interface TrackingClientState {
  isActive: boolean;
  kind: ClientKind;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
}

/**
 * Le client est-il en état d'être servi aujourd'hui ?
 *
 * Même règle que le bilan mensuel : ni archivé, ni terminé, ni en pause. Un
 * client en prestation ponctuelle (`one_shot`) reste accepté, lui : ces deux
 * produits se vendent sans gestion des réseaux.
 */
export function trackingClientIsServed(client: TrackingClientState, today: string): boolean {
  const state = clientLifecycle({
    isActive: client.isActive,
    kind: client.kind,
    contractStartDate: client.contractStartDate,
    contractEndDate: client.contractEndDate,
    pauseStartDate: client.pauseStartDate,
    pauseEndDate: client.pauseEndDate,
  }, today).state;
  return state === "active" || state === "one_shot";
}
