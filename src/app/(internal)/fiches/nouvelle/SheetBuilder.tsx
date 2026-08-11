"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createSheet, type SheetActionResult } from "./actions";
import { isoWeekStart } from "@/lib/domain/deadline";
import {
  isoWeekIdentity,
  selectHashtags,
  publicationDatesForWeek,
  weeklyFormatsForCadence,
  type MonthlyCadence,
} from "@/lib/domain/planning";
import { mediaFrameBackground, mediaFrameClass } from "@/lib/domain/media-frame";
import { PostPreview } from "@/components/PostPreview";
import {
  MEDIA_FORMAT_LABELS,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  type SocialNetwork,
  type MediaFormat,
  type PublicationType,
} from "@/lib/domain/types";
import { Icon } from "@/components/Icon";
import { uploadMediaDirect } from "@/lib/media/direct-upload";
import { formatBytes } from "@/lib/domain/media-retention";

interface ClientPreset {
  id: string;
  name: string;
  defaultNetworks: string[];
  defaultHashtags: string[];
  publicationWeekdays: number[];
  monthlyCadence: MonthlyCadence;
  /** Phrase répétée en fin de chaque publication, préremplie dans le texte. */
  postSignature: string;
}

interface DraftItem {
  key: string;
  scheduledDate: string;
  scheduledTime: string;
  format: MediaFormat;
  caption: string;
  hashtags: string;
  /*
   * Le média part vers Supabase dès le dépôt, sans passer par le serveur : une
   * fonction Vercel refuse tout corps de requête au-delà de 4,5 Mo, ce qu'une
   * vidéo dépasse systématiquement. On ne conserve donc ici que l'identifiant
   * du média déjà stocké.
   */
  mediaAssetId: string | null;
  mediaName: string | null;
  mediaStatus: "vide" | "preparation" | "envoi" | "enregistrement" | "pret" | "erreur";
  mediaError: string | null;
  mediaSaving: string | null;
  mediaPercent: number | null;
  mediaRemaining: number | null;
  /** Aperçu local du fichier déposé, avant tout aller-retour serveur. */
  mediaPreviewUrl: string | null;
  mediaPreviewKind: "image" | "video" | null;
}

const EMPTY_MEDIA = {
  mediaAssetId: null,
  mediaName: null,
  mediaStatus: "vide",
  mediaError: null,
  mediaSaving: null,
  mediaPercent: null,
  mediaRemaining: null,
  mediaPreviewUrl: null,
  mediaPreviewKind: null,
} satisfies Pick<
  DraftItem,
  "mediaAssetId" | "mediaName" | "mediaStatus" | "mediaError" | "mediaSaving" | "mediaPercent" | "mediaRemaining"
  | "mediaPreviewUrl" | "mediaPreviewKind"
>;

/**
 * Texte de départ d'une publication : deux retours à la ligne puis la
 * signature du client. Le curseur se place en haut du champ, le community
 * manager rédige au-dessus, et reste libre de retirer la signature.
 */
function signatureBlock(signature: string): string {
  const trimmed = signature.trim();
  return trimmed ? `\n\n${trimmed}` : "";
}

/** La signature préremplie seule ne compte pas comme un texte rédigé. */
function hasWrittenCaption(caption: string, signature: string): boolean {
  const written = caption.replace(signature.trim(), "").trim();
  return written.length > 0;
}

function publicationTypeForFormat(format: MediaFormat): PublicationType {
  switch (format) {
    case "reels": return "reel";
    case "story": return "story";
    case "video": return "video";
    case "carrousel": return "carousel";
    default: return "post";
  }
}

function mediaAccept(format: MediaFormat): string {
  if (["video", "reels"].includes(format)) return "video/mp4,video/quicktime,video/webm";
  // Une story se tourne en vidéo comme en photo : on accepte les deux.
  if (format === "story") return "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm";
  if (format === "texte_seul") return "";
  return "image/jpeg,image/png,image/webp,image/heic";
}

const MEDIA_STATUS_LABEL: Record<DraftItem["mediaStatus"], string> = {
  vide: "",
  preparation: "Compression…",
  envoi: "Envoi en cours…",
  enregistrement: "Finalisation…",
  pret: "Média prêt",
  erreur: "Échec",
};

function createDraftItems(client: ClientPreset, isoYear: number, isoWeek: number): DraftItem[] {
  const formats = weeklyFormatsForCadence(client.monthlyCadence, isoWeek);
  /*
   * Dates préremplies sur les jours de publication de la fiche client. Elles
   * restent modifiables : le préremplissage évite la saisie répétitive, il ne
   * la remplace pas.
   */
  const dates = publicationDatesForWeek(
    formats.length,
    client.publicationWeekdays,
    isoWeekStart(isoYear, isoWeek),
  );

  return formats.map((format, index) => ({
    key: `${client.id}-${isoYear}-${isoWeek}-${format}-${index}`,
    scheduledDate: dates[index] ?? "",
    scheduledTime: "18:00",
    format,
    // La signature est posée en bas du texte : le community manager rédige
    // au-dessus, et reste libre de la retirer publication par publication.
    caption: signatureBlock(client.postSignature),
    hashtags: selectHashtags(client.defaultHashtags, `${client.id}-${isoYear}-${isoWeek}-${index}`).join(" "),
    ...EMPTY_MEDIA,
  }));
}

function MediaDropzone({ item, onFile }: { item: DraftItem; onFile: (file: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  const requiresMedia = item.format !== "texte_seul";
  if (!requiresMedia) return <p className="rounded-xl bg-canvas px-4 py-3 text-xs text-ink-faint">Aucun média nécessaire pour un texte seul.</p>;

  const isVideo = ["video", "reels"].includes(item.format);
  const expected = item.format === "story"
    ? "une photo ou une vidéo"
    : isVideo
      ? "une vidéo MP4, MOV ou WEBM"
      : "une photo JPG, PNG, WEBP ou HEIC";
  const busy = ["preparation", "envoi", "enregistrement"].includes(item.mediaStatus);
  const ready = item.mediaStatus === "pret";
  const failed = item.mediaStatus === "erreur";

  const preview = item.mediaPreviewUrl && (
    <span className={`mb-3 block w-full max-w-[132px] overflow-hidden rounded-xl border border-line ${mediaFrameBackground(item.format)}`}>
      <span className={`block ${mediaFrameClass(item.format)}`}>
        {item.mediaPreviewKind === "video"
          ? <video src={item.mediaPreviewUrl} muted playsInline preload="metadata" className="block h-full w-full object-contain"/>
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={item.mediaPreviewUrl} alt="" className="block h-full w-full object-contain"/>}
      </span>
    </span>
  );

  const border = dragging
    ? "border-[#1468ff] bg-[#edf4ff]"
    : failed
      ? "border-state-changes/50 bg-state-changes/5"
      : ready
        ? "border-state-approved/50 bg-state-approved/5"
        : "border-[#cdd5df] bg-canvas hover:border-[#8bb5ff] hover:bg-[#f5f9ff]";

  return (
    <label
      aria-busy={busy}
      className={`group flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center transition-[border-color,background-color,transform] duration-150 active:scale-[.99] ${border}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onFile(event.dataTransfer.files[0] ?? null);
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={mediaAccept(item.format)}
        disabled={busy}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
      {preview}
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${ready ? "bg-state-approved/10 text-state-approved" : failed ? "bg-state-changes/10 text-state-changes" : "bg-white text-[#0759e6] shadow-sm"}`}>
        <Icon name={ready ? "check" : "upload"} className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`}/>
      </span>
      <strong className="mt-2 max-w-full truncate text-xs">
        {busy
          ? item.mediaStatus === "envoi" && item.mediaPercent !== null
            ? `Envoi ${item.mediaPercent} %`
            : MEDIA_STATUS_LABEL[item.mediaStatus]
          : item.mediaName ?? `Déposer ${expected}`}
      </strong>

      {/* Une barre qui avance vaut mieux qu'une attente muette sur une vidéo. */}
      {item.mediaStatus === "envoi" && item.mediaPercent !== null && (
        <span className="mt-2 block h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-[#dbe4f0]">
          <span
            className="block h-full rounded-full bg-[#1468ff] transition-[width] duration-200"
            style={{ width: `${item.mediaPercent}%` }}
          />
        </span>
      )}

      <span className="mt-1 text-[11px] text-ink-faint">
        {failed
          ? item.mediaError
          : item.mediaSaving
            ? item.mediaSaving
            : busy
              ? "Vous pouvez continuer à rédiger pendant l’envoi."
              : `Glisser-déposer ou cliquer · ${isVideo ? "200 Mo" : "15 Mo"} maximum`}
      </span>
    </label>
  );
}

export function SheetBuilder({
  clients,
  preselectedClientId,
  preselectedIsoYear,
  preselectedIsoWeek,
}: {
  clients: ClientPreset[];
  preselectedClientId: string | null;
  preselectedIsoYear?: number;
  preselectedIsoWeek?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<SheetActionResult | null>(null);
  const defaultWeek = useMemo(() => {
    const nextWeekDate = new Date();
    nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
    return isoWeekIdentity(nextWeekDate);
  }, []);
  const [isoYear] = useState(preselectedIsoYear ?? defaultWeek.year);
  const [isoWeek] = useState(preselectedIsoWeek ?? defaultWeek.week);
  const initialClient = clients.find((client) => client.id === preselectedClientId) ?? clients[0]!;
  const [selectedClientId, setSelectedClientId] = useState(initialClient.id);
  const activeClient =
    clients.find((client) => client.id === selectedClientId) ?? initialClient;
  const [selectedNetworks, setSelectedNetworks] = useState<SocialNetwork[]>(
    initialClient.defaultNetworks.filter((network): network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork)),
  );
  const [items, setItems] = useState<DraftItem[]>(() => createDraftItems(initialClient, isoYear, isoWeek));

  const monday = useMemo(() => isoWeekStart(isoYear, isoWeek), [isoYear, isoWeek]);
  const dayOffset = (offset: number) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const resolvedItems = items.map((item, index) => ({ ...item, scheduledDate: item.scheduledDate || dayOffset(Math.min(index * 2, 6)) }));
  const totalRequirements = resolvedItems.reduce((total, item) => total + (item.format === "texte_seul" ? 2 : 3), 0);
  const completedRequirements = resolvedItems.reduce((total, item) => total
    + Number(hasWrittenCaption(item.caption, activeClient.postSignature))
    + Number(Boolean(item.hashtags.trim()))
    + Number(item.format !== "texte_seul" && Boolean(item.mediaAssetId)), 0);
  const progress = totalRequirements ? Math.round((completedRequirements / totalRequirements) * 100) : 0;
  const periodLabel = `${dayOffset(0)} → ${dayOffset(6)}`;

  const update = (key: string, patch: Partial<DraftItem>) => setItems((currentItems) =>
    currentItems.map((item) => item.key === key ? { ...item, ...patch } : item),
  );

  // Un blob non libéré retient le fichier entier en mémoire, ce qui pèse vite
  // avec plusieurs vidéos : on relâche tous les aperçus au démontage.
  /*
   * Aperçu ouvert par publication : on rédige en voyant le visuel déposé,
   * plutôt qu'à l'aveugle au-dessus d'un nom de fichier.
   */
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});
  const localPreviews = useRef<string[]>([]);
  useEffect(() => () => { for (const url of localPreviews.current) URL.revokeObjectURL(url); }, []);

  /**
   * Le fichier part vers Supabase dès le dépôt, sans attendre l'enregistrement
   * de la fiche : c'est ce qui permet d'accepter une vidéo, et l'utilisateur
   * peut continuer à rédiger pendant l'envoi.
   */
  const handleMedia = async (key: string, file: File | null) => {
    if (!file) {
      update(key, EMPTY_MEDIA);
      return;
    }

    // Seules les images sont préparées ; une vidéo part directement à l'envoi.
    // L'aperçu, lui, est affiché tout de suite depuis le fichier local.
    const previewUrl = URL.createObjectURL(file);
    localPreviews.current.push(previewUrl);
    update(key, {
      ...EMPTY_MEDIA,
      mediaName: file.name,
      mediaStatus: file.type.startsWith("video/") ? "envoi" : "preparation",
      mediaPreviewUrl: previewUrl,
      mediaPreviewKind: file.type.startsWith("video/") ? "video" : "image",
    });

    let result;
    try {
      result = await uploadMediaDirect({
      file,
      clientId: selectedClientId,
      sheetId: null,
      onProgress: (step) => update(key, { mediaStatus: step }),
        onUploadProgress: (percent, _bytes, remaining) =>
          update(key, { mediaPercent: percent, mediaRemaining: remaining }),
      });
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Envoi interrompu." };
    }

    if (!result.ok) {
      update(key, {
        ...EMPTY_MEDIA,
        mediaName: file.name,
        mediaStatus: "erreur",
        mediaPreviewUrl: previewUrl,
        mediaPreviewKind: file.type.startsWith("video/") ? "video" : "image",
        mediaError: result.message ?? "Envoi impossible.",
      });
      return;
    }

    const saved =
      result.originalBytes && result.finalBytes && result.finalBytes < result.originalBytes
        ? `${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}`
        : null;

    update(key, {
      mediaAssetId: result.mediaAssetId ?? null,
      mediaName: file.name,
      mediaStatus: "pret",
      mediaError: null,
      mediaSaving: saved,
    });
  };

  const selectClient = (clientId: string) => {
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;
    setSelectedClientId(clientId);
    const networks = client.defaultNetworks.filter((network): network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork));
    setSelectedNetworks(networks.length ? networks : ["instagram", "facebook"]);
    setItems(createDraftItems(client, isoYear, isoWeek));
  };

  const addPublication = () => {
    const client = clients.find((candidate) => candidate.id === selectedClientId) ?? initialClient;
    setItems((currentItems) => [...currentItems, {
      key: `manual-${Date.now()}`,
      scheduledDate: "",
      scheduledTime: "18:00",
      format: "photo",
      caption: signatureBlock(client.postSignature),
      hashtags: selectHashtags(client.defaultHashtags, `${client.id}-${isoYear}-${isoWeek}-${currentItems.length}`).join(" "),
      ...EMPTY_MEDIA,
    }]);
  };

  return (
    <form
      action={(formData) => {
        formData.set("items", JSON.stringify(resolvedItems.map((item) => ({
          scheduledDate: item.scheduledDate,
          scheduledTime: item.scheduledTime,
          publicationType: publicationTypeForFormat(item.format),
          format: item.format,
          caption: item.caption,
          hashtags: item.hashtags,
          mediaAssetId: item.mediaAssetId,
        }))));
        startTransition(async () => {
          try {
            const result = await createSheet(formData);
            setFeedback(result);
            if (result.ok && result.sheetId) router.push(`/fiches/${result.sheetId}`);
          } catch {
            setFeedback({
              ok: false,
              message: "L’enregistrement a été interrompu. Rechargez la page puis réessayez.",
            });
          }
        });
      }}
      className="space-y-5"
    >
      {feedback?.message && !feedback.ok && <p className="rounded-md border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">{feedback.message}</p>}

      <div className="card overflow-hidden">
        <div className="flex flex-col items-start gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><p className="eyebrow">Fiche préprogrammée</p><h2 className="mt-1 font-semibold">Cadre de la semaine</h2></div>
          <span className="rounded-full bg-[#edf4ff] px-3 py-1 text-xs font-semibold text-[#0759e6]">{periodLabel}</span>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" className="field" value={selectedClientId} onChange={(event) => selectClient(event.target.value)}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          <div>
            <span className="label">Semaine</span>
            <div className="field flex items-center bg-canvas text-sm font-medium">Semaine {isoWeek} · {isoYear}</div>
            <input type="hidden" name="isoWeek" value={isoWeek}/><input type="hidden" name="isoYear" value={isoYear}/>
          </div>
        </div>
      </div>

      <fieldset className="card p-5">
        <legend className="eyebrow px-1">Réseaux de diffusion</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SOCIAL_NETWORKS.map((network) => (
            <label key={network} className="choice-chip">
              <input type="checkbox" name="networks" value={network} checked={selectedNetworks.includes(network)} onChange={(event) => setSelectedNetworks((currentNetworks) => event.target.checked ? [...currentNetworks, network] : currentNetworks.filter((value) => value !== network))}/>
              {SOCIAL_NETWORK_LABELS[network]}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-4">
        <div className="card sticky top-3 z-10 overflow-hidden p-4 shadow-[0_8px_30px_rgba(31,41,55,.08)] sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="eyebrow">Avancement</p><h2 className="mt-1 font-semibold">Préparation de la semaine prochaine</h2></div>
            <span className={`text-lg font-bold tracking-[-.03em] ${progress === 100 ? "text-state-approved" : "text-[#0759e6]"}`}>{progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`${progress}% de la fiche complétée`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span className={`block h-full origin-left rounded-full transition-transform duration-300 ${progress === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${progress / 100})` }}/>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Pour atteindre 100 %, chaque contenu doit avoir son texte, ses hashtags et son média.</p>
        </div>

        <div className="space-y-3">
          {resolvedItems.map((item, index) => {
            const itemComplete = hasWrittenCaption(item.caption, activeClient.postSignature) && Boolean(item.hashtags.trim()) && (item.format === "texte_seul" || Boolean(item.mediaAssetId));
            return (
              <article key={item.key} className="card reveal-panel space-y-4 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold ${itemComplete ? "bg-state-approved/10 text-state-approved" : "bg-[#edf4ff] text-[#0759e6]"}`}>{itemComplete ? <Icon name="check" className="h-4 w-4"/> : index + 1}</span>
                    <div className="min-w-0"><h3 className="truncate text-sm font-semibold">Publication {index + 1} · {MEDIA_FORMAT_LABELS[item.format]}</h3><p className="text-xs text-ink-faint">{itemComplete ? "Contenu complet" : "Texte et média à préparer"}</p></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className={`min-h-11 px-2 text-xs font-semibold hover:underline ${previewing[item.key] ? "text-[#0759e6]" : "text-ink-faint"}`}
                      aria-expanded={Boolean(previewing[item.key])}
                      onClick={() => setPreviewing((current) => ({ ...current, [item.key]: !current[item.key] }))}
                    >
                      {previewing[item.key] ? "Masquer l’aperçu" : "Aperçu"}
                    </button>
                    {items.length > 1 && <button type="button" className="min-h-11 px-2 text-xs text-state-changes hover:underline" onClick={() => setItems((currentItems) => currentItems.filter((candidate) => candidate.key !== item.key))}>Retirer</button>}
                  </div>
                </div>

                {previewing[item.key] && (
                  <div className="reveal-panel rounded-2xl bg-canvas p-4">
                    <PostPreview
                      clientName={activeClient.name}
                      format={item.format}
                      mediaUrl={item.mediaPreviewUrl}
                      mediaKind={item.mediaPreviewKind}
                      caption={item.caption}
                      hashtags={item.hashtags}
                    />
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <input type="date" className="field" aria-label={`Date de la publication ${index + 1}`} value={item.scheduledDate} onChange={(event) => update(item.key, { scheduledDate: event.target.value })}/>
                  <input type="time" className="field" aria-label={`Heure de la publication ${index + 1}`} value={item.scheduledTime} onChange={(event) => update(item.key, { scheduledTime: event.target.value })}/>
                  <select className="field" aria-label={`Format de la publication ${index + 1}`} value={item.format} onChange={(event) => update(item.key, { format: event.target.value as MediaFormat, ...EMPTY_MEDIA })}>
                    {Object.entries(MEDIA_FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,.8fr)]">
                  <div className="space-y-3">
                    <div><label className="label" htmlFor={`caption-${item.key}`}>Texte de la publication</label><textarea id={`caption-${item.key}`} rows={5} className="field" placeholder="Écrivez librement le texte à publier…" value={item.caption} onChange={(event) => update(item.key, { caption: event.target.value })}/></div>
                    <div><label className="label" htmlFor={`hashtags-${item.key}`}>Hashtags sélectionnés automatiquement</label><textarea id={`hashtags-${item.key}`} rows={2} className="field" value={item.hashtags} onChange={(event) => update(item.key, { hashtags: event.target.value })}/><p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint"><Icon name="layers" className="h-3.5 w-3.5 text-[#0759e6]"/>Sélection variée issue des 20 hashtags enregistrés dans le dossier client.</p></div>
                  </div>
                  <div><span className="label">Média prévu · {MEDIA_FORMAT_LABELS[item.format]}</span><MediaDropzone item={item} onFile={(file) => handleMedia(item.key, file)}/></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <button type="button" className="btn-secondary" onClick={addPublication}><Icon name="plus" className="h-4 w-4"/>Ajouter une publication</button>
        <button type="submit" className="btn-primary" disabled={pending || selectedNetworks.length === 0}>{pending ? "Enregistrement…" : progress === 100 ? "Enregistrer la fiche complète" : "Enregistrer et continuer plus tard"}<Icon name="arrow" className="h-4 w-4"/></button>
      </div>
    </form>
  );
}
