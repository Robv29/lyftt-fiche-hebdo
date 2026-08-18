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
  label: string;
  /** Note sur cent, ou null quand la période n'a rien à mesurer. */
  percentage: number | null;
  /** Précision affichée sous la note : ce qui la compose. */
  detail?: string;
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
  /** Tickets ouverts dont l'échéance n'est pas dépassée. */
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
          label: "Note des clients",
          // En deçà de trois réponses, on ne note pas : on le dit.
          percentage: satisfactionCounts ? input.satisfactionPercentage : null,
          detail: satisfactionCounts
            ? `${input.satisfactionAnswers} réponses`
            : `${input.satisfactionAnswers} réponse${input.satisfactionAnswers > 1 ? "s" : ""} — trop peu pour compter`,
        },
        { label: "Validées sans correction", percentage: input.noCorrectionRate },
        { label: "Fiches consultées", percentage: input.viewRate },
      ],
    },
    {
      key: "rapidite",
      label: "Rapidité",
      weight: 30,
      parts: [
        { label: "Fiches envoyées avant l'échéance", percentage: input.sentBeforeDeadlineRate },
        {
          label: "Corrections rendues vite",
          // Sous 24 h c'est tenu, au-delà de 72 h le client a attendu tout un week-end.
          percentage: delayScore(input.correctionHours, 24, 72),
          detail: input.correctionHours === null
            ? undefined
            : `${Math.round(input.correctionHours)} h en moyenne`,
        },
        { label: "Commandes internes dans les temps", percentage: input.productionPunctuality },
      ],
    },
    {
      key: "suivi",
      label: "Suivi interne",
      weight: 30,
      parts: [
        { label: "Dossiers budget complets", percentage: input.budgetsComplete },
        { label: "Shootings catégorisés", percentage: input.shootingsCategorised },
        { label: "Tickets sans retard", percentage: input.ticketsOnTime },
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
