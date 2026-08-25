import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hashToken,
  isWellFormedToken,
  validateLinkState,
  type LinkRejectionReason,
} from "@/lib/domain/tokens";
import { rateLimit } from "@/lib/security/rate-limit";
import { callerFingerprint } from "@/lib/security/caller";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { resolveClientLogoUrl } from "@/lib/media/client-logo";
import type {
  ItemApprovalStatus,
  MediaFormat,
  PublicationType,
  SheetStatus,
  SocialNetwork,
  ApprovalPolicy,
} from "@/lib/domain/types";

/**
 * Résolution d'un lien de consultation.
 *
 * Toutes les requêtes du portail passent par ici. Le principe est simple : on
 * ne fait jamais confiance au token, et on ne sélectionne jamais une colonne
 * interne (§19, scénario 8).
 */

export type AccessDenial = LinkRejectionReason | "rate_limited";

export interface ReviewLinkContext {
  linkId: string;
  sheetId: string;
  clientId: string;
  /** Version associée au lien, pour détecter une consultation périmée (§24). */
  linkVersionNumber: number | null;
}

export interface ReviewItem {
  id: string;
  position: number;
  scheduledDate: string;
  scheduledTime: string | null;
  publicationType: PublicationType;
  format: MediaFormat;
  networks: SocialNetwork[];
  caption: string;
  hashtags: string[];
  approvalStatus: ItemApprovalStatus;
  isCancelled: boolean;
  publishedAt: string | null;
  media: {
    kind: "image" | "video" | "document";
    url: string | null;
    thumbnailUrl: string | null;
    fileName: string;
  } | null;
  /**
   * Toutes les images de la publication, dans l'ordre.
   *
   * Un carrousel se juge sur l'ensemble ; ne montrer que la couverture
   * revenait à faire valider un contenu que le client n'avait pas vu en
   * entier. Vide quand la publication n'a aucun média.
   */
  gallery: { kind: "image" | "video" | "document"; url: string | null; fileName: string }[];
  /** « Vidéo transmise séparément » quand aucun fichier n'est déposé (§5). */
  mediaPendingNote: string | null;
  mediaExternalUrl: string | null;
  openTicketCount: number;
  /** Compte partenaire, nul quand la publication n'est pas en collaboration. */
  collaborationHandle: string | null;
}

export interface ReviewSheet {
  id: string;
  clientName: string;
  clientLogoUrl: string | null;
  timezone: string;
  approvalPolicy: ApprovalPolicy;
  tacitApprovalNotice: string | null;
  isoYear: number;
  isoWeek: number;
  periodStart: string;
  periodEnd: string;
  networks: SocialNetwork[];
  status: SheetStatus;
  validationDeadlineAt: string | null;
  communityManagerName: string | null;
  currentVersionNumber: number | null;
  currentVersionId: string | null;
  items: ReviewItem[];
}

export type ResolveResult =
  | { ok: true; context: ReviewLinkContext }
  | { ok: false; reason: AccessDenial };

/**
 * Vérifie un token et renvoie le contexte du lien.
 *
 * Un token mal formé est rejeté sans requête : impossible d'utiliser le portail
 * pour sonder la base (§19, protection contre l'énumération).
 */
export async function resolveReviewLink(token: string): Promise<ResolveResult> {
  const { ipHash } = await callerFingerprint();

  if (!(await rateLimit("linkAccess", ipHash)).allowed) {
    return { ok: false, reason: "rate_limited" };
  }

  if (!isWellFormedToken(token)) {
    await rateLimit("invalidToken", ipHash);
    return { ok: false, reason: "malformed" };
  }

  const supabase = createSupabaseAdminClient();
  const { data: link } = await supabase
    .from("client_review_links")
    .select(
      "id, weekly_sheet_id, expires_at, revoked_at, access_count, sheet_version_id, weekly_sheets(client_id), weekly_sheet_versions(version_number)",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  const validation = validateLinkState(
    link
      ? {
          revokedAt: link.revoked_at ? new Date(link.revoked_at) : null,
          expiresAt: new Date(link.expires_at),
        }
      : null,
  );

  if (!validation.valid || !link) {
    if (!link) await rateLimit("invalidToken", ipHash);
    if (link) await logReviewEvent(link.id, "access_denied", { reason: validation.reason });
    return { ok: false, reason: validation.reason ?? "not_found" };
  }

  const sheet = link.weekly_sheets as unknown as { client_id: string } | null;
  const version = link.weekly_sheet_versions as unknown as { version_number: number } | null;

  return {
    ok: true,
    context: {
      linkId: link.id,
      sheetId: link.weekly_sheet_id,
      clientId: sheet?.client_id ?? "",
      linkVersionNumber: version?.version_number ?? null,
    },
  };
}

/** Journalisation minimale d'un événement de consultation (§18). */
export async function logReviewEvent(
  linkId: string,
  eventType:
    | "link_opened"
    | "sheet_viewed"
    | "item_approved"
    | "sheet_approved"
    | "ticket_created"
    | "attachment_uploaded"
    | "new_version_viewed"
    | "access_denied",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { ipHash, uaFamily } = await callerFingerprint();
  const supabase = createSupabaseAdminClient();

  await supabase.from("client_review_events").insert({
    review_link_id: linkId,
    event_type: eventType,
    metadata,
    ip_hash: ipHash,
    user_agent_family: uaFamily,
  });
}

/** Incrémente le compteur d'accès et date la dernière consultation. */
export async function touchReviewLink(linkId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("client_review_links")
    .select("access_count, weekly_sheet_id")
    .eq("id", linkId)
    .single();

  /*
   * Première consultation de la fiche.
   *
   * Le compteur du lien disait déjà combien de fois il avait été ouvert, mais
   * la fiche, elle, ne portait aucune trace : le taux de consultation et le
   * délai de réaction des indicateurs restaient donc figés à zéro. On ne pose
   * la date que si elle est absente — c'est la *première* ouverture qui
   * mesure la réactivité, pas la dernière.
   */
  if (data?.weekly_sheet_id) {
    await supabase
      .from("weekly_sheets")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", data.weekly_sheet_id)
      .is("first_viewed_at", null);
  }

  await supabase
    .from("client_review_links")
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: (data?.access_count ?? 0) + 1,
    })
    .eq("id", linkId);
}

const MEDIA_URL_TTL_SECONDS = 60 * 60;

/**
 * Charge la fiche destinée au client.
 *
 * La liste des colonnes est explicite et volontairement restrictive :
 * `internal_notes` et les identifiants d'autres clients n'en font pas partie.
 */
export async function loadReviewSheet(
  context: ReviewLinkContext,
): Promise<ReviewSheet | null> {
  const supabase = createSupabaseAdminClient();

  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select(
      `id, iso_year, iso_week, period_start, period_end, networks, status,
       validation_deadline_at, current_version_id,
       clients ( name, logo_url, timezone, approval_policy, tacit_approval_notice ),
       profiles:community_manager_id ( full_name ),
       weekly_sheet_versions:current_version_id ( version_number )`,
    )
    .eq("id", context.sheetId)
    .maybeSingle();

  if (!sheet) return null;

  const { data: items } = await supabase
    .from("weekly_sheet_items")
    .select(
      `id, position, scheduled_date, scheduled_time, publication_type, format,
       networks, caption, hashtags, approval_status, is_cancelled, published_at,
       media_external_url, media_pending_note,
       collaboration_handle,
       media_assets:media_asset_id ( kind, storage_path, thumbnail_path, file_name, preview_path, purged_at, preview_purged_at ),
       weekly_sheet_item_media ( position, media_assets ( kind, storage_path, thumbnail_path, file_name, preview_path, purged_at, preview_purged_at ) )`,
    )
    .eq("weekly_sheet_id", context.sheetId)
    .order("position", { ascending: true });

  const { data: openTickets } = await supabase
    .from("client_tickets")
    .select("weekly_sheet_item_id, status")
    .eq("weekly_sheet_id", context.sheetId)
    // Un ticket renvoyé attend justement la validation : il ne doit plus la bloquer.
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client,sent_back_to_client)");

  const ticketCountByItem = new Map<string, number>();
  for (const ticket of openTickets ?? []) {
    if (!ticket.weekly_sheet_item_id) continue;
    ticketCountByItem.set(
      ticket.weekly_sheet_item_id,
      (ticketCountByItem.get(ticket.weekly_sheet_item_id) ?? 0) + 1,
    );
  }

  const client = sheet.clients as unknown as {
    name: string;
    logo_url: string | null;
    timezone: string;
    approval_policy: ApprovalPolicy;
    tacit_approval_notice: string | null;
  };
  const manager = sheet.profiles as unknown as { full_name: string } | null;
  const version = sheet.weekly_sheet_versions as unknown as {
    version_number: number;
  } | null;

  const reviewItems: ReviewItem[] = [];
  for (const item of items ?? []) {
    const media = item.media_assets as unknown as {
      kind: "image" | "video" | "document";
      storage_path: string;
      thumbnail_path: string | null;
      file_name: string;
      preview_path: string | null;
      purged_at: string | null;
      preview_purged_at: string | null;
    } | null;

    // Après la purge suivant la publication, l'original n'existe plus : le
    // client verrait une image cassée sans ce repli sur l'aperçu.
    const resolved = media
      ? await resolveMediaUrl({
          storagePath: media.storage_path,
          previewPath: media.preview_path ?? media.thumbnail_path,
          purgedAt: media.purged_at,
          previewPurgedAt: media.preview_purged_at,
        })
      : null;

    /*
     * Galerie complète : un carrousel se juge sur toutes ses images, pas sur
     * sa couverture. Les publications antérieures à la galerie n'ont que leur
     * média unique — il en tient alors lieu, l'écran n'ayant qu'un cas à gérer.
     */
    type GalleryRow = {
      position: number;
      media_assets: {
        kind: "image" | "video" | "document";
        storage_path: string;
        thumbnail_path: string | null;
        file_name: string;
        preview_path: string | null;
        purged_at: string | null;
        preview_purged_at: string | null;
      } | null;
    };
    const galleryRows = ((item.weekly_sheet_item_media ?? []) as unknown as GalleryRow[])
      .filter((row) => row.media_assets)
      .sort((a, b) => a.position - b.position)
      .map((row) => row.media_assets!);

    const gallerySource = galleryRows.length > 0 ? galleryRows : media ? [media] : [];
    const gallery = await Promise.all(gallerySource.map(async (asset) => ({
      kind: asset.kind,
      fileName: asset.file_name,
      url: (await resolveMediaUrl({
        storagePath: asset.storage_path,
        previewPath: asset.preview_path ?? asset.thumbnail_path,
        purgedAt: asset.purged_at,
        previewPurgedAt: asset.preview_purged_at,
      }))?.url ?? null,
    })));

    reviewItems.push({
      id: item.id,
      gallery,
      position: item.position,
      scheduledDate: item.scheduled_date,
      scheduledTime: item.scheduled_time,
      publicationType: item.publication_type,
      format: item.format,
      networks: item.networks ?? [],
      caption: item.caption,
      hashtags: item.hashtags ?? [],
      approvalStatus: item.approval_status,
      isCancelled: item.is_cancelled,
      publishedAt: item.published_at,
      mediaExternalUrl: item.media_external_url,
      mediaPendingNote: item.media_pending_note,
      openTicketCount: ticketCountByItem.get(item.id) ?? 0,
      collaborationHandle: (item.collaboration_handle as string | null)?.trim() || null,
      media: media
        ? {
            kind: media.kind,
            fileName: media.file_name,
            // URLs signées, à durée limitée : le bucket reste privé (§19).
            url: resolved?.url ?? null,
            thumbnailUrl: media.thumbnail_path ? await signedUrl(media.thumbnail_path) : null,
          }
        : null,
    });
  }

  return {
    id: sheet.id,
    clientName: client.name,
    clientLogoUrl: await resolveClientLogoUrl(client.logo_url),
    timezone: client.timezone,
    approvalPolicy: client.approval_policy,
    tacitApprovalNotice: client.tacit_approval_notice,
    isoYear: sheet.iso_year,
    isoWeek: sheet.iso_week,
    periodStart: sheet.period_start,
    periodEnd: sheet.period_end,
    networks: sheet.networks ?? [],
    status: sheet.status,
    validationDeadlineAt: sheet.validation_deadline_at,
    communityManagerName: manager?.full_name ?? null,
    currentVersionId: sheet.current_version_id,
    currentVersionNumber: version?.version_number ?? null,
    items: reviewItems,
  };
}

async function signedUrl(path: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.storage
    .from("media")
    .createSignedUrl(path, MEDIA_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
