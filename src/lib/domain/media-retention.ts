/**
 * Politique de conservation des médias.
 *
 * Ce qui sature le stockage, ce sont les fichiers, pas les lignes : une fiche
 * pèse quelques kilo-octets, une vidéo plusieurs dizaines de méga-octets. On
 * purge donc les fichiers et on garde les enregistrements — la preuve de
 * validation, l'historique des versions et les indicateurs restent intacts.
 *
 * Le déclencheur est la publication, pas la validation client : entre les deux,
 * l'équipe a encore besoin du fichier pour poster.
 */

export type MediaPurgeDecision =
  | { action: "keep"; reason: "not_published" | "still_needed" | "already_purged" }
  | { action: "purge_original"; reason: "published" }
  | { action: "purge_preview"; reason: "retention_expired" };

export interface MediaRetentionInput {
  /** Publication rattachée : date de mise en ligne effective. */
  publishedAt: Date | null;
  /** La publication est-elle annulée ? Un contenu annulé ne sera jamais publié. */
  isCancelled: boolean;
  /** Une demande de modification est-elle en cours sur ce contenu ? */
  hasOpenTicket: boolean;
  /** Fichier original déjà supprimé ? */
  purgedAt: Date | null;
  /** Aperçu léger déjà supprimé ? */
  previewPurgedAt: Date | null;
  /** Durée de conservation de l'aperçu, en jours. */
  previewRetentionDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideMediaRetention(
  input: MediaRetentionInput,
  now: Date = new Date(),
): MediaPurgeDecision {
  // Une correction est en cours : le graphiste peut avoir besoin de l'original.
  if (input.hasOpenTicket) return { action: "keep", reason: "still_needed" };

  if (input.purgedAt === null) {
    // Un contenu annulé ne sera jamais publié : son fichier ne sert plus.
    const finished = input.publishedAt !== null || input.isCancelled;
    if (!finished) return { action: "keep", reason: "not_published" };
    return { action: "purge_original", reason: "published" };
  }

  if (input.previewPurgedAt !== null) {
    return { action: "keep", reason: "already_purged" };
  }

  const expiresAt = input.purgedAt.getTime() + input.previewRetentionDays * DAY_MS;
  return now.getTime() >= expiresAt
    ? { action: "purge_preview", reason: "retention_expired" }
    : { action: "keep", reason: "already_purged" };
}

/** Volume libéré par une purge, pour l'afficher dans les indicateurs. */
export function freedBytes(assets: { byteSize: number | null; previewByteSize: number | null }[]): number {
  return assets.reduce(
    (total, asset) => total + Math.max(0, (asset.byteSize ?? 0) - (asset.previewByteSize ?? 0)),
    0,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}
