"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

export type PlanningTab = "past" | "current" | "next";
const TAB_IDS: readonly PlanningTab[] = ["past", "current", "next"];

export function isPlanningTab(value: string | undefined): value is PlanningTab {
  return TAB_IDS.includes(value as PlanningTab);
}

export interface PlanningValidation {
  validated: number;
  total: number;
  percentage: number;
}

const TABS: Array<{
  id: PlanningTab;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  /** Période couverte par l'indicateur de validation, en tête d'écran. */
  scope: string;
}> = [
  { id: "past", label: "Passé", shortLabel: "Passé", icon: "clock", description: "Historique des semaines terminées, de la plus récente à la plus ancienne.", scope: "Semaine passée." },
  { id: "current", label: "Cette semaine", shortLabel: "Cette semaine", icon: "calendar", description: "Les fiches incomplètes et les modifications de priorité haute apparaissent en premier.", scope: "Semaine en cours." },
  { id: "next", label: "Semaine prochaine", shortLabel: "Prochaine", icon: "layers", description: "Les fiches préprogrammées à préparer pour chaque client actif.", scope: "Semaine prochaine." },
];

export function PlanningTabs({
  counts,
  validation,
  toCreate,
  initialTab,
  past,
  current,
  next,
}: {
  counts: Record<PlanningTab, number>;
  /** Taux de validation propre à chaque période. */
  validation: Record<PlanningTab, PlanningValidation>;
  /** Fiches de la semaine prochaine restant à créer. */
  toCreate: number;
  /** Onglet lu depuis `?tab=` côté serveur : évite `useSearchParams` (et son Suspense). */
  initialTab: PlanningTab;
  past: ReactNode;
  current: ReactNode;
  next: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  /*
   * L'onglet vit aussi dans l'URL, pas seulement dans ce state : sans ça,
   * revenir en arrière depuis une fiche ouverte depuis « Semaine prochaine »
   * ramenait toujours sur « Cette semaine », l'onglet par défaut au montage.
   */
  const [active, setActiveState] = useState<PlanningTab>(initialTab);
  const content = { past, current, next }[active];
  const activeTab = TABS.find((tab) => tab.id === active)!;
  // L'indicateur suit l'onglet : un taux affiché sur une autre période que
  // celle qu'on regarde se lit comme une erreur.
  const rate = validation[active];

  const setActive = (tab: PlanningTab) => {
    setActiveState(tab);
    router.replace(tab === "current" ? pathname : `${pathname}?tab=${tab}`, { scroll: false });
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === active);
    const target = TABS[(index + direction + TABS.length) % TABS.length]!;
    setActive(target.id);
    document.getElementById(`planning-tab-${target.id}`)?.focus();
  };

  return (
    <section className="space-y-5">
      {rate.total > 0 ? (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${rate.percentage === 100 ? "bg-[#e8f8f1] text-state-approved" : "bg-[#e8f2ff] text-[#1176d3]"}`}>
              <Icon name="check" className="h-5 w-5"/>
            </span>
            <div>
              <strong className="text-sm">
                {rate.validated} fiche{rate.validated > 1 ? "s" : ""} validée{rate.validated > 1 ? "s" : ""} sur {rate.total}
              </strong>
              <p className="mt-1 text-xs text-ink-faint">
                {activeTab.scope} Validation explicite ou tacite ; les fiches en préparation ne sont pas comptées.
                {active === "next" && toCreate > 0 && ` ${toCreate} fiche${toCreate > 1 ? "s" : ""} reste${toCreate > 1 ? "nt" : ""} à créer.`}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-56">
            <div className="mb-2 flex justify-between text-[11px] text-ink-faint">
              <span>Taux de validation</span>
              <strong className={rate.percentage === 100 ? "text-state-approved" : "text-ink"}>{rate.percentage} %</strong>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Taux de validation : ${rate.percentage}%`} aria-valuenow={rate.percentage} aria-valuemin={0} aria-valuemax={100}>
              <span className={`block h-full origin-left rounded-full transition-transform duration-300 ${rate.percentage === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${rate.percentage / 100})` }}/>
            </div>
          </div>
        </div>
      ) : (
        <p className="card px-4 py-3 text-xs text-ink-faint">
          {activeTab.scope} Aucune fiche soumise au client sur cette période.
          {active === "next" && toCreate > 0 && ` ${toCreate} fiche${toCreate > 1 ? "s" : ""} reste${toCreate > 1 ? "nt" : ""} à créer.`}
        </p>
      )}

      <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-[#e9eff6] p-1.5 shadow-inner" role="tablist" aria-label="Période du planning">
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`planning-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`planning-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={`group flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[.98] sm:min-h-16 sm:px-4 sm:text-sm ${selected ? "bg-white text-[#0b4f88] shadow-[0_4px_14px_rgba(34,72,112,.12)]" : "text-ink-faint hover:bg-white/55 hover:text-ink-soft"}`}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") move(event, -1);
                if (event.key === "ArrowRight") move(event, 1);
              }}
            >
              <Icon name={tab.icon} className={`hidden h-4 w-4 shrink-0 sm:block ${selected ? "text-[#1176d3]" : ""}`}/>
              <span className="min-w-0 truncate"><span className="sm:hidden">{tab.shortLabel}</span><span className="hidden sm:inline">{tab.label}</span></span>
              <span className={`grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[10px] ${selected ? "bg-[#e8f2ff] text-[#0b5e9f]" : "bg-white/55 text-ink-faint"}`}>{counts[tab.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 px-1">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-[#1176d3]"><Icon name={activeTab.icon} className="h-4 w-4"/></span>
        <div><h2 className="font-semibold">{activeTab.label}</h2><p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{activeTab.description}</p></div>
      </div>

      <div key={active} id={`planning-panel-${active}`} role="tabpanel" aria-labelledby={`planning-tab-${active}`} className="reveal-panel">
        {content}
      </div>
    </section>
  );
}
