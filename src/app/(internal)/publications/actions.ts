"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { publicationReadiness } from "@/lib/domain/publication-checklist";
import {
  ACCESS_DENIED_MESSAGE,
  requireEditorialProfile,
  resolveAccessibleItem,
} from "@/lib/internal/authorization";

export interface PublicationActionResult { ok:boolean; published:boolean; message?:string }

const schema = z.object({ itemId:z.string().uuid(), step:z.enum(["media", "content"]) });

export async function completePublicationStep(itemId:string, step:"media"|"content"):Promise<PublicationActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok:false, published:false, message:"Action non autorisée." };
  const parsed = schema.safeParse({ itemId, step });
  if (!parsed.success) return { ok:false, published:false, message:"Publication invalide." };

  // Le rôle ne suffit pas : la publication doit appartenir à un client du
  // périmètre de l'utilisateur. La vérification passe par une lecture RLS.
  if (!(await resolveAccessibleItem(parsed.data.itemId))) {
    return { ok:false, published:false, message:ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { data:item } = await admin.from("weekly_sheet_items").select("id, format, media_asset_id, media_external_url, media_downloaded_at, content_copied_at, published_at").eq("id",itemId).maybeSingle();
  if (!item) return { ok:false, published:false, message:"Publication introuvable." };

  const mediaRequired = item.format !== "texte_seul";
  const mediaAvailable = Boolean(item.media_asset_id || item.media_external_url);
  const now = new Date().toISOString();
  const readiness=publicationReadiness({ mediaRequired, mediaAvailable, mediaDownloaded:Boolean(item.media_downloaded_at), contentCopied:Boolean(item.content_copied_at) },step);
  if (!readiness.allowed) return { ok:false, published:false, message:"Ajoutez d’abord le visuel ou la vidéo." };
  const published=readiness.published;
  const updates:Record<string,unknown> = {};
  if (step === "media") updates.media_downloaded_at = now;
  if (step === "content") updates.content_copied_at = now;
  if (published && !item.published_at) updates.published_at = now;

  const { error } = await admin.from("weekly_sheet_items").update(updates).eq("id",itemId);
  if (error) return { ok:false, published:false, message:"La progression n’a pas été enregistrée." };
  revalidatePath("/publications");
  return { ok:true, published, message:published ? "Publication terminée." : "Étape enregistrée." };
}
