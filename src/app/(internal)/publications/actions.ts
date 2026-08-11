"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canConfirmPublication, publicationReadiness } from "@/lib/domain/publication-checklist";
import { SOCIAL_NETWORKS } from "@/lib/domain/types";
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
  /*
   * La préparation n'emporte plus la publication : télécharger le média et
   * copier le texte préparent le post, mais seul un humain sait s'il est en
   * ligne. La confirmation est donc un geste à part, ci-dessous.
   */
  const published=Boolean(item.published_at);
  const updates:Record<string,unknown> = {};
  if (step === "media") updates.media_downloaded_at = now;
  if (step === "content") updates.content_copied_at = now;

  const { error } = await admin.from("weekly_sheet_items").update(updates).eq("id",itemId);
  if (error) return { ok:false, published:false, message:"La progression n’a pas été enregistrée." };
  revalidatePath("/publications");
  return { ok:true, published, message:published ? "Publication terminée." : "Étape enregistrée." };
}

/** Confirmation, ou retrait, de la mise en ligne effective. */
export async function setPublicationPublished(itemId:string, published:boolean):Promise<PublicationActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok:false, published:false, message:"Action non autorisée." };
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok:false, published:false, message:"Publication invalide." };
  }
  if (!(await resolveAccessibleItem(itemId))) {
    return { ok:false, published:false, message:ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { data:item } = await admin
    .from("weekly_sheet_items")
    .select("id, format, media_downloaded_at, content_copied_at")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok:false, published:false, message:"Publication introuvable." };

  if (published && !canConfirmPublication({
    mediaRequired: item.format !== "texte_seul",
    mediaDownloaded: Boolean(item.media_downloaded_at),
    contentCopied: Boolean(item.content_copied_at),
  })) {
    return { ok:false, published:false, message:"Téléchargez le média et copiez le texte avant de confirmer." };
  }

  const { error } = await admin
    .from("weekly_sheet_items")
    .update({ published_at: published ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) return { ok:false, published:false, message:"La publication n’a pas été enregistrée." };

  revalidatePath("/publications");
  return {
    ok:true,
    published,
    message: published ? "Publication confirmée." : "Publication retirée.",
  };
}

/**
 * Coche ou décoche un réseau réellement publié.
 *
 * La liste vient de la fiche client : on ne peut cocher qu'un réseau prévu
 * pour ce client, ce qui évite d'enregistrer une diffusion qui n'a pas lieu
 * d'être.
 */
export async function togglePublishedNetwork(itemId:string, network:string, on:boolean):Promise<PublicationActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok:false, published:false, message:"Action non autorisée." };
  if (!z.string().uuid().safeParse(itemId).success
    || !SOCIAL_NETWORKS.includes(network as never)) {
    return { ok:false, published:false, message:"Réseau invalide." };
  }
  if (!(await resolveAccessibleItem(itemId))) {
    return { ok:false, published:false, message:ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { data:item } = await admin
    .from("weekly_sheet_items")
    .select("published_networks, published_at")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok:false, published:false, message:"Publication introuvable." };

  const current = new Set((item.published_networks ?? []) as string[]);
  if (on) current.add(network); else current.delete(network);

  const { error } = await admin
    .from("weekly_sheet_items")
    .update({ published_networks: [...current] })
    .eq("id", itemId);
  if (error) return { ok:false, published:false, message:"Le réseau n’a pas été enregistré." };

  revalidatePath("/publications");
  return { ok:true, published:Boolean(item.published_at) };
}
