"use client";

import { useState, type ReactNode } from "react";

type ProductionTab = "overview" | "detail";

export function ProductionTabs({ overview, detail, detailAlertCount = 0 }: { overview: ReactNode; detail: ReactNode; /** Commandes ou corrections en retard : affiché sur l'onglet sans qu'il faille l'ouvrir. */ detailAlertCount?: number }) {
  const [active, setActive] = useState<ProductionTab>("overview");

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-[#e9eff6] p-1.5 shadow-inner" role="tablist" aria-label="Vue de production">
        <button
          type="button"
          role="tab"
          id="production-tab-overview"
          aria-selected={active === "overview"}
          aria-controls="production-panel-overview"
          className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors duration-200 ${active === "overview" ? "bg-white text-[#0b4f88] shadow-[0_4px_14px_rgba(34,72,112,.12)]" : "text-ink-faint hover:bg-white/55 hover:text-ink-soft"}`}
          onClick={() => setActive("overview")}
        >
          Vue d’ensemble
        </button>
        <button
          type="button"
          role="tab"
          id="production-tab-detail"
          aria-selected={active === "detail"}
          aria-controls="production-panel-detail"
          className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors duration-200 ${active === "detail" ? "bg-white text-[#0b4f88] shadow-[0_4px_14px_rgba(34,72,112,.12)]" : "text-ink-faint hover:bg-white/55 hover:text-ink-soft"}`}
          onClick={() => setActive("detail")}
        >
          Commandes &amp; corrections
          {detailAlertCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-state-changes px-1.5 text-[10px] font-bold text-white">{detailAlertCount}</span>
          )}
        </button>
      </div>

      <div id="production-panel-overview" role="tabpanel" aria-labelledby="production-tab-overview" hidden={active !== "overview"} className="reveal-panel">
        {overview}
      </div>
      <div id="production-panel-detail" role="tabpanel" aria-labelledby="production-tab-detail" hidden={active !== "detail"} className="reveal-panel">
        {detail}
      </div>
    </section>
  );
}
