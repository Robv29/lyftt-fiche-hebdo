"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  computeTrackingRatios,
  findTrackingProduct,
  parseTrackingStats,
  type TrackingStatValues,
} from "@/lib/domain/monthly-tracking";
import { fillTrackingReport } from "./actions";

/**
 * Le formulaire d'un compte rendu : quatre ou cinq chiffres, et un paragraphe.
 *
 * Deux minutes, pas plus. Aucun ratio n'est demandé — ils s'affichent sous les
 * champs, recalculés à chaque frappe, avec les chiffres saisis. Les voir se
 * former est aussi le meilleur contrôle de saisie qui existe : un coût par clic
 * à 4 000 € se repère sans relire la case.
 */

export interface ReportCard {
  id: string;
  serviceKey: string;
  clientName: string;
  monthLabel: string;
  dueOn: string;
  /** Échéance dépassée : la carte le dit, elle ne se contente pas d'une couleur. */
  overdue: boolean;
  /** Valeurs déjà enregistrées, pour reprendre un compte rendu corrigé. */
  stats: unknown;
  improvements: string | null;
}

const dayLabel = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});

export function ReportForm({ report }: { report: ReportCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(report));

  const product = findTrackingProduct(report.serviceKey);
  if (!product) return null;

  // Ratios de ce qui est tapé à l'instant : les cases vides n'en produisent aucun.
  const typed: TrackingStatValues = {};
  for (const field of product.stats) {
    const raw = (values[field.key] ?? "").replace(",", ".");
    if (raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    typed[field.key] = field.unit === "euros" ? Math.round(value * 100) : Math.round(value);
  }
  const ratios = computeTrackingRatios(product, typed);

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0">
          <p className="eyebrow">{product.label}</p>
          <h2 className="mt-1 font-semibold">
            {report.clientName} — {report.monthLabel}
          </h2>
        </div>
        <span className={`badge ${report.overdue ? "bg-state-changes/10 text-state-changes" : "bg-canvas text-ink-soft"}`}>
          {report.overdue ? "En retard — attendu le " : "À rendre le "}
          {dayLabel.format(new Date(`${report.dueOn}T12:00:00Z`))}
        </span>
      </header>

      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            try {
              const result = await fillTrackingReport(formData);
              setFeedback(result);
              if (result.ok) router.refresh();
            } catch {
              setFeedback({ ok: false, message: "Enregistrement interrompu. Réessayez." });
            }
          });
        }}
      >
        <input type="hidden" name="reportId" value={report.id}/>

        <div className="grid gap-4 sm:grid-cols-2">
          {product.stats.map((field) => (
            <div key={field.key}>
              <label className="label" htmlFor={`${report.id}-${field.key}`}>
                {field.label}
                {field.unit === "euros" && <span className="font-normal text-ink-faint"> (€)</span>}
                {!field.required && <span className="font-normal text-ink-faint"> — facultatif</span>}
              </label>
              <input
                id={`${report.id}-${field.key}`}
                name={`stat_${field.key}`}
                type="number"
                min="0"
                step={field.unit === "euros" ? "0.01" : "1"}
                required={field.required}
                className="field"
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              {field.hint && <p className="mt-1 text-xs text-ink-faint">{field.hint}</p>}
            </div>
          ))}
        </div>

        {/* Calculés, jamais demandés : une division de plus est une erreur de plus. */}
        <div className="grid gap-2 rounded-xl bg-canvas p-3 sm:grid-cols-3">
          {ratios.map((ratio) => (
            <div key={ratio.key}>
              <p className="text-[11px] leading-tight text-ink-faint">{ratio.label}</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums">{ratio.text}</p>
            </div>
          ))}
        </div>

        <div>
          <label className="label" htmlFor={`${report.id}-improvements`}>
            Améliorations faites ce mois-ci
          </label>
          <textarea
            id={`${report.id}-improvements`}
            name="improvements"
            rows={4}
            required
            maxLength={2000}
            className="field"
            defaultValue={report.improvements ?? ""}
            placeholder="Audiences resserrées sur Montauban, nouvelle accroche sur l’annonce principale, budget basculé du display vers la recherche…"
          />
          <p className="mt-1 text-xs text-ink-faint">
            C’est ce texte que l’on relira dans l’historique du client, à côté des chiffres.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer le compte rendu"}
          </button>
          {feedback?.message && (
            <span
              role="status"
              className={`text-xs ${feedback.ok ? "text-state-approved" : "text-state-changes"}`}
            >
              {feedback.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

/** Reprise d'un compte rendu déjà commencé : les centimes redeviennent des euros. */
function initialValues(report: ReportCard): Record<string, string> {
  const product = findTrackingProduct(report.serviceKey);
  if (!product) return {};
  const stored = parseTrackingStats(report.stats);
  const values: Record<string, string> = {};
  for (const field of product.stats) {
    const value = stored[field.key];
    if (!Number.isFinite(value)) continue;
    values[field.key] = field.unit === "euros" ? (value! / 100).toFixed(2) : String(value);
  }
  return values;
}
