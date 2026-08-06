import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Adresse d'affichage d'un média, valable une heure.
 *
 * Le bucket est privé : rien n'est accessible sans URL signée. Après la purge
 * qui suit la publication, le fichier original n'existe plus — on retombe alors
 * sur l'aperçu léger tant qu'il est conservé, plutôt que d'afficher une image
 * cassée.
 */

const TTL_SECONDS = 60 * 60;

export interface MediaSource {
  storagePath: string | null;
  previewPath: string | null;
  purgedAt: string | null;
  previewPurgedAt: string | null;
}

export interface ResolvedMedia {
  /** URL à afficher, ou null si plus rien n'est disponible. */
  url: string | null;
  /** Vrai quand seul l'aperçu subsiste : l'original a été purgé. */
  isPreviewOnly: boolean;
  /** Vrai quand fichier et aperçu ont tous deux été supprimés. */
  isGone: boolean;
}

export async function resolveMediaUrl(source: MediaSource): Promise<ResolvedMedia> {
  const admin = createSupabaseAdminClient();

  const sign = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await admin.storage.from("media").createSignedUrl(path, TTL_SECONDS);
    return data?.signedUrl ?? null;
  };

  // Original toujours présent : c'est lui qu'on sert.
  if (!source.purgedAt) {
    const url = await sign(source.storagePath);
    if (url) return { url, isPreviewOnly: false, isGone: false };
  }

  // Original purgé : l'aperçu prend le relais s'il est encore là.
  if (!source.previewPurgedAt) {
    const url = await sign(source.previewPath);
    if (url) return { url, isPreviewOnly: true, isGone: false };
  }

  return { url: null, isPreviewOnly: false, isGone: true };
}

/** Signature groupée : une seule passe pour toute une fiche. */
export async function resolveMediaUrls<T extends { media: MediaSource | null }>(
  rows: T[],
): Promise<(T & { resolved: ResolvedMedia })[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      resolved: row.media
        ? await resolveMediaUrl(row.media)
        : { url: null, isPreviewOnly: false, isGone: false },
    })),
  );
}
