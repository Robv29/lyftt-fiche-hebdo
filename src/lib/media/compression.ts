"use client";

/**
 * Préparation des médias dans le navigateur, avant envoi.
 *
 * Deux objectifs : réduire le poids stocké — une photo de smartphone passe de
 * 4 Mo à quelques centaines de kilo-octets sans perte visible — et produire un
 * aperçu de quelques kilo-octets, conservé après la purge du fichier original.
 *
 * Les vidéos ne sont pas transcodées : cela demanderait ffmpeg.wasm, plusieurs
 * dizaines de méga-octets à charger et des minutes de calcul. On en extrait en
 * revanche une image de couverture, ce qui évite au portail client de charger
 * la vidéo entière pour l'afficher.
 */

/** Côté le plus long de l'image conservée. */
const MAX_EDGE = 1600;
/** Côté le plus long de l'aperçu léger. */
const PREVIEW_EDGE = 320;

export interface PreparedMedia {
  /** Fichier à téléverser (image recompressée, ou vidéo inchangée). */
  file: File;
  /** Aperçu de quelques kilo-octets : couverture vidéo ou miniature image. */
  preview: File | null;
  originalBytes: number;
  finalBytes: number;
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  quality: number,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Compression impossible"));
          return;
        }
        resolve(new File([blob], fileName, { type: "image/webp" }));
      },
      "image/webp",
      quality,
    );
  });
}

function scaleTo(width: number, height: number, maxEdge: number) {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image illisible"));
      image.src = url;
    });
    return image;
  } finally {
    // Révoqué après décodage : l'image reste utilisable pour le dessin.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  const image = await loadImage(file);
  const base = file.name.replace(/\.[^.]+$/, "");

  const full = scaleTo(image.naturalWidth, image.naturalHeight, MAX_EDGE);
  const compressed = await canvasToFile(
    draw(image, full.width, full.height),
    `${base}.webp`,
    0.82,
  );

  const small = scaleTo(image.naturalWidth, image.naturalHeight, PREVIEW_EDGE);
  const preview = await canvasToFile(
    draw(image, small.width, small.height),
    `${base}-apercu.webp`,
    0.6,
  );

  // Une recompression qui alourdit le fichier n'a aucun intérêt.
  const keepOriginal = compressed.size >= file.size;

  return {
    file: keepOriginal ? file : compressed,
    preview,
    originalBytes: file.size,
    finalBytes: keepOriginal ? file.size : compressed.size,
  };
}

/** Fichier transmis tel quel, sans aucun traitement préalable. */
function asIs(file: File): PreparedMedia {
  return { file, preview: null, originalBytes: file.size, finalBytes: file.size };
}

export async function prepareMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith("image/")) {
    try {
      return await prepareImage(file);
    } catch {
      // HEIC non décodable par certains navigateurs : on envoie l'original.
      return asIs(file);
    }
  }

  /*
   * Les vidéos partent brutes, sans traitement.
   *
   * Il n'y a jamais eu de compression vidéo — transcoder dans un navigateur
   * exigerait ffmpeg.wasm, des dizaines de méga-octets à charger et des minutes
   * de calcul. Seule une image de couverture était extraite ; elle est retirée
   * car elle allongeait le dépôt et échouait sur certains codecs. Le portail
   * client charge de toute façon la vidéo en `preload="metadata"` : il ne
   * télécharge que l'en-tête tant que le client ne lance pas la lecture.
   */
  return asIs(file);
}
