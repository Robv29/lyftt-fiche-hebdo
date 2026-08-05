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

  if (!items.length) return <div className="empty-state"><span className="empty-state-icon !bg-[#e8f8f1] !text-state-approved"><Icon name="check" className="h-6 w-6"/></span><h2 className="mt-4 font-semibold">Rien à publier</h2><p className="mt-1 max-w-sm text-sm text-ink-faint">Aucun contenu n’est planifié pour cette date. La checklist est à jour.</p></div>;

  const complete=items.filter((item)=>item.publishedAt).length;
  const percentage=Math.round(complete/items.length*100);
  const groups=Object.entries(items.reduce<Record<string,DailyPublication[]>>((result,item)=>{ (result[item.clientName]??=[]).push(item); return result; },{}));

  return <div className="space-y-6">
    <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className={`grid h-11 w-11 place-items-center rounded-2xl ${percentage===100?"bg-[#e8f8f1] text-state-approved":"bg-[#e8f2ff] text-[#1176d3]"}`}><Icon name={percentage===100?"check":"send"} className="h-5 w-5"/></span><div><strong className="text-sm">{complete} sur {items.length} publication{items.length>1?"s":""} terminée{items.length>1?"s":""}</strong><p className="mt-1 text-xs text-ink-faint">Téléchargez le média puis copiez le texte et les hashtags.</p></div></div>
      <div className="w-full sm:w-56"><div className="mb-2 flex justify-between text-[11px] text-ink-faint"><span>Progression du jour</span><strong className="text-ink">{percentage}%</strong></div><div className="progress-track"><span className={`progress-fill ${percentage===100?"!bg-state-approved":""}`} style={{transform:`scaleX(${percentage/100})`}}/></div></div>
    </section>

    {feedback && <p role="status" className="rounded-xl border border-[#c9dcf0] bg-[#f7fafe] px-4 py-3 text-center text-xs text-ink-soft">{feedback}</p>}

    {groups.map(([clientName,clientItems])=><section key={clientName} className="space-y-3" aria-labelledby={`client-${clientItems[0]?.id}`}>
      <div className="flex items-center justify-between gap-3 px-1"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e8f2ff] text-[11px] font-bold text-[#0b5e9f]">{clientName.slice(0,2).toUpperCase()}</span><div><h2 id={`client-${clientItems[0]?.id}`} className="text-sm font-semibold">{clientName}</h2><p className="text-[11px] text-ink-faint">{clientItems.length} contenu{clientItems.length>1?"s":""} à exécuter</p></div></div><span className="badge bg-white text-ink-soft shadow-sm">{clientItems.filter((item)=>item.publishedAt).length}/{clientItems.length}</span></div>
      <div className="grid gap-4 xl:grid-cols-2">{clientItems.map((item)=><PublicationCard key={item.id} item={item} pending={pending} onDownload={()=>download(item)} onCopy={()=>copy(item)}/>)}</div>
    </section>)}
  </div>;
}

function PublicationCard({item,pending,onDownload,onCopy}:{item:DailyPublication;pending:boolean;onDownload:()=>void;onCopy:()=>void}) {
  const mediaDone=!item.mediaRequired||Boolean(item.mediaDownloadedAt); const contentDone=Boolean(item.contentCopiedAt); const done=Boolean(item.publishedAt);
  return <article className={`card lift-card overflow-hidden transition-colors ${done?"border-state-approved/30 bg-[#fbfffd]":""}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{item.scheduledTime?.slice(0,5)??"Heure libre"}</h3>{done&&<span className="badge gap-1 bg-[#e8f8f1] text-state-approved"><Icon name="check" className="h-3 w-3"/>Publié</span>}</div><p className="mt-1 text-xs text-ink-faint">{item.formatLabel} · {item.networks.join(", ")}</p></div><span className={`badge ${item.approved?"bg-[#e8f8f1] text-state-approved":"bg-[#fff4e5] text-state-progress"}`}>{item.approvalLabel}</span></header>
    <div className="grid gap-5 p-5 sm:grid-cols-[160px_1fr]">
      <div className="overflow-hidden rounded-2xl border bg-canvas">{item.mediaUrl ? item.mediaKind==="video" ? <video src={item.mediaUrl} controls preload="metadata" className="aspect-square h-full w-full object-cover"/> : <Image src={item.mediaUrl} alt="Aperçu du média à publier" width={600} height={600} unoptimized className="aspect-square h-full w-full object-cover"/> : <div className="grid aspect-square place-items-center p-3 text-center text-xs text-ink-faint"><Icon name={item.mediaRequired?"photo":"check"} className="mb-2 h-5 w-5"/>{item.mediaRequired?"Média manquant":"Aucun média requis"}</div>}</div>
      <div className="min-w-0"><p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed">{item.caption||"Texte vide"}</p>{item.hashtags.length>0&&<p className="mt-3 break-words text-xs leading-relaxed text-[#0b63ad]">{item.hashtags.join(" ")}</p>}</div>
    </div>
    <div className="grid gap-2 border-t bg-[#fbfcfe] p-4 sm:grid-cols-2"><button type="button" className={mediaDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-secondary"} disabled={pending||(!item.mediaUrl&&item.mediaRequired)} onClick={onDownload}>{mediaDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="download" className="h-4 w-4"/>}{mediaDone?"Média téléchargé":item.mediaRequired?"Télécharger le média":"Aucun média requis"}</button><button type="button" className={contentDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-primary"} disabled={pending} onClick={onCopy}>{contentDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="copy" className="h-4 w-4"/>}{contentDone?"Texte copié":"Copier texte + hashtags"}</button></div>
  </article>;
}
