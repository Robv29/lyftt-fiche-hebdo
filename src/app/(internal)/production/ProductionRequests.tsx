"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { uploadMediaDirect } from "@/lib/media/direct-upload";
import {
  createProductionRequest,
  deleteProductionRequest,
  deliverProductionRequest,
  reopenProductionRequest,
  validateProductionRequest,
  type ProductionActionResult,
} from "./actions";

export interface ProductionRequestRow {
  id: string;
  clientId: string;
  clientName: string;
  kind: "video" | "photo" | "visuel";
  title: string;
  brief: string | null;
  dueOn: string;
  status: "a_faire" | "livree" | "validee";
  /** Nom de la personne qui a passé la commande. */
  requestedByName: string | null;
  /** La commande a-t-elle été passée par la personne connectée ? */
  isMine: boolean;
  mediaUrl: string | null;
  mediaFileName: string | null;
  mediaKind: string | null;
  /** Visuel de référence joint à la demande, s'il y en a un. */
  referenceUrl: string | null;
  overdue: boolean;
}

const KIND_LABELS: Record<ProductionRequestRow["kind"], string> = {
  video: "Vidéo",
  photo: "Photo",
  visuel: "Visuel",
};

const KIND_ACCEPT: Record<ProductionRequestRow["kind"], string> = {
  video: "video/*",
  photo: "image/*",
  visuel: "image/*",
};

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", day: "numeric", month: "long", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Commandes de production internes.
 *
 * Une demande interne n'est pas un ticket client : il n'y a ni client à
 * recontacter, ni revalidation à obtenir — juste un fichier attendu par un
 * collègue, avant une date. D'où un écran court : la commande, le dépôt, la
 * validation.
 */
export function ProductionRequests({
  requests,
  clients,
  canRequest,
}: {
  requests: ProductionRequestRow[];
  clients: { id: string; name: string }[];
  canRequest: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ProductionActionResult | null>(null);
  const [open, setOpen] = useState(false);
  /*
   * Référence : envoyée directement au stockage, pas à travers l'action.
   * Le corps d'une action serveur est plafonné, et une photo prise au
   * téléphone le dépasse régulièrement.
   */
  const [clientId, setClientId] = useState("");
  const [reference, setReference] = useState<{ id: string; previewUrl: string } | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<"vide" | "envoi" | "erreur">("vide");

  const attachReference = async (file: File) => {
    if (!clientId) {
      setFeedback({ ok: false, message: "Choisissez d'abord le client concerné." });
      return;
    }
    setReferenceStatus("envoi");
    const previewUrl = URL.createObjectURL(file);
    const result = await uploadMediaDirect({ file, clientId, sheetId: null });
    if (!result.ok || !result.mediaAssetId) {
      setReferenceStatus("erreur");
      setFeedback({ ok: false, message: result.message ?? "Référence non envoyée." });
      return;
    }
    setReference({ id: result.mediaAssetId, previewUrl });
    setReferenceStatus("vide");
  };

  const run = (action: () => Promise<ProductionActionResult>) => {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) router.refresh();
      } catch {
        setFeedback({ ok: false, message: "Opération interrompue. Réessayez." });
      }
    });
  };

  // Les commandes validées sont closes : elles n'encombrent pas la file.
  const active = requests.filter((request) => request.status !== "validee");
  const awaitingValidation = active.filter((request) => request.status === "livree");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Commandes internes</h2>
          <p className="mt-1 text-xs text-ink-faint">
            {active.length === 0
              ? "Aucune commande en cours."
              : `${active.length} en cours${awaitingValidation.length > 0 ? ` · ${awaitingValidation.length} en attente de validation` : ""}`}
          </p>
        </div>
        {canRequest && (
          <button type="button" className="btn-primary sm:w-auto" onClick={() => { setOpen((value) => !value); setFeedback(null); }}>
            <Icon name="layers" className="h-4 w-4"/>
            {open ? "Fermer" : "Demander une production"}
          </button>
        )}
      </div>

      {feedback?.message && (
        <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>
          {feedback.message}
        </p>
      )}

      {open && canRequest && (
        <form
          className="card space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            startTransition(async () => {
              const result = await createProductionRequest(formData);
              setFeedback(result);
              if (result.ok) {
                form.reset();
                setReference(null);
                setClientId("");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div>
            <h3 className="font-semibold">Nouvelle demande</h3>
            <p className="mt-1 text-xs text-ink-faint">
              Tout ce qu&apos;il faut pour produire sans revenir vous voir : le client,
              ce qui est attendu, et pour quand.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="request-client">Client concerné</label>
              <select id="request-client" name="clientId" required className="field" value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="" disabled>Choisir un client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="request-due">Date limite</label>
              <input id="request-due" name="dueOn" type="date" required className="field"/>
            </div>
          </div>

          <fieldset>
            <legend className="label">Ce qui est demandé</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(["video", "photo", "visuel"] as const).map((kind, index) => (
                <label key={kind} className="choice-chip">
                  <input type="radio" name="kind" value={kind} defaultChecked={index === 0} required/>
                  {KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="request-title">Intitulé</label>
            <input id="request-title" name="title" required maxLength={160} className="field" placeholder="Reel de présentation de l’atelier"/>
          </div>

          <div>
            <label className="label" htmlFor="request-brief">Brief et informations utiles</label>
            <textarea id="request-brief" name="brief" rows={4} maxLength={2000} className="field" placeholder="Message à faire passer, format, lieu, contraintes, éléments déjà disponibles…"/>
          </div>

          {/*
            Une référence vaut mieux qu'un paragraphe : « comme la story de la
            semaine dernière, mais plus sobre » suppose que l'autre l'ait sous
            les yeux.
          */}
          <div>
            <label className="label" htmlFor="request-reference">
              Visuel de référence <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <input type="hidden" name="referenceMediaId" value={reference?.id ?? ""}/>
            {reference ? (
              <div className="mt-1 flex items-center gap-3 rounded-xl border border-line bg-white p-2">
                <span className="block w-[72px] overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reference.previewUrl} alt="Référence jointe" className="block aspect-square w-full object-cover"/>
                </span>
                <span className="text-xs text-ink-soft">Référence jointe</span>
                <button
                  type="button"
                  className="ml-auto text-xs text-state-changes hover:underline"
                  onClick={() => setReference(null)}
                >
                  Retirer
                </button>
              </div>
            ) : (
              <input
                id="request-reference"
                type="file"
                accept="image/*"
                className="field text-xs"
                disabled={referenceStatus === "envoi"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attachReference(file);
                  event.target.value = "";
                }}
              />
            )}
            <p className="mt-1 text-xs text-ink-faint">
              {referenceStatus === "envoi"
                ? "Envoi de la référence…"
                : "Une image qui montre le rendu attendu : ambiance, cadrage, mise en page."}
            </p>
          </div>

          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Envoi…" : "Envoyer à la production"}
          </button>
        </form>
      )}

      {active.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune commande interne en cours.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {active.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              pending={pending}
              onDeliver={(formData) => run(() => deliverProductionRequest(formData))}
              onValidate={() => run(() => validateProductionRequest(request.id))}
              onReopen={() => run(() => reopenProductionRequest(request.id))}
              onDelete={() => run(() => deleteProductionRequest(request.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestCard({
  request,
  pending,
  onDeliver,
  onValidate,
  onReopen,
  onDelete,
}: {
  request: ProductionRequestRow;
  pending: boolean;
  onDeliver: (formData: FormData) => void;
  onValidate: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const delivered = request.status === "livree";

  const deliver = (file: File) => {
    const formData = new FormData();
    formData.set("requestId", request.id);
    formData.set("file", file);
    onDeliver(formData);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) deliver(file);
  };

  return (
    <li className={`card overflow-hidden ${request.overdue ? "border-state-changes/40" : ""}`}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="badge bg-[#f1edff] text-[#6f50c9]">{KIND_LABELS[request.kind]}</span>
              <strong className="truncate text-sm">{request.clientName}</strong>
            </div>
            <h3 className="mt-2 text-sm font-semibold leading-snug">{request.title}</h3>
          </div>
          <span className={`badge shrink-0 ${request.overdue ? "bg-state-changes/10 text-state-changes" : "bg-canvas text-ink-soft"}`}>
            {request.overdue ? "En retard · " : ""}{formatDay(request.dueOn)}
          </span>
        </div>

        {request.brief && (
          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-ink-soft">{request.brief}</p>
        )}

        {request.referenceUrl && (
          <figure className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={request.referenceUrl} alt="Visuel de référence" className="block max-h-40 w-full object-contain"/>
            <figcaption className="border-t px-3 py-2 text-[11px] text-ink-faint">Référence à suivre</figcaption>
          </figure>
        )}

        <p className="mt-3 text-[11px] text-ink-faint">
          Demandé par {request.requestedByName ?? "l’équipe"}
        </p>
      </div>

      {/*
        Le dépôt reste ouvert après une livraison : une nouvelle version se
        dépose au même endroit, sans avoir à rouvrir la commande.
      */}
      <div className="border-t bg-[#fbfcfe] p-5">
        {delivered && request.mediaUrl && (
          <div className="mb-4 overflow-hidden rounded-xl border border-line bg-white">
            {request.mediaKind === "video" ? (
              <video src={request.mediaUrl} controls className="max-h-56 w-full bg-black object-contain"/>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={request.mediaUrl} alt={request.mediaFileName ?? request.title} className="max-h-56 w-full object-contain"/>
            )}
            <p className="truncate border-t px-3 py-2 text-[11px] text-ink-faint">{request.mediaFileName}</p>
          </div>
        )}

        <div
          role="presentation"
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-[#1468ff] bg-[#f0f6ff]" : "border-line bg-white hover:bg-canvas"}`}
        >
          <Icon name="layers" className="mx-auto h-5 w-5 text-ink-faint"/>
          <p className="mt-2 text-xs font-semibold">
            {delivered ? "Déposer une nouvelle version" : `Glissez ${request.kind === "video" ? "la vidéo" : "le fichier"} ici`}
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">ou cliquez pour choisir un fichier</p>
          <input
            ref={inputRef}
            type="file"
            accept={KIND_ACCEPT[request.kind]}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) deliver(file);
              event.target.value = "";
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {delivered ? (
            <>
              <span className="badge bg-[#fff4e5] text-[#8a5700]">En attente de validation</span>
              {request.isMine && (
                <>
                  <button type="button" className="btn-primary" disabled={pending} onClick={onValidate}>
                    <Icon name="check" className="h-4 w-4"/>Valider
                  </button>
                  <button type="button" className="text-xs text-ink-faint hover:underline" disabled={pending} onClick={onReopen}>
                    Renvoyer en production
                  </button>
                </>
              )}
            </>
          ) : (
            <span className="badge bg-canvas text-ink-soft">À produire</span>
          )}

          {request.isMine && (
            <button
              type="button"
              className="ml-auto text-xs text-state-changes hover:underline"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Retirer la commande « ${request.title} » ?`)) onDelete();
              }}
            >
              Retirer
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
