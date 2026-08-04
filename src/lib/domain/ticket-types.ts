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
};

export function getTicketTypeDefinition(type: TicketType): TicketTypeDefinition {
  return TICKET_TYPE_DEFINITIONS[type];
}

export function isTicketType(value: string): value is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(value);
}

/** Sélecteur du portail client, regroupé par famille et dans l'ordre de la spec. */
export function groupedTicketTypes(): { group: string; types: TicketTypeDefinition[] }[] {
  const groups: { group: string; types: TicketTypeDefinition[] }[] = [];
  for (const type of TICKET_TYPES) {
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
