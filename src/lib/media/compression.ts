"use client";

/**
 * Préparation des médias dans le navigateur, avant envoi.
 *
 * Le fichier stocké est l'original, octet pour octet. Ces médias sont ensuite
 * téléchargés pour être publiés sur les réseaux : les redimensionner à 1600 px
 * et les recompresser en WebP, comme on le faisait, dégradait chaque
 * publication. Le poids économisé ne vaut pas une photo floue chez le client.
 *
 * Seul un aperçu de quelques kilo-octets est produit à côté, pour l'affichage
 * et pour survivre à la purge de l'original après publication.
 *
 * Exception : le HEIC, que ni Chrome ni les outils de publication de Meta
 * n'acceptent. Quand le navigateur sait le décoder, il est converti en JPEG à
 * pleine résolution et à qualité maximale ; sinon il part tel quel.
 *
 * Les vidéos ne sont jamais transcodées.
 */

/** Côté le plus long de l'aperçu léger. */
const PREVIEW_EDGE = 320;

export interface PreparedMedia {
  /** Fichier à téléverser : l'original, ou un JPEG pleine résolution pour un HEIC. */
  file: File;
  /** Aperçu de quelques kilo-octets, pour l'affichage uniquement. */
  preview: File | null;
  originalBytes: number;
  finalBytes: number;
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Conversion impossible"));
          return;
        }
        resolve(new File([blob], fileName, { type }));
      },
      type,
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
  context.imageSmoothingQuality = "high";
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

export function isHeic(file: Pick<File, "type" | "name">): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  const image = await loadImage(file);
  const base = file.name.replace(/\.[^.]+$/, "");

  const small = scaleTo(image.naturalWidth, image.naturalHeight, PREVIEW_EDGE);
  const preview = await canvasToFile(
    draw(image, small.width, small.height),
    `${base}-apercu.webp`,
    "image/webp",
    0.6,
  );

  const upload = isHeic(file)
    ? await canvasToFile(
        draw(image, image.naturalWidth, image.naturalHeight),
        `${base}.jpg`,
        "image/jpeg",
        0.95,
      )
    : file;

  return { file: upload, preview, originalBytes: file.size, finalBytes: upload.size };
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
   * Transcoder dans un navigateur exigerait ffmpeg.wasm, des dizaines de
   * méga-octets à charger et des minutes de calcul. Le portail client charge
   * la vidéo en `preload="metadata"` : il ne télécharge que l'en-tête tant que
   * le client ne lance pas la lecture.
   */
  return asIs(file);
}
