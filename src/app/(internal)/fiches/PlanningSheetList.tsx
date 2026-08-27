"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { CONTENT_BUCKETS, type ContentBucket } from "@/lib/domain/content-buckets";
import type { BucketStatus } from "@/lib/domain/planning";
import { SheetTopic } from "./SheetTopic";

export type PlanningEntry =
  | {
      kind: "sheet";
      id: string;
      href: string;
      clientName: string;
      isoWeek: number;
      periodLabel: string;
      statusLabel: string;
      validated: boolean;
      urgent: boolean;
      percentage: number;
      completed: number;
      total: number;
      /** État par famille de contenu : dit *quoi* manque, là où le pourcentage ne dit que *combien*. */
      buckets: Record<ContentBucket, BucketStatus>;
      /** Sujet de la semaine, modifiable sur place — seulement affiché si `showTopic`. */
      topic: string | null;
    }
  | {
      kind: "proposal";
      id: string;
      href: string;
      clientName: string;
      summary: string;
      percentage: number;
    };

type SortOption = "default" | "name" | "complete" | "incomplete";

const SORT_LABELS: Record<SortOption, string> = {
  default: "Ordre par défaut",
  name: "Client (A→Z)",
  complete: "Complet d'abord",
  incomplete: "À compléter d'abord",
};

/** Recherche insensible aux accents et à la casse : « aneto » doit trouver « Ánetô ». */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function ProgressBar({ percentage, label }: { percentage: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px] font-medium">
        <span className="text-ink-faint">{label}</span>
        <span className={percentage === 100 ? "text-state-approved" : "text-[#0759e6]"}>{percentage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`${label} : ${percentage}%`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <span className={`block h-full origin-left rounded-full transition-transform duration-300 ${percentage === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${percentage / 100})` }}/>
      </div>
    </div>
  );
}

/**
 * Familles de contenu d'une fiche, en pastilles.
 *
 * Le pourcentage dit combien il reste à faire, jamais quoi : une fiche à 60 %
 * peut attendre une vidéo comme trois légendes. Chaque famille présente sur la
 * fiche prend donc sa couleur — pleine quand elle est prête, cerclée et barrée
 * d'un « ! » quand il y manque quelque chose.
 *
 * Les familles absentes de la fiche ne sont pas affichées : une pastille grise
 * « pas de story cette semaine » n'apprend rien et encombre une petite carte.
 * Mêmes couleurs et mêmes états que la vue Production, pour qu'un même symbole
 * ne veuille pas dire deux choses selon l'écran.
 */
function BucketDots({ buckets }: { buckets: Record<ContentBucket, BucketStatus> }) {
  const shown = CONTENT_BUCKETS.filter((bucket) => buckets[bucket.key] !== "none");
  if (shown.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {shown.map((bucket) => {
        const ready = buckets[bucket.key] === "ready";
        return (
          <span
            key={bucket.key}
            title={`${bucket.label} : ${ready ? "prêt" : "à compléter"}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={
              ready
                ? { background: bucket.accent, borderColor: bucket.accent, color: "#fff" }
                : { background: bucket.bg, borderColor: bucket.accent, color: bucket.text }
            }
          >
            <Icon name={ready ? "check" : "warning"} className="h-3 w-3"/>
            {bucket.label}
          </span>
        );
      })}
      <span className="sr-only">
        {shown.filter((bucket) => buckets[bucket.key] !== "ready").length === 0
          ? "Toutes les familles de contenu sont prêtes."
          : `À compléter : ${shown.filter((bucket) => buckets[bucket.key] !== "ready").map((bucket) => bucket.label).join(", ")}.`}
      </span>
    </div>
  );
}

/**
 * Liste de fiches (ou de propositions) avec recherche et tri.
 *
 * Retrouver un client demandait de défiler toute la liste : la recherche
 * filtre par nom, le tri fait remonter le complet ou l'incomplet selon ce
 * qu'on cherche à ce moment-là.
 */
export function PlanningSheetList({
  entries,
  emptyLabel,
  showProgress = false,
  showTopic = false,
}: {
  entries: PlanningEntry[];
  emptyLabel: string;
  showProgress?: boolean;
  showTopic?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("default");

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    const matched = needle ? entries.filter((entry) => normalize(entry.clientName).includes(needle)) : entries;
    if (sort === "default") return matched;
    const sorted = [...matched];
    if (sort === "name") sorted.sort((a, b) => a.clientName.localeCompare(b.clientName, "fr"));
    if (sort === "complete") sorted.sort((a, b) => b.percentage - a.percentage);
    if (sort === "incomplete") sorted.sort((a, b) => a.percentage - b.percentage);
    return sorted;
  }, [entries, query, sort]);

  if (entries.length === 0) {
    return <p className="card px-4 py-6 text-center text-sm text-ink-faint">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"/>
            <input
              type="search"
              className="field pl-9"
              placeholder="Chercher un client…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Chercher un client"
            />
          </div>
          <select className="field w-auto shrink-0" value={sort} onChange={(event) => setSort(event.target.value as SortOption)} aria-label="Trier la liste">
            {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-ink-faint">Aucun client ne correspond à « {query.trim()} ».</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {filtered.map((entry) => entry.kind === "sheet" ? (
            <li key={entry.id} className={`card lift-card overflow-hidden ${entry.validated ? "border-state-approved/40 bg-[#f6fdf9]" : entry.urgent ? "ring-2 ring-state-changes/20" : ""}`}>
              <Link href={entry.href} className="block p-4 hover:bg-canvas sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{entry.clientName}</h3>
                      {entry.validated && <span className="badge gap-1 bg-[#e8f8f1] text-state-approved"><Icon name="check" className="h-3 w-3"/>Validée par le client</span>}
                      {!entry.validated && entry.urgent && <span className="badge bg-state-changes/10 text-state-changes">Modification haute</span>}
                      {!entry.validated && !entry.urgent && entry.percentage < 100 && <span className="badge bg-[#fff7e6] text-[#8a5700]">À compléter</span>}
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">Semaine {entry.isoWeek} · {entry.periodLabel}</p>
                  </div>
                  <Icon name="arrow" className="mt-1 h-4 w-4 shrink-0 text-ink-faint"/>
                </div>

                <BucketDots buckets={entry.buckets}/>

                {showProgress && entry.percentage < 100 && (
                  <div className="mt-4"><ProgressBar percentage={entry.percentage} label="Préparation de la fiche"/></div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                  <span className={entry.validated ? "font-semibold text-state-approved" : "text-ink-soft"}>{entry.statusLabel}</span>
                  {/* Le pourcentage s'affiche sur toutes les cartes, y compris à 100 % : son absence
                      se lisait comme une donnée manquante plutôt que comme une fiche terminée. */}
                  <span className={entry.percentage === 100 ? "font-semibold text-state-approved" : "text-ink-faint"}>
                    <strong className={entry.percentage === 100 ? "" : "text-[#0759e6]"}>{entry.percentage} %</strong>
                    {entry.percentage === 100 ? " · fiche complète" : ` · ${entry.completed}/${entry.total} éléments prêts`}
                  </span>
                </div>
              </Link>

              {/* Hors du lien : le sujet se saisit sur place, sans ouvrir la fiche. */}
              {showTopic && <div className="px-4 pb-4 sm:px-5 sm:pb-5"><SheetTopic sheetId={entry.id} initialTopic={entry.topic}/></div>}
            </li>
          ) : (
            <li key={entry.id} className="card reveal-panel overflow-hidden border-[#bfd4ff] bg-[#f8fbff]">
              <Link href={entry.href} className="block p-4 hover:bg-[#f0f6ff] sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="badge bg-[#dbeafe] text-[#0759e6]">Fiche proposée</span>
                    <h3 className="mt-2 truncate text-sm font-semibold">{entry.clientName}</h3>
                    <p className="mt-1 text-xs text-ink-faint">{entry.summary} · hashtags déjà sélectionnés</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#0759e6] shadow-sm"><Icon name="arrow" className="h-4 w-4"/></span>
                </div>
                <div className="mt-4"><ProgressBar percentage={entry.percentage} label="Préparation préremplie"/></div>
                <div className="mt-4 border-t border-[#dbe7fb] pt-3 text-xs font-semibold text-[#0759e6]">Remplir la fiche préprogrammée</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
