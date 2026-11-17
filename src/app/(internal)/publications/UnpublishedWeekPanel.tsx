"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
 * Retard des sept derniers jours.
 *
 * `items` ne contient que du retard réel : la sélection se fait côté serveur
 * par la règle partagée (`src/lib/domain/late-publications.ts`), la même que
 * celle de la pop-up de la coquille. Tout ce qui arrive ici est donc en retard
 * **et cochable**, par construction : pas besoin de le redire ligne par ligne.
 *
 * `awaitingApproval` compte le retard dont la case est grisée faute de
 * validation client. Il est dit, jamais détaillé : le geste n'est pas de
 * cocher, et il n'entre pas dans la pastille — un compteur qu'on ne peut pas
 * faire baisser depuis cet écran s'apprend à ignorer.
 *
 * Les mots sont ceux de la pop-up : « à confirmer », et non « non publiées ».
 * Sur 195 contenus cochés, 154 l'ont été le jour même et le plus grand écart
 * observé est de trois jours : ce qui manque à une ligne de cette liste est la
 * coche, presque jamais le post. Deux encarts qui montrent la même règle
 * doivent la nommer pareil, sinon on croit lire deux choses.
 *
 * Ici les lignes restent des liens, et c'est suffisant : la checklist du jour
 * est à un clic, sur l'écran même. La pop-up, elle, s'ouvre n'importe où — elle
 * porte donc le bouton de confirmation.
 *
 * Mais ce sont des `<Link>`, et c'était un `<a href>` nu. L'App Router
 * n'intercepte pas un `<a>` nu : le clic rechargeait la page entière, la
 * coquille se remontait, et l'alerte de retard se reposait par-dessus la
 * checklist qu'on venait d'ouvrir pour cocher — l'exact contraire du geste
 * demandé. Une navigation côté client ne remonte pas la coquille ; le tiroir se
 * ferme de lui-même au clic, ce que le rechargement faisait à sa place.
 */
export function UnpublishedWeekPanel({ items, awaitingApproval = 0 }: { items: UnpublishedItem[]; awaitingApproval?: number }) {
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
        <Icon name="warning" className="h-4 w-4"/>À confirmer
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
                  <p className="eyebrow">Retard des sept derniers jours</p>
                  <h2 id="unpublished-week-title" className="mt-1 truncate text-lg font-semibold">
                    {items.length} publication{items.length > 1 ? "s" : ""} à confirmer
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
                {/*
                  « Rien en retard » serait faux quand il reste du retard que
                  la validation du client empêche de cocher : la phrase dit
                  alors ce qu'elle sait — il n'y a rien à cocher.
                */}
                {groups.length === 0 && (
                  <p className="text-center text-sm text-ink-faint">
                    {awaitingApproval > 0
                      ? "Rien à cocher ces sept derniers jours."
                      : "Rien en retard ces sept derniers jours."}
                  </p>
                )}
                {groups.map(([day, dayItems]) => (
                  <section key={day} className="space-y-2">
                    <h3 className="px-1 text-sm font-semibold capitalize">{dayLabel(day)}</h3>
                    <ul className="space-y-2">
                      {dayItems.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={`/publications?date=${item.scheduledDate}`}
                            onClick={() => setOpen(false)}
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm hover:border-[#c9dcf0] hover:bg-[#f7fafe]"
                          >
                            <span className="min-w-0">
                              <strong className="block truncate">{item.clientName}</strong>
                              <span className="mt-0.5 block truncate text-xs text-ink-faint">
                                {item.formatLabel}{item.scheduledTime ? ` · ${item.scheduledTime.slice(0, 5)}` : ""}
                              </span>
                            </span>
                            <Icon name="arrow" className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"/>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {/*
                  Le compte secondaire passe sous la liste, comme dans la
                  fenêtre d'alerte : au-dessus, il se lisait avant ce sur quoi
                  on peut agir. « Autres » ne se dit que s'il y a un premier.
                */}
                {awaitingApproval > 0 && (
                  <p className="border-t border-line pt-3 text-xs text-ink-faint">
                    {awaitingApproval}{groups.length > 0 ? ` autre${awaitingApproval > 1 ? "s" : ""}` : ""} publication{awaitingApproval > 1 ? "s" : ""} en
                    retard attend{awaitingApproval > 1 ? "ent" : ""} la validation du client :
                    elle{awaitingApproval > 1 ? "s ne se cochent" : " ne se coche"} pas tant qu’il n’a pas répondu.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
