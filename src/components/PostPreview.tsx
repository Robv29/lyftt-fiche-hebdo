"use client";

import { Icon } from "@/components/Icon";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";
import { mediaFrameBackground, mediaFrameClass } from "@/lib/domain/media-frame";

/**
 * Aperçu de la publication telle qu'elle sera vue.
 *
 * Rédiger un texte sans voir le visuel qu'il accompagne conduit à des
 * légendes qui redisent l'image, ou qui la contredisent. L'aperçu réunit les
 * deux dans le format réel du post — cadre téléphone pour une story ou une
 * vidéo, carré pour un post de feed — et se met à jour à la frappe.
 */
export function PostPreview({
  clientName,
  format,
  mediaUrl,
  mediaKind,
  caption,
  hashtags,
}: {
  clientName: string;
  format: MediaFormat;
  mediaUrl: string | null;
  mediaKind: "image" | "video" | "document" | null;
  caption: string;
  hashtags: string;
}) {
  const tags = hashtags.trim();
  const needsMedia = format !== "texte_seul";

  return (
    <figure className="mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <figcaption className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e8f2ff] text-[10px] font-bold text-[#0b5e9f]">
          {clientName.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{clientName}</span>
        <span className="badge shrink-0 bg-canvas text-[10px] text-ink-faint">
          {MEDIA_FORMAT_LABELS[format]}
        </span>
      </figcaption>

      {needsMedia && (
        <div className={`${mediaFrameClass(format)} w-full ${mediaFrameBackground(format)}`}>
          {mediaUrl ? (
            mediaKind === "video"
              ? <video src={mediaUrl} controls playsInline preload="metadata" className="h-full w-full object-contain"/>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={mediaUrl} alt="" className="h-full w-full object-contain"/>
          ) : (
            /*
             * Le média manquant est montré à sa place et à sa taille : on voit
             * ce qui reste à déposer, pas seulement qu'il manque quelque chose.
             */
            <div className="grid h-full w-full place-items-center bg-canvas p-4 text-center">
              <span className="text-xs text-ink-faint">
                <Icon name="photo" className="mx-auto mb-2 h-5 w-5"/>
                Média à déposer
              </span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 px-3 py-3">
        {caption.trim()
          ? <p className="whitespace-pre-wrap text-xs leading-relaxed">{caption}</p>
          : <p className="text-xs italic text-ink-faint">Texte à rédiger…</p>}
        {tags && <p className="break-words text-[11px] leading-relaxed text-[#0b63ad]">{tags}</p>}
      </div>
    </figure>
  );
}
