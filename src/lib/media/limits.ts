/**
 * Plafonds appliqués aux médias de production, distincts de ceux des pièces
 * jointes déposées par le client.
 *
 * Ces constantes vivent dans leur propre module : un fichier marqué
 * « use server » ne peut exporter que des fonctions asynchrones, Next.js
 * traitant chaque export comme une référence d'action serveur. Y déclarer un
 * objet fait échouer le module entier à l'exécution.
 */

export const SHEET_MEDIA_MAX_BYTES = {
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
} as const;

export const SHEET_MEDIA_MIME = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
} as const;
