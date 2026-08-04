/**
 * Types du domaine, alignés sur les énumérations PostgreSQL.
 * Toute modification ici doit être répercutée dans supabase/migrations.
 */

export const APP_ROLES = [
  "super_admin",
  "production_manager",
  "community_manager",
  "graphic_designer",
  "video_editor",
  "observer",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Administrateur",
  production_manager: "Responsable de production",
  community_manager: "Community manager",
  graphic_designer: "Graphiste",
  video_editor: "Vidéaste",
  observer: "Observateur",
};

export const SOCIAL_NETWORKS = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "google_business",
  "pinterest",
  "x",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  google_business: "Google Business",
  pinterest: "Pinterest",
  x: "X",
};

export type PublicationType =
  | "post"
  | "reel"
  | "story"
  | "carousel"
  | "video"
  | "article"
  | "other";

export const PUBLICATION_TYPE_LABELS: Record<PublicationType, string> = {
  post: "POST",
  reel: "REEL",
  story: "STORY",
  carousel: "CARROUSEL",
  video: "VIDÉO",
  article: "ARTICLE",
  other: "AUTRE",
};

export type MediaFormat =
  | "visuel"
  | "photo"
  | "reels"
  | "video"
  | "carrousel"
  | "texte_seul";

export const MEDIA_FORMAT_LABELS: Record<MediaFormat, string> = {
  visuel: "VISUEL",
  photo: "PHOTO",
  reels: "REELS",
  video: "VIDÉO",
  carrousel: "CARROUSEL",
  texte_seul: "TEXTE SEUL",
};

export type SheetStatus =
  | "draft"
  | "internal_review"
  | "ready_to_send"
  | "sent_to_client"
  | "partially_approved"
  | "changes_requested"
  | "corrections_in_progress"
  | "new_version_to_send"
  | "awaiting_revalidation"
  | "approved_by_client"
  | "tacitly_approved"
  | "rejected"
  | "expired";

export const SHEET_STATUS_LABELS: Record<SheetStatus, string> = {
  draft: "En préparation",
  internal_review: "Contrôle interne",
  ready_to_send: "Prête à envoyer",
  sent_to_client: "Envoyée au client",
  partially_approved: "Partiellement validée",
  changes_requested: "Modifications demandées",
  corrections_in_progress: "Corrections en cours",
  new_version_to_send: "Nouvelle version à envoyer",
  awaiting_revalidation: "En attente de nouvelle validation",
  approved_by_client: "Validée par le client",
  tacitly_approved: "Validation tacite",
  rejected: "Refusée",
  expired: "Expirée",
};

export type ItemApprovalStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "corrected"
  | "resent"
  | "approved_after_fix";

export const ITEM_APPROVAL_STATUS_LABELS: Record<ItemApprovalStatus, string> = {
  pending: "En attente de validation",
  approved: "Validé",
  changes_requested: "Modification demandée",
  corrected: "Corrigé",
  resent: "Renvoyé",
  approved_after_fix: "Validé après correction",
};

export type TicketStatus =
  | "new"
  | "to_qualify"
  | "assigned"
  | "in_progress"
  | "ready_for_review"
  | "internally_reviewed"
  | "new_version_generated"
  | "sent_back_to_client"
  | "approved_by_client"
  | "closed"
  | "awaiting_client"
  | "rejected"
  | "out_of_scope"
  | "billing_review"
  | "cancelled"
  | "reopened";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Nouveau",
  to_qualify: "À qualifier",
  assigned: "Affecté",
  in_progress: "En cours",
  ready_for_review: "Prêt à contrôler",
  internally_reviewed: "Contrôlé en interne",
  new_version_generated: "Nouvelle version générée",
  sent_back_to_client: "Renvoyé au client",
  approved_by_client: "Validé par le client",
  closed: "Fermé",
  awaiting_client: "En attente du client",
  rejected: "Refusé",
  out_of_scope: "Hors périmètre",
  billing_review: "Facturation complémentaire à valider",
  cancelled: "Annulé",
  reopened: "Rouvert",
};

/** Statuts considérés comme terminaux : le ticket ne pèse plus sur la fiche. */
export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = [
  "closed",
  "cancelled",
  "rejected",
  "approved_by_client",
];

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

export type TicketCategory =
  | "editorial"
  | "graphic"
  | "video"
  | "scheduling"
  | "scope";

export type AssignmentRole = "owner" | "contributor" | "reviewer" | "watcher";

export type ActorType = "client" | "staff" | "system";

export type MessageTemplateType =
  | "standard"
  | "warm"
  | "explicit_approval"
  | "tacit_approval"
  | "after_corrections"
  | "reminder"
  | "overdue"
  | "new_version";

export const MESSAGE_TEMPLATE_TYPE_LABELS: Record<MessageTemplateType, string> = {
  standard: "Message standard",
  warm: "Message plus chaleureux",
  explicit_approval: "Validation obligatoire",
  tacit_approval: "Validation tacite",
  after_corrections: "Après corrections",
  reminder: "Rappel",
  overdue: "En retard",
  new_version: "Après nouvelle version",
};

export type ApprovalPolicy = "explicit_required" | "tacit_allowed";

/**
 * Accesseurs de libellés.
 *
 * Tant que `supabase gen types` n'a pas été exécuté sur une base provisionnée,
 * les colonnes énumérées remontent en `string`. Ces fonctions évitent d'indexer
 * un Record avec un `any`, et affichent la valeur brute plutôt que « undefined »
 * si une valeur inattendue apparaît.
 */
function labelFrom<T extends string>(
  labels: Record<T, string>,
  value: string,
): string {
  return labels[value as T] ?? value;
}

export const appRoleLabel = (value: string) => labelFrom(APP_ROLE_LABELS, value);
export const sheetStatusLabel = (value: string) => labelFrom(SHEET_STATUS_LABELS, value);
export const itemApprovalStatusLabel = (value: string) =>
  labelFrom(ITEM_APPROVAL_STATUS_LABELS, value);
export const ticketStatusLabel = (value: string) => labelFrom(TICKET_STATUS_LABELS, value);
export const ticketPriorityLabel = (value: string) =>
  labelFrom(TICKET_PRIORITY_LABELS, value);
export const messageTemplateTypeLabel = (value: string) =>
  labelFrom(MESSAGE_TEMPLATE_TYPE_LABELS, value);
export const socialNetworkLabel = (value: string) =>
  labelFrom(SOCIAL_NETWORK_LABELS, value);
