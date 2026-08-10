/**
 * Cadre d'aperçu d'un média selon le format vendu.
 *
 * Une story ou une vidéo se tourne au téléphone, en 9:16. L'afficher dans un
 * carré la recadre : on perd le haut et le bas, c'est-à-dire exactement là où
 * se trouvent le texte incrusté et le sujet. L'aperçu doit donc reprendre la
 * forme du téléphone, et montrer le média entier plutôt qu'un extrait.
 */

import type { MediaFormat } from "./types";

export type MediaFrame = "vertical" | "square";

/** Formats tournés en plein écran téléphone. */
const VERTICAL_FORMATS: readonly MediaFormat[] = ["story", "reels", "video"];

export function mediaFrame(format: MediaFormat): MediaFrame {
  return VERTICAL_FORMATS.includes(format) ? "vertical" : "square";
}

/** Classe Tailwind du rapport d'image, à appliquer au conteneur et au média. */
export function mediaFrameClass(format: MediaFormat): string {
  return mediaFrame(format) === "vertical" ? "aspect-[9/16]" : "aspect-square";
}

/**
 * Un média vertical est posé sur du noir : les bandes éventuelles se lisent
 * comme un cadre, pas comme un défaut d'affichage.
 */
export function mediaFrameBackground(format: MediaFormat): string {
  return mediaFrame(format) === "vertical" ? "bg-black" : "bg-canvas";
}
