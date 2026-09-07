"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShootingDetails, type ShootingActionResult } from "../actions";
import { SHOOTING_KIND_LABELS, type ShootingKind } from "@/lib/domain/shootings";

export interface ShootingFormInitial {
  name: string;
  kind: string;
  place: string;
  leadName: string;
  durationMinutes: number | null;
  deliveryDays: number | null;
  deliveredOn: string;
  assetsCount: number | null;
  cancelled: boolean;
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

export function ShootingForm({
  budgetLineId,
  initial,
  promisedOn,
}: {
  budgetLineId: string;
  initial: ShootingFormInitial;
  /** Échéance de livraison promise, pour la rappeler à la saisie. */
  promisedOn: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ShootingActionResult | null>(null);

  const hours = initial.durationMinutes === null ? "" : String(Math.floor(initial.durationMinutes / 60));
  const minutes = initial.durationMinutes === null ? "" : String(initial.durationMinutes % 60);

  return (
    <form
      action={(formData) => {
        formData.set("budgetLineId", budgetLineId);
        startTransition(async () => {
          const result = await saveShootingDetails(formData);
          setFeedback(result);
          if (result.ok) router.refresh();
        });
      }}
      className="space-y-6"
    >
      {feedback?.message && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <section className="card p-5">
        <p className="eyebrow">Le tournage</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Nom du shooting</label>
            <input id="name" name="name" maxLength={160} className="field"
              placeholder="Campagne été 2026" defaultValue={initial.name}/>
          </div>
          <div>
            <label className="label" htmlFor="kind">Type</label>
            <select id="kind" name="kind" className="field" defaultValue={initial.kind}>
              <option value="">Non renseigné</option>
              {(Object.keys(SHOOTING_KIND_LABELS) as ShootingKind[]).map((key) => (
                <option key={key} value={key}>{SHOOTING_KIND_LABELS[key]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="place">Lieu</label>
            <input id="place" name="place" maxLength={160} className="field"
              placeholder="En agence // Chez le client // Toulouse" defaultValue={initial.place}/>
          </div>
          <div>
            <label className="label" htmlFor="leadName">Responsable</label>
            <input id="leadName" name="leadName" maxLength={120} className="field"
              placeholder="Qui tient la caméra" defaultValue={initial.leadName}/>
          </div>
          <div>
            <span className="label">Durée réelle</span>
            <div className="flex items-center gap-2">
              <input name="durationHours" type="number" min="0" max="24" className="field"
                placeholder="5" defaultValue={hours} aria-label="Heures"/>
              <span className="text-sm text-ink-faint">h</span>
              <input name="durationMinutes" type="number" min="0" max="59" className="field"
                placeholder="20" defaultValue={minutes} aria-label="Minutes"/>
              <span className="text-sm text-ink-faint">min</span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              C&apos;est elle qui alimente la durée moyenne de l&apos;onglet.
            </p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <p className="eyebrow">La livraison</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="deliveryDays">Délai promis (jours)</label>
            <input id="deliveryDays" name="deliveryDays" type="number" min="0" max="365"
              className="field" placeholder="3"
              defaultValue={initial.deliveryDays ?? ""}/>
            {promisedOn && (
              <p className="mt-1 text-xs text-ink-faint">Soit le {dayFormat.format(new Date(`${promisedOn}T00:00:00Z`))}.</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="deliveredOn">Livré le</label>
            <input id="deliveredOn" name="deliveredOn" type="date" className="field"
              defaultValue={initial.deliveredOn}/>
          </div>
          <div>
            <label className="label" htmlFor="assetsCount">Contenus livrés</label>
            <input id="assetsCount" name="assetsCount" type="number" min="0" max="10000"
              className="field" placeholder="24" defaultValue={initial.assetsCount ?? ""}/>
          </div>
        </div>
        {/*
          Le pourcentage « à temps » ne se calcule que sur les shootings dont le
          délai promis ET la date de livraison sont connus. Sans les deux, le
          shooting sort du calcul plutôt que de compter comme un retard.
        */}
        <p className="mt-3 text-xs text-ink-faint">
          Le délai promis et la date de livraison, ensemble, alimentent le taux de livraisons à temps.
        </p>
      </section>

      <section className="card p-5">
        <p className="eyebrow">État</p>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" name="cancelled" className="mt-0.5" defaultChecked={initial.cancelled}/>
          <span>
            <strong>Shooting annulé</strong>
            <span className="mt-1 block text-xs text-ink-faint">
              {/*
                « Réalisé » et « à venir » se déduisent de la date ; l'annulation
                non. Sans cette case, annuler revenait à supprimer la ligne, et
                le shooting disparaissait de l'historique.
              */}
              Un shooting annulé sort des statistiques et ne compte plus comme dernier
              shooting réalisé : le prochain reste dû.
            </span>
          </span>
        </label>
      </section>

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer la fiche"}
      </button>
    </form>
  );
}
