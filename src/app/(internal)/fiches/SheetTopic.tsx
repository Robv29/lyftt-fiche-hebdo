"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { SheetTopicEditState } from "@/lib/domain/sheet-status";
import { setSheetTopic } from "./topic-actions";

/**
 * Encart « sujet de la semaine », posé sur la carte du planning et en tête de
 * la fiche.
 *
 * La production a besoin de savoir quoi raconter avant de produire. Tant que
 * le sujet manque, la carte le signale : c'est le seul moyen de s'apercevoir
 * qu'une semaine part sans consigne, ce qui ne se voyait nulle part.
 *
 * Le sujet se corrige tant que la fiche vit — semaine en cours, fiche envoyée,
 * fiche validée. Il ne se fige pas avec la validation du client parce qu'il
 * n'en fait pas partie : c'est une note interne, jamais montrée au client.
 * `state` porte cette nuance (voir `sheetTopicEditState`), et l'écran la dit
 * au moment où elle pourrait tromper : juste avant d'enregistrer.
 *
 * `alertWhenEmpty` distingue une semaine encore à produire — un sujet manquant
 * y est une alerte — d'une semaine passée, où réclamer une consigne pour un
 * travail déjà fait ne serait qu'un faux signal de plus.
 */
export function SheetTopic({
  sheetId,
  initialTopic,
  state,
  alertWhenEmpty = true,
}: {
  sheetId: string;
  initialTopic: string | null;
  state: SheetTopicEditState;
  alertWhenEmpty?: boolean;
}) {
  const server = initialTopic ?? "";
  const [topic, setTopic] = useState(server);
  const [saved, setSaved] = useState(server);
  const [seen, setSeen] = useState(server);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Le sujet a changé côté serveur depuis l'affichage — autre personne, autre
   * onglet — et la page vient d'être rafraîchie : l'encart doit montrer ce que
   * la base contient. Sinon « Modifier » rouvrirait sur un texte périmé et
   * l'enregistrement effacerait la consigne de l'autre sans rien dire. Une
   * saisie en cours n'est jamais écrasée.
   */
  if (!editing && server !== seen) {
    setSeen(server);
    setSaved(server);
    setTopic(server);
  }

  const empty = saved.trim() === "";
  const locked = state === "locked";
  const alert = empty && alertWhenEmpty && !locked;

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
      <div className={`rounded-xl border px-3 py-2.5 ${alert ? "border-state-changes/40 bg-state-changes/5" : "border-line bg-canvas"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-[.12em] ${alert ? "text-state-changes" : "text-ink-faint"}`}>
              Sujet de la semaine
            </p>
            {alert ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-state-changes">
                <Icon name="message" className="h-3.5 w-3.5"/>
                À renseigner — la production ne sait pas quoi préparer.
              </p>
            ) : empty ? (
              <p className="mt-1 text-xs text-ink-faint">Aucun sujet noté.</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{saved}</p>
            )}
            {locked && (
              <p className="mt-1 text-[11px] text-ink-faint">
                Fiche refusée ou périmée : son sujet n&apos;est plus modifiable.
              </p>
            )}
          </div>
          {!locked && (
            <button
              type="button"
              className="shrink-0 text-xs font-semibold text-[#0759e6] hover:underline"
              onClick={() => { setTopic(saved); setEditing(true); }}
            >
              {empty ? "Ajouter" : "Modifier"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#bfd4ff] bg-[#f8fbff] px-3 py-2.5">
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
      {/* La fiche est partie chez le client : dire tout de suite qu'elle n'est pas en jeu. */}
      {state === "internal_notice" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          Consigne interne : le client ne voit pas le sujet, le modifier ne touche pas à la fiche qu&apos;il a reçue.
        </p>
      )}
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
