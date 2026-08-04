"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/server";
import { uploadSheetMedia } from "@/lib/media/internal-upload";
import { normalizeHashtags, sanitizeText } from "@/lib/security/sanitize";
import type { MediaFormat, PublicationType } from "@/lib/domain/types";

export interface SheetContentActionResult {
  ok: boolean;
  message: string;
}

const editableItemSchema = z.object({
  id: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  format: z.enum(["visuel", "photo", "reels", "video", "carrousel", "texte_seul"]),
  caption: z.string().max(5000),
  hashtags: z.string().max(1000),
});

function publicationTypeForFormat(format: MediaFormat): PublicationType {
  if (format === "reels") return "reel";
  if (format === "video") return "video";
  if (format === "carrousel") return "carousel";
  return "post";
}

export async function saveSheetContent(formData: FormData): Promise<SheetContentActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Action non autorisée." };
  }

  const sheetId = z.string().uuid().safeParse(formData.get("sheetId"));
  let rawItems: unknown;
  try { rawItems = JSON.parse(String(formData.get("items") ?? "[]")); } catch { rawItems = null; }
  const items = z.array(editableItemSchema).min(1).safeParse(rawItems);
  if (!sheetId.success || !items.success) return { ok: false, message: "Contenu de la fiche invalide." };

  const admin = createSupabaseAdminClient();
  const { data: sheet } = await admin
    .from("weekly_sheets")
    .select("id, client_id, status, weekly_sheet_items ( id, media_asset_id )")
    .eq("id", sheetId.data)
    .maybeSingle();
  if (!sheet) return { ok: false, message: "Fiche introuvable." };
  if (!["draft", "internal_review", "ready_to_send"].includes(sheet.status)) {
    return { ok: false, message: "Cette fiche a déjà été envoyée. Utilisez le workflow de correction pour la modifier." };
  }

  const existingItems = new Map((sheet.weekly_sheet_items ?? []).map((item) => [item.id, item]));
  if (items.data.some((item) => !existingItems.has(item.id))) {
    return { ok: false, message: "Une publication n’appartient pas à cette fiche." };
  }

  for (const [index, item] of items.data.entries()) {
    const existing = existingItems.get(item.id)!;
    const patch: Record<string, unknown> = {
      scheduled_date: item.scheduledDate,
      scheduled_time: item.scheduledTime,
      format: item.format,
      publication_type: publicationTypeForFormat(item.format),
      caption: sanitizeText(item.caption, 5000),
      hashtags: normalizeHashtags(item.hashtags),
    };
    const file = formData.get(`media-${index}`);
    if (file instanceof File && file.size > 0) {
      const upload = await uploadSheetMedia({
        file,
        clientId: sheet.client_id,
        sheetId: sheet.id,
        uploadedBy: profile.id,
        expectedKind: ["video", "reels"].includes(item.format) ? "video" : "image",
        replacesMediaId: existing.media_asset_id,
      });
      if (!upload.data) return { ok: false, message: upload.error ?? "Média non enregistré." };
      patch.media_asset_id = upload.data.assetId;
    }

    const { error } = await admin.from("weekly_sheet_items").update(patch).eq("id", item.id);
    if (error) return { ok: false, message: `Publication non enregistrée : ${error.message}` };
  }

  revalidatePath("/fiches");
  revalidatePath(`/fiches/${sheet.id}`);
  return { ok: true, message: "Fiche enregistrée." };
}
