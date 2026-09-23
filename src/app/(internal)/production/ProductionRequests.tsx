"use client";

import { useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import type { ProductionUrgency } from "@/lib/domain/production";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { uploadMediaDirect } from "@/lib/media/direct-upload";
import {
  BOARD_SORT_LABELS,
  EMPTY_BOARD_FILTERS,
  inBoardScope,
  matchesBoardFilters,
  sortBoard,
  type BoardFilters,
  type BoardScope,
  type BoardSort,
} from "@/lib/domain/production-board";
import { UNKNOWN_PERSON_KEY } from "@/lib/domain/production-requests";
import {
  assignProductionRequest,
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
  /** Date de la commande : sert au tri « plus récentes d'abord ». */
  createdAt: string;
  /** Instant de la dernière livraison, ou null. */
  deliveredAt: string | null;
  status: "a_faire" | "livree" | "validee";
  /** Nom de la personne qui a passé la commande. */
  requestedByName: string | null;
  /** La commande a-t-elle été passée par la personne connectée ? */
  isMine: boolean;
  /** Personne de production à qui la commande est confiée. */
  assignedToId: string | null;
  /** Son prénom, tel qu'affiché dans le menu « Confier à ». */
  assigneeLabel: string | null;
  /** La commande est-elle confiée à la personne connectée ? */
  assignedToViewer: boolean;
  /*
   * Droits, calculés une seule fois côté serveur par `productionRequestRights`
   * — le même module que les six actions serveur. L'écran n'invente aucune
   * règle : il n'affiche que des boutons qui aboutiront.
   */
  /** Demandeur, affectataire ou encadrement : la carte n'est pas en lecture seule. */
  isConcerned: boolean;
  canDeliver: boolean;
  canValidate: boolean;
  canReopen: boolean;
  canDelete: boolean;
  canReassign: boolean;
  mediaUrl: string | null;
  mediaFileName: string | null;
  mediaKind: string | null;
  /** Un fichier a été livré — même quand le lecteur n'a pas le droit de le voir. */
  hasMedia: boolean;
  /** Un visuel d'exemple a été joint — même quand il reste invisible. */
  hasReference: boolean;
  /** Visuel d'exemple joint à la demande : une inspiration, pas un modèle. */
  referenceUrl: string | null;
  /*
   * Urgence de l'échéance, calculée une seule fois côté serveur par
   * `productionUrgency` : la carte, le sous-menu et la pastille de navigation
   * doivent dire la même chose.
   */
  urgency: ProductionUrgency;
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

const STATUS_FILTERS: { value: BoardFilters["status"]; label: string }[] = [
  { value: "", label: "Tous les états" },
  { value: "a_faire", label: "À produire" },
  { value: "livree", label: "En attente de validation" },
];

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", day: "numeric", month: "long", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatMoment(instant: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", timeZone: "Europe/Paris",
  }).format(new Date(instant));
}

/**
 * Commandes de production internes.
 *
 * Une demande interne n'est pas un ticket client : il n'y a ni client à
 * recontacter, ni revalidation à obtenir — juste un fichier attendu par un
 * collègue, avant une date. D'où un écran court : la commande, le dépôt, la
 * validation.
 *
 * La file porte désormais les commandes de toute l'agence : chacun voit ce que
 * produisent les autres et ce qui part en retard ailleurs. Ce qui ne le
 * concerne pas se lit sans un seul bouton — et se classe, sans quoi une liste
 * complète cesse d'être utilisable.
 */
export function ProductionRequests({
  requests,
  clients,
  canRequest,
  assignees,
  viewerProduces,
}: {
  requests: ProductionRequestRow[];
  clients: { id: string; name: string }[];
  canRequest: boolean;
  /** Personnes de production actives, par prénom. Vide : la demande part sans destinataire. */
  assignees: { id: string; label: string }[];
  /** La personne connectée produit-elle ? Sa vue s'ouvre alors sur ce qui lui est confié. */
  viewerProduces: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ProductionActionResult | null>(null);
  const [open, setOpen] = useState(false);
  /*
   * Exemple : envoyé directement au stockage, pas à travers l'action.
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
      setFeedback({ ok: false, message: result.message ?? "Exemple non envoyé." });
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

  // Les commandes validées sont closes : le serveur ne les envoie déjà plus.
  const active = useMemo(() => requests.filter((request) => request.status !== "validee"), [requests]);
  const awaitingValidation = active.filter((request) => request.status === "livree");
  const forViewer = active.filter((request) => request.assignedToViewer);
  const mine = active.filter((request) => request.isMine);
  const unassigned = active.filter((request) => request.status === "a_faire" && !request.assignedToId);
  const overdue = active.filter((request) => request.urgency === "overdue");

  /*
   * Vue d'ouverture : ce qui appelle un geste de la personne qui regarde. Celui
   * qui produit ouvre sur ce qui lui est confié, celui qui commande sur ses
   * propres demandes. La vue « toute l'agence » reste un choix explicite :
   * l'élargissement ne doit pas noyer la liste de ceux qui s'en servent chaque
   * jour.
   */
  const [scope, setScope] = useState<BoardScope>(
    viewerProduces && forViewer.length > 0 ? "pour_vous" : mine.length > 0 ? "mes_demandes" : "toutes",
  );
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_BOARD_FILTERS);
  const [sort, setSort] = useState<BoardSort>("echeance");
  const setFilter = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const filtering = Boolean(filters.query.trim() || filters.clientId || filters.person || filters.status);

  /*
   * Les pastilles comptent ce qu'elles ouvrent : la barre de filtres s'applique
   * avant elles, sinon « En retard · 4 » pourrait rendre une liste vide sans
   * qu'on voie le filtre, deux lignes plus haut, qui l'a vidée.
   */
  const matching = useMemo(
    () => active.filter((request) => matchesBoardFilters(request, filters)),
    [active, filters],
  );

  const shown = useMemo(
    () => sortBoard(matching.filter((request) => inBoardScope(request, scope)), sort),
    [matching, scope, sort],
  );

  // Menus déroulants : seulement ce que la file contient réellement.
  const clientOptions = useMemo(() => {
    const byId = new Map(active.map((request) => [request.clientId, request.clientName]));
    return [...byId].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [active]);

  const personOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const request of active) {
      if (request.assignedToId) byKey.set(request.assignedToId, request.assigneeLabel ?? "Ancien membre");
    }
    const people = [...byKey].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return unassigned.length > 0
      ? [...people, { value: UNKNOWN_PERSON_KEY, label: "Non confiée" }]
      : people;
  }, [active, unassigned.length]);

  // Les pastilles restent affichées selon ce que contient la file, mais comptent ce qui est filtré.
  const chipCount = (key: BoardScope) => matching.filter((request) => inBoardScope(request, key)).length;
  const chips: { key: BoardScope; label: string; count: number; alert?: boolean }[] = [
    { key: "pour_vous", label: "Pour vous", count: chipCount("pour_vous") },
    { key: "mes_demandes", label: "Mes demandes", count: chipCount("mes_demandes") },
    ...(unassigned.length > 0 || scope === "a_confier"
      ? [{ key: "a_confier" as const, label: "À confier", count: chipCount("a_confier") }]
      : []),
    ...(overdue.length > 0 || scope === "en_retard"
      ? [{ key: "en_retard" as const, label: "En retard", count: chipCount("en_retard"), alert: true }]
      : []),
    { key: "toutes", label: "Toutes", count: matching.length },
  ];

  const emptyLabel = filtering
    ? "Aucune commande ne correspond à ces filtres."
    : scope === "pour_vous" ? "Aucune commande ne vous est confiée."
    : scope === "mes_demandes" ? "Vous n’avez aucune commande en cours."
    : scope === "a_confier" ? "Toutes les commandes sont confiées."
    : scope === "en_retard" ? "Aucune commande en retard."
    : "Aucune commande interne en cours.";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Commandes internes</h2>
          <p className="mt-1 text-xs text-ink-faint">
            {active.length === 0
              ? "Aucune commande en cours."
              : `${active.length} en cours${forViewer.length > 0 ? ` · ${forViewer.length} pour vous` : ""}${awaitingValidation.length > 0 ? ` · ${awaitingValidation.length} en attente de validation` : ""}`}
          </p>
          {scope === "toutes" && active.some((request) => !request.isConcerned) && (
            <p className="mt-1 text-xs text-ink-faint">
              Toute la production de l’agence. Vous n’agissez que sur les commandes qui vous concernent.
            </p>
          )}
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

          <div className={`grid gap-4 ${assignees.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div>
              <label className="label" htmlFor="request-client">Client concerné</label>
              {/* Les clients qu'on suit, et eux seuls : on ne commande pas pour l'équipe d'à côté. */}
              <select id="request-client" name="clientId" required className="field" value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="" disabled>Choisir un client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>
            {/*
              Aucun choix par défaut : confier une commande est une décision,
              pas un réglage qu'on laisse passer sans le voir.
            */}
            {assignees.length > 0 && (
              <div>
                <label className="label" htmlFor="request-assignee">Confier à</label>
                <select id="request-assignee" name="assignedTo" required defaultValue="" className="field">
                  <option value="" disabled>Choisir…</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>{person.label}</option>
                  ))}
                </select>
              </div>
            )}
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
            Un exemple vaut mieux qu'un paragraphe : « comme la story de la
            semaine dernière, mais plus sobre » suppose que l'autre l'ait sous
            les yeux.
          */}
          <div>
            <label className="label" htmlFor="request-reference">
              Visuel d&apos;exemple ou d&apos;inspiration <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <input type="hidden" name="referenceMediaId" value={reference?.id ?? ""}/>
            {reference ? (
              <div className="mt-1 flex items-center gap-3 rounded-xl border border-line bg-white p-2">
                <span className="block w-[72px] overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reference.previewUrl} alt="Exemple joint" className="block aspect-square w-full object-cover"/>
                </span>
                <span className="text-xs text-ink-soft">Exemple joint</span>
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
                ? "Envoi de l’exemple…"
                : "Une image qui donne l’idée : ambiance, cadrage, mise en page. Elle inspire, elle n’est pas à reproduire."}
            </p>
          </div>

          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Envoi…" : "Envoyer à la production"}
          </button>
        </form>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les commandes">
          {chips.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={scope === item.key}
              onClick={() => setScope(item.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                scope === item.key ? "bg-[#1176d3] text-white"
                : item.alert ? "bg-state-changes/10 text-state-changes ring-1 ring-state-changes/20 hover:bg-state-changes/15"
                : "bg-white text-ink-soft ring-1 ring-line hover:bg-canvas"
              }`}
            >
              {item.label} · {item.count}
            </button>
          ))}
        </div>
      )}

      {/*
        Classer : même barre que la liste des fiches — une recherche, des menus.
        Elle n'apparaît que quand il y a de quoi trier.
      */}
      {active.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"/>
            <input
              type="search"
              className="field pl-9"
              placeholder="Chercher un client, une commande…"
              value={filters.query}
              onChange={(event) => setFilter("query", event.target.value)}
              aria-label="Chercher un client ou une commande"
            />
          </div>
          {clientOptions.length > 1 && (
            <select
              className="field w-auto shrink-0"
              value={filters.clientId}
              onChange={(event) => setFilter("clientId", event.target.value)}
              aria-label="Filtrer par client"
            >
              <option value="">Tous les clients</option>
              {clientOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          {personOptions.length > 1 && (
            <select
              className="field w-auto shrink-0"
              value={filters.person}
              onChange={(event) => setFilter("person", event.target.value)}
              aria-label="Filtrer par personne"
            >
              <option value="">Tout le monde</option>
              {personOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          <select
            className="field w-auto shrink-0"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value as BoardFilters["status"])}
            aria-label="Filtrer par état"
          >
            {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select
            className="field w-auto shrink-0"
            value={sort}
            onChange={(event) => setSort(event.target.value as BoardSort)}
            aria-label="Trier la liste"
          >
            {Object.entries(BOARD_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {shown.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              pending={pending}
              assignees={assignees}
              onAssign={(assigneeId) => run(() => assignProductionRequest(request.id, assigneeId))}
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

/** Aperçu du fichier livré. Affiché seulement quand le serveur a signé une URL. */
function DeliveredPreview({ request, className = "" }: { request: ProductionRequestRow; className?: string }) {
  if (!request.mediaUrl) return null;
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-white ${className}`}>
      {request.mediaKind === "video" ? (
        <video src={request.mediaUrl} controls className="max-h-56 w-full bg-black object-contain"/>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={request.mediaUrl} alt={request.mediaFileName ?? request.title} className="max-h-56 w-full object-contain"/>
      )}
      <p className="truncate border-t px-3 py-2 text-[11px] text-ink-faint">{request.mediaFileName}</p>
    </div>
  );
}

function RequestCard({
  request,
  pending,
  assignees,
  onAssign,
  onDeliver,
  onValidate,
  onReopen,
  onDelete,
}: {
  request: ProductionRequestRow;
  pending: boolean;
  assignees: { id: string; label: string }[];
  onAssign: (assigneeId: string) => void;
  onDeliver: (formData: FormData) => void;
  onValidate: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const delivered = request.status === "livree";
  /*
   * Une carte qui n'appelle aucun geste n'a pas de pied gris : c'est l'écart le
   * plus lisible entre « à vous de jouer » et « pour information ». Rien n'est
   * grisé pour autant — une carte grise se lit « annulée », et un retard doit
   * se voir de tout le monde.
   */
  const canAct = request.canDeliver || request.canValidate || request.canReopen || request.canDelete;

  const [sending, setSending] = useState(false);

  /*
   * Envoi direct au stockage, puis l'identifiant à l'action. Faire transiter le
   * fichier par l'action butait sur le plafond du corps de requête : une vidéo
   * de montage échouait systématiquement.
   */
  const deliver = async (file: File) => {
    setSending(true);
    const result = await uploadMediaDirect({ file, clientId: request.clientId, sheetId: null });
    setSending(false);
    if (!result.ok || !result.mediaAssetId) {
      window.alert(result.message ?? "Envoi impossible.");
      return;
    }
    const formData = new FormData();
    formData.set("requestId", request.id);
    formData.set("mediaAssetId", result.mediaAssetId);
    onDeliver(formData);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void deliver(file);
  };

  const statusBadge = delivered
    ? <span className="badge bg-[#fff4e5] text-[#8a5700]">En attente de validation</span>
    : <span className="badge bg-canvas text-ink-soft">À produire</span>;

  // Livré sans aperçu : le fichier appartient au client, il reste dans son équipe.
  const hiddenDelivery = delivered && request.hasMedia && !request.mediaUrl;

  return (
    <li className={`card overflow-hidden ${
      request.urgency === "overdue" ? "border-state-changes/40"
      : request.urgency === "due_tomorrow" ? "border-state-progress/40" : ""
    }`}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="badge bg-[#f1edff] text-[#6f50c9]">{KIND_LABELS[request.kind]}</span>
              <strong className="truncate text-sm">{request.clientName}</strong>
              {/* Mêmes mots que les corrections clients : « Pour vous », « À confier ». */}
              {request.assignedToViewer ? (
                <span className="badge shrink-0 bg-[#e8f2ff] text-[#0b5e9f]">Pour vous</span>
              ) : !request.isConcerned ? (
                <span className="badge shrink-0 bg-canvas text-ink-faint" title="Commande d’une autre équipe : vous la consultez">
                  Lecture
                </span>
              ) : request.status === "a_faire" && !request.assignedToId ? (
                <span className="badge shrink-0 bg-[#fff4e5] text-[#8a5700]">À confier</span>
              ) : null}
            </div>
            <h3 className="mt-2 text-sm font-semibold leading-snug">{request.title}</h3>
          </div>
          {/*
            L'échéance de demain se distingue du retard : l'une se rattrape
            encore, l'autre non. Les confondre dans un même rouge ferait
            renoncer à ce qui est encore tenable.
          */}
          <span className={`badge shrink-0 ${
            request.urgency === "overdue" ? "bg-state-changes/10 text-state-changes"
            : request.urgency === "due_tomorrow" ? "bg-state-progress/10 text-state-progress"
            : "bg-canvas text-ink-soft"
          }`}>
            {request.urgency === "overdue" ? "En retard · "
              : request.urgency === "due_tomorrow" ? "Demain · " : ""}
            {formatDay(request.dueOn)}
          </span>
        </div>

        {request.brief && (
          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-ink-soft">{request.brief}</p>
        )}

        {request.referenceUrl ? (
          <figure className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={request.referenceUrl} alt="Visuel d’exemple" className="block max-h-40 w-full object-contain"/>
            <figcaption className="border-t px-3 py-2 text-[11px] text-ink-faint">Exemple donné à la demande — pour l’idée, pas à reproduire</figcaption>
          </figure>
        ) : request.hasReference ? (
          <p className="mt-3 text-[11px] text-ink-faint">Exemple joint — visible par l’équipe du client.</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-faint">
          <span>Demandé par {request.requestedByName ?? "l’équipe"}</span>
          {/* « Pour vous » et « À confier » sont déjà dits en tête de carte. */}
          {request.canReassign && assignees.length > 0 ? (
            <label className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">·</span>
              <span>Confiée à</span>
              <select
                aria-label={`Confier la commande « ${request.title} » à`}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink"
                value={request.assignedToId ?? ""}
                disabled={pending}
                onChange={(event) => { if (event.target.value) onAssign(event.target.value); }}
              >
                <option value="" disabled>À confier</option>
                {/* Personne qui ne produit plus : gardée affichée, plus proposée. */}
                {request.assignedToId && !assignees.some((person) => person.id === request.assignedToId) && (
                  <option value={request.assignedToId} disabled>{request.assigneeLabel ?? "Ancien membre"}</option>
                )}
                {assignees.map((person) => (
                  <option key={person.id} value={person.id}>{person.label}</option>
                ))}
              </select>
            </label>
          ) : request.assigneeLabel && !request.assignedToViewer ? (
            <span>· Pour {request.assigneeLabel}</span>
          ) : null}
          {delivered && request.deliveredAt && <span>· Livré le {formatMoment(request.deliveredAt)}</span>}
        </div>

        {/* Carte en lecture : l'état se dit en une ligne, et rien ne se clique. */}
        {!canAct && (
          <div className="mt-4 space-y-2">
            <DeliveredPreview request={request}/>
            <div className="flex flex-wrap items-center gap-2">{statusBadge}</div>
            {hiddenDelivery && (
              <p className="text-[11px] text-ink-faint">Fichier livré — visible par l’équipe du client.</p>
            )}
          </div>
        )}
      </div>

      {/*
        Le dépôt reste ouvert après une livraison : une nouvelle version se
        dépose au même endroit, sans avoir à rouvrir la commande.
      */}
      {canAct && (
        <div className="border-t bg-[#fbfcfe] p-5">
          <DeliveredPreview request={request} className="mb-4"/>

          {request.canDeliver && (
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
                {/*
                  L'envoi d'un montage prend du temps : le dire, sinon on croit
                  l'écran figé et on dépose une seconde fois.
                */}
                {sending
                  ? "Envoi du fichier…"
                  : delivered ? "Déposer une nouvelle version" : `Glissez ${request.kind === "video" ? "la vidéo" : "le fichier"} ici`}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">ou cliquez pour choisir un fichier</p>
              <input
                ref={inputRef}
                type="file"
                accept={KIND_ACCEPT[request.kind]}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void deliver(file);
                  event.target.value = "";
                }}
              />
            </div>
          )}

          <div className={`flex flex-wrap items-center gap-2 ${request.canDeliver ? "mt-4" : ""}`}>
            {statusBadge}
            {request.canValidate && (
              <button type="button" className="btn-primary" disabled={pending} onClick={onValidate}>
                <Icon name="check" className="h-4 w-4"/>Valider
              </button>
            )}
            {request.canReopen && (
              <button type="button" className="text-xs text-ink-faint hover:underline" disabled={pending} onClick={onReopen}>
                Renvoyer en production
              </button>
            )}

            {request.canDelete && (
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

          {hiddenDelivery && (
            <p className="mt-2 text-[11px] text-ink-faint">Fichier livré — visible par l’équipe du client.</p>
          )}
        </div>
      )}
    </li>
  );
}
