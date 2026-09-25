"use client";

import { useState, type ReactNode } from "react";

type ProductionTab = "overview" | "detail" | "calendar";

/**
 * Les trois lectures d'un même plan de charge : ce que chaque client attend
 * cette semaine, la file de ce qu'il y a à produire, et le calendrier de
 * quand.
 *
 * L'onglet actif reste dans l'état du composant : la pagination de la vue
 * d'ensemble passe par l'URL (`?week=`) et toute navigation ferait retomber le
 * lecteur ici. Le calendrier pagine donc, lui aussi, sans quitter la page.
 */
const TABS: { key: ProductionTab; label: string; short: string }[] = [
  { key: "overview", label: "Vue d’ensemble", short: "Semaine" },
  { key: "detail", label: "Commandes & corrections", short: "File" },
  { key: "calendar", label: "Calendrier", short: "Agenda" },
];

export function ProductionTabs({
  overview,
  detail,
  calendar,
  detailAlertCount = 0,
}: {
  overview: ReactNode;
  detail: ReactNode;
  calendar: ReactNode;
  /** Commandes ou corrections en retard : affiché sur l'onglet sans qu'il faille l'ouvrir. */
  detailAlertCount?: number;
}) {
  const [active, setActive] = useState<ProductionTab>("overview");
  const panels: Record<ProductionTab, ReactNode> = { overview, detail, calendar };

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-[#e9eff6] p-1.5 shadow-inner" role="tablist" aria-label="Vue de production">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`production-tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`production-panel-${tab.key}`}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition-colors duration-200 sm:px-3 ${active === tab.key ? "bg-white text-[#0b4f88] shadow-[0_4px_14px_rgba(34,72,112,.12)]" : "text-ink-faint hover:bg-white/55 hover:text-ink-soft"}`}
            onClick={() => setActive(tab.key)}
          >
            {/* Trois intitulés français ne tiennent pas côte à côte sur un téléphone. */}
            <span className="sm:hidden">{tab.short}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.key === "detail" && detailAlertCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-state-changes px-1.5 text-[10px] font-bold text-white">{detailAlertCount}</span>
            )}
          </button>
        ))}
      </div>

      {TABS.map((tab) => (
        <div
          key={tab.key}
          id={`production-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`production-tab-${tab.key}`}
          hidden={active !== tab.key}
          className="reveal-panel"
        >
          {panels[tab.key]}
        </div>
      ))}
    </section>
  );
}
