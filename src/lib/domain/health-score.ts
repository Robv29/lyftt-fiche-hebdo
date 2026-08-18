/**
 * Santé de l'agence, en trois piliers.
 *
 * Le score ne regardait que la relation client — consultation, corrections,
 * échéances — et retranchait un malus budgétaire. Il ignorait donc les deux
 * choses qui font la différence au quotidien : la vitesse à laquelle on rend,
 * et ce que le client pense vraiment du travail.
 *
 * Trois piliers, chacun noté sur cent, puis pondérés :
 *   - la satisfaction, ce que le client vit et ce qu'il en dit ;
 *   - la rapidité, nos délais à nous ;
 *   - le suivi interne, la rigueur de tenue des dossiers.
 *
 * Deux règles tiennent l'ensemble. Une mesure sans donnée est **écartée**, pas
 * comptée zéro : une semaine sans retour client ne doit pas faire chuter la
 * note. Et un pilier vide ne pèse pas — les poids se répartissent alors sur
 * ceux qui restent, faute de quoi le score dépendrait de ce qu'on ignore.
 */

export type HealthPillarKey = "satisfaction" | "rapidite" | "suivi";

export interface HealthPart {
  key: string;
  label: string;
  /** Note sur cent, ou null quand la période n'a rien à mesurer. */
  percentage: number | null;
  /** Précision affichée sous la note : ce qui la compose. */
  detail?: string;
  /** Le geste qui remonte cette mesure. */
  advice: string;
  /** Le geste qui la rend mesurable, quand elle ne l'est pas encore. */
  missingAdvice?: string;
}

export interface HealthPillar {
  key: HealthPillarKey;
  label: string;
  /** Poids visé, avant redistribution des piliers vides. */
  weight: number;
  percentage: number | null;
  parts: HealthPart[];
}

export interface HealthScore {
  /** Note globale sur cent, ou null quand rien n'est mesurable. */
  score: number | null;
  pillars: HealthPillar[];
}

/**
 * Nombre de réponses en deçà duquel la satisfaction ne compte pas.
 *
 * Une seule réponse ferait bouger le score de vingt points : ce serait le
 * hasard qui noterait l'agence.
 */
export const MIN_SATISFACTION_ANSWERS = 3;

/**
 * Un délai devient une note.
 *
 * En deçà de l'objectif, c'est cent ; au-delà du seuil intolérable, zéro ;
 * entre les deux, la note descend proportionnellement. Sans cette conversion,
 * on ne pourrait pas mêler des heures à des pourcentages.
 */
export function delayScore(hours: number | null, goodHours: number, badHours: number): number | null {
  if (hours === null || !Number.isFinite(hours)) return null;
  if (hours <= goodHours) return 100;
  if (hours >= badHours) return 0;
  return Math.round(100 * (1 - (hours - goodHours) / (badHours - goodHours)));
}

/** Moyenne des mesures disponibles, en ignorant celles qui n'en sont pas. */
function averageOf(parts: readonly HealthPart[]): number | null {
  const values = parts.map((part) => part.percentage).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export interface HealthInputs {
  /** Note moyenne donnée par les clients, en pourcentage. */
  satisfactionPercentage: number | null;
  satisfactionAnswers: number;
  /** Fiches ouvertes par le client, sur les fiches envoyées. */
  viewRate: number | null;
  /** Fiches validées sans la moindre demande de correction. */
  noCorrectionRate: number | null;
  /** Fiches envoyées avant l'échéance de validation. */
  sentBeforeDeadlineRate: number | null;
  /** Délai moyen entre un retour client et sa résolution, en heures. */
  correctionHours: number | null;
  /** Commandes internes livrées avant leur date limite. */
  productionPunctuality: number | null;
  /** Dossiers budget complets : mode, enveloppe, dates, RIB. */
  budgetsComplete: number | null;
  /** Shootings dont on sait s'ils sont compris au forfait ou vendus en plus. */
  shootingsCategorised: number | null;
  /** Retours renvoyés au client dans les vingt heures ouvrées suivant leur arrivée. */
  ticketsOnTime: number | null;
}

export function healthScore(input: HealthInputs): HealthScore {
  const satisfactionCounts = input.satisfactionAnswers >= MIN_SATISFACTION_ANSWERS;

  const definitions: Omit<HealthPillar, "percentage">[] = [
    {
      key: "satisfaction",
      label: "Satisfaction client",
      weight: 40,
      parts: [
        {
          key: "satisfaction-note",
          advice: "Demandez la note à chaque validation : la fenêtre s'ouvre en fin de fiche, un client qui la ferme ne compte pas.",
          missingAdvice: "Aucune note exploitable : il en faut au moins trois. Relancez les clients qui viennent de valider.",
          label: "Note des clients",
          // En deçà de trois réponses, on ne note pas : on le dit.
          percentage: satisfactionCounts ? input.satisfactionPercentage : null,
          detail: satisfactionCounts
            ? `${input.satisfactionAnswers} réponses`
            : `${input.satisfactionAnswers} réponse${input.satisfactionAnswers > 1 ? "s" : ""} — trop peu pour compter`,
        },
        {
          key: "sans-correction",
          label: "Validées sans correction",
          percentage: input.noCorrectionRate,
          advice: "Relisez les fiches avant envoi : reprenez les motifs de tickets les plus fréquents, ce sont les mêmes qui reviennent.",
        },
        {
          key: "consultees",
          label: "Fiches consultées",
          percentage: input.viewRate,
          advice: "Relancez les clients qui n'ont pas ouvert leur lien : une fiche non consultée finit en validation tacite, jamais en satisfaction.",
        },
      ],
    },
    {
      key: "rapidite",
      label: "Rapidité",
      weight: 30,
      parts: [
        {
          key: "avant-echeance",
          label: "Fiches envoyées avant l'échéance",
          percentage: input.sentBeforeDeadlineRate,
          advice: "Avancez la préparation d'une journée : c'est l'écart qui sépare une fiche envoyée la veille d'une fiche envoyée le jour même.",
        },
        {
          key: "corrections",
          advice: "Traitez les retours sous 24 h : au-delà de 72 h la note tombe à zéro, et le client a attendu tout un week-end.",
          missingAdvice: "Aucun retour clos sur la période — rien à corriger de ce côté.",
          label: "Corrections rendues vite",
          // Sous 24 h c'est tenu, au-delà de 72 h le client a attendu tout un week-end.
          percentage: delayScore(input.correctionHours, 24, 72),
          detail: input.correctionHours === null
            ? undefined
            : `${Math.round(input.correctionHours)} h en moyenne`,
        },
        {
          key: "prod-interne",
          label: "Commandes internes dans les temps",
          percentage: input.productionPunctuality,
          advice: "Fixez des dates limites tenables à la commande, et livrez avant : c'est ce délai qui décale toute la semaine quand il glisse.",
          missingAdvice: "Aucune commande interne livrée sur la période : la mesure reste vide tant que rien n'est déposé.",
        },
      ],
    },
    {
      key: "suivi",
      label: "Suivi interne",
      weight: 30,
      parts: [
        {
          key: "budgets",
          label: "Dossiers budget complets",
          percentage: input.budgetsComplete,
          advice: "Complétez les fiches budget en alerte : date de contrat, enveloppe, RIB pour les comptant et hybride.",
          missingAdvice: "Réservé à la direction : les budgets ne sont pas lisibles depuis ce compte.",
        },
        {
          key: "shootings",
          label: "Shootings catégorisés",
          percentage: input.shootingsCategorised,
          advice: "Classez les shootings en attente dans l'onglet Budget : compris au forfait ou vendu en plus. Un shooting non classé n'est jamais facturé.",
          missingAdvice: "Aucun shooting enregistré : rien à trier.",
        },
        {
          key: "tickets",
          label: "Retours corrigés en 20 h ouvrées",
          percentage: input.ticketsOnTime,
          advice: "Renvoyez le lien corrigé dans les vingt heures ouvrées qui suivent l'arrivée du retour : un ticket ouvert au-delà est déjà compté en faute.",
          missingAdvice: "Aucun retour jugeable : les compteurs en cours ne sont pas notés.",
        },
      ],
    },
  ];
  const pillars: HealthPillar[] = definitions.map((pillar) => ({
    ...pillar,
    percentage: averageOf(pillar.parts),
  }));

  /*
   * Les poids se redistribuent sur les piliers mesurables. Compter un pilier
   * vide comme zéro reviendrait à sanctionner l'agence pour une semaine sans
   * commande interne ; l'ignorer sans rééquilibrer plafonnerait le score.
   */
  const measured = pillars.filter((pillar) => pillar.percentage !== null);
  const totalWeight = measured.reduce((total, pillar) => total + pillar.weight, 0);
  const score = totalWeight === 0
    ? null
    : Math.round(
        measured.reduce((total, pillar) => total + pillar.percentage! * pillar.weight, 0) / totalWeight,
      );

  return { score, pillars };
}

/**
 * Objectif de l'agence.
 *
 * Cent est hors d'atteinte durable — il suppose que pas un client ne demande
 * jamais la moindre correction. Quatre-vingt-dix est exigeant et tenable.
 */
export const HEALTH_TARGET = 90;

export interface HealthAction {
  key: string;
  pillar: HealthPillarKey;
  pillarLabel: string;
  label: string;
  /** Note actuelle, ou null quand la mesure n'existe pas encore. */
  percentage: number | null;
  advice: string;
  /**
   * Points de score global gagnés en portant cette mesure à l'objectif.
   *
   * C'est le seul tri honnête : une mesure très basse dans un pilier léger
   * pèse parfois moins qu'une mesure moyenne dans un pilier lourd, et l'ordre
   * alphabétique enverrait travailler au mauvais endroit.
   */
  gain: number;
}

/**
 * Ce qu'il reste à faire pour atteindre l'objectif.
 *
 * On ne liste que ce qui manque, chiffré en points de score, du plus payant au
 * moins payant. Les mesures absentes ferment la marche : elles ne rapportent
 * rien tant qu'aucune donnée ne les alimente, mais les ignorer laisserait
 * croire que tout est mesuré.
 */
export function healthActions(health: HealthScore, target: number = HEALTH_TARGET): HealthAction[] {
  const measuredPillars = health.pillars.filter((pillar) => pillar.percentage !== null);
  const totalWeight = measuredPillars.reduce((total, pillar) => total + pillar.weight, 0);

  const actions: HealthAction[] = [];
  for (const pillar of health.pillars) {
    const measuredParts = pillar.parts.filter((part) => part.percentage !== null);
    for (const part of pillar.parts) {
      if (part.percentage === null) {
        actions.push({
          key: part.key,
          pillar: pillar.key,
          pillarLabel: pillar.label,
          label: part.label,
          percentage: null,
          advice: part.missingAdvice ?? part.advice,
          gain: 0,
        });
        continue;
      }
      if (part.percentage >= target) continue;
      /*
       * Une mesure ne pèse que sa part du pilier, et le pilier que sa part du
       * score. Annoncer le gain brut ferait promettre vingt points là où il
       * n'y en a que trois.
       */
      const share = totalWeight === 0 ? 0 : pillar.weight / totalWeight / measuredParts.length;
      actions.push({
        key: part.key,
        pillar: pillar.key,
        pillarLabel: pillar.label,
        label: part.label,
        percentage: part.percentage,
        advice: part.advice,
        gain: Math.round((target - part.percentage) * share * 10) / 10,
      });
    }
  }

  return actions.sort((a, b) => {
    if (a.percentage === null && b.percentage !== null) return 1;
    if (b.percentage === null && a.percentage !== null) return -1;
    return b.gain - a.gain;
  });
}
