import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "./deadline";

/**
 * Fiches transmises par le CRM commercial.
 *
 * Le CRM et cette application ne partagent que ces quelques champs : ce que le
 * commercial connaît d'un client qui vient de signer. Tout ce qui suit sert à
 * les présenter ou à les retrouver, sans dépendre de la base.
 */

/** Nom du contact tel qu'on l'écrit, ou null si le CRM n'a rien transmis. */
export function contactFullName(
  prenom?: string | null,
  nom?: string | null,
): string | null {
  const parts = [prenom, nom].map((part) => (part ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Numéro utilisable dans un lien `tel:`.
 *
 * Les commerciaux saisissent « 06 12 34 56 78 » ou « +33 6.12.34.56.78 ».
 * Passé tel quel, le téléphone compose la ponctuation avec le reste et
 * l'appel échoue : seuls les chiffres et un éventuel « + » de tête survivent.
 */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Neutralise les jokers d'un motif `LIKE`.
 *
 * Une adresse comme `jean_dupont@exemple.fr` cherchée telle quelle en `ilike`
 * ferait du souligné un joker : `jeanXdupont@exemple.fr` correspondrait aussi,
 * et le rendez-vous Calendly se poserait sur la fiche d'un autre client.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Montant du contrat, tel qu'on l'affiche sur une carte. */
export function formatMontantCa(montant: number | null | undefined): string | null {
  if (montant === null || montant === undefined || Number.isNaN(montant)) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: montant % 1 === 0 ? 0 : 2,
  }).format(montant);
}

/** Date et heure d'un rendez-vous, lues à l'heure de Paris. */
export function formatParisDateTime(iso: string): string {
  return formatInTimeZone(new Date(iso), DEFAULT_TIMEZONE, "dd/MM/yyyy 'à' HH'h'mm");
}

/**
 * Valeur d'un `<input type="datetime-local">` à partir d'un instant absolu.
 *
 * Le champ n'a pas de fuseau : il affiche ce qu'on lui donne. Passer l'ISO brut
 * afficherait l'heure UTC — un rendez-vous de 16 h apparaîtrait à 14 h l'été.
 */
export function parisDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatInTimeZone(date, DEFAULT_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Inverse du précédent : l'heure saisie est lue comme une heure de Paris, puis
 * convertie en instant absolu. Le passage à l'heure d'été est géré par
 * date-fns-tz.
 */
export function parisDateTimeToIso(local: string): string | null {
  const trimmed = local.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const instant = fromZonedTime(trimmed, DEFAULT_TIMEZONE);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/* ---------------------------------------------------------------------------
 * Parcours de validation en trois étapes
 *
 * Une fiche transmise ne se résume pas à « à traiter » ou « traitée ». Entre
 * les deux, le chef de projet relit le menu, le confirme au client, puis ouvre
 * le dossier. Ces trois gestes sont ici, en logique pure, pour que l'écran, le
 * tri et les tests parlent tous du même parcours.
 * ------------------------------------------------------------------------- */

/** Instant d'un horodatage ISO, ou null si absent ou illisible. */
function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

export type EtapeTransmissionKey = "menu" | "recap" | "client";

/** État d'une fiche vis-à-vis du parcours, et rien de plus. */
export interface TransmissionEtapesEtat {
  menuValideLe: string | null;
  recapEnvoyeLe: string | null;
  clientId: string | null;
  /**
   * Date de création du client rattaché. Elle vient de `clients.created_at` :
   * inutile de la recopier sur la fiche, la seule source qui vaille est le
   * dossier lui-même. Absente quand le client est hors périmètre du lecteur.
   */
  clientCreeLe?: string | null;
}

export interface EtapeTransmission {
  key: EtapeTransmissionKey;
  /** 1, 2 ou 3 — le numéro affiché dans la pastille. */
  rang: number;
  titre: string;
  /** Ce qu'il reste à faire, quand l'étape n'est pas franchie. */
  attendu: string;
  franchie: boolean;
  /** Horodatage du franchissement, quand il est connu. */
  le: string | null;
}

export const NOMBRE_ETAPES_TRANSMISSION = 3;

/**
 * Les trois étapes d'une fiche, dans l'ordre, avec leur date.
 *
 * Aucune ne conditionne la suivante : Théo doit pouvoir envoyer un
 * récapitulatif sans avoir touché au menu — un menu déjà juste n'a pas besoin
 * d'être corrigé pour être envoyé. L'écran le signale, il ne l'interdit pas.
 */
export function transmissionEtapes(etat: TransmissionEtapesEtat): EtapeTransmission[] {
  return [
    {
      key: "menu",
      rang: 1,
      titre: "Récapitulatif du besoin",
      attendu: "Relire le menu du client, le corriger au besoin.",
      franchie: Boolean(etat.menuValideLe),
      le: etat.menuValideLe,
    },
    {
      key: "recap",
      rang: 2,
      titre: "Récapitulatif envoyé au client",
      attendu: "Confirmer par e-mail l’accompagnement retenu.",
      franchie: Boolean(etat.recapEnvoyeLe),
      le: etat.recapEnvoyeLe,
    },
    {
      key: "client",
      rang: 3,
      titre: "Fiche client créée",
      attendu: "Ouvrir le dossier dans le portefeuille.",
      franchie: Boolean(etat.clientId),
      le: etat.clientId ? (etat.clientCreeLe ?? null) : null,
    },
  ];
}

/** Nombre d'étapes franchies, de 0 à 3. */
export function transmissionAvancement(etat: TransmissionEtapesEtat): number {
  return transmissionEtapes(etat).filter((etape) => etape.franchie).length;
}

/** Première étape non franchie, ou null quand le parcours est bouclé. */
export function prochaineEtapeTransmission(
  etat: TransmissionEtapesEtat,
): EtapeTransmission | null {
  return transmissionEtapes(etat).find((etape) => !etape.franchie) ?? null;
}

/** Ce que la fiche a besoin de porter pour être triée. */
export interface TransmissionTriable extends TransmissionEtapesEtat {
  dateRdv: string | null;
  menuComposeLe: string | null;
}

/**
 * Ordre d'affichage : ce que personne n'a encore regardé, d'abord.
 *
 * Un tri par date de rendez-vous seul enterrait les fiches sans créneau — donc
 * précisément celles qu'il faut relancer. L'avancement commande, le
 * rendez-vous départage, la fraîcheur du menu tranche : à égalité, la fiche
 * dont le commercial vient de parler passe devant.
 */
export function compareTransmissions(a: TransmissionTriable, b: TransmissionTriable): number {
  const ecart = transmissionAvancement(a) - transmissionAvancement(b);
  if (ecart !== 0) return ecart;

  const rdvA = instant(a.dateRdv);
  const rdvB = instant(b.dateRdv);
  if (rdvA !== rdvB) {
    // Sans créneau, la fiche passe derrière : il n'y a pas d'échéance à tenir.
    if (rdvA === null) return 1;
    if (rdvB === null) return -1;
    return rdvA - rdvB;
  }

  const menuA = instant(a.menuComposeLe);
  const menuB = instant(b.menuComposeLe);
  if (menuA === menuB) return 0;
  if (menuA === null) return 1;
  if (menuB === null) return -1;
  return menuB - menuA;
}

export interface MenuAffiche {
  /** Texte à afficher, ou null quand aucune version n'existe. */
  texte: string | null;
  /** Vrai quand c'est la version corrigée par la production qui s'affiche. */
  corrige: boolean;
}

/**
 * Menu à montrer, et à envoyer au client.
 *
 * Deux versions coexistent en base : `fiche_mission`, réécrite à chaque envoi
 * du CRM, et `menu_corrige`, que seule la production touche. La corrigée prime,
 * sinon la correction de Théo disparaîtrait à la prochaine retouche du dossier
 * commercial. Un `menu_corrige` vidé de son texte équivaut à « reprendre le
 * menu du CRM » : on retombe alors sur la version d'origine, et les mises à
 * jour du CRM recommencent à passer.
 */
export function menuAffiche(fiche: {
  ficheMission: string | null;
  menuCorrige: string | null;
}): MenuAffiche {
  const corrige = (fiche.menuCorrige ?? "").trim();
  if (corrige.length > 0) return { texte: corrige, corrige: true };

  const crm = (fiche.ficheMission ?? "").trim();
  return { texte: crm.length > 0 ? crm : null, corrige: false };
}

/**
 * Le CRM a-t-il renvoyé un menu différent depuis la dernière relecture ?
 *
 * C'est le revers de la protection : puisque la version corrigée prime, une
 * vraie évolution de la commande passerait inaperçue. `fiche_mission_maj_le`
 * n'est redatée que par un menu réellement différent — un simple renvoi à
 * l'identique ne déclenche donc pas d'alerte inutile.
 */
export function menuDivergeDepuisValidation(fiche: {
  menuValideLe: string | null;
  ficheMissionMajLe: string | null;
}): boolean {
  const valide = instant(fiche.menuValideLe);
  const recu = instant(fiche.ficheMissionMajLe);
  return valide !== null && recu !== null && recu > valide;
}
