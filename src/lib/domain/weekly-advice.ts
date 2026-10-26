import { fromZonedTime } from "date-fns-tz";
import { isoWeekStart } from "./deadline";
import { HEALTH_TARGET, type HealthAction, type HealthScore } from "./health-score";
import { PARIS_TIMEZONE, parisFields } from "./paris-time";
import { hasWrittenCaption, isoWeekIdentity } from "./planning";
import { productionVerdict } from "./production-requests";
import { isPreSendSheetStatus } from "./sheet-status";
import { TICKET_SLA_HOURS, ticketSlaState, ticketSlaSummary } from "./ticket-sla";
import { TICKET_TYPE_DEFINITIONS, type TicketType } from "./ticket-types";
import { requiresCaption, requiresMedia, type MediaFormat, type SheetStatus } from "./types";
import { sheetsToCreate, weekLifecycle, type WeekExpectationRow } from "./week-expectation";
import { ALERT_HOUR } from "./weekly-sheet-alert";

/**
 * Le diagnostic du lundi : pourquoi la note n'est pas au maximum, ce que la
 * semaine réclame, et ce qu'il faut changer aux textes et aux visuels pour que
 * le client demande moins de corrections.
 *
 * Deux moments, un seul calcul. Le lundi à 10 h, la tâche planifiée lit la
 * production et écrit une ligne par semaine ; à 14 h 30, la pop-up ouvre cette
 * ligne. Rien n'est recalculé entre les deux : ce que l'équipe lit l'après-midi
 * est exactement ce qui a été mesuré le matin, et deux personnes ne peuvent pas
 * lire deux diagnostics différents de la même semaine.
 *
 * **Tout ce qui se décide vit dans ce fichier** — les heures, le plafond de
 * conseils, chaque seuil et chaque phrase. C'est ce qui rend vraie la promesse
 * « ajouter une règle sans toucher à la plomberie » : une entrée de plus dans
 * `ADVICE_RULES`, et la tâche planifiée, la base et la pop-up n'ont pas une
 * ligne à changer. Les écrans ne formulent rien ; ils affichent.
 *
 * Module pur : ni réseau, ni base, ni `use client`. C'est ce qui permet de
 * rejouer un lundi d'hiver, un lundi d'été, une semaine vide et une semaine
 * chargée sans rien montrer à personne — et de vérifier chaque phrase avant
 * qu'elle ne s'affiche.
 *
 * Les règles sont **des règles** : aucun texte n'est écrit par un modèle de
 * langage, chaque phrase est un gabarit nourri d'un chiffre mesuré. Un chiffre
 * qu'une règle ne sait pas mesurer n'apparaît pas — c'est la seule façon
 * d'éviter la généralité, qui est ce qu'on reproche à ce genre d'encart.
 */

// ---------------------------------------------------------------------------
// 1. Les deux moments
// ---------------------------------------------------------------------------

/** Lundi, en jour de semaine ISO. Les deux moments tombent le même jour. */
export const ADVICE_WEEKDAY = 1;

/** L'heure du scan : lundi 10 h, heure de Paris. */
export const ADVICE_SCAN_HOUR = 10;

/** L'heure de la pop-up : lundi 14 h 30, heure de Paris. */
export const ADVICE_OPEN_HOUR = 14;
export const ADVICE_OPEN_MINUTE = 30;

/**
 * Cette exécution a-t-elle le droit de calculer ?
 *
 * Le garde répond à « cette exécution peut-elle agir ? », jamais à « est-il
 * exactement 10 h ? » : une tâche planifiée glisse, se rejoue, s'appelle à la
 * main, et un `=== 10` a déjà fait disparaître l'alerte du vendredi en silence
 * (`weekly-sheet-alert.ts`). Le créneau s'arrête à l'heure de la pop-up : après
 * 14 h 30, calculer reviendrait à écrire un diagnostic que personne ne verra
 * s'ouvrir cette semaine.
 *
 * Heure civile parisienne, heure d'été comprise : 10 h à Paris vaut 8 h UTC en
 * été et 9 h UTC en hiver. La tâche est donc planifiée aux deux heures UTC, en
 * deux entrées quotidiennes distinctes, et c'est ce garde qui tranche —
 * `getHours()`, lui, répondrait selon le fuseau de la machine, UTC en
 * production.
 */
export function isAdviceScanWindow(now: Date): boolean {
  const { weekday, hour, minute } = parisFields(now);
  if (weekday !== ADVICE_WEEKDAY) return false;
  return hour >= ADVICE_SCAN_HOUR
    && hour * 60 + minute < ADVICE_OPEN_HOUR * 60 + ADVICE_OPEN_MINUTE;
}

/**
 * Semaine ISO du diagnostic, lue à l'heure de Paris.
 *
 * `isoWeekIdentity` lit les champs **UTC** de l'instant qu'on lui donne : le
 * lundi à 0 h 30 à Paris, il est encore dimanche en UTC, et la recherche
 * tomberait sur la ligne de la semaine précédente — donc sur un `opens_at`
 * déjà passé, donc sur une pop-up de la semaine dernière qui se rouvre. On
 * passe par la date civile parisienne, comme partout ailleurs dans
 * l'application.
 */
export function adviceWeek(now: Date): { isoYear: number; isoWeek: number; weekStart: string } {
  const { year, week } = isoWeekIdentity(new Date(`${parisFields(now).day}T00:00:00Z`));
  return { isoYear: year, isoWeek: week, weekStart: isoWeekStart(year, week).toISOString().slice(0, 10) };
}

/**
 * Instant où la pop-up s'ouvre : lundi 14 h 30 à Paris, résolu une fois.
 *
 * Un **instant**, et non une heure civile, parce que c'est le navigateur qui
 * décidera du moment : comparer `Date.now()` à cet instant ne dépend ni du
 * fuseau de l'appareil ni de la saison. La conversion a lieu ici, côté serveur,
 * dans la base de fuseaux — un décalage calculé à la main se trompe toujours
 * d'une heure fin octobre, et aujourd'hui est le lundi qui suit la bascule.
 */
export function adviceOpensAt(weekStart: string): Date {
  const clock = `${String(ADVICE_OPEN_HOUR).padStart(2, "0")}:${String(ADVICE_OPEN_MINUTE).padStart(2, "0")}`;
  return fromZonedTime(`${weekStart}T${clock}:00`, PARIS_TIMEZONE);
}

// ---------------------------------------------------------------------------
// 2. Les deux audiences
// ---------------------------------------------------------------------------

/**
 * À qui s'adresse une ligne de diagnostic.
 *
 * Le score n'est pas un nombre unique : deux de ses neuf mesures — dossiers
 * budget et shootings catégorisés — se calculent sur `client_budget_lines`,
 * table ouverte à la seule direction. Pour tout autre rôle elles valent `null`,
 * les poids se redistribuent (`healthScore`) et la note change. Une seule ligne
 * par semaine devrait donc soit mentir à l'un des deux publics, soit révéler à
 * l'autre un conseil budgétaire qu'il ne peut pas suivre.
 *
 * D'où deux lignes par semaine, et la même note qu'affiche déjà le tableau de
 * bord de chacun. Le partage est au niveau de la ligne et non de la colonne :
 * tous les comptes de l'application sont un seul rôle Postgres,
 * `authenticated`, donc un `grant` par colonne n'y changerait rien.
 */
export type AdviceAudience = "equipe" | "direction";

export const ADVICE_AUDIENCES: readonly AdviceAudience[] = ["equipe", "direction"];

// ---------------------------------------------------------------------------
// 3. Ce que le diagnostic sait de la production
// ---------------------------------------------------------------------------

/** Un dossier et le nombre d'objets qu'il porte. Jamais son nom — voir plus bas. */
export interface ClientCount {
  clientId: string;
  count: number;
}

/**
 * Un total, et sa répartition par dossier.
 *
 * Le total est ce que la règle explique ; la répartition est ce qui la rend
 * actionnable — « 34 sur 4 dossiers » dit où aller, « 36 au total » ne dit rien.
 */
export interface ClientTally {
  total: number;
  /** Décroissant, les plus gros d'abord. */
  byClient: readonly ClientCount[];
}

export const EMPTY_TALLY: ClientTally = { total: 0, byClient: [] };

/** Une commande interne en retard : le dossier, et de combien de jours. */
export interface OverdueRequest {
  clientId: string | null;
  days: number;
}

/** Un shooting tourné dont personne n'a dit s'il était compris au forfait. */
export interface ShootingToClassify {
  clientId: string;
  /** Date de tournage, en date civile. Jamais le montant de la ligne. */
  performedOn: string;
}

/**
 * Tout ce que le diagnostic mesure, et rien d'autre.
 *
 * Chaque champ porte son dénominateur à côté de son numérateur, parce que la
 * purge nocturne (`purge-media`) supprime les fiches dont la semaine est
 * passée depuis plus de quinze jours et emporte en cascade leurs publications,
 * leurs versions, leurs validations et leurs tickets. Ce que le diagnostic
 * **peut** mesurer change donc de semaine en semaine : une règle qui annoncerait
 * « 21 retours sur 96 » sur un échantillon de trois semaines dirait un chiffre
 * faux d'un air sûr. Chaque phrase dit donc son propre `n`.
 */
export interface WeeklyAdviceFacts {
  /** Fenêtre réellement analysée, en date civile. */
  windowSince: string;
  /** Lundi de la semaine en cours, date civile parisienne. */
  weekStart: string;
  /** Lundi de la semaine suivante. */
  nextWeekStart: string;
  /** Numéro ISO de la semaine suivante : c'est celle qu'on prépare. */
  nextIsoWeek: number;

  /** Le score tel que cette audience le voit, et ses écarts déjà chiffrés. */
  health: HealthScore;
  /** `healthActions(health)` : trié par gain, mesures absentes en dernier. */
  actions: readonly HealthAction[];

  // -- Fiches envoyées -------------------------------------------------------
  sentSheets: number;
  approvedSheets: number;
  /** Envoyées, jamais validées. */
  unapprovedSheets: ClientTally;
  /** Parmi elles : une version corrigée existe et n'est pas repartie. */
  resendPending: ClientTally;
  /** Validées après au moins une demande de correction. */
  approvedAfterCorrection: ClientTally;
  /** Validées après leur échéance. */
  approvedLate: number;
  /** Parties après le vendredi 16 h qui précède leur semaine. */
  sentAfterCutoff: number;
  /** Retard moyen de celles-là, en heures. `null` quand il n'y en a aucune. */
  sentAfterCutoffAverageHours: number | null;

  // -- Retours clients -------------------------------------------------------
  /** Retours jugeables sur le délai promis. */
  judgeableTickets: number;
  /** Au-delà du délai promis. */
  lateTickets: ClientTally;
  /** Jamais suivis d'une version corrigée envoyée au client. */
  unansweredTickets: number;
  /** Retours portant sur le texte. */
  textTickets: ClientTally;
  /** Retours portant sur les hashtags. */
  hashtagTickets: ClientTally;
  /** Total des retours de la fenêtre, hors demandes hors publication. */
  totalTickets: number;

  // -- Commandes internes ----------------------------------------------------
  deliveredRequests: number;
  deliveredLateRequests: number;
  /** Encore à faire, échéance dépassée. */
  overdueRequests: readonly OverdueRequest[];

  // -- La semaine à venir ----------------------------------------------------
  nextWeekSheets: number;
  nextWeekDrafts: number;
  nextWeekItems: number;
  nextWeekItemsWithoutMedia: number;
  /** Légendes réduites au bloc signature, sur des fiches jamais parties. */
  nextWeekCaptionsSignatureOnly: number;
  /** Clients attendus la semaine prochaine sans aucune fiche. */
  nextWeekMissingSheets: ClientTally;
  currentWeekItems: number;
  currentWeekItemsWithoutMedia: number;

  // -- Textes et visuels -----------------------------------------------------
  /** Publications parties chez le client avec la signature pour seule légende. */
  sentCaptionsSignatureOnly: ClientTally;
  /** Dossiers en gestion aujourd'hui. */
  managedClients: number;
  /** Parmi eux : aucune liste de hashtags validée sur la fiche client. */
  clientsWithoutPinnedHashtags: number;

  // -- Suivi et demandes -----------------------------------------------------
  trackingReportsToFill: number;
  openServiceRequests: number;

  // -- Direction seule -------------------------------------------------------
  /** Shootings tournés et non tranchés, encore classables. Sans montant. */
  unclassifiedShootings: readonly ShootingToClassify[];
  /** Dossiers budget en alerte. Un compte, jamais un euro. */
  budgetClientsWithIssue: ClientTally;
}

// ---------------------------------------------------------------------------
// 4. Un conseil
// ---------------------------------------------------------------------------

/** Nombre maximum de conseils affichés. Au-delà, on ne lit plus. */
export const WEEKLY_ADVICE_LIMIT = 5;

/**
 * Nombre de dossiers nommés sous un conseil.
 *
 * « Nommez les dossiers quand ils sont peu nombreux » : au-delà de quatre noms,
 * la ligne cesse d'être une consigne et devient une liste, qu'on referme.
 */
export const ADVICE_CLIENT_NAMES_LIMIT = 4;

/**
 * Ce qu'il n'y a pas à dire, dit platement.
 *
 * Une semaine sans écart existe. Inventer un conseil pour remplir l'encart
 * apprend à l'équipe que l'encart est décoratif, et le prochain vrai conseil
 * ne sera pas lu non plus.
 */
export const ADVICE_NOTHING_TO_SAY =
  "Rien à signaler cette semaine : aucune règle n'a d'écart à relever. "
  + "L'écart de note restant, s'il y en a, se lit mesure par mesure sur Indicateurs.";

export interface WeeklyAdviceItem {
  key: string;
  audience: AdviceAudience;
  /** La phrase qui porte le chiffre. Jamais de nom de dossier dedans. */
  statement: string;
  /** Le seul geste à faire. Un, pas trois. */
  action: string;
  /**
   * Ce que la règle explique, en nombre d'objets concernés — fiches, retours,
   * publications, commandes. C'est le seul tri honnête disponible : trier par
   * ordre alphabétique ou par pilier enverrait travailler au mauvais endroit,
   * et les unités diffèrent trop pour qu'une pondération inventée soit plus
   * juste qu'un simple volume. À volume égal, l'ordre de `ADVICE_RULES`
   * tranche.
   */
  volume: number;
  /**
   * Les dossiers concernés, par identifiant et par compte.
   *
   * **Jamais leur nom.** Le diagnostic est à l'échelle de l'agence, mais
   * `can_access_client` borne un community manager à ses clients : une ligne en
   * base qui nommerait tout le monde lui livrerait les dossiers des autres.
   * Les noms sont résolus à l'affichage, par une lecture soumise à RLS ; ceux
   * que la personne ne peut pas résoudre se replient sur « et n autres
   * dossiers ».
   */
  clients: readonly ClientCount[];
  /** Nombre total de dossiers concernés, même quand tous ne sont pas listés. */
  clientCount: number;
  /**
   * Points de score global gagnés en portant la mesure à l'objectif, quand la
   * règle est adossée à une mesure du score. `null` sinon : la semaine à venir
   * et les textes ne se notent pas.
   *
   * Les gains ne sont **pas** additionnés pour annoncer un total « disponible » :
   * les mesures déjà au-dessus de l'objectif ne sont pas écrêtées, et la somme
   * dépasse l'écart réel à rattraper — l'encart d'Indicateurs promet ainsi
   * 16,3 points pour 12 points d'écart.
   */
  gain: number | null;
  /** D'où vient le chiffre, pour qui veut le vérifier. */
  source: string;
}

export interface WeeklyAdviceResult {
  /** La note telle que cette audience la voit, ou `null` si rien n'est mesurable. */
  score: number | null;
  /** Objectif de l'agence, répété ici pour que la pop-up n'ait rien à importer. */
  target: number;
  advices: readonly WeeklyAdviceItem[];
  /** Vrai quand aucune règle n'a quelque chose à dire. */
  nothingToSay: boolean;
  /** Les `n` de la semaine, pour relire le diagnostic sans les lignes sources. */
  sample: Record<string, number | string | null>;
}

// ---------------------------------------------------------------------------
// 5. La table des règles — le seul endroit où l'on ajoute un conseil
// ---------------------------------------------------------------------------

/** Ce qu'une règle a trouvé, ou `null` quand elle n'a rien à dire. */
interface AdviceFinding {
  volume: number;
  statement: string;
  action: string;
  clients?: ClientTally;
  /** Clé de la mesure du score dont la règle hérite son gain en points. */
  gainFrom?: string;
}

interface AdviceRule {
  key: string;
  audience: AdviceAudience;
  /** Où le chiffre se vérifie. Affiché en petit sous le conseil. */
  source: string;
  /**
   * `null` veut dire « rien à dire de ce côté », et non « zéro » : une semaine
   * sans retour hors délai ne doit pas produire la phrase « 0 retour hors
   * délai », qui occupe une des cinq places pour ne rien apprendre.
   */
  measure: (facts: WeeklyAdviceFacts) => AdviceFinding | null;
}

/**
 * Un nombre et son nom accordé : « 1 fiche », « 16 fiches ».
 *
 * Deux aides et non une : la moitié des phrases a besoin du nombre devant le
 * mot, l'autre moitié l'a déjà dit plus tôt dans la phrase et n'a besoin que de
 * l'accord. Les mêler produisait « 3 3 commandes », faute qu'aucun type ne
 * signale.
 *
 * **Le pluriel par défaut n'ajoute un `s` qu'au dernier mot**, ce qui ne vaut
 * que pour un nom d'un seul mot. Dès que le nom est suivi d'un complément ou
 * d'un adjectif qui ne s'accorde pas comme lui, il faut donner le pluriel en
 * entier : le défaut écrivait « 16 version corrigées », « 2 compte rendus » et
 * « 3 demande hors publications ». Le test « accorde les noms composés » tient
 * cette règle pour les règles à venir.
 */
function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value > 1 ? plural : singular}`;
}

/** L'accord seul, sans répéter le nombre : « sont encore en retard ». */
function agree(value: number, singular: string, plural: string): string {
  return value > 1 ? plural : singular;
}

/** Nombre de dossiers distincts d'un relevé. */
function clientsOf(tally: ClientTally): number {
  return tally.byClient.length;
}

/** Ce que les premiers dossiers concentrent, pour dire « 34 sur 4 dossiers ». */
function topShare(tally: ClientTally, take = ADVICE_CLIENT_NAMES_LIMIT): number {
  return tally.byClient.slice(0, take).reduce((total, entry) => total + entry.count, 0);
}

/** Pourcentage arrondi, pour une phrase. Jamais de division par zéro. */
function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

/**
 * Les règles, dans l'ordre où elles tranchent à volume égal.
 *
 * Chaque entrée dit son chiffre, nomme ses dossiers quand ils sont peu
 * nombreux, et ne demande **qu'un** geste. L'ordre de la liste est celui du
 * raisonnement : d'abord les écarts du score, parce que c'est la question
 * posée ; puis la semaine à venir, parce qu'elle se joue cette semaine ; puis
 * les textes et les visuels, qui font les retours de la semaine suivante.
 */
export const ADVICE_RULES: readonly AdviceRule[] = [
  // -- Les écarts du score ---------------------------------------------------
  {
    key: "fiches-jamais-validees",
    audience: "equipe",
    source: "Score · Validées sans correction · weekly_sheets.status",
    /*
     * Le plus gros morceau de l'écart, et il était mal nommé.
     *
     * « Validées sans correction » se calcule sur les fiches **envoyées**
     * (`agency-metrics.ts`) et exige le statut `approved_by_client` exactement :
     * une fiche propre que le client n'a jamais validée compte donc en faute
     * sur une mesure qui porte le mot « correction ». Le geste n'est pas
     * « relire mieux », c'est « faire revenir la validation » — d'où deux
     * conseils distincts là où l'écran n'en montre qu'un.
     */
    measure: (facts) => {
      const unapproved = facts.unapprovedSheets;
      if (unapproved.total === 0) return null;
      const resend = facts.resendPending;
      return {
        volume: unapproved.total,
        statement: `${unapproved.total} des ${facts.sentSheets} fiches envoyées n'ont jamais été validées`
          + (resend.total > 0
            ? `, dont ${resend.total} ${agree(resend.total, "attend", "attendent")} un renvoi.`
            : "."),
        action: resend.total > 0
          ? `Renvoyez ${count(resend.total, "version corrigée", "versions corrigées")} cette semaine.`
          : "Relancez les clients concernés : sans validation, la fiche finit en accord tacite.",
        clients: resend.total > 0 ? resend : unapproved,
        gainFrom: "sans-correction",
      };
    },
  },
  {
    key: "fiches-avec-correction",
    audience: "equipe",
    source: "Score · Validées sans correction · client_tickets",
    measure: (facts) => {
      const tally = facts.approvedAfterCorrection;
      if (tally.total === 0) return null;
      const dossiers = clientsOf(tally);
      const named = Math.min(dossiers, ADVICE_CLIENT_NAMES_LIMIT);
      return {
        volume: tally.total,
        statement: `${tally.total} des ${facts.approvedSheets} fiches validées ont demandé au moins une correction, `
          + (named < dossiers
            ? `${topShare(tally)} sur ${count(named, "dossier")}.`
            : `réparties sur ${count(dossiers, "dossier")}.`),
        action: "Faites relire ces fiches par un second œil avant de les envoyer.",
        clients: tally,
        gainFrom: "sans-correction",
      };
    },
  },
  {
    key: "fiches-en-retard",
    audience: "equipe",
    source: "Score · Fiches envoyées avant l'échéance · weekly_sheets",
    /*
     * Deux chiffres pour un seul geste : l'échéance de validation manquée, et
     * l'heure d'envoi qui l'explique. Le dossier d'enquête affirmait qu'aucune
     * fiche n'était jamais partie avant le vendredi 16 h ; la mesure live en
     * compte 42 sur 155 avant l'heure. L'affirmation n'est donc pas encodée —
     * c'est le compte réel qui l'est, avec son retard moyen.
     */
    measure: (facts) => {
      if (facts.approvedLate === 0 && facts.sentAfterCutoff === 0) return null;
      const hours = facts.sentAfterCutoffAverageHours;
      const days = hours === null ? null : Math.round((hours / 24) * 10) / 10;
      return {
        volume: Math.max(facts.approvedLate, facts.sentAfterCutoff),
        statement: `${facts.approvedLate} des ${facts.approvedSheets} fiches validées l'ont été après leur échéance, `
          + `et ${facts.sentAfterCutoff} des ${facts.sentSheets} fiches sont parties après le vendredi ${ALERT_HOUR} h`
          + (days === null
            ? "."
            : ` — ${String(days).replace(".", ",")} ${agree(days, "jour", "jours")} trop tard en moyenne.`),
        action: "Avancez l'envoi d'une journée : la fiche se prépare le vendredi, pas le lundi suivant.",
        gainFrom: "avant-echeance",
      };
    },
  },
  {
    key: "commandes-internes",
    audience: "equipe",
    source: "Score · Commandes internes dans les temps · production_requests",
    measure: (facts) => {
      const overdue = facts.overdueRequests;
      if (facts.deliveredLateRequests === 0 && overdue.length === 0) return null;
      const worst = overdue.reduce((days, request) => Math.max(days, request.days), 0);
      return {
        volume: facts.deliveredLateRequests + overdue.length,
        statement: `${facts.deliveredLateRequests} des ${facts.deliveredRequests} commandes internes livrées ont dépassé leur date`
          + (overdue.length === 0
            ? "."
            : `, et ${overdue.length} ${agree(overdue.length, "est encore en retard", "sont encore en retard")} — jusqu'à ${count(worst, "jour")}.`),
        action: overdue.length === 0
          ? "Fixez des dates tenables à la commande, et livrez avant."
          : overdue.length > 1
            ? `Livrez ces ${overdue.length} commandes avant jeudi.`
            : "Livrez cette commande avant jeudi.",
        clients: tallyOfRequests(overdue),
        gainFrom: "prod-interne",
      };
    },
  },
  {
    key: "retours-hors-delai",
    audience: "equipe",
    source: `Score · Retours dans le délai de ${TICKET_SLA_HOURS} h ouvrées · ticket-sla`,
    /*
     * Le libellé dit le vrai seuil, lu dans `TICKET_SLA_HOURS`.
     * `health-score.ts` annonce encore « 20 h ouvrées » dans son libellé et son
     * conseil alors que la règle en applique dix : recopier ce conseil, c'était
     * mentir d'un facteur deux dans une pop-up lue chaque semaine.
     */
    measure: (facts) => {
      const late = facts.lateTickets;
      const unanswered = facts.unansweredTickets;
      if (late.total === 0 && unanswered === 0) return null;
      const parts: string[] = [];
      if (late.total > 0) {
        const dossiers = clientsOf(late);
        const named = Math.min(dossiers, 3);
        parts.push(`${late.total} des ${facts.judgeableTickets} retours ont dépassé les ${TICKET_SLA_HOURS} h ouvrées`
          + (named < dossiers ? `, ${topShare(late, 3)} sur ${count(named, "dossier")}` : ""));
      }
      if (unanswered > 0) {
        parts.push(`${count(unanswered, "retour")} ${agree(unanswered, "n'a", "n'ont")} jamais reçu de version corrigée`);
      }
      return {
        volume: late.total + unanswered,
        statement: `${parts.join(", et ")}.`,
        action: "Renvoyez le lien corrigé le jour ouvré qui suit l'arrivée du retour.",
        clients: late,
        gainFrom: "tickets",
      };
    },
  },

  // -- La semaine à venir ----------------------------------------------------
  {
    key: "semaine-sans-media",
    audience: "equipe",
    source: "Semaine à venir · weekly_sheet_items.media_asset_id",
    measure: (facts) => {
      if (facts.nextWeekItemsWithoutMedia === 0) return null;
      const drafts = facts.nextWeekDrafts;
      return {
        volume: facts.nextWeekItemsWithoutMedia,
        statement: `Semaine ${facts.nextIsoWeek} : ${facts.nextWeekItemsWithoutMedia} des ${facts.nextWeekItems} contenus n'ont pas de média`
          + (drafts > 0
            ? `, et ${count(drafts, "fiche")} ${agree(drafts, "est", "sont")} encore en brouillon.`
            : "."),
        action: `Déposez les fichiers avant vendredi ${ALERT_HOUR} h.`,
      };
    },
  },
  {
    key: "semaine-legendes-signature",
    audience: "equipe",
    source: "Semaine à venir · hasWrittenCaption / post_signature",
    measure: (facts) => {
      if (facts.nextWeekCaptionsSignatureOnly === 0) return null;
      return {
        volume: facts.nextWeekCaptionsSignatureOnly,
        statement: `Semaine ${facts.nextIsoWeek} : ${facts.nextWeekCaptionsSignatureOnly} des ${facts.nextWeekItems} contenus `
          + "n'ont que le bloc signature pour légende.",
        action: "Écrivez le texte au-dessus de la signature : sans lui, la fiche reste bloquée sous les 100 %.",
      };
    },
  },
  {
    key: "semaine-clients-sans-fiche",
    audience: "equipe",
    source: "Semaine à venir · weekExpectation / sheetsToCreate",
    measure: (facts) => {
      const tally = facts.nextWeekMissingSheets;
      if (tally.total === 0) return null;
      return {
        volume: tally.total,
        statement: `${count(tally.total, "client attendu", "clients attendus")} en semaine ${facts.nextIsoWeek} `
          + `${agree(tally.total, "n'a", "n'ont")} aucune fiche.`,
        action: "Créez ces fiches depuis le planning, onglet « Semaine prochaine ».",
        clients: tally,
      };
    },
  },
  {
    key: "semaine-en-cours-sans-media",
    audience: "equipe",
    source: "Semaine en cours · weekly_sheet_items.media_asset_id",
    measure: (facts) => {
      if (facts.currentWeekItemsWithoutMedia === 0) return null;
      return {
        volume: facts.currentWeekItemsWithoutMedia,
        statement: `Semaine en cours : ${facts.currentWeekItemsWithoutMedia} des ${facts.currentWeekItems} contenus `
          + "sont encore sans média.",
        action: "Déposez les fichiers manquants aujourd'hui : ces publications sont déjà programmées.",
      };
    },
  },
  {
    key: "comptes-rendus",
    audience: "equipe",
    source: "Suivi mensuel · client_tracking_reports",
    measure: (facts) => facts.trackingReportsToFill === 0 ? null : {
      volume: facts.trackingReportsToFill,
      statement: `${count(facts.trackingReportsToFill, "compte rendu", "comptes rendus")} de suivi mensuel `
        + `${agree(facts.trackingReportsToFill, "reste", "restent")} à remplir.`,
      action: "Onglet Comptes rendus : complétez-les avant la fin du mois.",
    },
  },
  {
    key: "demandes-ouvertes",
    audience: "equipe",
    source: "Demandes hors publication · isServiceRequest",
    measure: (facts) => facts.openServiceRequests === 0 ? null : {
      volume: facts.openServiceRequests,
      statement: `${count(facts.openServiceRequests, "demande hors publication", "demandes hors publication")} `
        + `${agree(facts.openServiceRequests, "reste ouverte", "restent ouvertes")} — devis, date de shooting, service annexe.`,
      action: "Répondez ou refermez-les : elles n'ont pas de délai, donc personne ne les voit vieillir.",
    },
  },

  // -- Textes et visuels, pour moins de retours -------------------------------
  {
    key: "legendes-parties-signature",
    audience: "equipe",
    source: "Textes · weekly_sheet_items.caption sur fiches parties",
    /*
     * Le motif de retour le plus simple à supprimer : la publication est partie
     * chez le client avec la signature pour seul texte. Le verrou de complétude
     * l'interdit désormais sur les fiches jamais parties ; celles-ci sont déjà
     * chez le client, et restent réparables.
     */
    measure: (facts) => {
      const tally = facts.sentCaptionsSignatureOnly;
      if (tally.total === 0) return null;
      return {
        volume: tally.total,
        statement: `${count(tally.total, "publication")} ${agree(tally.total, "est partie", "sont parties")} chez le client `
          + "avec le bloc signature pour seule légende.",
        action: "Reprenez ces légendes : c'est le motif de retour le plus simple à supprimer.",
        clients: tally,
      };
    },
  },
  {
    key: "hashtags-sans-liste",
    audience: "equipe",
    source: "Textes · clients.notes → pinnedHashtags / tickets hashtags",
    measure: (facts) => {
      const tickets = facts.hashtagTickets;
      /*
       * Sans retour « hashtags », l'absence de liste validée reste une dette de
       * saisie et non une cause de correction : la règle ne parle que quand elle
       * explique quelque chose.
       */
      if (facts.clientsWithoutPinnedHashtags === 0 || tickets.total === 0) return null;
      return {
        volume: tickets.total,
        statement: `${facts.clientsWithoutPinnedHashtags} des ${facts.managedClients} dossiers gérés n'ont pas de liste de hashtags validée, `
          + `et les ${tickets.total} retours « hashtags » viennent de ${count(clientsOf(tickets), "dossier")}.`,
        action: "Figez leur liste sur la fiche client : elle sera reprise à chaque création de fiche.",
        clients: tickets,
      };
    },
  },
  {
    key: "retours-texte",
    audience: "equipe",
    source: "Textes · client_tickets.ticket_type = text_*",
    measure: (facts) => {
      const tally = facts.textTickets;
      if (tally.total === 0) return null;
      const dossiers = clientsOf(tally);
      const named = Math.min(dossiers, ADVICE_CLIENT_NAMES_LIMIT);
      return {
        volume: tally.total,
        statement: `Les retours de texte font ${tally.total} des ${facts.totalTickets} retours `
          + `(${percent(tally.total, facts.totalTickets)} %) sur ${count(dossiers, "client")}`
          + (named < dossiers ? `, dont ${topShare(tally)} sur ${count(named, "dossier")}.` : "."),
        action: "Validez le sujet de la semaine avec ces clients avant de rédiger.",
        clients: tally,
      };
    },
  },

  // -- Direction seule : deux comptes tirés du budget, sans un euro -----------
  {
    key: "shootings-a-classer",
    audience: "direction",
    source: "Score · Shootings catégorisés · isShootingUnclassified",
    /*
     * Deux chemins répondaient à « ce shooting est-il encore classable ? » : le
     * score lit `settledMonths` sur le mois de tournage, l'écran Shootings passe
     * par `invoiceMonthFor`, qui rattache les lignes d'avant le début de gestion
     * au mois de démarrage. Le conseil envoie quelqu'un sur l'onglet Shootings :
     * il compte donc **comme cet onglet**, sans quoi il nommerait un shooting
     * que l'écran ne montre pas.
     */
    measure: (facts) => {
      const shootings = facts.unclassifiedShootings;
      if (shootings.length === 0) return null;
      return {
        volume: shootings.length,
        statement: `${count(shootings.length, "shooting tourné", "shootings tournés")} `
          + `${agree(shootings.length, "attend son classement", "attendent leur classement")}.`,
        action: "Onglet Shootings : dites pour chacun s'il était compris au forfait ou vendu en plus.",
        clients: tallyOfShootings(shootings),
        gainFrom: "shootings",
      };
    },
  },
  {
    key: "budgets-en-defaut",
    audience: "direction",
    source: "Score · Dossiers budget complets · budgetSummary",
    measure: (facts) => {
      const tally = facts.budgetClientsWithIssue;
      if (tally.total === 0) return null;
      return {
        volume: tally.total,
        statement: `${tally.total} des ${facts.managedClients} dossiers gérés sont en défaut sur leur fiche budget `
          + "— enveloppe dépassée, rythme intenable ou dates manquantes.",
        action: "Reprenez ces fiches budget : date de contrat, enveloppe, rythme.",
        clients: tally,
        gainFrom: "budgets",
      };
    },
  },
];

/** Relevé par dossier d'une liste de commandes en retard. */
function tallyOfRequests(requests: readonly OverdueRequest[]): ClientTally {
  return tallyOf(requests.map((request) => request.clientId).filter((id): id is string => Boolean(id)));
}

/** Relevé par dossier d'une liste de shootings à classer. */
function tallyOfShootings(shootings: readonly ShootingToClassify[]): ClientTally {
  return tallyOf(shootings.map((shooting) => shooting.clientId));
}

/**
 * Relevé par dossier à partir d'une liste d'identifiants.
 *
 * Exporté : la lecture (`weekly-advice-scan.ts`) et les tests construisent
 * leurs relevés avec la même fonction, pour que l'ordre — décroissant, puis par
 * identifiant à compte égal — soit stable d'un lundi au suivant. Un ordre
 * instable ferait bouger les noms affichés sans qu'aucun chiffre n'ait changé.
 */
export function tallyOf(clientIds: readonly string[]): ClientTally {
  const counts = new Map<string, number>();
  for (const id of clientIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const byClient = [...counts.entries()]
    .map(([clientId, count]) => ({ clientId, count }))
    .sort((first, second) => second.count - first.count || first.clientId.localeCompare(second.clientId));
  return { total: clientIds.length, byClient };
}

// ---------------------------------------------------------------------------
// 6. Le diagnostic
// ---------------------------------------------------------------------------

/** Gain en points de score de la mesure dont une règle hérite, ou `null`. */
function gainOf(facts: WeeklyAdviceFacts, key: string | undefined): number | null {
  if (!key) return null;
  const action = facts.actions.find((candidate) => candidate.key === key);
  // Mesure absente ou déjà au-dessus de l'objectif : elle ne rapporte rien.
  return action && action.percentage !== null ? action.gain : null;
}

/**
 * Le diagnostic d'une audience : sa note, et au plus cinq conseils.
 *
 * L'audience `direction` reçoit les conseils de l'équipe **et** les deux
 * conseils budgétaires, parce que c'est elle qui tranche ; l'audience `equipe`
 * ne voit jamais les seconds, et sa note est celle que `healthScore` produit
 * sans les mesures budgétaires.
 */
export function weeklyAdvice(facts: WeeklyAdviceFacts, audience: AdviceAudience): WeeklyAdviceResult {
  const ranked = ADVICE_RULES
    .filter((rule) => audience === "direction" || rule.audience === "equipe")
    .flatMap((rule, index) => {
      const finding = rule.measure(facts);
      if (!finding) return [];
      const clients = finding.clients ?? EMPTY_TALLY;
      return [{
        item: {
          key: rule.key,
          audience: rule.audience,
          statement: finding.statement,
          action: finding.action,
          volume: finding.volume,
          clients: clients.byClient.slice(0, ADVICE_CLIENT_NAMES_LIMIT),
          clientCount: clients.byClient.length,
          gain: gainOf(facts, finding.gainFrom),
          source: rule.source,
        } satisfies WeeklyAdviceItem,
        index,
        gainFrom: finding.gainFrom,
      }];
    })
    // Par volume expliqué, puis par ordre de la table : deux conseils de même
    // volume ne doivent pas permuter d'une semaine à l'autre sans raison.
    .sort((first, second) => second.item.volume - first.item.volume || first.index - second.index)
    .slice(0, WEEKLY_ADVICE_LIMIT);

  /*
   * Une mesure du score ne se gagne qu'une fois.
   *
   * Deux conseils peuvent venir de la même mesure — « jamais validées » et
   * « validées après correction » sortent toutes deux de « validées sans
   * correction » — et le gain entier serait rendu à chacune : deux pastilles
   * « +5,9 pts » voisines, soit 11,8 points annoncés sur une mesure qui en
   * plafonne à 5,9. La pastille reste sur le conseil le mieux classé de la
   * mesure ; les suivants gardent leur phrase et leur geste, sans le chiffre.
   */
  const claimed = new Set<string>();
  const advices = ranked.map((entry) => {
    if (!entry.gainFrom) return entry.item;
    if (claimed.has(entry.gainFrom)) return { ...entry.item, gain: null };
    claimed.add(entry.gainFrom);
    return entry.item;
  });

  return {
    score: facts.health.score,
    target: HEALTH_TARGET,
    advices,
    nothingToSay: advices.length === 0,
    sample: adviceSample(facts),
  };
}

/**
 * Les `n` de la semaine.
 *
 * La purge emporte les fiches passées et, en cascade, leurs tickets et leurs
 * publications : dans quinze jours, plus aucune ligne ne permettra de
 * recalculer ces chiffres. Cette ligne hebdomadaire devient donc la seule
 * mémoire durable de ce qu'on a mesuré — et c'est ce qui permettra, le lundi
 * suivant, de dire « en hausse » ou « en baisse » sans les lignes sources.
 */
function adviceSample(facts: WeeklyAdviceFacts): Record<string, number | string | null> {
  return {
    fenetre_depuis: facts.windowSince,
    semaine_en_cours: facts.weekStart,
    semaine_preparee: facts.nextIsoWeek,
    fiches_envoyees: facts.sentSheets,
    fiches_validees: facts.approvedSheets,
    fiches_non_validees: facts.unapprovedSheets.total,
    fiches_a_renvoyer: facts.resendPending.total,
    fiches_validees_apres_correction: facts.approvedAfterCorrection.total,
    fiches_validees_en_retard: facts.approvedLate,
    fiches_parties_apres_vendredi: facts.sentAfterCutoff,
    retard_moyen_envoi_h: facts.sentAfterCutoffAverageHours,
    retours_total: facts.totalTickets,
    retours_jugeables: facts.judgeableTickets,
    retours_hors_delai: facts.lateTickets.total,
    retours_sans_reponse: facts.unansweredTickets,
    retours_texte: facts.textTickets.total,
    retours_hashtags: facts.hashtagTickets.total,
    commandes_livrees: facts.deliveredRequests,
    commandes_livrees_en_retard: facts.deliveredLateRequests,
    commandes_en_retard: facts.overdueRequests.length,
    semaine_fiches: facts.nextWeekSheets,
    semaine_brouillons: facts.nextWeekDrafts,
    semaine_contenus: facts.nextWeekItems,
    semaine_contenus_sans_media: facts.nextWeekItemsWithoutMedia,
    semaine_legendes_signature: facts.nextWeekCaptionsSignatureOnly,
    semaine_clients_sans_fiche: facts.nextWeekMissingSheets.total,
    semaine_en_cours_contenus: facts.currentWeekItems,
    semaine_en_cours_sans_media: facts.currentWeekItemsWithoutMedia,
    legendes_signature_parties: facts.sentCaptionsSignatureOnly.total,
    dossiers_geres: facts.managedClients,
    dossiers_sans_hashtags: facts.clientsWithoutPinnedHashtags,
    comptes_rendus_a_faire: facts.trackingReportsToFill,
    demandes_ouvertes: facts.openServiceRequests,
    shootings_a_classer: facts.unclassifiedShootings.length,
    budgets_en_defaut: facts.budgetClientsWithIssue.total,
  };
}

// ---------------------------------------------------------------------------
// 7. Des lignes de la base aux faits mesurés
// ---------------------------------------------------------------------------

/**
 * Pourquoi la dérivation vit ici, et non dans la lecture.
 *
 * `weekly-advice-scan.ts` ne fait que des requêtes : il ramène des lignes et
 * les renomme. Tout ce qui compte, tranche ou arrondit est dans ce module pur.
 * C'est ce qui permet de rejouer le diagnostic d'un lundi donné sur un jeu de
 * lignes figées, de le tester, et de relire chaque phrase avant qu'elle ne
 * s'affiche — ce qu'un calcul enfoui dans une requête SQL ne permet pas.
 */

/** Une fiche, telle que le diagnostic la lit. */
export interface AdviceSheetRow {
  id: string;
  clientId: string;
  status: SheetStatus;
  sentToClientAt: string | null;
  approvedAt: string | null;
  validationDeadlineAt: string | null;
  /** Lundi de la semaine produite, en date civile. */
  periodStart: string;
}

/** Un retour client. */
export interface AdviceTicketRow {
  id: string;
  clientId: string;
  sheetId: string | null;
  type: TicketType;
  submittedAt: string;
  resolvedAt: string | null;
  /** Vrai quand le retour est encore ouvert : il compte même hors fenêtre. */
  open: boolean;
}

/** Une version de fiche, qui dit quand une correction est repartie. */
export interface AdviceVersionRow {
  sheetId: string;
  sourceTicketId: string | null;
  sentToClientAt: string | null;
}

/** Une publication, avec de quoi juger sa légende et son média. */
export interface AdviceItemRow {
  clientId: string;
  format: MediaFormat;
  caption: string | null;
  isCancelled: boolean;
  hasMedia: boolean;
  /**
   * Signature du client telle qu'elle est aujourd'hui sur sa fiche, ou `null`
   * quand l'appelant ne veut pas que la règle de la signature s'applique.
   */
  signature: string | null;
}

/** Une commande interne livrée, ou en retard. */
export interface AdviceRequestRow {
  clientId: string | null;
  dueOn: string;
  deliveredAt: string | null;
}

/** Un client, avec ce qu'il faut pour savoir ce qu'on attend de lui. */
export interface AdviceClientRow extends WeekExpectationRow {
  id: string;
  /** Nombre de hashtags figés sur sa fiche. Zéro : aucune liste validée. */
  pinnedHashtags: number;
}

export interface WeeklyAdviceRows {
  /** Fenêtre analysée, en date civile : la borne des mesures d'événement. */
  windowSince: string;
  /** Instant de référence du calcul — le lundi 10 h. */
  now: Date;

  health: HealthScore;
  actions: readonly HealthAction[];

  clients: readonly AdviceClientRow[];
  sheets: readonly AdviceSheetRow[];
  tickets: readonly AdviceTicketRow[];
  versions: readonly AdviceVersionRow[];
  requests: readonly AdviceRequestRow[];
  /** Publications des fiches déjà parties chez le client, sur la fenêtre. */
  sentItems: readonly AdviceItemRow[];
  /** Fiches de la semaine suivante, avec leurs publications. */
  nextWeekSheets: readonly { status: SheetStatus; clientId: string; items: readonly AdviceItemRow[] }[];
  /** Publications de la semaine en cours. */
  currentWeekItems: readonly AdviceItemRow[];

  trackingReportsToFill: number;
  openServiceRequests: number;
  unclassifiedShootings: readonly ShootingToClassify[];
  /** Dossiers budget en alerte, par identifiant. Vide hors direction. */
  budgetIssueClientIds: readonly string[];
}

/**
 * Le vendredi 16 h qui précède une semaine de publication.
 *
 * `ALERT_HOUR` et non une heure écrite ici : c'est la même frontière que
 * l'alerte du vendredi, et deux heures distinctes finiraient par ne plus
 * s'accorder sur ce qu'est « une fiche partie à temps ». Converti dans la base
 * de fuseaux, parce que le vendredi d'une semaine d'hiver et celui d'une
 * semaine d'été ne sont pas au même décalage.
 */
export function sendCutoffFor(weekStart: string): Date {
  const friday = new Date(`${weekStart}T00:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() - 3);
  const day = friday.toISOString().slice(0, 10);
  return fromZonedTime(`${day}T${String(ALERT_HOUR).padStart(2, "0")}:00:00`, PARIS_TIMEZONE);
}

/** Statuts qui disent qu'une fiche est validée. Les deux, pas seulement le premier. */
const APPROVED_STATUSES: readonly SheetStatus[] = ["approved_by_client", "tacitly_approved"];

/**
 * Un retour porte-t-il sur le texte ?
 *
 * Lu dans la typologie (`group`) et non en reniflant le préfixe du nom :
 * ajouter un type de texte au sélecteur du portail doit suffire. `hashtags`
 * appartient au même groupe mais a sa propre règle — le compter ici
 * expliquerait deux fois le même retour.
 */
function isTextTicket(type: TicketType): boolean {
  return TICKET_TYPE_DEFINITIONS[type].group === "Texte" && type !== "hashtags";
}

/**
 * Une légende réduite au bloc signature.
 *
 * Deux conditions, et la première compte : il faut qu'il y ait **du texte**.
 * Une légende vide est un travail qui n'a pas commencé ; une légende qui ne
 * contient que la signature préremplie est un travail qu'on croit fait, et
 * c'est elle qui part chez le client.
 *
 * `hasWrittenCaption` est la seule règle de l'application sur cette question
 * (planning, éditeur, production, verrou des 100 %) : le diagnostic la lit, il
 * ne la réécrit pas.
 */
function isSignatureOnly(item: AdviceItemRow): boolean {
  if (item.isCancelled || !requiresCaption(item.format)) return false;
  if ((item.caption ?? "").trim().length === 0) return false;
  return !hasWrittenCaption(item.caption, item.signature);
}

/** Les faits de la semaine, dérivés des lignes lues. */
export function weeklyAdviceFacts(rows: WeeklyAdviceRows): WeeklyAdviceFacts {
  const since = new Date(`${rows.windowSince}T00:00:00Z`);
  const inWindow = (value: string | null) => Boolean(value) && new Date(value!) >= since;

  const week = adviceWeek(rows.now);
  const nextStartDate = new Date(`${week.weekStart}T00:00:00Z`);
  nextStartDate.setUTCDate(nextStartDate.getUTCDate() + 7);
  const nextWeekStart = nextStartDate.toISOString().slice(0, 10);
  const nextIsoWeek = isoWeekIdentity(nextStartDate).week;

  // -- Fiches ---------------------------------------------------------------
  const sent = rows.sheets.filter((sheet) => inWindow(sheet.sentToClientAt));
  const approved = rows.sheets.filter((sheet) =>
    inWindow(sheet.approvedAt) && APPROVED_STATUSES.includes(sheet.status));
  const sheetsWithTickets = new Set(rows.tickets.map((ticket) => ticket.sheetId).filter(Boolean));

  const unapproved = sent.filter((sheet) => !APPROVED_STATUSES.includes(sheet.status));
  const resendPending = unapproved.filter((sheet) => sheet.status === "new_version_to_send");
  const approvedAfterCorrection = approved.filter((sheet) => sheetsWithTickets.has(sheet.id));
  const approvedLate = approved.filter((sheet) =>
    sheet.approvedAt && sheet.validationDeadlineAt
    && new Date(sheet.approvedAt) > new Date(sheet.validationDeadlineAt)).length;

  const cutoffDelays = sent.flatMap((sheet) => {
    const cutoff = sendCutoffFor(sheet.periodStart);
    const sentAt = new Date(sheet.sentToClientAt!);
    return sentAt > cutoff ? [(sentAt.getTime() - cutoff.getTime()) / 3_600_000] : [];
  });

  // -- Retours --------------------------------------------------------------
  /*
   * La réponse au client, c'est le lien corrigé qui part — pas la clôture du
   * ticket, qu'on oublie de poser (`resolved_at` est vide sur presque tous les
   * retours). Même repli que le score : la version issue du retour d'abord, la
   * clôture ensuite.
   */
  const answeredAt = new Map<string, string>();
  for (const version of rows.versions) {
    if (!version.sourceTicketId || !version.sentToClientAt) continue;
    const known = answeredAt.get(version.sourceTicketId);
    if (!known || new Date(version.sentToClientAt) < new Date(known)) {
      answeredAt.set(version.sourceTicketId, version.sentToClientAt);
    }
  }
  const respondedAt = (ticket: AdviceTicketRow) => answeredAt.get(ticket.id) ?? ticket.resolvedAt ?? null;

  /*
   * Deux populations, un seul barème, comme le score : les retours arrivés dans
   * la fenêtre, qui disent la tenue de la période, et ceux encore ouverts hors
   * fenêtre, qui traînent depuis plus longtemps. Ne garder que les premiers
   * laisserait les pires retards hors du diagnostic.
   */
  const slaTickets = rows.tickets.filter((ticket) => inWindow(ticket.submittedAt) || ticket.open);
  const sla = ticketSlaSummary(
    slaTickets.map((ticket) => ({ submittedAt: ticket.submittedAt, respondedAt: respondedAt(ticket) })),
    rows.now,
  );
  const lateTickets = slaTickets.filter((ticket) =>
    ticketSlaState({ submittedAt: ticket.submittedAt, respondedAt: respondedAt(ticket) }, rows.now) === "depasse");
  const received = rows.tickets.filter((ticket) => inWindow(ticket.submittedAt));

  // -- Commandes internes ---------------------------------------------------
  const delivered = rows.requests.filter((request) => inWindow(request.deliveredAt));
  const today = parisFields(rows.now).day;
  const deliveredLate = delivered.filter((request) =>
    productionVerdict({ dueOn: request.dueOn, deliveredAt: request.deliveredAt }, today).kind === "late").length;
  const overdue = rows.requests
    .filter((request) => !request.deliveredAt)
    .flatMap((request) => {
      const verdict = productionVerdict({ dueOn: request.dueOn, deliveredAt: null }, today);
      return verdict.kind === "overdue"
        ? [{ clientId: request.clientId, days: verdict.days }]
        : [];
    })
    .sort((first, second) => second.days - first.days);

  // -- La semaine à venir ---------------------------------------------------
  const nextItems = rows.nextWeekSheets.flatMap((sheet) => sheet.items).filter((item) => !item.isCancelled);
  const covered = new Set(rows.nextWeekSheets.map((sheet) => sheet.clientId));
  const missing = sheetsToCreate(rows.clients, covered, nextWeekStart).map((proposal) => proposal.client.id);
  const currentItems = rows.currentWeekItems.filter((item) => !item.isCancelled);
  const withoutMedia = (items: readonly AdviceItemRow[]) =>
    items.filter((item) => requiresMedia(item.format) && !item.hasMedia).length;

  // -- Dossiers -------------------------------------------------------------
  const managed = rows.clients.filter((client) => weekLifecycle(client, week.weekStart).canProduce);

  return {
    windowSince: rows.windowSince,
    weekStart: week.weekStart,
    nextWeekStart,
    nextIsoWeek,

    health: rows.health,
    actions: rows.actions,

    sentSheets: sent.length,
    approvedSheets: approved.length,
    unapprovedSheets: tallyOf(unapproved.map((sheet) => sheet.clientId)),
    resendPending: tallyOf(resendPending.map((sheet) => sheet.clientId)),
    approvedAfterCorrection: tallyOf(approvedAfterCorrection.map((sheet) => sheet.clientId)),
    approvedLate,
    sentAfterCutoff: cutoffDelays.length,
    sentAfterCutoffAverageHours: cutoffDelays.length
      ? Math.round((cutoffDelays.reduce((total, hours) => total + hours, 0) / cutoffDelays.length) * 10) / 10
      : null,

    judgeableTickets: sla.measured,
    lateTickets: tallyOf(lateTickets.map((ticket) => ticket.clientId)),
    unansweredTickets: received.filter((ticket) => respondedAt(ticket) === null).length,
    textTickets: tallyOf(received.filter((ticket) => isTextTicket(ticket.type)).map((ticket) => ticket.clientId)),
    hashtagTickets: tallyOf(received.filter((ticket) => ticket.type === "hashtags").map((ticket) => ticket.clientId)),
    totalTickets: received.length,

    deliveredRequests: delivered.length,
    deliveredLateRequests: deliveredLate,
    overdueRequests: overdue,

    nextWeekSheets: rows.nextWeekSheets.length,
    nextWeekDrafts: rows.nextWeekSheets.filter((sheet) => isPreSendSheetStatus(sheet.status)).length,
    nextWeekItems: nextItems.length,
    nextWeekItemsWithoutMedia: withoutMedia(nextItems),
    nextWeekCaptionsSignatureOnly: nextItems.filter(isSignatureOnly).length,
    nextWeekMissingSheets: tallyOf(missing),
    currentWeekItems: currentItems.length,
    currentWeekItemsWithoutMedia: withoutMedia(currentItems),

    sentCaptionsSignatureOnly: tallyOf(
      rows.sentItems.filter(isSignatureOnly).map((item) => item.clientId),
    ),
    managedClients: managed.length,
    clientsWithoutPinnedHashtags: managed.filter((client) => client.pinnedHashtags === 0).length,

    trackingReportsToFill: rows.trackingReportsToFill,
    openServiceRequests: rows.openServiceRequests,

    unclassifiedShootings: rows.unclassifiedShootings,
    budgetClientsWithIssue: tallyOf(rows.budgetIssueClientIds),
  };
}

// ---------------------------------------------------------------------------
// 8. Le diagnostic tel qu'un écran le reçoit
// ---------------------------------------------------------------------------

/**
 * Ces deux formes vivent ici, et non dans la lecture.
 *
 * La lecture (`weekly-advice-read.ts`) est marquée `server-only` : un module
 * client qui en importerait ne serait-ce qu'un type casserait la compilation
 * au premier oubli de `import type`. Le contrat d'affichage appartient de
 * toute façon au domaine — c'est lui qui décide qu'un conseil porte une
 * phrase, un geste, des dossiers nommés et un reste anonyme.
 */

/** Un conseil prêt à afficher : noms résolus, dossiers hors périmètre comptés. */
export interface WeeklyAdviceEntry {
  key: string;
  statement: string;
  action: string;
  /** Points de score global, quand la règle est adossée à une mesure. */
  gain: number | null;
  source: string;
  /** Dossiers nommés, dans l'ordre du relevé. */
  clients: { label: string; count: number }[];
  /** Dossiers hors du périmètre de la personne : comptés, jamais nommés. */
  hiddenClients: number;
}

/** Les conseils d'une semaine, pour une personne donnée. */
export interface WeeklyAdviceView {
  isoYear: number;
  isoWeek: number;
  weekStart: string;
  /** Instant d'ouverture de la pop-up, en ISO. */
  opensAt: string;
  windowSince: string;
  score: number | null;
  target: number;
  nothingToSay: boolean;
  /** La personne a-t-elle déjà vu les conseils de cette semaine ? */
  seen: boolean;
  advices: WeeklyAdviceEntry[];
}
