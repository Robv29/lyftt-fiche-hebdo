"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { Portal } from "@/components/Portal";
import type { WeeklyAdviceView } from "@/lib/domain/weekly-advice";
import { WeeklyAdviceBody } from "./WeeklyAdviceBody";

/**
 * La fenêtre des conseils de la semaine.
 *
 * Reprend le motif de modale de la maison — `Portal`, fond cliquable,
 * `role="dialog"`, `aria-modal`, Échap, piège de tabulation, retour du focus
 * sur le déclencheur. Aucune bibliothèque d'interface n'est installée ici, et
 * ce motif existe déjà en trois exemplaires (`UnpublishedWeekPanel`,
 * `ReviewBoard`, `ClientEditor`) : une quatrième variante maison aurait été une
 * accessibilité de plus à maintenir.
 *
 * Géométrie centrée, et non en tiroir latéral : c'est une lecture courte et
 * non une liste à parcourir. `max-h` plus défilement interne pour qu'elle
 * tienne sur un téléphone, où une modale haute enferme le contenu hors écran.
 *
 * Le `Portal` est obligatoire et non décoratif : les blocs de page reçoivent
 * `animation:rise-in … both`, et une animation d'opacité maintenue crée un
 * contexte d'empilement permanent — une modale rendue dans un bloc de page
 * passe derrière les blocs suivants quel que soit son `z-index`.
 */
export function WeeklyAdviceDialog({
  advice,
  onClose,
  /** Élément à refocaliser en sortant, quand l'ouverture vient d'un bouton. */
  returnFocusTo,
}: {
  advice: WeeklyAdviceView;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  /*
   * `onClose` change à chaque rendu du parent : le garder dans une référence
   * évite de reposer l'écouteur de clavier et de re-déclencher le premier focus
   * — ce qui, sur un parent qui se rafraîchit, ramènerait le curseur au bouton
   * de fermeture pendant la lecture.
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
      /*
       * Le focus revient au bouton qui a ouvert la fenêtre. La pop-up
       * automatique n'a pas de déclencheur : on ne force alors rien, pour ne pas
       * envoyer le curseur au hasard dans la page.
       */
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

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
          aria-labelledby="weekly-advice-title"
          className="reveal-panel relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_24px_70px_rgba(17,63,115,.28)]"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Icon name="spark" className="h-3.5 w-3.5"/>
                Semaine {advice.isoWeek}
              </p>
              <h2 id="weekly-advice-title" className="mt-1 text-lg font-semibold">
                Pour remonter la note cette semaine
              </h2>
            </div>
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft transition-transform active:scale-95"
              onClick={onClose}
              aria-label="Fermer"
            >×</button>
          </header>

          {/*
            Zone focalisable : sans elle, ce qui dépasse du cadre est hors de
            portée au clavier — le contenu ne porte aucun lien ni champ, donc
            rien n'y attrape le focus et les touches de défilement n'agissent
            pas. Le piège à focus la prend dans son cycle.
          */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="weekly-advice-title"
            className="flex-1 overflow-y-auto px-5 py-4"
          >
            <WeeklyAdviceBody advice={advice}/>
          </div>

          <footer className="shrink-0 border-t border-line px-5 py-3">
            <button type="button" className="btn-primary w-full" onClick={onClose}>
              J’ai lu
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-faint">
              Vous pourrez les relire depuis la vue d’ensemble.
            </p>
          </footer>
        </section>
      </div>
    </Portal>
  );
}
