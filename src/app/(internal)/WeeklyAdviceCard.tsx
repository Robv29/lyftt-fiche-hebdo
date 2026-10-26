"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { WeeklyAdviceView } from "@/lib/domain/weekly-advice";
import { WeeklyAdviceDialog } from "./WeeklyAdviceDialog";
import { markWeeklyAdviceSeen } from "./weekly-advice-actions";

/**
 * « Revoir les conseils de la semaine », sur la vue d'ensemble.
 *
 * L'endroit se justifie : les conseils **sont** le score expliqué, et cette
 * colonne est celle qui porte déjà la santé de l'agence. Pas d'entrée dans la
 * barre latérale — elle en compte douze, et une pastille que la personne ne
 * peut pas éteindre la plupart des jours apprend à ignorer les autres, ce que
 * la navigation documente déjà.
 *
 * Ouvrir ici marque aussi la semaine comme lue : quelqu'un qui vient chercher
 * les conseils à 11 h ne doit pas les voir resurgir à 14 h 30.
 */
export function WeeklyAdviceCard({ advice }: { advice: WeeklyAdviceView }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const count = advice.advices.length;

  return (
    <section className="section-card" aria-labelledby="weekly-advice-card-title">
      <div className="section-card-header">
        <div className="min-w-0">
          <p className="eyebrow">Semaine {advice.isoWeek}</p>
          <h2 id="weekly-advice-card-title" className="mt-1 font-semibold">Conseils de la semaine</h2>
        </div>
        {!advice.seen && <span className="badge shrink-0 bg-[#e8f2ff] text-[#0b4f88]">Nouveau</span>}
      </div>
      <div className="px-5 pb-5 pt-1">
        <p className="text-xs text-ink-faint">
          {count === 0
            ? "Rien à signaler cette semaine."
            : `${count} geste${count > 1 ? "s" : ""} pour remonter la note.`}
        </p>
        <button
          ref={triggerRef}
          type="button"
          className="btn-secondary mt-3 w-full"
          onClick={() => {
            setOpen(true);
            if (advice.seen) return;
            startTransition(async () => {
              await markWeeklyAdviceSeen({ isoYear: advice.isoYear, isoWeek: advice.isoWeek, dismissed: false });
              router.refresh();
            });
          }}
        >
          <Icon name="spark" className="h-4 w-4"/>
          Revoir les conseils de la semaine
        </button>
      </div>

      {open && (
        <WeeklyAdviceDialog
          advice={advice}
          onClose={() => setOpen(false)}
          returnFocusTo={triggerRef.current}
        />
      )}
    </section>
  );
}
