import type { MessageTemplateType } from "./types";

/**
 * §4 — Message d'accompagnement prérempli.
 *
 * Le rendu est volontairement strict : une variable inconnue ou non fournie est
 * signalée plutôt que remplacée par du vide, pour éviter d'envoyer au client un
 * message contenant « Bonjour , ».
 */

export const TEMPLATE_VARIABLES = [
  "contact_first_name",
  "client_name",
  "publication_week",
  "publication_start_date",
  "publication_end_date",
  "validation_deadline",
  "review_link",
  /*
   * Second lien : tout ce qui ne concerne pas les publications de la semaine.
   * Devis, dates de shooting, services annexes arrivaient par message et se
   * perdaient ; ils passent désormais par un formulaire suivi.
   */
  "request_link",
  "community_manager_name",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  contact_first_name: "Prénom du contact",
  client_name: "Nom de l'entreprise",
  publication_week: "Semaine de publication",
  publication_start_date: "Début de période",
  publication_end_date: "Fin de période",
  validation_deadline: "Date limite de validation",
  review_link: "Lien sécurisé",
  request_link: "Lien « autre demande »",
  community_manager_name: "Community manager",
};

export type TemplateContext = Partial<Record<TemplateVariable, string>>;

export interface RenderResult {
  body: string;
  /** Variables présentes dans le modèle mais absentes du contexte. */
  missing: TemplateVariable[];
  /** Variables inconnues rencontrées dans le modèle. */
  unknown: string[];
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  template: string,
  context: TemplateContext,
): RenderResult {
  const missing = new Set<TemplateVariable>();
  const unknown = new Set<string>();

  const body = template.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const name = rawName as TemplateVariable;

    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) {
      unknown.add(rawName);
      return match;
    }

    const value = context[name];
    if (value === undefined || value.trim() === "") {
      missing.add(name);
      return match;
    }

    return value;
  });

  return { body, missing: [...missing], unknown: [...unknown] };
}

/** Un message ne peut être copié ou envoyé que s'il est complet. */
export function isRenderComplete(result: RenderResult): boolean {
  return result.missing.length === 0 && result.unknown.length === 0;
}

/** Modèles livrés par défaut (§4). Modifiables ensuite en base. */
export const DEFAULT_TEMPLATES: Record<MessageTemplateType, string> = {
  standard: `Bonjour {{contact_first_name}},

Voici le planning des contenus prévus pour la semaine {{publication_week}}.

Merci de le consulter et de nous transmettre votre validation ou vos demandes de modification avant le {{validation_deadline}}.

Pour valider ou demander une modification, cliquez sur ce lien et sélectionnez le contenu concerné :
{{review_link}}

Pour toute autre demande — devis, date de shooting, site internet — utilisez ce second lien :
{{request_link}}

Merci et bonne journée.
{{community_manager_name}} — LYFTT`,

  warm: `Bonjour {{contact_first_name}},

J'espère que vous allez bien ! Voici les contenus que nous avons préparés pour {{client_name}} pour la semaine {{publication_week}}.

Prenez le temps de les regarder : si un texte ou une photo ne vous convient pas, vous pouvez nous le dire directement depuis le lien, contenu par contenu.

{{review_link}}

Idéalement avant le {{validation_deadline}}, pour que nous ayons le temps d'ajuster.

Très belle journée,
{{community_manager_name}} — LYFTT`,

  explicit_approval: `Bonjour {{contact_first_name}},

Voici le planning des contenus de {{client_name}} pour la semaine {{publication_week}}.

Votre validation est nécessaire avant toute publication. Merci de la transmettre avant le {{validation_deadline}} via ce lien :
{{review_link}}

Sans validation de votre part, les contenus ne seront pas publiés.

{{community_manager_name}} — LYFTT`,

  tacit_approval: `Bonjour {{contact_first_name}},

Voici le planning des contenus prévus pour la semaine {{publication_week}}.

Merci de le consulter et de nous transmettre votre validation ou vos demandes de modification avant le {{validation_deadline}} :
{{review_link}}

Sans retour avant cette échéance, les contenus seront considérés comme validés, selon les modalités prévues ensemble.

Merci et bonne journée.
{{community_manager_name}} — LYFTT`,

  after_corrections: `Bonjour {{contact_first_name}},

Nous avons pris en compte vos retours sur les contenus de la semaine {{publication_week}}.

Voici la version corrigée :
{{review_link}}

Merci de nous confirmer que cela vous convient avant le {{validation_deadline}}.

{{community_manager_name}} — LYFTT`,

  reminder: `Bonjour {{contact_first_name}},

Un petit rappel concernant le planning des contenus de la semaine {{publication_week}}.

Merci de le consulter avant le {{validation_deadline}} :
{{review_link}}

{{community_manager_name}} — LYFTT`,

  overdue: `Bonjour {{contact_first_name}},

Le planning des contenus de la semaine {{publication_week}} est toujours en attente de votre validation, dont l'échéance était fixée au {{validation_deadline}}.

Merci de nous transmettre votre retour dès que possible pour que nous puissions publier dans les temps :
{{review_link}}

{{community_manager_name}} — LYFTT`,

  new_version: `Bonjour {{contact_first_name}},

Une nouvelle version du planning de la semaine {{publication_week}} est disponible, elle intègre vos dernières demandes.

{{review_link}}

Merci de votre retour avant le {{validation_deadline}}.

{{community_manager_name}} — LYFTT`,
};

/** Lien « ouvrir WhatsApp » avec le message prérempli (§4). */
export function whatsappLink(body: string, phone?: string): string {
  const text = encodeURIComponent(body);
  return phone
    ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${text}`
    : `https://wa.me/?text=${text}`;
}
