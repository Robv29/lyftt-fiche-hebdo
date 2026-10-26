"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { computeWeeklyAdviceNow } from "./weekly-advice-actions";

/**
 * « Calculer les conseils maintenant », quand la tâche du lundi n'a rien écrit.
 *
 * Deux cas, et deux seulement : la mise en service un lundi après-midi, et la
 * semaine où la tâche est tombée. Le reste du temps l'encart n'existe pas — une
 * commande qui double une automatisation finit par la remplacer, et personne ne
 * remarque plus qu'elle ne tourne plus.
 *
 * Réservé à la direction, comme le calcul lui-même. Sans écrasement : une
 * semaine déjà calculée est laissée telle quelle, et le bouton le dit.
 */
export function WeeklyAdviceCompute() {
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <section className="section-card" aria-labelledby="weekly-advice-compute-title">
      <div className="section-card-header">
        <div className="min-w-0">
          <p className="eyebrow">Semaine en cours</p>
          <h2 id="weekly-advice-compute-title" className="mt-1 font-semibold">Conseils pas encore calculés</h2>
        </div>
      </div>
      <div className="px-5 pb-5 pt-1">
        <p className="text-xs leading-relaxed text-ink-faint">
          Le calcul tourne tout seul le lundi à 10 h. Lancez-le à la main pour cette semaine :
          la fenêtre s’ouvrira ensuite pour chacun, au premier écran chargé.
        </p>
        <button
          type="button"
          className="btn-secondary mt-3 w-full"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await computeWeeklyAdviceNow();
            setFeedback(result);
            if (result.ok) router.refresh();
          })}
        >
          <Icon name="spark" className="h-4 w-4"/>
          {pending ? "Calcul…" : "Calculer les conseils maintenant"}
        </button>
        {feedback && (
          <p
            role="status"
            className={`mt-2 text-xs ${feedback.ok ? "text-state-approved" : "text-state-changes"}`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  );
}
