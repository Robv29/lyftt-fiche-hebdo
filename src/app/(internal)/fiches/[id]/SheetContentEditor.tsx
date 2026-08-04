"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSheetContent, type SheetContentActionResult } from "./actions";
import { Icon } from "@/components/Icon";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";

export interface EditableSheetItem {
  id: string;
  position: number;
  scheduledDate: string;
  scheduledTime: string;
  format: MediaFormat;
  caption: string;
  hashtags: string;
  mediaFileName: string | null;
  mediaExternalUrl: string | null;
}

interface EditorItem extends EditableSheetItem { newMedia: File | null }

function acceptFor(format: MediaFormat): string {
  return ["video", "reels"].includes(format)
    ? "video/mp4,video/quicktime"
    : "image/jpeg,image/png,image/webp,image/heic";
}

export function SheetContentEditor({ sheetId, initialItems }: { sheetId: string; initialItems: EditableSheetItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<SheetContentActionResult | null>(null);
  const [items, setItems] = useState<EditorItem[]>(initialItems.map((item) => ({ ...item, newMedia: null })));
  const update = (id: string, patch: Partial<EditorItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const requirements = items.reduce((total, item) => total + (item.format === "texte_seul" ? 2 : 3), 0);
  const completed = items.reduce((total, item) => total
    + Number(Boolean(item.caption.trim()))
    + Number(Boolean(item.hashtags.trim()))
    + Number(item.format !== "texte_seul" && Boolean(item.newMedia || item.mediaFileName || item.mediaExternalUrl)), 0);
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
      }))));
      items.forEach((item, index) => { if (item.newMedia) formData.set(`media-${index}`, item.newMedia); });
      startTransition(async () => {
        const result = await saveSheetContent(formData);
        setFeedback(result);
        if (result.ok) {
          setItems((current) => current.map((item) => ({
            ...item,
            mediaFileName: item.newMedia?.name ?? item.mediaFileName,
            newMedia: null,
          })));
          router.refresh();
        }
      });
    }} className="space-y-4">
      <div className="card sticky top-3 z-10 p-4 shadow-[0_8px_30px_rgba(31,41,55,.08)]">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Préparation</p><h2 className="mt-1 text-sm font-semibold">Contenus de la fiche</h2></div><strong className={progress === 100 ? "text-state-approved" : "text-[#0759e6]"}>{progress}%</strong></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Fiche complétée à ${progress}%`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span className={`block h-full origin-left rounded-full transition-transform duration-300 ${progress === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${progress / 100})` }}/></div>
        {progress < 100 && <p className="mt-2 text-xs text-ink-faint">Complétez le texte et le média de chaque publication pour atteindre 100 %.</p>}
      </div>

      {feedback && <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>{feedback.message}</p>}

      {items.map((item, index) => {
        const mediaReady = item.format === "texte_seul" || Boolean(item.newMedia || item.mediaFileName || item.mediaExternalUrl);
        const itemReady = Boolean(item.caption.trim() && item.hashtags.trim() && mediaReady);
        return (
          <article key={item.id} className="card space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-bold ${itemReady ? "bg-state-approved/10 text-state-approved" : "bg-[#edf4ff] text-[#0759e6]"}`}>{itemReady ? <Icon name="check" className="h-4 w-4"/> : index + 1}</span><div><h3 className="text-sm font-semibold">Publication {index + 1} · {MEDIA_FORMAT_LABELS[item.format]}</h3><p className="text-xs text-ink-faint">{itemReady ? "Prête" : "À compléter"}</p></div></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input type="date" className="field" aria-label={`Date de la publication ${index + 1}`} value={item.scheduledDate} onChange={(event) => update(item.id, { scheduledDate: event.target.value })}/>
              <input type="time" className="field" aria-label={`Heure de la publication ${index + 1}`} value={item.scheduledTime.slice(0, 5)} onChange={(event) => update(item.id, { scheduledTime: event.target.value })}/>
              <select className="field" aria-label={`Format de la publication ${index + 1}`} value={item.format} onChange={(event) => update(item.id, { format: event.target.value as MediaFormat, newMedia: null })}>{Object.entries(MEDIA_FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,.8fr)]">
              <div className="space-y-3">
                <div><label className="label" htmlFor={`caption-${item.id}`}>Texte libre</label><textarea id={`caption-${item.id}`} rows={5} className="field" value={item.caption} placeholder="Écrivez le texte de la publication…" onChange={(event) => update(item.id, { caption: event.target.value })}/></div>
                <div><label className="label" htmlFor={`hashtags-${item.id}`}>Hashtags</label><textarea id={`hashtags-${item.id}`} rows={2} className="field" value={item.hashtags} onChange={(event) => update(item.id, { hashtags: event.target.value })}/></div>
              </div>
              <div>
                <span className="label">Média · {MEDIA_FORMAT_LABELS[item.format]}</span>
                {item.format === "texte_seul" ? <p className="rounded-xl bg-canvas p-4 text-xs text-ink-faint">Aucun média nécessaire.</p> : (
                  <label className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-4 text-center transition-colors ${mediaReady ? "border-state-approved/50 bg-state-approved/5" : "border-[#cdd5df] bg-canvas hover:border-[#8bb5ff]"}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); update(item.id, { newMedia: event.dataTransfer.files[0] ?? null }); }}>
                    <input type="file" className="sr-only" accept={acceptFor(item.format)} onChange={(event) => update(item.id, { newMedia: event.target.files?.[0] ?? null })}/>
                    <Icon name={mediaReady ? "check" : "upload"} className={`h-5 w-5 ${mediaReady ? "text-state-approved" : "text-[#0759e6]"}`}/>
                    <strong className="mt-2 max-w-full truncate text-xs">{item.newMedia?.name ?? item.mediaFileName ?? "Déposer le média"}</strong>
                    <span className="mt-1 text-[11px] text-ink-faint">Glisser-déposer ou cliquer</span>
                  </label>
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
