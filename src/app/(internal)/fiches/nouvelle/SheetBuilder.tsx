"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createSheet, type SheetActionResult } from "./actions";
import { isoWeekStart } from "@/lib/domain/deadline";
import {
  MEDIA_FORMAT_LABELS,
  PUBLICATION_TYPE_LABELS,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  type MediaFormat,
  type PublicationType,
} from "@/lib/domain/types";

interface DraftItem {
  key: string;
  scheduledDate: string;
  scheduledTime: string;
  publicationType: PublicationType;
  format: MediaFormat;
  caption: string;
  hashtags: string;
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
  clients: { id: string; name: string }[];
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
      publicationType: "post" as PublicationType,
      format: "photo" as MediaFormat,
      caption: "",
      hashtags: "",
    })),
  );

  // Les dates suivent la semaine choisie tant qu'elles n'ont pas été modifiées.
  const resolvedItems = items.map((item, index) => ({
    ...item,
    scheduledDate: item.scheduledDate || dayOffset(Math.min(index, 6)),
  }));

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const periodLabel = `${monday.toISOString().slice(0, 10)} → ${dayOffset(6)}`;

  return (
    <form
      action={(formData) => {
        formData.set(
          "items",
          JSON.stringify(
            resolvedItems.map((i) => ({
              scheduledDate: i.scheduledDate,
              scheduledTime: i.scheduledTime,
              publicationType: i.publicationType,
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

      <div className="card grid gap-4 p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="clientId">
            Client
          </label>
          <select
            id="clientId"
            name="clientId"
            className="field"
            defaultValue={preselectedClientId ?? clients[0]?.id}
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
        <p className="text-xs text-ink-faint sm:col-span-3">Période : {periodLabel}</p>
      </div>

      <fieldset className="card p-4">
        <legend className="label">Réseaux</legend>
        <div className="flex flex-wrap gap-3">
          {SOCIAL_NETWORKS.map((network) => (
            <label key={network} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="networks"
                value={network}
                defaultChecked={network === "instagram" || network === "facebook"}
              />
              {SOCIAL_NETWORK_LABELS[network]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3">
        {resolvedItems.map((item, index) => (
          <div key={item.key} className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Publication {index + 1}</span>
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

            <div className="grid gap-3 sm:grid-cols-4">
              <input
                type="date"
                className="field"
                value={item.scheduledDate}
                onChange={(e) => update(item.key, { scheduledDate: e.target.value })}
              />
              <input
                type="time"
                className="field"
                value={item.scheduledTime}
                onChange={(e) => update(item.key, { scheduledTime: e.target.value })}
              />
              <select
                className="field"
                value={item.publicationType}
                onChange={(e) =>
                  update(item.key, { publicationType: e.target.value as PublicationType })
                }
              >
                {Object.entries(PUBLICATION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="field"
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
              placeholder="Rédaction — texte de la publication"
              value={item.caption}
              onChange={(e) => update(item.key, { caption: e.target.value })}
            />
            <input
              className="field"
              placeholder="#Guinguette #Montauban #TarnEtGaronne"
              value={item.hashtags}
              onChange={(e) => update(item.key, { hashtags: e.target.value })}
            />
          </div>
        ))}
      </div>

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
                publicationType: "post",
                format: "photo",
                caption: "",
                hashtags: "",
              },
            ])
          }
        >
          Ajouter une publication
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Création…" : "Créer la fiche"}
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        Les visuels se déposent ensuite depuis la fiche. Le lien client ne peut être
        généré qu&apos;une fois la fiche prête.
      </p>
    </form>
  );
}
