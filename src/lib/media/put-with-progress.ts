"use client";

/**
 * Écriture d'un fichier sur une URL signée, avec suivi de progression.
 *
 * `uploadToSignedUrl` du client Supabase n'expose aucune progression : sur une
 * vidéo de plusieurs dizaines de méga-octets, l'interface reste figée pendant
 * toute la durée de l'envoi, ce qui donne l'impression d'un blocage. On passe
 * donc par XMLHttpRequest, seule API navigateur à remonter l'avancement d'un
 * envoi.
 */

export interface PutResult {
  ok: boolean;
  status: number;
  message?: string;
}

export function putWithProgress(params: {
  signedUrl: string;
  file: File;
  onProgress?: (percent: number, uploadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<PutResult> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", params.signedUrl, true);
    request.setRequestHeader("content-type", params.file.type || "application/octet-stream");
    // Le fichier ne doit jamais écraser un objet existant à son insu.
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress?.(
        Math.min(99, Math.round((event.loaded / event.total) * 100)),
        event.loaded,
      );
    };

    request.onload = () => {
      const ok = request.status >= 200 && request.status < 300;
      resolve({
        ok,
        status: request.status,
        message: ok ? undefined : extractMessage(request.responseText, request.status),
      });
    };

    request.onerror = () =>
      resolve({ ok: false, status: 0, message: "Connexion interrompue pendant l'envoi." });
    request.ontimeout = () =>
      resolve({ ok: false, status: 0, message: "L'envoi a expiré." });
    request.onabort = () =>
      resolve({ ok: false, status: 0, message: "Envoi annulé." });

    params.signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(params.file);
  });
}

function extractMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    if (parsed.message) return parsed.message;
    if (parsed.error) return parsed.error;
  } catch {
    // Réponse non JSON : on retombe sur le code HTTP.
  }
  if (status === 413) return "Fichier refusé : il dépasse la limite du stockage.";
  return `Envoi refusé (HTTP ${status}).`;
}
