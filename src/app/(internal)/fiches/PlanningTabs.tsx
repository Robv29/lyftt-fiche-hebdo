"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

type PlanningTab = "past" | "current" | "next";

const TABS: Array<{
  id: PlanningTab;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
}> = [
  { id: "past", label: "Passé", shortLabel: "Passé", icon: "clock", description: "Historique des semaines terminées, de la plus récente à la plus ancienne." },
  { id: "current", label: "Cette semaine", shortLabel: "Cette semaine", icon: "calendar", description: "Les fiches incomplètes et les modifications de priorité haute apparaissent en premier." },
  { id: "next", label: "Semaine prochaine", shortLabel: "Prochaine", icon: "layers", description: "Les fiches préprogrammées à préparer pour chaque client actif." },
];

export function PlanningTabs({
  counts,
  past,
  current,
  next,
}: {
  counts: Record<PlanningTab, number>;
  past: ReactNode;
  current: ReactNode;
  next: ReactNode;
}) {
  const [active, setActive] = useState<PlanningTab>("current");
  const content = { past, current, next }[active];
  const activeTab = TABS.find((tab) => tab.id === active)!;

  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === active);
    const target = TABS[(index + direction + TABS.length) % TABS.length]!;
    setActive(target.id);
    document.getElementById(`planning-tab-${target.id}`)?.focus();
  };

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-[#edf0f4] p-1.5 shadow-inner" role="tablist" aria-label="Période du planning">
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
              className={`group flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[.98] sm:min-h-16 sm:px-4 sm:text-sm ${selected ? "bg-white text-ink shadow-[0_2px_10px_rgba(31,41,55,.10)]" : "text-ink-faint hover:bg-white/45 hover:text-ink-soft"}`}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") move(event, -1);
                if (event.key === "ArrowRight") move(event, 1);
              }}
            >
              <Icon name={tab.icon} className={`hidden h-4 w-4 shrink-0 sm:block ${selected ? "text-[#0759e6]" : ""}`}/>
              <span className="min-w-0 truncate"><span className="sm:hidden">{tab.shortLabel}</span><span className="hidden sm:inline">{tab.label}</span></span>
              <span className={`grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[10px] ${selected ? "bg-[#e6efff] text-[#0759e6]" : "bg-white/55 text-ink-faint"}`}>{counts[tab.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 px-1">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4ff] text-[#0759e6]"><Icon name={activeTab.icon} className="h-4 w-4"/></span>
        <div><h2 className="font-semibold">{activeTab.label}</h2><p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{activeTab.description}</p></div>
      </div>

      <div key={active} id={`planning-panel-${active}`} role="tabpanel" aria-labelledby={`planning-tab-${active}`} className="reveal-panel">
        {content}
      </div>
    </section>
  );
}
