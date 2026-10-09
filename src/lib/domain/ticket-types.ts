import type { TicketCategory } from "./types";

/** §6 — Types de demande proposés au client. */
export const TICKET_TYPES = [
  "text_edit",
  "text_typo",
  "text_information",
  "text_tone",
  "hashtags",
  "photo_replace",
  "photo_retouch",
  "graphic_edit",
  "image_order",
  "video_edit",
  "video_replace",
  "schedule_change",
  "network_change",
  "publication_remove",
  "publication_add",
  "other",
  /*
   * Demandes hors publication : elles ne portent sur aucun contenu de la
   * semaine. Elles empruntent le circuit des tickets, qui sait déjà router,
   * assigner et clore, mais arrivent par un lien distinct.
   */
  "quote_request",
  "shooting_request",
  "side_service",
  /*
   * Envie du client pour la semaine suivante. Elle ne corrige rien : elle
   * oriente la fiche à venir. Recueillie à côté de la validation finale, elle
   * emprunte le même circuit que les demandes hors publication.
   */
  "weekly_wish",
] as const;

export type TicketType = (typeof TICKET_TYPES)[number];

/** Formulaire à afficher au client selon le type choisi (§6). */
export type TicketFormKind =
  | "text"
  | "photo"
  | "graphic"
  | "video"
  | "scheduling"
  | "generic";

export interface TicketTypeDefinition {
  type: TicketType;
  label: string;
  /** Regroupement affiché dans le sélecteur du portail client. */
  group: string;
  category: TicketCategory;
  form: TicketFormKind;
  /** Choix rapides proposés en plus du commentaire libre. */
  options?: readonly { value: string; label: string }[];
  /** Vrai si la demande peut sortir du périmètre contractuel (§7). */
  mayAffectScope?: boolean;
  /** Vrai si la demande ne porte pas sur une publication précise. */
  sheetLevel?: boolean;
}

const PHOTO_OPTIONS = [
  { value: "replace", label: "Remplacer la photo" },
  { value: "crop", label: "Recadrer" },
  { value: "brightness", label: "Corriger la luminosité" },
  { value: "remove_element", label: "Supprimer un élément" },
  { value: "use_existing", label: "Utiliser une autre photo existante" },
  { value: "other", label: "Autre" },
] as const;

const VIDEO_OPTIONS = [
  { value: "sequence", label: "Changer une séquence" },
  { value: "overlay_text", label: "Modifier un texte incrusté" },
  { value: "music", label: "Changer la musique" },
  { value: "editing", label: "Modifier le montage" },
  { value: "format", label: "Changer le format" },
  { value: "other", label: "Autre" },
] as const;

const GRAPHIC_OPTIONS = [
  { value: "color", label: "Changer une couleur" },
  { value: "photo", label: "Changer une photo" },
  { value: "text", label: "Modifier un texte" },
  { value: "layout", label: "Modifier une mise en page" },
  { value: "element", label: "Ajouter ou retirer un élément" },
  { value: "other", label: "Autre" },
] as const;

export const TICKET_TYPE_DEFINITIONS: Record<TicketType, TicketTypeDefinition> = {
  text_edit: {
    type: "text_edit",
    label: "Modifier le texte",
    group: "Texte",
    category: "editorial",
    form: "text",
  },
  text_typo: {
    type: "text_typo",
    label: "Corriger une faute",
    group: "Texte",
    category: "editorial",
    form: "text",
  },
  text_information: {
    type: "text_information",
    label: "Changer une information",
    group: "Texte",
    category: "editorial",
    form: "text",
  },
  text_tone: {
    type: "text_tone",
    label: "Modifier le ton",
    group: "Texte",
    category: "editorial",
    form: "text",
  },
  hashtags: {
    type: "hashtags",
    label: "Modifier les hashtags",
    group: "Texte",
    category: "editorial",
    form: "text",
  },
  photo_replace: {
    type: "photo_replace",
    label: "Remplacer une photo",
    group: "Image",
    category: "graphic",
    form: "photo",
    options: PHOTO_OPTIONS,
  },
  photo_retouch: {
    type: "photo_retouch",
    label: "Retoucher une photo",
    group: "Image",
    category: "graphic",
    form: "photo",
    options: PHOTO_OPTIONS,
  },
  graphic_edit: {
    type: "graphic_edit",
    label: "Modifier une création graphique",
    group: "Image",
    category: "graphic",
    form: "graphic",
    options: GRAPHIC_OPTIONS,
  },
  image_order: {
    type: "image_order",
    label: "Changer l'ordre des images",
    group: "Image",
    category: "graphic",
    form: "graphic",
  },
  video_edit: {
    type: "video_edit",
    label: "Modifier une vidéo",
    group: "Vidéo",
    category: "video",
    form: "video",
    options: VIDEO_OPTIONS,
  },
  video_replace: {
    type: "video_replace",
    label: "Remplacer une vidéo",
    group: "Vidéo",
    category: "video",
    form: "video",
    options: VIDEO_OPTIONS,
  },
  schedule_change: {
    type: "schedule_change",
    label: "Changer la date de publication",
    group: "Planning",
    category: "scheduling",
    form: "scheduling",
  },
  network_change: {
    type: "network_change",
    label: "Changer le réseau",
    group: "Planning",
    category: "scheduling",
    form: "scheduling",
  },
  publication_remove: {
    type: "publication_remove",
    label: "Retirer une publication",
    group: "Planning",
    category: "scope",
    form: "generic",
    mayAffectScope: true,
  },
  publication_add: {
    type: "publication_add",
    label: "Ajouter une publication",
    group: "Planning",
    category: "scope",
    form: "generic",
    mayAffectScope: true,
    sheetLevel: true,
  },
  other: {
    type: "other",
    label: "Autre demande",
    group: "Autre",
    category: "editorial",
    form: "generic",
  },
  quote_request: {
    type: "quote_request",
    label: "Demande de devis",
    group: "Hors publication",
    category: "scope",
    form: "generic",
  },
  shooting_request: {
    type: "shooting_request",
    label: "Date de shooting",
    group: "Hors publication",
    category: "scope",
    form: "generic",
  },
  side_service: {
    type: "side_service",
    label: "Service annexe (site web, autre)",
    group: "Hors publication",
    category: "scope",
    form: "generic",
  },
  /*
   * `scope` et non `editorial` : l'envie parle du périmètre de la semaine
   * suivante, pas d'un contenu à retoucher. Le routage n'en retient alors que
   * la règle « le community manager reste responsable » — ni graphiste, ni
   * monteur.
   *
   * `sheetLevel` est obligatoire : l'envie ne vise aucune publication, et
   * c'est aussi ce qui la range dans la chronologie de la semaine.
   *
   * `mayAffectScope` est volontairement absent : il déclencherait une escalade
   * vers le responsable de production à *chaque* envie, y compris la plus
   * anodine. Le filet de sécurité, en l'absence de community manager, est le
   * repli d'affectation (`fallbackRolesFor`), pas une escalade systématique.
   */
  weekly_wish: {
    type: "weekly_wish",
    label: "Envies pour la semaine prochaine",
    group: "Vos envies",
    category: "scope",
    form: "generic",
    sheetLevel: true,
  },
};

/**
 * Demandes qui ne portent sur aucune publication.
 *
 * Elles arrivent par le second lien du message hebdomadaire et suivent un
 * traitement propre : pas de correction de contenu, juste une réponse à
 * apporter.
 */
export const SERVICE_REQUEST_TYPES = [
  "quote_request",
  "shooting_request",
  "side_service",
  /*
   * L'envie rejoint cette famille : rien à corriger, rien à renvoyer pour
   * revalidation. Un seul geste suffit côté agence — dire qu'elle est prise en
   * compte — et c'est exactement ce que `TicketActions` et
   * `resolveServiceRequest` savent déjà faire.
   */
  "weekly_wish",
] as const;

export function isServiceRequest(type: TicketType): boolean {
  return (SERVICE_REQUEST_TYPES as readonly string[]).includes(type);
}

/** Délai au-delà duquel une demande non traitée devient alarmante. */
export const SERVICE_REQUEST_ALERT_DAYS = 3;

/**
 * Une envie n'attend pas une réponse sous trois jours.
 *
 * Son échéance réelle est la fiche de la semaine suivante : tant qu'elle n'est
 * pas construite, l'envie est encore utile. Lui appliquer l'alerte des devis
 * aurait peint en rouge une vingtaine de lignes par semaine, et l'alerte
 * aurait cessé de vouloir dire quoi que ce soit.
 */
export const WEEKLY_WISH_ALERT_DAYS = 7;

/** Délai d'alerte propre à chaque demande hors publication. */
export function serviceRequestAlertDays(type: TicketType): number {
  return type === "weekly_wish" ? WEEKLY_WISH_ALERT_DAYS : SERVICE_REQUEST_ALERT_DAYS;
}

/** Jours écoulés depuis la demande, pour signaler celles qui traînent. */
export function serviceRequestAgeInDays(submittedAt: string, now: Date = new Date()): number {
  const submitted = new Date(submittedAt).getTime();
  if (Number.isNaN(submitted)) return 0;
  return Math.max(0, (now.getTime() - submitted) / 86_400_000);
}

/** Une demande non résolue au-delà du délai passe en alerte rouge. */
export function isServiceRequestOverdue(
  input: { type: TicketType; submittedAt: string; resolvedAt: string | null },
  now: Date = new Date(),
): boolean {
  if (input.resolvedAt) return false;
  return serviceRequestAgeInDays(input.submittedAt, now) >= serviceRequestAlertDays(input.type);
}

export function getTicketTypeDefinition(type: TicketType): TicketTypeDefinition {
  return TICKET_TYPE_DEFINITIONS[type];
}

export function isTicketType(value: string): value is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(value);
}

/**
 * Motifs qu'un client peut soumettre par un formulaire de demande.
 *
 * L'envie de la semaine en est exclue : elle a son propre point d'entrée — le
 * bloc « Vos envies », à côté de la validation — qui seul connaît son plafond
 * d'une par fiche, sa longueur et son titre de semaine. Acceptée ailleurs,
 * elle consommerait ce plafond sans être confiée à personne, et une requête
 * forgée pourrait figer une publication en « modification demandée ».
 */
export function isClientRequestableType(value: string): value is TicketType {
  return isTicketType(value) && value !== "weekly_wish";
}

/**
 * Sélecteur du portail client, regroupé par famille et dans l'ordre de la spec.
 *
 * Il ne propose que les demandes qui portent sur le contenu de la semaine. Les
 * demandes hors publication en sont exclues : chacune a son propre point
 * d'entrée — la page « Autres demandes » pour les devis, les shootings et les
 * services annexes, le bloc « Vos envies » pour l'envie de la semaine
 * suivante. Les voir réapparaître sous « Demander une modification » faisait
 * naître un ticket rattaché à une publication qui n'avait rien à corriger.
 */
export function groupedTicketTypes(): { group: string; types: TicketTypeDefinition[] }[] {
  const groups: { group: string; types: TicketTypeDefinition[] }[] = [];
  for (const type of TICKET_TYPES) {
    if (isServiceRequest(type)) continue;
    const def = TICKET_TYPE_DEFINITIONS[type];
    let bucket = groups.find((g) => g.group === def.group);
    if (!bucket) {
      bucket = { group: def.group, types: [] };
      groups.push(bucket);
    }
    bucket.types.push(def);
  }
  return groups;
}
