import type { MediaFormat } from "./types";

export type ContentBucket = "photo" | "video" | "visuel" | "story" | "texte";

export interface ContentBucketDefinition {
  key: ContentBucket;
  label: string;
  formats: readonly MediaFormat[];
  icon: string;
  /** Couleurs douces : fond pastel + texte saturé, comme les badges de statut. */
  bg: string;
  text: string;
  /** Teinte plus marquée, pour une pastille pleine ou une bordure. */
  accent: string;
}

/**
 * Regroupement des formats en familles reconnaissables d'un coup d'œil.
 *
 * Les 7 formats de `MediaFormat` sont trop fins pour trier visuellement une
 * fiche ou un planning : reels et vidéo sont la même famille pour qui
 * organise le travail, de même que visuel et carrousel. Cinq familles avec
 * chacune sa couleur suffisent à repérer ce qui manque sans lire chaque
 * étiquette.
 */
export const CONTENT_BUCKETS: readonly ContentBucketDefinition[] = [
  { key: "photo", label: "Photos", formats: ["photo"], icon: "photo", bg: "#fff4e0", text: "#a15c00", accent: "#f5a524" },
  { key: "video", label: "Vidéos", formats: ["video", "reels"], icon: "video", bg: "#f1eaff", text: "#6d28d9", accent: "#8b5cf6" },
  { key: "visuel", label: "Visuels", formats: ["visuel", "carrousel"], icon: "layers", bg: "#e0f7fa", text: "#0e7490", accent: "#14b8a6" },
  { key: "story", label: "Stories", formats: ["story"], icon: "spark", bg: "#ffe4ef", text: "#be185d", accent: "#ec4899" },
  { key: "texte", label: "Texte", formats: ["texte_seul"], icon: "message", bg: "#eef1f6", text: "#475569", accent: "#64748b" },
];

const FORMAT_TO_BUCKET = CONTENT_BUCKETS.reduce<Record<MediaFormat, ContentBucket>>((map, bucket) => {
  for (const format of bucket.formats) map[format] = bucket.key;
  return map;
}, {} as Record<MediaFormat, ContentBucket>);

export function bucketForFormat(format: MediaFormat): ContentBucket {
  return FORMAT_TO_BUCKET[format];
}

export function contentBucketDefinition(key: ContentBucket): ContentBucketDefinition {
  return CONTENT_BUCKETS.find((bucket) => bucket.key === key)!;
}
