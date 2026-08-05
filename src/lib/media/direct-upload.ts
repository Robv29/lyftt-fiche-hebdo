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

export async function uploadMediaDirect(params: {
  file: File;
  clientId: string;
  sheetId: string | null;
  onProgress?: (step: "preparation" | "envoi" | "enregistrement") => void;
  /** Avancement de l'envoi réseau, en pourcentage. */
  onUploadProgress?: (percent: number, uploadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<UploadOutcome> {
  const kind = params.file.type.startsWith("video/") ? "video" : "image";

  // Les images sont recompressées ; les vidéos partent telles quelles.
  if (kind === "image") params.onProgress?.("preparation");
  const prepared = await prepareMedia(params.file);

  const ticket = await createMediaUploadTicket({
    clientId: params.clientId,
    sheetId: params.sheetId,
    fileName: prepared.file.name,
    kind,
    byteSize: prepared.file.size,
    mimeType: prepared.file.type,
    withPreview: prepared.preview !== null,
  });

  if (!ticket.ok || !ticket.path || !ticket.token) {
    return { ok: false, message: ticket.message ?? "Téléversement refusé." };
  }

  params.onProgress?.("envoi");

  // Écriture directe sur l'URL signée, pour disposer de la progression : sur
  // une vidéo, une barre qui avance change tout par rapport à une attente muette.
  const upload = await putWithProgress({
    signedUrl: ticket.signedUrl!,
    file: prepared.file,
    onProgress: params.onUploadProgress,
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
