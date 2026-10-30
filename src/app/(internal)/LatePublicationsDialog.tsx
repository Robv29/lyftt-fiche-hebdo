"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Icon } from "@/components/Icon";
import { Portal } from "@/components/Portal";
import { MEDIA_FORMAT_LABELS } from "@/lib/domain/types";
import type { LatePublicationEntry, LatePublicationsView } from "@/lib/domain/late-publications";

/**
 * La fenêtre des publications en retard.
 *
 * Reprend le motif de modale de la maison, à l'identique de
 * `WeeklyAdviceDialog` — `Portal`, fond cliquable, `role="dialog"`,
 * `aria-modal`, Échap, piège de tabulation. Le `Portal` n'est pas décoratif :
 * les blocs de page portent `animation:rise-in … both`, et une animation
 * d'opacité maintenue crée un contexte d'empilement permanent — une modale
 * rendue dans un bloc de page passe derrière les blocs suivants quel que soit
 * son `z-index`.
 *
 * Deux écarts assumés avec le précédent :
 *
 * - **pas de zone `tabIndex={0}`** : le corps des conseils ne portait aucun
 *   lien, donc rien n'y attrapait le focus et les touches de défilement
 *   n'agissaient pas. Ici chaque ligne est un lien, déjà pris dans le cycle de
 *   tabulation par le sélecteur `[href]` ;
 * - **pas de `returnFocusTo`** : la fenêtre s'ouvre d'elle-même, il n'y a aucun
 *   déclencheur où renvoyer le curseur.
 *
 * Tous les liens ferment la fenêtre avant de naviguer : la coquille n'est pas
 * re-rendue lors d'une navigation côté client, donc une fenêtre laissée ouverte
 * resterait posée sur l'écran d'arrivée.
 */

function dayLabel(day: string): string {
  return format(new Date(`${day}T12:00:00`), "EEEE d MMMM", { locale: fr });
}

function groupByDay(entries: readonly LatePublicationEntry[]): [string, LatePublicationEntry[]][] {
  const groups = new Map<string, LatePublicationEntry[]>();
  for (const item of entries) {
    const bucket = groups.get(item.scheduledDate);
    if (bucket) bucket.push(item);
    else groups.set(item.scheduledDate, [item]);
  }
  // `late` arrive déjà trié du plus ancien au plus récent : l'ordre d'insertion
  // d'une Map le conserve, inutile de retrier.
  return [...groups.entries()];
}

export function LatePublicationsDialog({
  view,
  onClose,
}: {
  view: LatePublicationsView;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  /*
   * `onClose` change à chaque rendu du parent : le garder dans une référence
   * évite de reposer l'écouteur de clavier et de re-déclencher le premier
   * focus — ce qui ramènerait le curseur au bouton de fermeture en pleine
   * lecture si la coquille se rafraîchissait.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const count = view.late.length;
  const groups = groupByDay(view.late);

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-[#123f73]/45 backdrop-blur-[2px]"
          aria-label="Fermer"
          onClick={onClose}
        />
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="late-publications-title"
          className="reveal-panel relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_24px_70px_rgba(17,63,115,.28)]"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Icon name="warning" className="h-3.5 w-3.5"/>
                Ces 7 derniers jours
              </p>
              <h2 id="late-publications-title" className="mt-1 text-lg font-semibold">
                {count} publication{count > 1 ? "s" : ""} non publiée{count > 1 ? "s" : ""}
              </h2>
            </div>
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft transition-transform active:scale-95"
              onClick={onClose}
              aria-label="Fermer"
            >×</button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <p className="text-sm text-ink-soft">
              Programmées avant aujourd’hui, validées par le client, et pas encore cochées comme publiées.
            </p>

            {groups.map(([day, dayItems]) => (
              <section key={day} className="space-y-2">
                <h3 className="px-1 text-sm font-semibold capitalize">{dayLabel(day)}</h3>
                <ul className="space-y-2">
                  {dayItems.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/publications?date=${item.scheduledDate}`}
                        onClick={onClose}
                        className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm hover:border-[#c9dcf0] hover:bg-[#f7fafe]"
                      >
                        <span className="min-w-0">
                          <strong className="block truncate">{item.clientName}</strong>
                          <span className="mt-0.5 block truncate text-xs text-ink-faint">
                            {MEDIA_FORMAT_LABELS[item.format]}
                            {item.scheduledTime ? ` · ${item.scheduledTime.slice(0, 5)}` : ""}
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
              Deux précisions, comptées et non nommées : le geste n'est pas le
              même. Une case grisée attend la validation du client, et le jour
              même n'est pas en retard — 527 des 533 contenus actifs sont
              programmés à 18 h.
            */}
            {(view.awaitingApproval > 0 || view.today.length > 0) && (
              <ul className="space-y-1 border-t border-line pt-3 text-xs text-ink-faint">
                {view.awaitingApproval > 0 && (
                  <li>
                    {view.awaitingApproval} autre{view.awaitingApproval > 1 ? "s" : ""} attend
                    {view.awaitingApproval > 1 ? "ent" : ""} encore la validation du client : la case
                    publication reste fermée.
                  </li>
                )}
                {view.today.length > 0 && (
                  <li>
                    Aujourd’hui, {view.today.length} publication{view.today.length > 1 ? "s" : ""} rest
                    {view.today.length > 1 ? "ent" : "e"} à poster.
                  </li>
                )}
              </ul>
            )}
          </div>

          <footer className="shrink-0 space-y-2 border-t border-line px-5 py-3">
            <Link href="/publications" onClick={onClose} className="btn-primary w-full">
              Ouvrir Publications
            </Link>
            <button type="button" className="btn-secondary w-full" onClick={onClose}>
              Fermer
            </button>
            <p className="text-center text-[11px] text-ink-faint">
              Cochez ce qui est en ligne depuis la checklist du jour concerné.
            </p>
          </footer>
        </section>
      </div>
    </Portal>
  );
}
