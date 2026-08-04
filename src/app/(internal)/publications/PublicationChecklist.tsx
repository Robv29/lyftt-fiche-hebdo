"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { completePublicationStep } from "./actions";
import { Icon } from "@/components/Icon";

export interface DailyPublication {
  id:string; clientName:string; scheduledTime:string|null; formatLabel:string; networks:string[];
  caption:string; hashtags:string[]; approvalLabel:string; approved:boolean; publishedAt:string|null;
  mediaDownloadedAt:string|null; contentCopiedAt:string|null; mediaUrl:string|null; mediaFileName:string|null;
  mediaKind:"image"|"video"|"document"|null; mediaRequired:boolean;
}

export function PublicationChecklist({ initialItems }: { initialItems:DailyPublication[] }) {
  const [items,setItems] = useState(initialItems);
  const [pending,startTransition] = useTransition();
  const [feedback,setFeedback] = useState<string|null>(null);

  const mark = (id:string,step:"media"|"content") => startTransition(async()=>{
    const result = await completePublicationStep(id,step);
    setFeedback(result.message ?? null);
    if (result.ok) setItems((current)=>current.map((item)=>item.id===id ? { ...item, mediaDownloadedAt:step==="media"?new Date().toISOString():item.mediaDownloadedAt, contentCopiedAt:step==="content"?new Date().toISOString():item.contentCopiedAt, publishedAt:result.published?(item.publishedAt??new Date().toISOString()):item.publishedAt } : item));
  });

  const download = async(item:DailyPublication) => {
    if (!item.mediaUrl) return;
    try {
      const response=await fetch(item.mediaUrl); const blob=await response.blob(); const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a"); anchor.href=url; anchor.download=item.mediaFileName??"media"; anchor.click(); URL.revokeObjectURL(url);
    } catch { window.open(item.mediaUrl,"_blank","noopener,noreferrer"); }
    mark(item.id,"media");
  };

  const copy = async(item:DailyPublication) => {
    const content=[item.caption.trim(),item.hashtags.join(" ")].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(content); mark(item.id,"content");
  };

  if (!items.length) return <div className="card flex min-h-72 flex-col items-center justify-center p-8 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-state-approved/10 text-state-approved"><Icon name="check" className="h-6 w-6"/></span><h2 className="mt-4 font-semibold">Rien à publier</h2><p className="mt-1 max-w-sm text-sm text-ink-faint">Aucun contenu n’est planifié pour cette date. Profitez-en, la checklist est vide.</p></div>;

  const complete=items.filter((item)=>item.publishedAt).length;
  return <div className="space-y-5">
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-sm">{complete} sur {items.length} publiée{items.length>1?"s":""}</strong><p className="text-xs text-ink-faint">Le statut vert apparaît après le téléchargement et la copie.</p></div><div className="h-2 w-full overflow-hidden rounded-full bg-[#e9edf3] sm:w-52"><span className="block h-full rounded-full bg-state-approved transition-transform" style={{transform:`translateX(${items.length ? Math.round(complete/items.length*100)-100 : -100}%)`}}/></div></div>
    {feedback && <p role="status" className="text-center text-xs text-ink-soft">{feedback}</p>}
    <div className="grid gap-4 xl:grid-cols-2">{items.map((item)=>{
      const mediaDone=!item.mediaRequired||Boolean(item.mediaDownloadedAt); const contentDone=Boolean(item.contentCopiedAt); const done=Boolean(item.publishedAt);
      return <article key={item.id} className={`card overflow-hidden transition-colors ${done?"border-state-approved/30 bg-state-approved/5":""}`}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{item.clientName}</h2>{done&&<span className="badge bg-state-approved text-white">Publié</span>}</div><p className="mt-1 text-xs text-ink-faint">{item.scheduledTime?.slice(0,5)??"Heure libre"} · {item.formatLabel} · {item.networks.join(", ")}</p></div><span className={`badge ${item.approved?"bg-state-approved/10 text-state-approved":"bg-state-progress/10 text-state-progress"}`}>{item.approvalLabel}</span></header>
        <div className="grid gap-4 p-4 sm:grid-cols-[150px_1fr]">
          <div className="overflow-hidden rounded-xl bg-canvas">{item.mediaUrl ? item.mediaKind==="video" ? <video src={item.mediaUrl} controls preload="metadata" className="aspect-square h-full w-full object-cover"/> : <Image src={item.mediaUrl} alt="Aperçu du média à publier" width={600} height={600} unoptimized className="aspect-square h-full w-full object-cover"/> : <div className="grid aspect-square place-items-center p-3 text-center text-xs text-ink-faint">{item.mediaRequired?"Média manquant":"Aucun média requis"}</div>}</div>
          <div className="min-w-0"><p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed">{item.caption||"Texte vide"}</p>{item.hashtags.length>0&&<p className="mt-3 break-words text-xs leading-relaxed text-[#0759e6]">{item.hashtags.join(" ")}</p>}</div>
        </div>
        <div className="grid gap-2 border-t p-4 sm:grid-cols-2"><button type="button" className={mediaDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-secondary"} disabled={pending||(!item.mediaUrl&&item.mediaRequired)} onClick={()=>download(item)}>{mediaDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="download" className="h-4 w-4"/>}{mediaDone?"Média téléchargé":item.mediaRequired?"Télécharger le média":"Aucun média requis"}</button><button type="button" className={contentDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-primary"} disabled={pending} onClick={()=>copy(item)}>{contentDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="copy" className="h-4 w-4"/>}{contentDone?"Texte copié":"Copier texte + hashtags"}</button></div>
      </article>;
    })}</div>
  </div>;
}
