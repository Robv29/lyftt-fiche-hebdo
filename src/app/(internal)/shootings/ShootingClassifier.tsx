"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SHOOTING_PLAN_SERVICES, findService, formatEuros } from "@/lib/domain/budget";
import type { ShootingDecision } from "@/lib/domain/shooting-decision";
import { classifyShooting } from "../budget/actions";

export interface ShootingToClassify {
  lineId: string;
  clientId: string;
  clientName: string;
  label: string;
  date: string;
  /** Clé de la ligne : date du forfait, ou prestation du catalogue. */
  serviceKey: string;
  /** Prestation du forfait vendu, ou null sans forfait. */
  planServiceKey: string | null;
  /** Client financé ou hybride : la prestation peut être facturée hors enveloppe. */
  financed: boolean;
  /** Réglage déjà porté par la ligne : la case part de lui, jamais d'une valeur par défaut. */
  billedDirectly: boolean;
  suggestion: { decision: ShootingDecision | null; reason: string };
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

/**
 * Classement des shootings, sur place.
 *
 * Le bouton « Classer » ouvrait le budget du client, où il fallait retrouver
 * la ligne parmi toutes les autres. Chaque shooting se tranche désormais ici,
 * en ne demandant que ce qui change la facture.
 */
export function ShootingClassifier({ rows, today }: { rows: ShootingToClassify[]; today: string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => <ClassifyRow key={row.lineId} row={row} today={today}/>)}
    </ul>
  );
}

function ClassifyRow({ row, today }: { row: ShootingToClassify; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<ShootingDecision | null>(row.suggestion.decision);
  const [soldServiceKey, setSoldServiceKey] = useState<string>(
    (SHOOTING_PLAN_SERVICES as readonly string[]).includes(row.serviceKey)
      ? row.serviceKey
      : row.planServiceKey ?? "shooting_demi",
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /*
   * Une fois classé, le shooting quitte la liste au rafraîchissement. Le
   * message — prestation, montant, facturation — reste quelques secondes :
   * c'est le seul endroit où l'on repère un mauvais choix.
   */
  if (done) {
    return (
      <li className="px-5 py-4">
        <p className="text-sm">
          <strong>{row.clientName}</strong>
          <span className="ml-2 text-state-approved" role="status">{done}</span>
        </p>
      </li>
    );
  }

  const choices: { value: ShootingDecision; label: string }[] = [
    { value: "compris", label: "Compris au forfait — 0 €" },
    { value: "supplementaire", label: "Vendu en plus" },
    { value: "annule", label: "N’a pas eu lieu" },
  ];

  return (
    <li className="px-5 py-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setFeedback(null);
          startTransition(async () => {
            try {
              const result = await classifyShooting(formData);
              if (result.ok) {
                setDone(result.message ?? "Classé.");
                setTimeout(() => router.refresh(), 4000);
              } else {
                setFeedback({ ok: false, message: result.message ?? "Enregistrement impossible." });
              }
            } catch {
              setFeedback({ ok: false, message: "Enregistrement interrompu. Réessayez." });
            }
          });
        }}
      >
        <input type="hidden" name="lineId" value={row.lineId}/>
        <input type="hidden" name="clientId" value={row.clientId}/>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.clientName}</p>
            <p className="mt-0.5 truncate text-xs text-ink-faint">{row.label} · {formatDay(row.date)}</p>
          </div>
        </div>

        {/* La proposition et sa raison : on confirme, ou on corrige en connaissance de cause. */}
        <p className="rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-soft">
          {row.suggestion.reason}
        </p>

        <fieldset>
          <legend className="sr-only">Ce qui s’est passé</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {choices.map((choice) => (
              <label key={choice.value} className="choice-chip bg-white">
                <input
                  type="radio"
                  name="decision"
                  value={choice.value}
                  checked={decision === choice.value}
                  onChange={() => setDecision(choice.value)}
                  required
                />
                {choice.label}
              </label>
            ))}
          </div>
          {decision === "compris" && !row.planServiceKey && (
            <p className="mt-2 text-xs text-ink-faint">
              Aucun forfait shooting n’est enregistré sur la fiche de ce client : le shooting est
              inscrit à 0 €, rien ne lui sera facturé.
            </p>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {decision === "supplementaire" && (
            <div>
              <label className="label" htmlFor={`sold-${row.lineId}`}>Prestation tournée</label>
              <select
                id={`sold-${row.lineId}`}
                name="soldServiceKey"
                className="field bg-white"
                value={soldServiceKey}
                onChange={(event) => setSoldServiceKey(event.target.value)}
              >
                {SHOOTING_PLAN_SERVICES.map((key) => (
                  <option key={key} value={key}>
                    {findService(key)?.label} — {formatEuros(findService(key)?.unitPriceCents ?? 0)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label" htmlFor={`date-${row.lineId}`}>
              {decision === "annule" ? "Date prévue" : "Date réelle du shooting"}
            </label>
            <input
              id={`date-${row.lineId}`}
              name="performedOn"
              type="date"
              required
              max={decision === "annule" ? undefined : today}
              defaultValue={row.date}
              className="field bg-white"
            />
          </div>
        </div>

        {/*
          Client financé : un shooting vendu en plus part sur l'enveloppe, sauf
          si l'organisme ne le prend pas en charge — il se facture alors au
          client. Sans objet au comptant, où tout se facture déjà.
        */}
        {decision === "supplementaire" && row.financed && (
          <label className="flex items-start gap-2 text-sm">
            <input type="hidden" name="billedDirectlyShown" value="1"/>
            <input type="checkbox" name="billedDirectly" defaultChecked={row.billedDirectly} className="mt-1"/>
            <span>
              Facturé directement au client
              <span className="block text-xs text-ink-faint">Hors enveloppe de financement.</span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={pending || decision === null}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {feedback && (
            <p className={`text-xs ${feedback.ok ? "text-state-approved" : "text-state-changes"}`} role="status">
              {feedback.message}
            </p>
          )}
        </div>
      </form>
    </li>
  );
}
