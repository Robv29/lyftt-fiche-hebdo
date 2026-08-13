"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveSheetContent, type SheetContentActionResult } from "./actions";
import { Icon } from "@/components/Icon";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";
import { mediaFrameBackground, mediaFrameClass, supportsGallery } from "@/lib/domain/media-frame";
import { PostPreview } from "@/components/PostPreview";
import { uploadMediaDirect } from "@/lib/media/direct-upload";

export interface EditableSheetItem {
  id: string;
  position: number;
  scheduledDate: string;
  scheduledTime: string;
  format: MediaFormat;
  caption: string;
  hashtags: string;
  mediaFileName: string | null;
  mediaKind: string | null;
  /** URL signée : le bucket est privé, rien n'est affichable sans elle. */
  mediaUrl: string | null;
  /** L'original a été purgé après publication ; seul l'aperçu subsiste. */
  mediaIsPreviewOnly: boolean;
  mediaExternalUrl: string | null;
  /** Images de la publication, dans l'ordre. La première fait la couverture. */
  gallery: GalleryImage[];
}

export interface GalleryImage {
  mediaAssetId: string;
  fileName: string;
  kind: string;
  url: string | null;
}

interface EditorItem extends EditableSheetItem {
  /*
   * Le fichier part vers Supabase dès le dépôt, jamais par la Server Action :
   * une fonction Vercel refuse tout corps de requête au-delà de 4,5 Mo, ce
   * qu'une vidéo dépasse systématiquement.
   */
  mediaAssetId: string | null;
  mediaStatus: "vide" | "envoi" | "enregistrement" | "pret" | "erreur";
  mediaPercent: number | null;
  mediaError: string | null;
  /** Marque une suppression demandée, appliquée à l'enregistrement. */
  mediaCleared: boolean;
  /** Publication retirée de la fiche, appliquée à l'enregistrement. */
  removed: boolean;
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";

function acceptFor(format: MediaFormat): string {
  if (["video", "reels"].includes(format)) return VIDEO_ACCEPT;
  // Une story se tourne en vidéo comme en photo : on accepte les deux.
  if (format === "story") return `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;
  return IMAGE_ACCEPT;
}

const EMPTY_UPLOAD = {
  mediaAssetId: null,
  mediaStatus: "vide",
  mediaPercent: null,
  mediaError: null,
  mediaCleared: false,
} satisfies Pick<
  EditorItem,
  "mediaAssetId" | "mediaStatus" | "mediaPercent" | "mediaError" | "mediaCleared"
>;

/** Un média est présent s'il en existe un, sauf suppression demandée. */
function hasMedia(item: EditorItem): boolean {
  if (item.mediaCleared) return Boolean(item.mediaAssetId);
  return item.gallery.length > 0
    || Boolean(item.mediaAssetId || item.mediaFileName || item.mediaExternalUrl);
}

export function SheetContentEditor({ sheetId, clientId, clientName, initialItems }: { sheetId: string; clientId: string; clientName: string; initialItems: EditableSheetItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<SheetContentActionResult | null>(null);
  const [items, setItems] = useState<EditorItem[]>(initialItems.map((item) => ({ ...item, ...EMPTY_UPLOAD, removed: false })));
  const active = items.filter((item) => !item.removed);
  const update = (id: string, patch: Partial<EditorItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  /*
   * Aperçu ouvert par publication. Rédiger en voyant le visuel évite les
   * légendes qui redisent l'image — mais l'aperçu prend de la place, donc il
   * se déplie à la demande.
   */
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});

  // Les aperçus locaux sont libérés au démontage : un blob retenu garde le
  // fichier entier en mémoire, ce qui compte vite avec des vidéos.
  const localPreviews = useRef<string[]>([]);
  useEffect(() => () => { for (const url of localPreviews.current) URL.revokeObjectURL(url); }, []);

  /**
   * Envoi immédiat des fichiers déposés.
   *
   * Un carrousel se compose en plusieurs dépôts successifs : chaque fichier
   * rejoint la galerie plutôt que de remplacer le précédent, sauf pour les
   * formats à média unique où le dernier déposé l'emporte.
   */
  const handleFiles = async (id: string, files: File[], format: MediaFormat) => {
    for (const file of files) {
      await handleMedia(id, file, supportsGallery(format));
      if (!supportsGallery(format)) break;
    }
  };

  const handleMedia = async (id: string, file: File | null, append = false) => {
    if (!file) return;
    const localPreview = URL.createObjectURL(file);
    localPreviews.current.push(localPreview);
    update(id, { ...EMPTY_UPLOAD, mediaStatus: "envoi", mediaFileName: file.name });

    let result;
    try {
      result = await uploadMediaDirect({
      file,
      clientId,
      sheetId,
      onProgress: (step) => { if (step !== "preparation") update(id, { mediaStatus: step }); },
        onUploadProgress: (percent) => update(id, { mediaPercent: percent }),
      });
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Envoi interrompu." };
    }

    if (result.ok && append && result.mediaAssetId) {
      // Ajout à la galerie : on n'écrase pas ce qui a déjà été déposé.
      setItems((current) => current.map((entry) => entry.id === id
        ? {
            ...entry,
            mediaStatus: "pret",
            mediaPercent: null,
            mediaCleared: false,
            mediaFileName: file.name,
            gallery: [...entry.gallery, {
              mediaAssetId: result.mediaAssetId!,
              fileName: file.name,
              kind: file.type.startsWith("video/") ? "video" : "image",
              url: localPreview,
            }],
          }
        : entry));
      return;
    }

    update(id, result.ok
      ? {
          mediaAssetId: result.mediaAssetId ?? null,
          gallery: result.mediaAssetId
            ? [{
                mediaAssetId: result.mediaAssetId,
                fileName: file.name,
                kind: file.type.startsWith("video/") ? "video" : "image",
                url: localPreview,
              }]
            : [],
          mediaStatus: "pret",
          mediaPercent: null,
          mediaCleared: false,
          /*
           * Le lien signé du fichier stocké n'existe qu'au prochain rendu
           * serveur. En attendant, on montre le fichier local : sans cela le
           * média déposé restait invisible jusqu'au rechargement de la fiche.
           */
          mediaUrl: localPreview,
          mediaKind: file.type.startsWith("video/") ? "video" : "image",
          mediaIsPreviewOnly: false,
        }
      : { ...EMPTY_UPLOAD, mediaStatus: "erreur", mediaError: result.message ?? "Envoi impossible." });
  };

  const requirements = active.reduce((total, item) => total + (item.format === "texte_seul" ? 2 : 3), 0);
  const completed = active.reduce((total, item) => total
    + Number(Boolean(item.caption.trim()))
    + Number(Boolean(item.hashtags.trim()))
    + Number(item.format !== "texte_seul" && hasMedia(item)), 0);
  const progress = requirements ? Math.round((completed / requirements) * 100) : 0;

  return (
    <form action={(formData) => {
      formData.set("sheetId", sheetId);
      formData.set("items", JSON.stringify(items.map((item) => ({
        id: item.id,
        scheduledDate: item.scheduledDate,
        scheduledTime: item.scheduledTime.slice(0, 5),
        format: item.format,
        caption: item.caption,
        hashtags: item.hashtags,
        // Le fichier est déjà stocké : seul son identifiant circule ici.
        // `null` explicite vaut suppression du média rattaché.
        mediaAssetId: item.mediaAssetId,
        mediaAssetIds: item.gallery.map((image) => image.mediaAssetId),
        mediaCleared: item.mediaCleared,
        isCancelled: item.removed,
      }))));
      startTransition(async () => {
        const result = await saveSheetContent(formData);
        setFeedback(result);
        if (result.ok) router.refresh();
      });
    }} className="space-y-4">
      <div className="card sticky top-3 z-10 p-4 shadow-[0_8px_30px_rgba(31,41,55,.08)]">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Préparation</p><h2 className="mt-1 text-sm font-semibold">Contenus de la fiche</h2></div><strong className={progress === 100 ? "text-state-approved" : "text-[#0759e6]"}>{progress}%</strong></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Fiche complétée à ${progress}%`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span className={`block h-full origin-left rounded-full transition-transform duration-300 ${progress === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${progress / 100})` }}/></div>
        {progress < 100 && <p className="mt-2 text-xs text-ink-faint">Complétez le texte et le média de chaque publication pour atteindre 100 %.</p>}
      </div>

      {feedback && <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>{feedback.message}</p>}

      {items.map((item, index) => {
        if (item.removed) {
          return (
            <article key={item.id} className="card flex flex-wrap items-center justify-between gap-3 border-dashed p-4 text-sm">
              <span className="text-ink-faint">
                Publication {index + 1} · {MEDIA_FORMAT_LABELS[item.format]} — retirée à l’enregistrement
              </span>
              <button type="button" className="text-xs font-semibold text-[#0759e6] hover:underline" onClick={() => update(item.id, { removed: false })}>
                Annuler le retrait
              </button>
            </article>
          );
        }
        const mediaReady = item.format === "texte_seul" || hasMedia(item);
        const itemReady = Boolean(item.caption.trim() && item.hashtags.trim() && mediaReady);
        return (
          <article key={item.id} className="card space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-bold ${itemReady ? "bg-state-approved/10 text-state-approved" : "bg-[#edf4ff] text-[#0759e6]"}`}>{itemReady ? <Icon name="check" className="h-4 w-4"/> : index + 1}</span>
              <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Publication {index + 1} · {MEDIA_FORMAT_LABELS[item.format]}</h3><p className="text-xs text-ink-faint">{itemReady ? "Prête" : "À compléter"}</p></div>
              <button
                type="button"
                className={`shrink-0 text-xs font-semibold hover:underline ${previewing[item.id] ? "text-[#0759e6]" : "text-ink-faint"}`}
                aria-expanded={Boolean(previewing[item.id])}
                onClick={() => setPreviewing((current) => ({ ...current, [item.id]: !current[item.id] }))}
              >
                {previewing[item.id] ? "Masquer l’aperçu" : "Aperçu du post"}
              </button>
              {/*
                Une fiche sans publication ne peut être ni envoyée ni validée :
                on garde toujours la dernière.
              */}
              {active.length > 1 && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-state-changes hover:underline"
                  onClick={() => update(item.id, { removed: true })}
                >
                  Retirer
                </button>
              )}
            </div>

            {previewing[item.id] && (
              <div className="reveal-panel rounded-2xl bg-canvas p-4">
                <PostPreview
                  clientName={clientName}
                  format={item.format}
                  mediaUrl={item.mediaCleared ? null : item.mediaUrl}
                  mediaKind={(item.mediaKind ?? null) as "image" | "video" | "document" | null}
                  caption={item.caption}
                  hashtags={item.hashtags}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <input type="date" className="field" aria-label={`Date de la publication ${index + 1}`} value={item.scheduledDate} onChange={(event) => update(item.id, { scheduledDate: event.target.value })}/>
              <input type="time" className="field" aria-label={`Heure de la publication ${index + 1}`} value={item.scheduledTime.slice(0, 5)} onChange={(event) => update(item.id, { scheduledTime: event.target.value })}/>
              <select className="field" aria-label={`Format de la publication ${index + 1}`} value={item.format} onChange={(event) => update(item.id, { format: event.target.value as MediaFormat, ...EMPTY_UPLOAD })}>{Object.entries(MEDIA_FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div><label className="label" htmlFor={`caption-${item.id}`}>Texte libre</label><textarea id={`caption-${item.id}`} rows={7} className="field" value={item.caption} placeholder="Écrivez le texte de la publication…" onChange={(event) => update(item.id, { caption: event.target.value })}/></div>
                <div><label className="label" htmlFor={`hashtags-${item.id}`}>Hashtags</label><textarea id={`hashtags-${item.id}`} rows={3} className="field" value={item.hashtags} onChange={(event) => update(item.id, { hashtags: event.target.value })}/></div>
              </div>
              <div>
                <span className="label">Média · {MEDIA_FORMAT_LABELS[item.format]}</span>
                {item.format === "texte_seul" ? <p className="rounded-xl bg-canvas p-4 text-xs text-ink-faint">Aucun média nécessaire.</p> : (
                  <div className="space-y-2">
                    {/* Le média est visible, pas seulement nommé : c'est ce que verra le client. */}
                    {item.gallery.length > 0 && !item.mediaCleared && (
                      <figure className={`overflow-hidden rounded-2xl border border-line ${mediaFrameBackground(item.format)}`}>
                        <div className={item.gallery.length > 1 ? "grid grid-cols-3 gap-1 p-1" : "mx-auto w-full max-w-[180px]"}>
                          {item.gallery.map((image, position) => (
                            <div key={image.mediaAssetId} className={`relative ${mediaFrameClass(item.format)} overflow-hidden ${item.gallery.length > 1 ? "rounded-lg" : ""}`}>
                              {image.kind === "video"
                                ? <video controls playsInline preload="metadata" className="block h-full w-full object-contain"><source src={image.url ?? undefined}/></video>
                                // eslint-disable-next-line @next/next/no-img-element
                                : <img src={image.url ?? undefined} alt={`Image ${position + 1} de la publication ${index + 1}`} className="block h-full w-full object-contain"/>}
                              {item.gallery.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Retirer l’image ${position + 1}`}
                                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                                  onClick={() => update(item.id, { gallery: item.gallery.filter((entry) => entry.mediaAssetId !== image.mediaAssetId) })}
                                >
                                  ×
                                </button>
                              )}
                              {position === 0 && item.gallery.length > 1 && (
                                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Couverture</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {item.mediaIsPreviewOnly && <figcaption className="bg-canvas px-3 py-2 text-[11px] text-ink-faint">Aperçu léger — le fichier original a été purgé après publication.</figcaption>}
                      </figure>
                    )}

                    <label
                      aria-busy={["envoi", "enregistrement"].includes(item.mediaStatus)}
                      className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-4 text-center transition-colors ${item.mediaStatus === "erreur" ? "border-state-changes/50 bg-state-changes/5" : mediaReady ? "border-state-approved/50 bg-state-approved/5" : "border-[#cdd5df] bg-canvas hover:border-[#8bb5ff]"}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => { event.preventDefault(); handleFiles(item.id, Array.from(event.dataTransfer.files), item.format); }}
                    >
                      <input
                        type="file"
                        className="sr-only"
                        accept={acceptFor(item.format)}
                        multiple={supportsGallery(item.format)}
                        disabled={["envoi", "enregistrement"].includes(item.mediaStatus)}
                        onChange={(event) => handleFiles(item.id, Array.from(event.target.files ?? []), item.format)}
                      />
                      <Icon name={mediaReady ? "check" : "upload"} className={`h-5 w-5 ${mediaReady ? "text-state-approved" : "text-[#0759e6]"}`}/>
                      <strong className="mt-2 max-w-full truncate text-xs">
                        {item.mediaStatus === "envoi" && item.mediaPercent !== null ? `Envoi ${item.mediaPercent} %`
                          : item.mediaStatus === "enregistrement" ? "Finalisation…"
                          : item.mediaCleared ? "Déposer un média"
                          : item.gallery.length > 1 ? `${item.gallery.length} images · en ajouter`
                          : supportsGallery(item.format) && item.gallery.length === 1 ? "Ajouter une image au carrousel"
                          : item.mediaFileName ?? "Déposer le média"}
                      </strong>
                      {item.mediaStatus === "envoi" && item.mediaPercent !== null && (
                        <span className="mt-2 block h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-[#dbe4f0]"><span className="block h-full rounded-full bg-[#1468ff] transition-[width] duration-200" style={{ width: `${item.mediaPercent}%` }}/></span>
                      )}
                      <span className="mt-1 text-[11px] text-ink-faint">
                        {item.mediaError
                          ?? (supportsGallery(item.format)
                            ? "Glisser-déposer une ou plusieurs images"
                            : "Glisser-déposer ou cliquer pour remplacer")}
                      </span>
                    </label>

                    {hasMedia(item) && (
                      <button
                        type="button"
                        className="text-xs text-state-changes hover:underline"
                        onClick={() => update(item.id, { ...EMPTY_UPLOAD, mediaCleared: true, mediaUrl: null, mediaFileName: null, gallery: [] })}
                      >
                        Retirer le média
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}

      <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Enregistrement…" : progress === 100 ? "Enregistrer la fiche complète" : "Enregistrer l’avancement"}</button>
    </form>
  );
}
