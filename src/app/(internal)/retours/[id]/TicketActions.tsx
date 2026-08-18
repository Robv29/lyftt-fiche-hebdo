"use client";

import { useRef, useState, useTransition } from "react";
import { addTicketComment, prepareCorrectionForClient, resolveServiceRequest, sendCorrectionToClient, transitionTicket, type InternalActionResult } from "@/lib/internal/actions";
import { isServiceRequestOverdue, serviceRequestAgeInDays, SERVICE_REQUEST_ALERT_DAYS } from "@/lib/domain/ticket-types";
import { Icon } from "@/components/Icon";
import { deliverTicketMedia } from "../../production/actions";

interface Transition { to:string; label:string; requiresReason:boolean }

export function TicketActions({ ticketId, ticketNumber, sheetId, item, category, status, clientName, transitions, serviceRequest, submittedAt, resolvedAt }: {
  ticketId:string; ticketNumber:string; sheetId:string; category:string; status:string; clientName:string;
  item:{
    id:string; caption:string; hashtags:string[]; scheduledDate:string;
    /** Média actuellement rattaché : c'est celui que verra le client. */
    mediaUrl:string|null; mediaFileName:string|null; mediaKind:string|null;
  } | null;
  transitions:Transition[];
  /** Demande hors publication : ni correction, ni renvoi pour revalidation. */
  serviceRequest:boolean;
  submittedAt:string;
  resolvedAt:string|null;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<InternalActionResult | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [reviewUrl, setReviewUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const prepared = Boolean(message) || ["new_version_generated", "sent_back_to_client", "approved_by_client", "closed"].includes(status);
  const sent = ["sent_back_to_client", "approved_by_client", "closed"].includes(status);
  const approved = ["approved_by_client", "closed"].includes(status);

  const run = (action:()=>Promise<InternalActionResult>, onSuccess?:(result:InternalActionResult)=>void) => startTransition(async()=>{
    const result = await action(); setFeedback(result); if (result.ok) onSuccess?.(result);
  });

  /*
   * Dépôt du fichier corrigé. Ouvert à tout le monde : le graphiste depuis la
   * production, le community manager depuis ici quand il corrige lui-même une
   * broutille. C'est la même action serveur dans les deux cas — un seul chemin
   * pour un seul fichier.
   */
  const deposit = (file:File) => {
    const formData = new FormData();
    formData.set("ticketId", ticketId);
    formData.set("file", file);
    startTransition(async()=>{
      const result = await deliverTicketMedia(formData);
      setFeedback(result);
      if (result.ok) setDeposited(true);
    });
  };

  /*
   * Une demande hors publication n'a rien à corriger ni à renvoyer : le
   * parcours en quatre étapes ne s'y applique pas. Un seul geste suffit —
   * dire que c'est traité — et l'attente se signale au-delà de trois jours.
   */
  if (serviceRequest) {
    const done = Boolean(resolvedAt) || status === "closed";
    const overdue = isServiceRequestOverdue({ submittedAt, resolvedAt });
    const days = Math.floor(serviceRequestAgeInDays(submittedAt));

    return <div className="space-y-5">
      {feedback?.message && <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>{feedback.message}</p>}

      <section className={`card p-5 ${overdue ? "border-2 border-state-changes bg-state-changes/5" : done ? "border-state-approved/40 bg-[#f6fdf9]" : ""}`}>
        <p className="eyebrow">Demande hors publication</p>
        <h2 className="mt-1 font-semibold">
          {done ? "Demande traitée" : overdue ? `Sans réponse depuis ${days} jours` : "À traiter"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {done
            ? "Rien de plus à faire : le client a eu sa réponse."
            : overdue
              ? `Passé ${SERVICE_REQUEST_ALERT_DAYS} jours sans réponse, une demande client se transforme en reproche. Répondez à ${clientName}, puis marquez-la traitée.`
              : `Répondez à ${clientName} par le canal habituel, puis marquez la demande comme traitée.`}
        </p>

        {!done && (
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={pending}
            onClick={() => run(() => resolveServiceRequest(ticketId))}
          >
            <Icon name="check" className="h-4 w-4"/>
            {pending ? "Enregistrement…" : "C’est fait"}
          </button>
        )}
      </section>
    </div>;
  }

  return <div className="space-y-5">
    <section className="card overflow-hidden">
      <div className="border-b p-4"><p className="eyebrow">Parcours de correction</p><h2 className="mt-1 font-semibold">4 étapes, sans changement d’écran</h2></div>
      <ol className="grid grid-cols-4 gap-1 p-3" aria-label="Progression du ticket">
        <Step number="1" label="Demande" complete />
        <Step number="2" label="Correction" complete={prepared}/>
        <Step number="3" label="Envoi" complete={sent}/>
        <Step number="4" label="Validation" complete={approved}/>
      </ol>
    </section>

    {feedback?.message && <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>{feedback.message}</p>}

    {!sent && <section className="card p-4 sm:p-5">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4ff] text-sm font-bold text-[#0759e6]">2</span><div><h2 className="font-semibold">Appliquer la correction</h2><p className="mt-1 text-xs text-ink-faint">Modifiez directement les éléments concernés. La nouvelle version et le lien client seront créés ensemble.</p></div></div>
      <form action={(formData)=>{ formData.set("ticketId",ticketId); formData.set("sheetId",sheetId); if(item) formData.set("itemId",item.id); run(()=>prepareCorrectionForClient(formData),(result)=>{setMessage(result.messageBody ?? "");setReviewUrl(result.reviewUrl ?? "");}); }} className="mt-5 space-y-4">
        {!item && <><input type="hidden" name="caption" value=""/><input type="hidden" name="hashtags" value=""/></>}
        {item && <>
          <div><label className="label" htmlFor="correctedCaption">Texte corrigé</label><textarea id="correctedCaption" name="caption" rows={7} className="field" defaultValue={item.caption}/></div>
          <div><label className="label" htmlFor="correctedHashtags">Hashtags corrigés</label><textarea id="correctedHashtags" name="hashtags" rows={2} className="field" defaultValue={item.hashtags.join(" ")}/></div>
          <div><label className="label" htmlFor="correctedDate">Date de publication</label><input id="correctedDate" name="scheduledDate" type="date" className="field" defaultValue={item.scheduledDate}/></div>
        </>}
        {["graphic","video"].includes(category) && <div className="rounded-2xl border border-line bg-canvas p-4">
          <p className="label">Média corrigé</p>
          {/*
            Le fichier se dépose ici comme dans l'écran de production : c'est le
            même geste, le même fichier, et le community manager voit enfin ce
            que la production a livré au lieu d'un champ vide.
          */}
          {item?.mediaUrl && !deposited && (
            <figure className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
              {item.mediaKind === "video"
                ? <video src={item.mediaUrl} controls playsInline className="block max-h-48 w-full bg-black object-contain"/>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={item.mediaUrl} alt={item.mediaFileName ?? "Média de la publication"} className="block max-h-48 w-full object-contain"/>}
              <figcaption className="truncate border-t px-3 py-2 text-[11px] text-ink-faint">{item.mediaFileName}</figcaption>
            </figure>
          )}
          <div
            role="presentation"
            onDragOver={(event)=>{event.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)}
            onDrop={(event)=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files?.[0];if(file)deposit(file);}}
            onClick={()=>fileRef.current?.click()}
            className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragging ? "border-[#1468ff] bg-[#f0f6ff]" : deposited ? "border-state-approved/50 bg-state-approved/5" : "border-line bg-white hover:bg-canvas"}`}
          >
            <Icon name={deposited ? "check" : "upload"} className={`mx-auto h-5 w-5 ${deposited ? "text-state-approved" : "text-ink-faint"}`}/>
            <p className="mt-2 text-xs font-semibold">{deposited ? "Nouveau fichier déposé" : item?.mediaUrl ? "Déposer un fichier corrigé" : "Déposer le fichier corrigé"}</p>
            <p className="mt-1 text-[11px] text-ink-faint">ou cliquez pour le choisir</p>
            <input
              ref={fileRef}
              type="file"
              accept={category === "video" ? "video/*" : "image/*"}
              className="hidden"
              onChange={(event)=>{const file=event.target.files?.[0];if(file)deposit(file);event.target.value="";}}
            />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-ink-faint">Le fichier est hébergé ailleurs</summary>
            <input id="mediaExternalUrl" name="mediaExternalUrl" type="url" className="field mt-2" placeholder="https://drive.google.com/…"/>
          </details>
        </div>}
        <button type="submit" className="btn-primary w-full" disabled={pending}><Icon name="spark" className="h-4 w-4"/>{pending ? "Préparation…" : "Enregistrer et préparer l’envoi"}</button>
      </form>
    </section>}

    {message && !sent && <section className="card reveal-panel border-[#b9d2ff] p-4 sm:p-5">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4ff] text-sm font-bold text-[#0759e6]">3</span><div><h2 className="font-semibold">Envoyer au client</h2><p className="mt-1 text-xs text-ink-faint">Le message contient déjà le lien de validation de la nouvelle version.</p></div></div>
      <textarea className="field mt-4 font-mono text-xs" rows={11} value={message} onChange={(event)=>{setMessage(event.target.value);setCopied(false)}} aria-label="Message WhatsApp prêt à envoyer"/>
      {/*
        On copie ce qu'on veut — le lien seul ou le message entier — on l'envoie
        par le canal habituel, puis on déclare l'envoi fait. Ouvrir WhatsApp à
        la place du community manager enregistrait un envoi avant qu'il ait eu
        lieu : le ticket disait « envoyé » et le client n'avait rien reçu.
      */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button type="button" className="btn-secondary" disabled={!reviewUrl} onClick={async()=>{await navigator.clipboard.writeText(reviewUrl);setLinkCopied(true);setCopied(false)}}>{linkCopied ? "Lien copié" : "Copier le lien"}</button>
        <button type="button" className="btn-secondary" onClick={async()=>{await navigator.clipboard.writeText(message);setCopied(true);setLinkCopied(false)}}>{copied ? "Message copié" : "Copier le message"}</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={()=>{ const formData=new FormData();formData.set("ticketId",ticketId);formData.set("sheetId",sheetId);formData.set("body",message);formData.set("recipientLabel",clientName);run(()=>sendCorrectionToClient(formData)) }}><Icon name="check" className="h-4 w-4"/>C&apos;est envoyé</button>
      </div>
    </section>}

    {sent && !approved && <section className="rounded-2xl border border-[#cfe0ff] bg-[#f4f8ff] p-5"><p className="eyebrow text-[#0759e6]">Étape 4</p><h2 className="mt-1 font-semibold">En attente du client</h2><p className="mt-2 text-sm text-ink-soft">Le client a reçu la nouvelle version. Dès qu’il clique sur « Valider », le ticket et la fiche se mettent à jour automatiquement.</p></section>}
    {approved && <section className="rounded-2xl border border-state-approved/30 bg-state-approved/5 p-5 text-state-approved"><Icon name="check" className="h-6 w-6"/><h2 className="mt-3 font-semibold">Correction validée</h2><p className="mt-1 text-sm">Le client a validé la nouvelle fiche. Ce ticket peut être archivé.</p></section>}

    <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">Actions avancées et notes internes</summary><div className="mt-4 space-y-4 border-t pt-4">
      <div className="flex flex-col gap-2">{transitions.map((transition)=><button key={transition.to} type="button" className="btn-secondary justify-start" disabled={pending || transition.requiresReason} onClick={()=>{const data=new FormData();data.set("ticketId",ticketId);data.set("nextStatus",transition.to);run(()=>transitionTicket(data))}}>{transition.label}{transition.requiresReason && " — depuis la vue avancée"}</button>)}</div>
      <form action={(data)=>{data.set("ticketId",ticketId);run(()=>addTicketComment(data))}} className="space-y-2"><label className="label" htmlFor="internalComment">Note interne</label><textarea id="internalComment" name="body" rows={3} className="field"/><input type="hidden" name="visibility" value="internal"/><button className="btn-secondary" disabled={pending}>Ajouter la note</button></form>
      <p className="text-xs text-ink-faint">Ticket {ticketNumber}</p>
    </div></details>
  </div>;
}

function Step({number,label,complete}:{number:string;label:string;complete:boolean}) { return <li className="min-w-0 text-center"><span className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${complete ? "bg-[#1468ff] text-white" : "bg-canvas text-ink-faint"}`}>{complete ? <Icon name="check" className="h-4 w-4"/> : number}</span><span className="mt-1 block truncate text-[10px] text-ink-faint">{label}</span></li> }
