"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { publicationReadiness } from "@/lib/domain/publication-checklist";
import { SOCIAL_NETWORKS } from "@/lib/domain/types";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { originalDate, reprogrammingRefusal, REPROGRAMMING_REFUSALS } from "@/lib/domain/reprogramming";
import { sanitizeText } from "@/lib/security/sanitize";
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

/**
 * Invitation en collaboration envoyée depuis le réseau.
 *
 * C'est une étape manuelle, distincte de la publication : le post doit être
 * créé en invitant le compte partenaire, sans quoi il ne paraît que sur un
 * seul compte. On la coche donc à part.
 */
export async function setCollaborationDone(itemId:string, done:boolean):Promise<PublicationActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok:false, published:false, message:"Action non autorisée." };
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok:false, published:false, message:"Publication invalide." };
  }
  if (!(await resolveAccessibleItem(itemId))) {
    return { ok:false, published:false, message:ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("weekly_sheet_items")
    .update({ collaboration_done_at: done ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) return { ok:false, published:false, message:"La collaboration n’a pas été enregistrée." };

  revalidatePath("/publications");
  return { ok:true, published:false, message: done ? "Collaboration notée." : "Collaboration retirée." };
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
    .select("id, format, media_downloaded_at, content_copied_at, collaboration_handle, collaboration_done_at")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok:false, published:false, message:"Publication introuvable." };

  /*
   * Une collaboration oubliée ne se rattrape pas : l'invitation doit être
   * envoyée à la création du post. On refuse donc de confirmer la publication
   * tant qu'elle n'est pas cochée.
   */
  if (published && item.collaboration_handle && !item.collaboration_done_at) {
    return { ok:false, published:false, message:`Invitez d’abord ${item.collaboration_handle} en collaboration.` };
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


const reprogramSchema = z.object({
  itemId: z.string().uuid(),
  newDate: z.string(),
  note: z.string().trim().max(300).optional(),
});

/**
 * Changement de programme : reporte une publication à un jour suivant.
 *
 * Sans accord du client, et même sur une semaine déjà validée — c'est tout
 * l'objet. Seule la date bouge : le contenu reste celui qu'il a approuvé, et
 * sa validation reste donc valable. Le déclencheur qui recalcule l'état d'une
 * fiche ne réagit qu'à l'approbation et à l'annulation, pas à la date.
 *
 * La pastille « Changement de programme » garde la trace de la date d'origine.
 */
export async function reprogramPublication(
  itemId: string,
  newDate: string,
  note?: string,
): Promise<PublicationActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, published: false, message: ACCESS_DENIED_MESSAGE };

  const parsed = reprogramSchema.safeParse({ itemId, newDate, note: note || undefined });
  if (!parsed.success) return { ok: false, published: false, message: "Demande invalide." };

  // Périmètre vérifié sous RLS, comme partout : la politique SQL reste seule juge.
  const accessible = await resolveAccessibleItem(parsed.data.itemId);
  if (!accessible) return { ok: false, published: false, message: ACCESS_DENIED_MESSAGE };

  const admin = createSupabaseAdminClient();
  const { data: item } = await admin
    .from("weekly_sheet_items")
    .select("id, scheduled_date, published_at, is_cancelled, reprogrammed_from")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!item) return { ok: false, published: false, message: ACCESS_DENIED_MESSAGE };

  const refusal = reprogrammingRefusal({
    scheduledDate: item.scheduled_date as string,
    publishedAt: (item.published_at as string | null) ?? null,
    isCancelled: Boolean(item.is_cancelled),
  }, parsed.data.newDate, todayInParis());
  if (refusal) return { ok: false, published: false, message: REPROGRAMMING_REFUSALS[refusal] };

  const { error } = await admin
    .from("weekly_sheet_items")
    .update({
      scheduled_date: parsed.data.newDate,
      reprogrammed_from: originalDate(
        item.scheduled_date as string,
        (item.reprogrammed_from as string | null) ?? null,
      ),
      reprogrammed_at: new Date().toISOString(),
      reprogrammed_by: profile.id,
      reprogrammed_note: parsed.data.note ? sanitizeText(parsed.data.note, 300) : null,
    })
    .eq("id", parsed.data.itemId);

  if (error) return { ok: false, published: false, message: `Report impossible : ${error.message}` };

  revalidatePath("/publications");
  revalidatePath("/fiches");
  revalidatePath(`/fiches/${accessible.sheetId}`);
  return {
    ok: true,
    published: false,
    message: `Publication reportée au ${new Intl.DateTimeFormat("fr-FR", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    }).format(new Date(`${parsed.data.newDate}T00:00:00Z`))}.`,
  };
}
