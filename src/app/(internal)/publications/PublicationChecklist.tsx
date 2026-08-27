"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { completePublicationStep, setCollaborationDone, setPublicationPublished, togglePublishedNetwork } from "./actions";
import { Icon } from "@/components/Icon";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { mediaFrameBackground, mediaFrameClass } from "@/lib/domain/media-frame";
import { SOCIAL_NETWORK_LABELS, type MediaFormat, type SocialNetwork } from "@/lib/domain/types";
import { missingNetworks } from "@/lib/domain/publication-checklist";

function todayInParis():string { return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function isToday(day:string):boolean { return day===todayInParis(); }
function dayLabel(day:string):string {
  const label=format(new Date(`${day}T12:00:00`),"EEEE d MMMM",{locale:fr});
  return isToday(day) ? `Aujourd’hui · ${label}` : label;
}

export interface DailyPublication {
  id:string; scheduledDate:string; clientName:string; scheduledTime:string|null; format:MediaFormat; formatLabel:string; networks:string[];
  caption:string; hashtags:string[]; approvalLabel:string; approved:boolean; publishedAt:string|null;
  mediaDownloadedAt:string|null; contentCopiedAt:string|null; mediaUrl:string|null; mediaFileName:string|null;
  mediaKind:"image"|"video"|"document"|null; mediaRequired:boolean;
  /** Toutes les images de la publication, dans l'ordre du carrousel. */
  gallery:{fileName:string;kind:"image"|"video"|"document";url:string|null}[];
  /** Compte partenaire, nul quand il n'y a pas de collaboration. */
  collaborationHandle:string|null;
  collaborationDoneAt:string|null;
  /** Réseaux enregistrés sur la fiche du client. */
  plannedNetworks:SocialNetwork[];
  /** Réseaux réellement publiés, cochés un à un. */
  publishedNetworks:SocialNetwork[];
}

export function PublicationChecklist({ initialItems, nextWithContent }: { initialItems:DailyPublication[]; nextWithContent?:string|null }) {
  const [items,setItems] = useState(initialItems);
  const [pending,startTransition] = useTransition();
  const [feedback,setFeedback] = useState<string|null>(null);

  const mark = (id:string,step:"media"|"content") => startTransition(async()=>{
    const result = await completePublicationStep(id,step);
    setFeedback(result.message ?? null);
    if (result.ok) setItems((current)=>current.map((item)=>item.id===id ? { ...item, mediaDownloadedAt:step==="media"?new Date().toISOString():item.mediaDownloadedAt, contentCopiedAt:step==="content"?new Date().toISOString():item.contentCopiedAt } : item));
  });

  const confirmPublished = (id:string,published:boolean) => startTransition(async()=>{
    const result = await setPublicationPublished(id,published);
    setFeedback(result.message ?? null);
    if (result.ok) setItems((current)=>current.map((item)=>item.id===id ? { ...item, publishedAt:published?new Date().toISOString():null } : item));
  });

  const markCollaboration = (id:string,done:boolean) => startTransition(async()=>{
    const result = await setCollaborationDone(id,done);
    setFeedback(result.message ?? null);
    if (result.ok) setItems((current)=>current.map((item)=>item.id===id ? { ...item, collaborationDoneAt:done?new Date().toISOString():null } : item));
  });

  const toggleNetwork = (id:string,network:SocialNetwork,on:boolean) => startTransition(async()=>{
    const result = await togglePublishedNetwork(id,network,on);
    if (result.message) setFeedback(result.message);
    if (result.ok) setItems((current)=>current.map((item)=>item.id===id ? { ...item, publishedNetworks:on ? [...item.publishedNetworks,network] : item.publishedNetworks.filter((value)=>value!==network) } : item));
  });

  const download = async(item:DailyPublication) => {
    /*
     * Un carrousel se télécharge en entier : ne servir que la couverture
     * obligerait à revenir chercher les autres images une par une.
     */
    const images=item.gallery.length>0?item.gallery:item.mediaUrl?[{url:item.mediaUrl,fileName:item.mediaFileName??"media",kind:item.mediaKind??"image"}]:[];
    if (images.length===0) return;
    try {
      for (const [index,image] of images.entries()) {
        if (!image.url) continue;
        const response=await fetch(image.url); const blob=await response.blob(); const url=URL.createObjectURL(blob);
        const anchor=document.createElement("a"); anchor.href=url;
        anchor.download=images.length>1?`${index+1}-${image.fileName}`:image.fileName;
        anchor.click(); URL.revokeObjectURL(url);
      }
    } catch { if (images[0]?.url) window.open(images[0].url,"_blank","noopener,noreferrer"); }
    mark(item.id,"media");
  };

  const copy = async(item:DailyPublication) => {
    const content=[item.caption.trim(),item.hashtags.join(" ")].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(content); mark(item.id,"content");
  };

  if (!items.length) return <div className="empty-state"><span className="empty-state-icon !bg-[#e8f8f1] !text-state-approved"><Icon name="check" className="h-6 w-6"/></span><h2 className="mt-4 font-semibold">Rien à publier</h2><p className="mt-1 max-w-sm text-sm text-ink-faint">Aucun contenu n’est planifié pour cette date.</p>{nextWithContent && <a href={`/publications?date=${nextWithContent}`} className="btn-secondary mt-4">Prochaine publication : {dayLabel(nextWithContent)}</a>}</div>;

  const complete=items.filter((item)=>item.publishedAt).length;
  const percentage=Math.round(complete/items.length*100);
  // Regroupement par jour : on execute la journee, pas le client.
  const groups=Object.entries(items.reduce<Record<string,DailyPublication[]>>((result,item)=>{ (result[item.scheduledDate]??=[]).push(item); return result; },{})).sort(([a],[b])=>a.localeCompare(b));

  return <div className="space-y-6">
    <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className={`grid h-11 w-11 place-items-center rounded-2xl ${percentage===100?"bg-[#e8f8f1] text-state-approved":"bg-[#e8f2ff] text-[#1176d3]"}`}><Icon name={percentage===100?"check":"send"} className="h-5 w-5"/></span><div><strong className="text-sm">{complete} sur {items.length} publication{items.length>1?"s":""} terminée{items.length>1?"s":""}</strong><p className="mt-1 text-xs text-ink-faint">Téléchargez le média puis copiez le texte et les hashtags.</p></div></div>
      <div className="w-full sm:w-56"><div className="mb-2 flex justify-between text-[11px] text-ink-faint"><span>Progression</span><strong className="text-ink">{percentage}%</strong></div><div className="progress-track"><span className={`progress-fill ${percentage===100?"!bg-state-approved":""}`} style={{transform:`scaleX(${percentage/100})`}}/></div></div>
    </section>

    {feedback && <p role="status" className="rounded-xl border border-[#c9dcf0] bg-[#f7fafe] px-4 py-3 text-center text-xs text-ink-soft">{feedback}</p>}

    {groups.map(([day,dayItems])=><section key={day} className="space-y-3" aria-labelledby={`jour-${day}`}>
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-xl text-[11px] font-bold ${isToday(day)?"bg-[#0b5e9f] text-white":"bg-[#e8f2ff] text-[#0b5e9f]"}`}>{day.slice(8,10)}</span>
          <div>
            <h2 id={`jour-${day}`} className="text-sm font-semibold capitalize">{dayLabel(day)}</h2>
            <p className="text-[11px] text-ink-faint">{dayItems.length} contenu{dayItems.length>1?"s":""} · {[...new Set(dayItems.map((item)=>item.clientName))].join(", ")}</p>
          </div>
        </div>
        <span className="badge bg-white text-ink-soft shadow-sm">{dayItems.filter((item)=>item.publishedAt).length}/{dayItems.length}</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{dayItems.map((item)=><PublicationCard key={item.id} item={item} pending={pending} onDownload={()=>download(item)} onCopy={()=>copy(item)} onPublished={(published)=>confirmPublished(item.id,published)} onNetwork={(network,on)=>toggleNetwork(item.id,network,on)} onCollaboration={(done)=>markCollaboration(item.id,done)}/>)}</div>
    </section>)}
  </div>;
}

/**
 * Le média est montré entier, dans la forme où il sera publié : cadre
 * téléphone pour une story ou une vidéo, carré pour un post de feed.
 */
function MediaPreview({ item }:{ item:DailyPublication }) {
  const frame=`${mediaFrameClass(item.format)} w-full`;
  if (!item.mediaUrl) {
    return <div className={`grid place-items-center overflow-hidden rounded-2xl border bg-canvas p-3 text-center text-xs text-ink-faint ${frame}`}>
      <span><Icon name={item.mediaRequired?"photo":"check"} className="mx-auto mb-2 h-5 w-5"/>{item.mediaRequired?"Média manquant":"Aucun média requis"}</span>
    </div>;
  }
  const media=item.mediaKind==="video"
    ? <video src={item.mediaUrl} controls playsInline preload="metadata" className="h-full w-full object-contain"/>
    : <Image src={item.mediaUrl} alt="Aperçu du média à publier" width={720} height={1280} unoptimized className="h-full w-full object-contain"/>;
  return <div className={`relative overflow-hidden rounded-2xl border ${mediaFrameBackground(item.format)} ${frame}`}>
    {media}
    {item.gallery.length>1&&<span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">1/{item.gallery.length}</span>}
  </div>;
}

/**
 * Mise en ligne effective.
 *
 * Télécharger le média et copier le texte ne prouvent rien : le post peut
 * n'avoir jamais été publié, ou ne l'avoir été que sur un réseau. Deux gestes
 * distincts le disent — la confirmation, et le réseau par réseau repris de la
 * fiche du client.
 */
function PublishPanel({item,pending,locked,onPublished,onNetwork,onCollaboration}:{item:DailyPublication;pending:boolean;locked:boolean;onPublished:(published:boolean)=>void;onNetwork:(network:SocialNetwork,on:boolean)=>void;onCollaboration:(done:boolean)=>void}) {
  const collaborationDone=Boolean(item.collaborationDoneAt);
  /*
   * Une invitation en collaboration s'envoie à la création du post : oubliée,
   * elle ne se rattrape pas. Elle conditionne donc la confirmation.
   */
  const ready=!item.collaborationHandle || collaborationDone;
  const published=Boolean(item.publishedAt);
  const remaining=missingNetworks(item.plannedNetworks,item.publishedNetworks);

  return <div className={`mt-3 rounded-2xl border p-3 transition-colors ${published?"border-state-approved/40 bg-[#f6fdf9]":"border-line bg-white"}`}>
    <label className={`flex items-center gap-3 ${!ready||locked?"opacity-50":"cursor-pointer"}`}>
      <input type="checkbox" checked={published} disabled={pending||locked||!ready} onChange={(event)=>onPublished(event.target.checked)}/>
      <span className="text-sm font-semibold">{published?"Publié":"Confirmer la publication"}</span>
    </label>

    {!ready&&!locked&&<p className="mt-1.5 pl-7 text-[11px] text-ink-faint">
      Invitez le compte en collaboration pour pouvoir confirmer.
    </p>}

    {/* Rien ne s'affiche quand la publication n'est pas en collaboration. */}
    {item.collaborationHandle&&<label className={`mt-3 flex items-start gap-3 border-t pt-3 ${locked?"opacity-50":"cursor-pointer"}`}>
      <input type="checkbox" className="mt-0.5" checked={collaborationDone} disabled={pending||locked} onChange={(event)=>onCollaboration(event.target.checked)}/>
      <span>
        <span className="text-sm font-semibold">Collaboration avec {item.collaborationHandle}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
          Le post doit être créé en invitant ce compte, sinon il ne paraîtra que
          sur celui du client.
        </span>
      </span>
    </label>}

    {item.plannedNetworks.length>0&&<div className="mt-3 border-t pt-3">
      <p className="text-[11px] font-medium text-ink-faint">Réseaux publiés{remaining.length>0&&published&&` · reste ${remaining.map((network)=>SOCIAL_NETWORK_LABELS[network]).join(", ")}`}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {item.plannedNetworks.map((network)=>{
          const done=item.publishedNetworks.includes(network);
          return <label key={network} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${done?"border-state-approved/40 bg-[#e8f8f1] text-state-approved":"border-line bg-canvas text-ink-soft hover:border-[#8bb5ff]"} ${locked?"pointer-events-none opacity-50":""}`}>
            <input type="checkbox" className="sr-only" checked={done} disabled={pending||locked} onChange={(event)=>onNetwork(network,event.target.checked)}/>
            {done&&<Icon name="check" className="h-3 w-3"/>}
            {SOCIAL_NETWORK_LABELS[network]}
          </label>;
        })}
      </div>
    </div>}
  </div>;
}

function PublicationCard({item,pending,onDownload,onCopy,onPublished,onNetwork,onCollaboration}:{item:DailyPublication;pending:boolean;onDownload:()=>void;onCopy:()=>void;onPublished:(published:boolean)=>void;onNetwork:(network:SocialNetwork,on:boolean)=>void;onCollaboration:(done:boolean)=>void}) {
  const mediaDone=!item.mediaRequired||Boolean(item.mediaDownloadedAt); const contentDone=Boolean(item.contentCopiedAt); const done=Boolean(item.publishedAt);
  /*
   * Publier un contenu que le client n'a pas validé est le risque que tout le
   * module cherche à éliminer : cocher « publié » reste donc bloqué jusque-là.
   *
   * Télécharger le média, en revanche, ne publie rien : c'est de la
   * préparation, et l'interdire obligeait à attendre la validation pour
   * commencer à travailler — parfois le matin même de la publication. Le
   * téléchargement est donc ouvert, la publication non.
   */
  const locked=!item.approved&&!done;
  return <article className={`card lift-card overflow-hidden transition-colors ${done?"border-state-approved/30 bg-[#fbfffd]":locked?"border-state-progress/30":""}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{item.clientName}</h3><span className="text-xs font-medium text-ink-faint">{item.scheduledTime?.slice(0,5)??"Heure libre"}</span>{done&&<span className="badge gap-1 bg-[#e8f8f1] text-state-approved"><Icon name="check" className="h-3 w-3"/>Publié</span>}</div><p className="mt-1 text-xs text-ink-faint">{item.formatLabel} · {item.networks.join(", ")}</p></div><span className={`badge ${item.approved?"bg-[#e8f8f1] text-state-approved":"bg-[#fff4e5] text-state-progress"}`}>{item.approvalLabel}</span></header>
    <div className="grid gap-5 p-5 sm:grid-cols-[168px_1fr]">
      <MediaPreview item={item}/>
      <div className="min-w-0"><p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed">{item.caption||"Texte vide"}</p>{item.hashtags.length>0&&<p className="mt-3 break-words text-xs leading-relaxed text-[#0b63ad]">{item.hashtags.join(" ")}</p>}</div>
    </div>
    <div className="border-t bg-[#fbfcfe] p-4">{locked&&<p className="mb-3 rounded-xl bg-[#fff4e5] px-3 py-2 text-xs leading-relaxed text-[#8a5700]">En attente de validation client. Le média est téléchargeable pour préparer, mais la publication reste bloquée tant que le client n&apos;a pas validé.</p>}<div className="grid gap-2 sm:grid-cols-2"><button type="button" className={mediaDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-secondary"} disabled={pending||(!item.mediaUrl&&item.mediaRequired)} onClick={onDownload}>{mediaDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="download" className="h-4 w-4"/>}{mediaDone?"Média téléchargé":item.mediaRequired?(item.gallery.length>1?`Télécharger les ${item.gallery.length} images`:"Télécharger le média"):"Aucun média requis"}</button><button type="button" className={contentDone?"btn-secondary border-state-approved/30 text-state-approved":"btn-primary"} disabled={pending||locked} onClick={onCopy}>{contentDone?<Icon name="check" className="h-4 w-4"/>:<Icon name="copy" className="h-4 w-4"/>}{contentDone?"Texte copié":"Copier texte + hashtags"}</button></div>

      <PublishPanel item={item} pending={pending} locked={locked} onPublished={onPublished} onNetwork={onNetwork} onCollaboration={onCollaboration}/>
    </div>
  </article>;
}
