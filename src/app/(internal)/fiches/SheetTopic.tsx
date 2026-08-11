"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { setSheetTopic } from "./topic-actions";

/**
 * Encart « sujet de la semaine », posé sur la carte du planning.
 *
 * La production a besoin de savoir quoi raconter avant de produire. Tant que
 * le sujet manque, la carte le signale : c'est le seul moyen de s'apercevoir
 * qu'une semaine part sans consigne, ce qui ne se voyait nulle part.
 */
export function SheetTopic({ sheetId, initialTopic }: { sheetId: string; initialTopic: string | null }) {
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [saved, setSaved] = useState(initialTopic ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = saved.trim() === "";

  const save = () => {
    startTransition(async () => {
      const result = await setSheetTopic(sheetId, topic);
      if (result.ok) {
        setSaved(topic.trim());
        setEditing(false);
        setError(null);
      } else {
        setError(result.message ?? "Enregistrement impossible.");
      }
    });
  };

  if (!editing) {
    return (
      <div className={`mt-3 rounded-xl border px-3 py-2.5 ${missing ? "border-state-changes/40 bg-state-changes/5" : "border-line bg-canvas"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-[.12em] ${missing ? "text-state-changes" : "text-ink-faint"}`}>
              Sujet de la semaine
            </p>
            {missing ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-state-changes">
                <Icon name="message" className="h-3.5 w-3.5"/>
                À renseigner — la production ne sait pas quoi préparer.
              </p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{saved}</p>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-[#0759e6] hover:underline"
            onClick={() => { setTopic(saved); setEditing(true); }}
          >
            {missing ? "Ajouter" : "Modifier"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[#bfd4ff] bg-[#f8fbff] px-3 py-2.5">
      <label className="text-[10px] font-semibold uppercase tracking-[.12em] text-ink-faint" htmlFor={`topic-${sheetId}`}>
        Sujet de la semaine
      </label>
      <textarea
        id={`topic-${sheetId}`}
        rows={2}
        maxLength={300}
        className="field mt-1.5 bg-white text-xs"
        placeholder="Ex. Lancement de la carte d’automne, mise en avant de la terrasse."
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        autoFocus
      />
      {error && <p className="mt-1 text-[11px] text-state-changes" role="alert">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={pending} onClick={save}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          className="text-xs text-ink-faint hover:underline"
          disabled={pending}
          onClick={() => { setTopic(saved); setEditing(false); setError(null); }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
