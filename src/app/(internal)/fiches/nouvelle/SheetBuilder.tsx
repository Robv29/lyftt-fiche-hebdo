"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createSheet, type SheetActionResult } from "./actions";
import { isoWeekStart } from "@/lib/domain/deadline";
import {
  MEDIA_FORMAT_LABELS,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  type SocialNetwork,
  type MediaFormat,
  type PublicationType,
} from "@/lib/domain/types";
import { Icon } from "@/components/Icon";

interface DraftItem {
  key: string;
  scheduledDate: string;
  scheduledTime: string;
  format: MediaFormat;
  caption: string;
  hashtags: string;
}

/** Le format choisi suffit à déterminer le type technique attendu en base. */
function publicationTypeForFormat(format: MediaFormat): PublicationType {
  switch (format) {
    case "reels": return "reel";
    case "video": return "video";
    case "carrousel": return "carousel";
    default: return "post";
  }
}

function hashtagsForItem(tags: string[], index: number): string {
  if (tags.length <= 8) return tags.join(" ");
  const core = tags.slice(0, 3);
  const variable = tags.slice(3);
  const rotated = [...variable.slice(index % variable.length), ...variable.slice(0, index % variable.length)];
  return [...new Set([...core, ...rotated.slice(0, 5)])].join(" ");
}

/** Semaine ISO courante, pour proposer par défaut la semaine suivante. */
function currentIsoWeek(): { year: number; week: number } {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

export function SheetBuilder({
  clients,
  preselectedClientId,
}: {
  clients: { id: string; name: string; defaultNetworks: string[]; defaultHashtags: string[]; monthlyContents: number }[];
  preselectedClientId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<SheetActionResult | null>(null);

  const nextWeek = useMemo(() => {
    const { year, week } = currentIsoWeek();
    return week >= 52 ? { year: year + 1, week: 1 } : { year, week: week + 1 };
  }, []);

  const [isoYear, setIsoYear] = useState(nextWeek.year);
  const [isoWeek, setIsoWeek] = useState(nextWeek.week);
  const initialClient = clients.find((client) => client.id === preselectedClientId) ?? clients[0];
  const [selectedClientId, setSelectedClientId] = useState(initialClient?.id ?? "");
  const [selectedNetworks, setSelectedNetworks] = useState<SocialNetwork[]>(
    (initialClient?.defaultNetworks.filter((network): network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork)) ?? ["instagram", "facebook"]),
  );

  const monday = useMemo(() => isoWeekStart(isoYear, isoWeek), [isoYear, isoWeek]);

  const dayOffset = (offset: number) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // Par défaut : une publication par jour ouvré à 18 h, comme la fiche actuelle.
  const [items, setItems] = useState<DraftItem[]>(() =>
    Array.from({ length: 5 }, (_, index) => ({
      key: `init-${index}`,
      scheduledDate: "",
      scheduledTime: "18:00",
      format: "photo" as MediaFormat,
      caption: "",
      hashtags: hashtagsForItem(initialClient?.defaultHashtags ?? [], index),
    })),
  );

  // Les dates suivent la semaine choisie tant qu'elles n'ont pas été modifiées.
  const resolvedItems = items.map((item, index) => ({
    ...item,
    scheduledDate: item.scheduledDate || dayOffset(Math.min(index, 6)),
  }));

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const resizeSchedule = (size: number, requestedHashtags?: string[]) => setItems((current) => {
    if (current.length >= size) return current.slice(0, size);
    const activeHashtags = requestedHashtags ?? clients.find((client) => client.id === selectedClientId)?.defaultHashtags ?? [];
    return [...current, ...Array.from({ length: size - current.length }, (_, index) => ({
      key: `preset-${Date.now()}-${index}`, scheduledDate:"", scheduledTime:"18:00",
      format:"photo" as MediaFormat, caption:"", hashtags:hashtagsForItem(activeHashtags, current.length + index),
    }))];
  });

  const selectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;
    const defaults = client.defaultNetworks.filter((network): network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork));
    setSelectedNetworks(defaults.length ? defaults : ["instagram", "facebook"]);
    setItems((current) => current.map((item, index) => ({ ...item, hashtags:hashtagsForItem(client.defaultHashtags, index) })));
    if (client.monthlyContents > 0) resizeSchedule(Math.max(1, Math.round(client.monthlyContents / 4)), client.defaultHashtags);
  };

  const periodLabel = `${monday.toISOString().slice(0, 10)} → ${dayOffset(6)}`;
  const completedItems = resolvedItems.filter((item) => item.caption.trim()).length;
  const progress = resolvedItems.length ? Math.round((completedItems / resolvedItems.length) * 100) : 0;

  return (
    <form
      action={(formData) => {
        formData.set(
          "items",
          JSON.stringify(
            resolvedItems.map((i) => ({
              scheduledDate: i.scheduledDate,
              scheduledTime: i.scheduledTime,
              publicationType: publicationTypeForFormat(i.format),
              format: i.format,
              caption: i.caption,
              hashtags: i.hashtags,
            })),
          ),
        );
        startTransition(async () => {
          const result = await createSheet(formData);
          setFeedback(result);
          if (result.ok && result.sheetId) router.push(`/fiches/${result.sheetId}`);
        });
      }}
      className="space-y-5"
    >
      {feedback?.message && !feedback.ok && (
        <p className="rounded-md border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">
          {feedback.message}
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4"><div><p className="eyebrow">Étape 1</p><h2 className="mt-1 font-semibold">Cadre de la semaine</h2></div><span className="rounded-full bg-[#edf4ff] px-3 py-1 text-xs font-semibold text-[#0759e6]">{periodLabel}</span></div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="clientId">
            Client
          </label>
          <select
            id="clientId"
            name="clientId"
            className="field"
            value={selectedClientId}
            onChange={(event) => selectClient(event.target.value)}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="isoWeek">
            Semaine ISO
          </label>
          <input
            id="isoWeek"
            name="isoWeek"
            type="number"
            min={1}
            max={53}
            className="field"
            value={isoWeek}
            onChange={(e) => setIsoWeek(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="isoYear">
            Année
          </label>
          <input
            id="isoYear"
            name="isoYear"
            type="number"
            min={2020}
            max={2100}
            className="field"
            value={isoYear}
            onChange={(e) => setIsoYear(Number(e.target.value))}
          />
        </div>
        </div>
      </div>

      <fieldset className="card p-5">
        <legend className="eyebrow px-1">Étape 2 · Réseaux de diffusion</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SOCIAL_NETWORKS.map((network) => (
            <label key={network} className="choice-chip">
              <input
                type="checkbox"
                name="networks"
                value={network}
                checked={selectedNetworks.includes(network)}
                onChange={(event) => setSelectedNetworks((current) => event.target.checked ? [...current, network] : current.filter((value) => value !== network))}
              />
              {SOCIAL_NETWORK_LABELS[network]}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Étape 3</p><h2 className="mt-1 text-lg font-semibold">Contenus à produire</h2><p className="mt-1 text-sm text-ink-faint">Choisissez un rythme, puis ajustez chaque publication.</p></div><div className="flex gap-2" aria-label="Rythme de publication"><button type="button" className="btn-secondary text-xs" onClick={()=>resizeSchedule(3)}>Léger · 3</button><button type="button" className="btn-secondary text-xs" onClick={()=>resizeSchedule(5)}>Standard · 5</button></div></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#e9edf3]" aria-label={`${progress}% des textes renseignés`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span className="block h-full rounded-full bg-[#1468ff] transition-[transform] duration-200" style={{ transform:`translateX(${progress - 100}%)` }}/></div>
        <div className="space-y-3">
        {resolvedItems.map((item, index) => (
          <div key={item.key} className="card reveal-panel space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#edf4ff] text-xs font-bold text-[#0759e6]">{index + 1}</span><div><span className="text-sm font-semibold">Publication {index + 1}</span><p className="text-xs text-ink-faint">{item.caption.trim() ? "Texte renseigné" : "À compléter"}</p></div></div>
              {items.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-state-changes hover:underline"
                  onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                >
                  Retirer
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="date"
                className="field"
                aria-label={`Date de la publication ${index + 1}`}
                value={item.scheduledDate}
                onChange={(e) => update(item.key, { scheduledDate: e.target.value })}
              />
              <input
                type="time"
                className="field"
                aria-label={`Heure de la publication ${index + 1}`}
                value={item.scheduledTime}
                onChange={(e) => update(item.key, { scheduledTime: e.target.value })}
              />
              <select
                className="field"
                aria-label={`Format de la publication ${index + 1}`}
                value={item.format}
                onChange={(e) => update(item.key, { format: e.target.value as MediaFormat })}
              >
                {Object.entries(MEDIA_FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              rows={3}
              className="field"
              aria-label={`Texte de la publication ${index + 1}`}
              placeholder="Rédaction — texte de la publication"
              value={item.caption}
              onChange={(e) => update(item.key, { caption: e.target.value })}
            />
            <input
              className="field"
              aria-label={`Hashtags de la publication ${index + 1}`}
              placeholder="Les hashtags recommandés du client apparaîtront ici"
              value={item.hashtags}
              onChange={(e) => update(item.key, { hashtags: e.target.value })}
            />
            <p className="-mt-2 flex items-center gap-1.5 text-xs text-ink-faint"><Icon name="spark" className="h-3.5 w-3.5 text-[#0759e6]"/>{item.hashtags ? "Sélection automatique issue du profil client — modifiable pour ce contenu." : "Ajoutez une bibliothèque de hashtags dans le dossier client."}</p>
          </div>
        ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setItems((prev) => [
              ...prev,
              {
                key: `add-${Date.now()}`,
                scheduledDate: "",
                scheduledTime: "18:00",
                format: "photo",
                caption: "",
                hashtags: hashtagsForItem(clients.find((client) => client.id === selectedClientId)?.defaultHashtags ?? [], prev.length),
              },
            ])
          }
        >
          <Icon name="plus" className="h-4 w-4"/>Ajouter une publication
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Création…" : "Créer la fiche et continuer"}<Icon name="arrow" className="h-4 w-4"/>
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        Les visuels se déposent ensuite depuis la fiche. Le lien client ne peut être
        généré qu&apos;une fois la fiche prête.
      </p>
    </form>
  );
}
