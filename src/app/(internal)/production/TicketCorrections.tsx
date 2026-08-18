"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { uploadMediaDirect } from "@/lib/media/direct-upload";
import { deliverTicketMedia, submitTicketForReview, validateTicketCorrection } from "./actions";

export interface TicketCorrectionRow {
  id: string;
  ticketNumber: string;
  clientName: string;
  /** Nature de la demande, reprise du catalogue des types de ticket. */
  typeLabel: string;
  title: string;
  /** Ce que le client demande, mot pour mot. */
  description: string;
  status: string;
  statusLabel: string;
  category: "graphic" | "video";
  /** Client de la correction : le fichier est rangé dans son dossier. */
  clientId: string;
  priorityLabel: string | null;
  dueLabel: string | null;
  overdue: boolean;
  /** Faux quand la demande ne vise aucune publication précise. */
  hasItem: boolean;
}

/**
 * Corrections demandées par le client.
 *
 * L'écran de production n'a qu'un geste à offrir : déposer le fichier corrigé,
 * puis valider. Le texte de la publication, ses hashtags et sa date ne sont pas
 * l'affaire du graphiste — les afficher ici ne faisait qu'allonger la carte et
 * inviter à modifier ce qui avait été arrêté avec le client.
 *
 * La validation du community manager, elle, va jusqu'au bout : elle date la
 * version corrigée et sort le lien de la fiche, avec son message prêt à coller.
 */
export function TicketCorrections({
  tickets,
  canValidate,
}: {
  tickets: TicketCorrectionRow[];
  canValidate: boolean;
}) {
  if (tickets.length === 0) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
        <span className="empty-state-icon"><Icon name="check" className="h-5 w-5"/></span>
        <strong className="mt-3 text-sm">Production à jour</strong>
        <p className="mt-1 text-xs text-ink-faint">Aucune correction graphique ou vidéo n’attend d’intervention.</p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {tickets.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} canValidate={canValidate}/>
      ))}
    </ul>
  );
}

function TicketCard({ ticket, canValidate }: { ticket: TicketCorrectionRow; canValidate: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);
  const [handoff, setHandoff] = useState<{ reviewUrl?: string; messageBody?: string; whatsappUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Ce qui vient d'être déposé pendant cette session, pour l'annoncer sur place.
  const [delivered, setDelivered] = useState(false);
  const [sending, setSending] = useState(false);

  const awaitingValidation = ticket.status === "ready_for_review";
  // Corrigé et validé : il ne reste qu'à l'envoyer, depuis le ticket.
  const validated = ["new_version_generated", "sent_back_to_client"].includes(ticket.status);
  // Le dépôt n'a de sens qu'une fois la correction confiée à la production.
  const openToDelivery = ["assigned", "in_progress", "reopened"].includes(ticket.status);
  const accept = ticket.category === "video" ? "video/*" : "image/*";

  /*
   * Le fichier part d'abord au stockage, puis seul son identifiant rejoint
   * l'action : une vidéo corrigée dépasse le corps admis par une action.
   */
  const deliver = async (file: File) => {
    setSending(true);
    const upload = await uploadMediaDirect({ file, clientId: ticket.clientId, sheetId: null });
    setSending(false);
    if (!upload.ok || !upload.mediaAssetId) {
      setFeedback({ ok: false, message: upload.message ?? "Envoi impossible." });
      return;
    }
    const formData = new FormData();
    formData.set("ticketId", ticket.id);
    formData.set("mediaAssetId", upload.mediaAssetId);
    startTransition(async () => {
      const result = await deliverTicketMedia(formData);
      setFeedback(result);
      if (result.ok) {
        setDelivered(true);
        router.refresh();
      }
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void deliver(file);
  };

  const submit = () => startTransition(async () => {
    const result = await submitTicketForReview(ticket.id);
    setFeedback(result);
    if (result.ok) router.refresh();
  });

  const validate = () => startTransition(async () => {
    const result = await validateTicketCorrection(ticket.id);
    setFeedback({ ok: result.ok, message: result.message });
    if (result.ok) {
      setHandoff({ reviewUrl: result.reviewUrl, messageBody: result.messageBody, whatsappUrl: result.whatsappUrl });
      router.refresh();
    }
  });

  return (
    <li className={`card overflow-hidden ${ticket.overdue ? "border-state-changes/40" : ""}`}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-xs font-bold text-[#0b4f88]">
                {ticket.clientName.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <strong className="block truncate text-sm">{ticket.clientName}</strong>
                <p className="truncate text-xs text-ink-faint">{ticket.typeLabel} · {ticket.ticketNumber}</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {ticket.priorityLabel && <span className="badge bg-state-changes/10 text-state-changes">{ticket.priorityLabel}</span>}
            {ticket.dueLabel && (
              <span className={`badge ${ticket.overdue ? "bg-state-changes/10 text-state-changes" : "bg-canvas text-ink-soft"}`}>
                {ticket.dueLabel}
              </span>
            )}
          </div>
        </div>

        {/* La demande du client, pas le texte de la publication. */}
        <h3 className="mt-3 text-sm font-semibold leading-snug">{ticket.title}</h3>
        {ticket.description && (
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-soft">{ticket.description}</p>
        )}
      </div>

      <div className="border-t bg-[#fbfcfe] p-5">
        {feedback?.message && (
          <p className={`mb-3 rounded-xl border px-3 py-2 text-xs ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>
            {feedback.message}
          </p>
        )}

        {!ticket.hasItem ? (
          <p className="rounded-xl bg-canvas px-4 py-3 text-xs leading-relaxed text-ink-faint">
            Cette demande ne porte pas sur une publication précise : elle se traite depuis le ticket.
          </p>
        ) : awaitingValidation ? (
          <div className="space-y-3">
            <span className="badge bg-[#fff4e5] text-[#8a5700]">En attente de validation</span>
            {canValidate ? (
              <>
                <p className="text-xs leading-relaxed text-ink-faint">
                  Valider date la version corrigée et prépare le lien de la fiche à envoyer au client.
                </p>
                <button type="button" className="btn-primary" disabled={pending} onClick={validate}>
                  <Icon name="check" className="h-4 w-4"/>
                  {pending ? "Validation…" : "Valider et préparer le lien client"}
                </button>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-faint">
                Le community manager contrôle la correction avant l’envoi au client.
              </p>
            )}
          </div>
        ) : validated ? (
          <div className="space-y-2">
            <span className="badge bg-[#e8f8f1] text-state-approved">Version corrigée prête</span>
            <p className="text-xs leading-relaxed text-ink-faint">
              Le lien de validation a été préparé. L’envoi au client se marque depuis le ticket.
            </p>
          </div>
        ) : !openToDelivery ? (
          <p className="rounded-xl bg-canvas px-4 py-3 text-xs leading-relaxed text-ink-faint">
            {ticket.statusLabel} — cette demande n’est pas encore confiée à la production.
          </p>
        ) : (
          <div className="space-y-3">
            <div
              role="presentation"
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-[#1468ff] bg-[#f0f6ff]" : delivered ? "border-state-approved/50 bg-state-approved/5" : "border-line bg-white hover:bg-canvas"}`}
            >
              <Icon name={delivered ? "check" : "upload"} className={`mx-auto h-5 w-5 ${delivered ? "text-state-approved" : "text-ink-faint"}`}/>
              <p className="mt-2 text-xs font-semibold">
                {sending || pending ? "Envoi…" : delivered ? "Déposer une nouvelle version" : `Glissez ${ticket.category === "video" ? "la vidéo corrigée" : "le fichier corrigé"} ici`}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">ou cliquez pour choisir un fichier</p>
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void deliver(file);
                  event.target.value = "";
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
                <Icon name="check" className="h-4 w-4"/>Valider
              </button>
              <span className="text-[11px] text-ink-faint">{ticket.statusLabel}</span>
            </div>
          </div>
        )}

        {/*
          Le lien n'est montré qu'une fois, à la validation : il est ensuite
          rangé avec la fiche. Le message est prêt à coller tel quel.
        */}
        {handoff?.reviewUrl && (
          <div className="mt-4 space-y-2 rounded-xl border border-state-approved/30 bg-state-approved/5 p-3">
            <strong className="text-xs text-state-approved">Lien de validation pour le client</strong>
            <p className="break-all rounded-lg bg-white px-2 py-1.5 text-[11px] text-ink-soft">{handoff.reviewUrl}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(handoff.messageBody ?? handoff.reviewUrl ?? "")
                    .then(() => setCopied(true), () => setCopied(false));
                }}
              >
                <Icon name="message" className="h-4 w-4"/>{copied ? "Message copié" : "Copier le message"}
              </button>
              {handoff.whatsappUrl && (
                <a href={handoff.whatsappUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                  Ouvrir WhatsApp
                </a>
              )}
            </div>
          </div>
        )}

        <Link href={`/retours/${ticket.id}`} className="mt-3 inline-block text-[11px] text-ink-faint hover:underline">
          Ouvrir le ticket complet →
        </Link>
      </div>
    </li>
  );
}
