"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ACCESS_DENIED_MESSAGE,
  requireEditorialProfile,
  resolveAccessibleSheet,
} from "@/lib/internal/authorization";
import { normalizeHashtags, sanitizeText } from "@/lib/security/sanitize";
import type { MediaFormat, PublicationType } from "@/lib/domain/types";
import { canEditSheetContent, editRequiresRevalidation } from "@/lib/domain/sheet-status";

export interface SheetContentActionResult {
  ok: boolean;
  message: string;
}

const editableItemSchema = z.object({
  id: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  format: z.enum(["visuel", "photo", "reels", "video", "story", "carrousel", "texte_seul"]),
  caption: z.string().max(5000),
  hashtags: z.string().max(1000),
  mediaAssetId: z.string().uuid().nullable().optional(),
  /** Galerie complète, dans l'ordre. La première image sert de couverture. */
  mediaAssetIds: z.array(z.string().uuid()).max(20).optional(),
  mediaCleared: z.boolean().optional(),
  /** Publication retirée de la fiche, sans être effacée. */
  isCancelled: z.boolean().optional(),
  /** Compte partenaire d'une publication en collaboration. */
  collaborationHandle: z.string().trim().max(120, "Compte de collaboration trop long.").optional(),
});

function publicationTypeForFormat(format: MediaFormat): PublicationType {
  if (format === "reels") return "reel";
  if (format === "story") return "story";
  if (format === "video") return "video";
  if (format === "carrousel") return "carousel";
  return "post";
}

export async function saveSheetContent(formData: FormData): Promise<SheetContentActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) {
    return { ok: false, message: "Action non autorisée." };
  }

  const sheetId = z.string().uuid().safeParse(formData.get("sheetId"));
  let rawItems: unknown;
  try { rawItems = JSON.parse(String(formData.get("items") ?? "[]")); } catch { rawItems = null; }
  const items = z.array(editableItemSchema).min(1).safeParse(rawItems);
  if (!sheetId.success || !items.success) return { ok: false, message: "Contenu de la fiche invalide." };

  // La fiche doit être dans le périmètre de l'utilisateur, pas seulement
  // exister : la lecture RLS le vérifie avant toute écriture service-role.
  if (!(await resolveAccessibleSheet(sheetId.data))) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { data: sheet } = await admin
    .from("weekly_sheets")
    .select("id, client_id, status, weekly_sheet_items ( id, media_asset_id )")
    .eq("id", sheetId.data)
    .maybeSingle();
  if (!sheet) return { ok: false, message: ACCESS_DENIED_MESSAGE };
  if (!canEditSheetContent(sheet.status)) {
    return { ok: false, message: "Le statut actuel de cette fiche ne permet pas sa modification directe." };
  }
  const requiresRevalidation = editRequiresRevalidation(sheet.status);

  const existingItems = new Map((sheet.weekly_sheet_items ?? []).map((item) => [item.id, item]));
  if (items.data.some((item) => !existingItems.has(item.id))) {
    return { ok: false, message: "Une publication n’appartient pas à cette fiche." };
  }

  /*
   * Une fiche vide n'a pas de sens : elle ne pourrait ni être envoyée ni
   * validée. Retirer la dernière publication est donc refusé, plutôt que de
   * laisser tomber la fiche dans un état qu'aucun écran ne sait afficher.
   */
  if (items.data.every((item) => item.isCancelled)) {
    return { ok: false, message: "Une fiche doit garder au moins une publication." };
  }

  for (const item of items.data) {
    const patch: Record<string, unknown> = {
      scheduled_date: item.scheduledDate,
      scheduled_time: item.scheduledTime,
      format: item.format,
      publication_type: publicationTypeForFormat(item.format),
      caption: sanitizeText(item.caption, 5000),
      hashtags: normalizeHashtags(item.hashtags),
      /*
       * Retirer marque plutôt que supprimer : la publication disparaît des
       * écrans, mais son historique et les validations déjà données par le
       * client restent attachés à la fiche.
       */
      is_cancelled: Boolean(item.isCancelled),
      /*
       * Vide vaut absence de collaboration : on stocke null plutôt qu'une
       * chaîne vide, pour que « y a-t-il une collaboration ? » se lise d'un
       * seul test partout ailleurs.
       */
      collaboration_handle: item.collaborationHandle?.trim()
        ? sanitizeText(item.collaborationHandle, 120)
        : null,
    };
    // Le média a déjà été téléversé depuis le navigateur ; on ne reçoit que
    // son identifiant. Une suppression explicite détache le média du contenu :
    // la ligne media_assets reste en base pour l'historique.
    /*
     * La galerie fait autorité quand elle est fournie : sa première image
     * devient la couverture. Le champ `media_asset_id` reste ainsi le seul
     * que lisent les écrans qui n'affichent qu'une vignette.
     */
    const gallery = item.mediaCleared ? [] : item.mediaAssetIds;
    if (gallery) patch.media_asset_id = gallery[0] ?? null;
    else if (item.mediaCleared) patch.media_asset_id = null;
    else if (item.mediaAssetId) patch.media_asset_id = item.mediaAssetId;

    const { error } = await admin.from("weekly_sheet_items").update(patch).eq("id", item.id);
    if (error) return { ok: false, message: `Publication non enregistrée : ${error.message}` };

    if (gallery) {
      // Remplacement intégral : l'ordre affiché est l'ordre enregistré.
      await admin.from("weekly_sheet_item_media").delete().eq("weekly_sheet_item_id", item.id);
      if (gallery.length > 0) {
        const { error: galleryError } = await admin.from("weekly_sheet_item_media").insert(
          gallery.map((mediaAssetId, position) => ({
            weekly_sheet_item_id: item.id,
            media_asset_id: mediaAssetId,
            position,
          })),
        );
        if (galleryError) {
          return { ok: false, message: `Galerie non enregistrée : ${galleryError.message}` };
        }
      }
    }
  }

  if (requiresRevalidation) {
    /*
     * Le contenu que le client avait accepté reste conservé dans l'ancienne
     * version. Le nouveau contenu repart en validation : on ne peut pas
     * conserver silencieusement un accord donné sur un texte ou un média qui
     * vient de changer.
     */
    const { error: approvalError } = await admin
      .from("weekly_sheet_items")
      .update({ approval_status: "pending" })
      .eq("weekly_sheet_id", sheet.id)
      .eq("is_cancelled", false);
    if (approvalError) {
      return { ok: false, message: `Validations non réinitialisées : ${approvalError.message}` };
    }

    const { data: versionId, error: versionError } = await admin.rpc("create_sheet_version", {
      target_sheet_id: sheet.id,
      summary: "Modification interne après envoi ou validation",
      author: profile.id,
    });
    if (versionError || !versionId) {
      return { ok: false, message: "La fiche a été modifiée, mais la nouvelle version n’a pas pu être créée." };
    }

    // L'ancien lien pointait vers la version précédemment validée.
    await admin
      .from("client_review_links")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: "Planning modifié après envoi ou validation",
      })
      .eq("weekly_sheet_id", sheet.id)
      .is("revoked_at", null);

    const { error: statusError } = await admin
      .from("weekly_sheets")
      .update({ status: "new_version_to_send", approved_at: null })
      .eq("id", sheet.id);
    if (statusError) {
      return { ok: false, message: `Nouvelle version créée, mais son statut n’a pas été actualisé : ${statusError.message}` };
    }
  }

  revalidatePath("/fiches");
  revalidatePath(`/fiches/${sheet.id}`);
  return {
    ok: true,
    message: requiresRevalidation
      ? "Nouvelle version enregistrée. Elle doit maintenant être renvoyée au client pour validation."
      : "Fiche enregistrée.",
  };
}
