"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  familyForKind,
  groupEventsByDay,
  HISTORY_FAMILIES,
  validationDelayHours,
  type HistoryEventKind,
  type HistoryFamily,
  type WeekHistory,
} from "@/lib/domain/history";

/** Une couleur par nature : l'œil distingue un envoi d'un retour sans lire. */
const EVENT_TONES: Record<HistoryEventKind, { dot: string; chip: string }> = {
  sheet_sent: { dot: "#1176d3", chip: "bg-[#e8f2ff] text-[#0b5e9f]" },
  sheet_resent: { dot: "#6d28d9", chip: "bg-[#f1eaff] text-[#6d28d9]" },
  reminder: { dot: "#e5484d", chip: "bg-[#ffedef] text-[#ce3540]" },
  client_feedback: { dot: "#f5a524", chip: "bg-[#fff4e0] text-[#a15c00]" },
  feedback_resolved: { dot: "#14b8a6", chip: "bg-[#e0f7fa] text-[#0e7490]" },
  special_request: { dot: "#ec4899", chip: "bg-[#ffe4ef] text-[#be185d]" },
  production_requested: { dot: "#8b5cf6", chip: "bg-[#f1eaff] text-[#6d28d9]" },
  production_delivered: { dot: "#0e7490", chip: "bg-[#e0f7fa] text-[#0e7490]" },
  approved: { dot: "#128359", chip: "bg-[#e8f8f1] text-[#128359]" },
  published: { dot: "#64748b", chip: "bg-[#eef1f6] text-[#475569]" },
};

const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
const dayShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

/**
 * Chronologie filtrable.
 *
 * Un historique se lit rarement en entier : on cherche « les retours de ce
 * client » ou « ce qui est sorti ce mois-ci ». Les familles filtrent, le sens
 * de lecture se retourne, et le compte affiché dit toujours ce qui est montré
 * — sans quoi un filtre actif se confond avec un client sans activité.
 */
export function HistoryView({ weeks, clientName }: { weeks: WeekHistory[]; clientName: string }) {
  const [families, setFamilies] = useState<HistoryFamily[]>([]);
  const [newestFirst, setNewestFirst] = useState(true);

  const toggle = (family: HistoryFamily) =>
    setFamilies((current) =>
      current.includes(family) ? current.filter((f) => f !== family) : [...current, family],
    );

  const visible = useMemo(() => {
    const kept = weeks
      .map((week) => ({
        ...week,
        events: families.length === 0
          ? week.events
          : week.events.filter((event) => families.includes(familyForKind(event.kind))),
      }))
      .filter((week) => week.events.length > 0);

    return newestFirst ? kept : [...kept].reverse();
  }, [weeks, families, newestFirst]);

  const shown = visible.reduce((n, week) => n + week.events.length, 0);
  const total = weeks.reduce((n, week) => n + week.events.length, 0);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        {HISTORY_FAMILIES.map((family) => {
          const active = families.includes(family.key);
          return (
            <button
              key={family.key}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(family.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? "bg-[#1176d3] text-white" : "bg-canvas text-ink-soft hover:bg-[#e8f2ff] hover:text-[#0b5e9f]"
              }`}
            >
              {family.label}
            </button>
          );
        })}

        {families.length > 0 && (
          <button type="button" className="text-xs font-semibold text-[#0b63ad] hover:underline" onClick={() => setFamilies([])}>
            Tout afficher
          </button>
        )}

        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-[#e8f2ff] hover:text-[#0b5e9f]"
          onClick={() => setNewestFirst((v) => !v)}
        >
          <Icon name="arrow" className={`h-3.5 w-3.5 transition-transform ${newestFirst ? "rotate-90" : "-rotate-90"}`}/>
          {newestFirst ? "Plus récent d’abord" : "Plus ancien d’abord"}
        </button>
      </div>

      {/* Le compte doit dire ce qui est montré : un filtre actif ressemble sinon à un client sans activité. */}
      <p className="text-xs text-ink-faint">
        {shown === total
          ? `${total} événement${total > 1 ? "s" : ""}`
          : `${shown} événement${shown > 1 ? "s" : ""} affiché${shown > 1 ? "s" : ""} sur ${total}`}
      </p>

      {visible.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          {total === 0
            ? `Aucun événement enregistré pour ${clientName}.`
            : "Aucun événement ne correspond à ce filtre."}
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((week) => {
            const delay = validationDelayHours(week);
            const retours = week.events.filter((e) => e.kind === "client_feedback").length;
            const days = groupEventsByDay(week.events, newestFirst);

            return (
              <section key={week.sheetId} className="history-week section-card">
                <div className="section-card-header flex-wrap gap-y-2">
                  <div className="min-w-0">
                    <p className="eyebrow">Semaine {week.isoWeek}</p>
                    <h2 className="mt-1 font-semibold">
                      {dayShort.format(new Date(`${week.periodStart}T12:00:00Z`))}
                      {" — "}
                      {dayShort.format(new Date(`${week.periodEnd}T12:00:00Z`))}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {retours > 0 && <span className="badge bg-[#fff4e0] text-[#a15c00]">{retours} retour{retours > 1 ? "s" : ""}</span>}
                    {delay !== null
                      ? <span className="badge bg-[#e8f8f1] text-state-approved">Validée en {delay} h</span>
                      : <span className="badge bg-canvas text-ink-faint">Pas de validation</span>}
                    <Link href={`/fiches/${week.sheetId}`} className="no-print text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">
                      Ouvrir →
                    </Link>
                  </div>
                </div>

                <div className="divide-y divide-line">
                  {days.map((day) => (
                    <div key={day.day} className="px-5 py-3">
                      {/* Le jour est le repère ; l'heure seule reste sur chaque ligne. */}
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        {dayLabel.format(new Date(`${day.day}T12:00:00Z`))}
                      </p>
                      <ol className="history-timeline mt-2">
                        {day.events.map((event, index) => {
                          const tone = EVENT_TONES[event.kind];
                          return (
                            <li key={`${event.kind}-${event.at}-${index}`} className="history-event">
                              <span className="history-dot" style={{ background: tone.dot }}/>
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}>
                                    {event.label}
                                  </span>
                                  <span className="text-xs tabular-nums text-ink-faint">{time.format(new Date(event.at))}</span>
                                </p>
                                {event.detail && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{event.detail}</p>}
                                {event.dueAt && (
                                  <p className="mt-0.5 text-xs text-ink-faint">
                                    Échéance : {event.dueAt.length <= 10
                                      ? dayShort.format(new Date(`${event.dueAt}T12:00:00Z`))
                                      : `${dayShort.format(new Date(event.dueAt))} à ${time.format(new Date(event.dueAt))}`}
                                  </p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
