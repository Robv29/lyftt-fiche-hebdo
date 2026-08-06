"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { putWithProgress } from "./put-with-progress";
import { prepareMedia } from "./compression";
import { createMediaUploadTicket, registerUploadedMedia } from "./upload-actions";

/**
 * Enchaînement complet côté navigateur : préparation, téléversement direct,
 * puis enregistrement des métadonnées. Le fichier ne transite jamais par une
 * fonction serverless.
 */

export interface UploadOutcome {
  ok: boolean;
  message?: string;
  mediaAssetId?: string;
  /** Poids avant et après compression, pour l'afficher à l'utilisateur. */
  originalBytes?: number;
  finalBytes?: number;
}

/**
 * Borne une étape dans le temps.
 *
 * Une promesse qui ne se résout jamais laisse l'interface figée sur « Envoi en
 * cours… » sans le moindre indice. Mieux vaut échouer explicitement.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} n'a pas répondu (${ms / 1000} s).`)), ms),
    ),
  ]);
}

export async function uploadMediaDirect(params: {
  file: File;
  clientId: string;
  sheetId: string | null;
  onProgress?: (step: "preparation" | "envoi" | "enregistrement") => void;
  /** Avancement de l'envoi réseau, en pourcentage. */
  /** Avancement réseau : pourcentage, octets envoyés, secondes restantes estimées. */
  onUploadProgress?: (percent: number, uploadedBytes: number, remainingSeconds: number | null) => void;
  signal?: AbortSignal;
}): Promise<UploadOutcome> {
  const kind = params.file.type.startsWith("video/") ? "video" : "image";

  try {
    return await runUpload(params, kind);
  } catch (error) {
    // Sans ce filet, une exception laissait la zone de dépôt figée pour de bon.
    console.error("[média] envoi interrompu", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Envoi interrompu.",
    };
  }
}

async function runUpload(
  params: Parameters<typeof uploadMediaDirect>[0],
  kind: "image" | "video",
): Promise<UploadOutcome> {

  // Les images sont recompressées ; les vidéos partent telles quelles.
  if (kind === "image") params.onProgress?.("preparation");
  const prepared = await withTimeout(prepareMedia(params.file), 20000, "La préparation du fichier")
    .catch(() => ({ file: params.file, preview: null, originalBytes: params.file.size, finalBytes: params.file.size }));

  const ticket = await withTimeout(createMediaUploadTicket({
    clientId: params.clientId,
    sheetId: params.sheetId,
    fileName: prepared.file.name,
    kind,
    byteSize: prepared.file.size,
    mimeType: prepared.file.type,
    withPreview: prepared.preview !== null,
  }), 30000, "Le serveur");

  // `signedUrl` est indispensable : sans elle, XMLHttpRequest lève à l'ouverture
  // et l'appelant resterait bloqué sur un état d'attente sans fin. Le cas se
  // produit pendant un déploiement, quand le navigateur exécute un code plus
  // récent que l'action serveur qui lui répond.
  if (!ticket.ok || !ticket.path || !ticket.token || !ticket.signedUrl) {
    return {
      ok: false,
      message:
        ticket.message ??
        "Téléversement refusé. Rechargez la page : une mise à jour est peut-être en cours.",
    };
  }

  params.onProgress?.("envoi");

  // Écriture directe sur l'URL signée, pour disposer de la progression : sur
  // une vidéo, une barre qui avance change tout par rapport à une attente muette.
  // Le débit se mesure sur l'envoi lui-même : une estimation calculée à partir
  // du transfert réel vaut mieux qu'une moyenne théorique.
  const startedAt = Date.now();

  const upload = await putWithProgress({
    signedUrl: ticket.signedUrl,
    file: prepared.file,
    onProgress: (percent, uploadedBytes) => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      // On attend deux secondes de transfert avant d'annoncer quoi que ce soit :
      // les premières mesures sont trop instables pour être crédibles.
      const remaining =
        elapsedSeconds > 2 && uploadedBytes > 0
          ? Math.round(
              ((prepared.file.size - uploadedBytes) / uploadedBytes) * elapsedSeconds,
            )
          : null;
      params.onUploadProgress?.(percent, uploadedBytes, remaining);
    },
    signal: params.signal,
  });

  if (!upload.ok) {
    return { ok: false, message: upload.message ?? "Envoi interrompu." };
  }

  // L'aperçu est un confort : son échec ne doit pas perdre le fichier envoyé.
  // Il ne concerne que les images, et pèse quelques kilo-octets.
  let previewUploaded = false;
  if (prepared.preview && ticket.previewPath && ticket.previewToken) {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from("media")
      .uploadToSignedUrl(ticket.previewPath, ticket.previewToken, prepared.preview, {
        contentType: "image/webp",
      });
    previewUploaded = !error;
  }

  params.onProgress?.("enregistrement");
  const registered = await registerUploadedMedia({
    clientId: params.clientId,
    storagePath: ticket.path,
    previewPath: previewUploaded ? ticket.previewPath! : null,
    previewByteSize: previewUploaded ? prepared.preview!.size : null,
    fileName: prepared.file.name,
    mimeType: prepared.file.type,
    byteSize: prepared.file.size,
    kind,
  });

  if (!registered.ok) return { ok: false, message: registered.message };

  return {
    ok: true,
    mediaAssetId: registered.mediaAssetId,
    originalBytes: prepared.originalBytes,
    finalBytes: prepared.finalBytes,
  };
}
