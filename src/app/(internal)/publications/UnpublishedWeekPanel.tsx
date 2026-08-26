"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Icon } from "@/components/Icon";
import { Portal } from "@/components/Portal";

export interface UnpublishedItem {
  id: string;
  scheduledDate: string;
  scheduledTime: string | null;
  clientName: string;
  formatLabel: string;
}

function dayLabel(day: string): string {
  return format(new Date(`${day}T12:00:00`), "EEEE d MMMM", { locale: fr });
}

/**
 * Retard de la semaine en cours.
 *
 * `items` ne contient que des jours déjà passés dans la semaine du calendrier
 * réel — la sélection se fait côté serveur (`page.tsx`), pas ici. Tout ce qui
 * arrive dans ce composant est donc en retard, par construction : pas besoin
 * de le redire ligne par ligne.
 */
export function UnpublishedWeekPanel({ items }: { items: UnpublishedItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  const groups = Object.entries(
    items.reduce<Record<string, UnpublishedItem[]>>((result, item) => {
      (result[item.scheduledDate] ??= []).push(item);
      return result;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary relative sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <Icon name="warning" className="h-4 w-4"/>Non publié
        {items.length > 0 && (
          <span className="badge bg-state-changes text-white">{items.length}</span>
        )}
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-[#123f73]/45 backdrop-blur-[2px]"
              aria-label="Fermer"
              onClick={() => setOpen(false)}
            />
            <div
              ref={dialogRef}
              className="side-sheet relative flex h-full w-full max-w-lg flex-col overflow-hidden bg-white shadow-[-24px_0_70px_rgba(17,63,115,.22)] sm:rounded-l-[28px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="unpublished-week-title"
            >
              <header className="flex shrink-0 items-center justify-between gap-4 border-b bg-white/90 px-4 py-4 backdrop-blur-xl sm:px-7">
                <div className="min-w-0">
                  <p className="eyebrow">Cette semaine, en retard</p>
                  <h2 id="unpublished-week-title" className="mt-1 truncate text-lg font-semibold">
                    {items.length} publication{items.length > 1 ? "s" : ""} non publiée{items.length > 1 ? "s" : ""}
                  </h2>
                </div>
                <button
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft transition-transform active:scale-95"
                  onClick={() => setOpen(false)}
                  aria-label="Fermer"
                >×</button>
              </header>

              <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-7">
                {groups.length === 0 && (
                  <p className="text-center text-sm text-ink-faint">Rien en retard cette semaine.</p>
                )}
                {groups.map(([day, dayItems]) => (
                  <section key={day} className="space-y-2">
                    <h3 className="px-1 text-sm font-semibold capitalize">{dayLabel(day)}</h3>
                    <ul className="space-y-2">
                      {dayItems.map((item) => (
                        <li key={item.id}>
                          <a
                            href={`/publications?date=${item.scheduledDate}`}
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm hover:border-[#c9dcf0] hover:bg-[#f7fafe]"
                          >
                            <span className="min-w-0">
                              <strong className="block truncate">{item.clientName}</strong>
                              <span className="mt-0.5 block truncate text-xs text-ink-faint">
                                {item.formatLabel}{item.scheduledTime ? ` · ${item.scheduledTime.slice(0, 5)}` : ""}
                              </span>
                            </span>
                            <Icon name="arrow" className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"/>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
