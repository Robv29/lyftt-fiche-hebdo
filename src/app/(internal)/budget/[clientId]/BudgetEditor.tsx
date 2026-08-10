"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  CATEGORY_LABELS,
  SERVICE_CATALOGUE,
  formatEuros,
  isManagementMonth,
  lineTotalCents,
  type BillingMode,
  type BudgetLine,
  type BudgetSummary,
  type ServiceDefinition,
} from "@/lib/domain/budget";
import type { MonthlyCadence } from "@/lib/domain/planning";
import {
  INVOICE_STATUS_LABELS,
  isInvoiceSettled,
  nextInvoiceStatus,
  pendingInvoiceCount,
  type InvoiceMonth,
} from "@/lib/domain/invoicing";
import { addBudgetLine, removeBudgetLine, saveBudgetSettings, setInvoiceStatus, type BudgetActionResult } from "../actions";

type EditorLine = BudgetLine & { note: string | null };

const CATEGORY_ORDER: ServiceDefinition["category"][] = ["entree", "plat", "dessert"];

export function BudgetEditor({
  clientId,
  clientName,
  contractStartDate,
  contractEndDate,
  cadence,
  initialMode,
  initialBudgetCents,
  initialNote,
  lines,
  months,
  summary,
}: {
  clientId: string;
  clientName: string;
  contractStartDate: string | null;
  contractEndDate: string | null;
  cadence: MonthlyCadence;
  initialMode: BillingMode;
  initialBudgetCents: number;
  initialNote: string;
  lines: EditorLine[];
  months: InvoiceMonth[];
  summary: BudgetSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<BudgetActionResult | null>(null);
  const [mode, setMode] = useState<BillingMode>(initialMode);
  const [serviceKey, setServiceKey] = useState<string>(SERVICE_CATALOGUE[0]!.key);

  const service = SERVICE_CATALOGUE.find((item) => item.key === serviceKey)!;
  const financed = mode === "financement";

  const run = (action: () => Promise<BudgetActionResult>) => {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) router.refresh();
      } catch {
        setFeedback({ ok: false, message: "Enregistrement interrompu. Réessayez." });
      }
    });
  };

  return (
    <div className="space-y-6">
      {feedback?.message && (
        <p className={`rounded-md border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>
          {feedback.message}
        </p>
      )}

      {/*
        L'absence de date de fin est bloquante : sans elle, ni le rythme à tenir
        ni le reliquat ne peuvent être calculés. L'alerte doit être impossible
        à manquer, et mener directement à l'endroit où corriger.
      */}
      {financed && !contractEndDate && (
        <section className="card border-2 border-state-changes bg-state-changes/5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-state-changes text-white">
              <Icon name="message" className="h-5 w-5"/>
            </span>
            <div>
              <strong className="text-base text-state-changes">Date de fin de gestion manquante</strong>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Impossible de calculer quoi que ce soit sans elle : ni le budget restant
                par mois, ni le reliquat à la fin, ni l&apos;alerte de rythme. Le suivi de
                {" "}{clientName} est à l&apos;aveugle tant qu&apos;elle n&apos;est pas renseignée.
              </p>
              <Link href={`/clients/${clientId}`} className="btn-primary mt-3 inline-flex">
                Renseigner la date de fin
              </Link>
            </div>
          </div>
        </section>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => saveBudgetSettings(formData));
        }}
        className="card space-y-5 p-5"
      >
        <input type="hidden" name="clientId" value={clientId}/>

        <fieldset>
          <legend className="label">Mode de facturation</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(["comptant", "financement"] as const).map((value) => (
              <label key={value} className={`choice-chip ${mode === value ? "border-[#1468ff] bg-[#f0f6ff]" : ""}`}>
                <input
                  type="radio"
                  name="billingMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {value === "comptant" ? "Client comptant" : "Client financement"}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Au comptant, le client règle chaque prestation : il n&apos;y a pas d&apos;enveloppe
            à suivre, et le reste de cet écran est désactivé.
          </p>
        </fieldset>

        {/*
          Grisé plutôt que masqué : on voit qu'un suivi budgétaire existe, et
          pourquoi il ne s'applique pas ici.
        */}
        <fieldset disabled={!financed} className={financed ? "" : "pointer-events-none opacity-40"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="budgetEuros">Budget accordé (€ HT)</label>
              <input
                id="budgetEuros"
                name="budgetEuros"
                type="number"
                min="0"
                step="10"
                className="field"
                defaultValue={initialBudgetCents ? initialBudgetCents / 100 : ""}
                placeholder="6000"
              />
              <p className="mt-1 text-xs text-ink-faint">Enveloppe non reportable.</p>
            </div>
            <div>
              <label className="label" htmlFor="note">Note interne</label>
              <input id="note" name="note" maxLength={500} className="field" defaultValue={initialNote} placeholder="Organisme, référence de dossier…"/>
            </div>
          </div>
        </fieldset>

        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>

      {financed && (
        <SummaryPanel summary={summary} cadence={cadence} contractStartDate={contractStartDate} contractEndDate={contractEndDate}/>
      )}

      {(
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              run(() => addBudgetLine(formData));
            }}
            className="card space-y-4 p-5"
          >
            <div>
              <h2 className="font-semibold">
                {financed ? "Ajouter une prestation" : "Prestation réalisée"}
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                {financed
                  ? "Chaque ajout s’empile comme une addition."
                  : "Notez chaque prestation au fil du mois : elle rejoint la facture du mois de sa date."}
                {" "}Le tarif est figé au moment de l&apos;ajout : une révision de la carte
                ne réécrira pas cette ligne.
              </p>
            </div>
            <input type="hidden" name="clientId" value={clientId}/>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="serviceKey">Prestation</label>
                <select id="serviceKey" name="serviceKey" className="field" value={serviceKey} onChange={(event) => setServiceKey(event.target.value)}>
                  {CATEGORY_ORDER.map((category) => (
                    <optgroup key={category} label={CATEGORY_LABELS[category]}>
                      {SERVICE_CATALOGUE.filter((item) => item.category === category).map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label} — {formatEuros(item.unitPriceCents)} {item.unitLabel}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-faint">{service.description}</p>
              </div>

              <div>
                <label className="label" htmlFor="quantity">
                  Quantité <span className="font-normal text-ink-faint">({service.unitLabel})</span>
                </label>
                <input id="quantity" name="quantity" type="number" min="0.5" step="0.5" defaultValue="1" required className="field"/>
              </div>

              {service.billing === "mensuel" ? (
                <div>
                  <label className="label" htmlFor="months">Engagement (mois)</label>
                  <input id="months" name="months" type="number" min="1" max="120" defaultValue="1" required className="field"/>
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="performedOnHint">Type</label>
                  <input id="performedOnHint" className="field bg-canvas" value="Prestation ponctuelle" readOnly tabIndex={-1}/>
                </div>
              )}

              <div>
                <label className="label" htmlFor="performedOn">
                  Date {service.key.startsWith("shooting") ? "du shooting" : "de mise à jour de la formule"}
                </label>
                <input id="performedOn" name="performedOn" type="date" required className="field" defaultValue={new Date().toISOString().slice(0, 10)}/>
              </div>

              <div>
                <label className="label" htmlFor="lineNote">Précision</label>
                <input id="lineNote" name="note" maxLength={300} className="field" placeholder="Lieu, thème, interlocuteur…"/>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Ajout…" : "Ajouter à l’addition"}
            </button>
          </form>

          {!financed && (
            <InvoiceBoard
              months={months}
              pending={pending}
              onAdvance={(month, status) => run(() => setInvoiceStatus(clientId, month, status))}
            />
          )}

          <section className="card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b p-5">
              <h2 className="font-semibold">{financed ? "L’addition" : "Toutes les prestations"}</h2>
              <strong className="text-sm">{formatEuros(summary.lineCents)}</strong>
            </header>
            {lines.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-faint">
                Aucune prestation encore engagée.
              </p>
            ) : (
              <ul className="divide-y">
                {lines.map((line) => {
                  const automatic = isManagementMonth(line);
                  return (
                  <li key={line.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${automatic ? "bg-canvas/60" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {line.label}
                        {automatic && <span className="ml-2 badge bg-[#e8f2ff] text-[#0b5e9f]">Automatique</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {line.quantity} × {formatEuros(line.unitPriceCents)}
                        {line.billing === "mensuel" && line.months ? ` × ${line.months} mois` : ""}
                        {" · "}{line.performedOn}
                        {line.note ? ` · ${line.note}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <strong className="text-sm">{formatEuros(lineTotalCents(line))}</strong>
                      {/* Un mois écoulé a bien été produit : il ne se retire pas. */}
                      {!automatic && (
                        <button
                          type="button"
                          className="text-xs text-state-changes hover:underline"
                          disabled={pending}
                          onClick={() => run(() => removeBudgetLine(line.id, clientId))}
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Récapitulatif mois par mois des factures à établir.
 *
 * Le mois est l'unité de facturation : chaque prestation notée rejoint le mois
 * de sa date, et le total du mois est le montant à facturer. On avance ensuite
 * d'un cran à la fois — facture faite, puis prélèvement programmé — pour qu'un
 * dossier à moitié traité reste visible.
 */
function InvoiceBoard({
  months,
  pending,
  onAdvance,
}: {
  months: InvoiceMonth[];
  pending: boolean;
  onAdvance: (month: string, status: string) => void;
}) {
  const remaining = pendingInvoiceCount(months);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Facturation</h2>
        <p className="text-xs text-ink-faint">
          {remaining === 0
            ? "Tout est facturé et prélevé."
            : `${remaining} mois à traiter`}
        </p>
      </div>

      {months.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune prestation notée. Ajoutez-en une : elle ouvrira la facture de son mois.
        </p>
      ) : (
        <ul className="space-y-3">
          {months.map((month) => {
            const settled = isInvoiceSettled(month.status);
            const next = nextInvoiceStatus(month.status);
            return (
              <li key={month.month} className={`card overflow-hidden ${settled ? "border-state-approved/40 bg-[#f6fdf9]" : ""}`}>
                <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div>
                    <h3 className="font-semibold capitalize">{month.label}</h3>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {month.lines.length} prestation{month.lines.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <strong className="text-sm">{formatEuros(month.totalCents)}</strong>
                    <span className={`badge ${
                      month.status === "prelevement_programme"
                        ? "bg-[#e8f8f1] text-state-approved"
                        : month.status === "faite"
                          ? "bg-[#e8f2ff] text-[#0b5e9f]"
                          : "bg-[#fff4e5] text-[#8a5700]"
                    }`}>
                      {INVOICE_STATUS_LABELS[month.status]}
                    </span>
                  </div>
                </header>

                <ul className="divide-y text-sm">
                  {month.lines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0 truncate">
                        {line.label}
                        <span className="ml-2 text-xs text-ink-faint">{line.performedOn}</span>
                      </span>
                      <span className="text-xs text-ink-soft">{formatEuros(lineTotalCents(line))}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-2 border-t bg-[#fbfcfe] p-4">
                  {next ? (
                    <button
                      type="button"
                      className={next === "prelevement_programme" ? "btn-primary bg-state-approved" : "btn-primary"}
                      disabled={pending}
                      onClick={() => onAdvance(month.month, next)}
                    >
                      <Icon name="check" className="h-4 w-4"/>
                      {next === "faite" ? "Facture faite" : "Prélèvement programmé"}
                    </button>
                  ) : (
                    <p className="text-xs font-semibold text-state-approved">
                      Facture établie et prélèvement programmé.
                    </p>
                  )}

                  {/* Une erreur de clic ne doit pas figer un dossier. */}
                  {month.status !== "a_faire" && (
                    <button
                      type="button"
                      className="text-xs text-ink-faint hover:underline"
                      disabled={pending}
                      onClick={() => onAdvance(month.month, month.status === "faite" ? "a_faire" : "faite")}
                    >
                      Revenir en arrière
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SummaryPanel({
  summary,
  cadence,
  contractStartDate,
  contractEndDate,
}: {
  summary: BudgetSummary;
  cadence: MonthlyCadence;
  contractStartDate: string | null;
  contractEndDate: string | null;
}) {
  const overspent = summary.remainingCents < 0;
  const rhythm = [
    ["photo", cadence.photo],
    ["vidéo", cadence.video],
    ["story", cadence.story],
    ["visuel", cadence.visual],
  ].filter(([, value]) => Number(value ?? 0) > 0)
    .map(([label, value]) => `${value} ${label}`)
    .join(" · ");

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Figure label="Budget" value={formatEuros(summary.budgetCents)}/>
          <Figure label="Consommé" value={formatEuros(summary.consumedCents)}/>
          <Figure
            label="Restant à utiliser"
            value={formatEuros(summary.remainingCents)}
            tone={overspent ? "text-state-changes" : "text-state-approved"}
          />
          <Figure
            label="À tenir par mois"
            value={summary.targetMonthlyCents > 0 ? formatEuros(summary.targetMonthlyCents) : "—"}
          />
        </dl>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Budget consommé : ${summary.consumedPercentage}%`} aria-valuenow={summary.consumedPercentage} aria-valuemin={0} aria-valuemax={100}>
          <span
            className={`block h-full origin-left rounded-full transition-transform duration-300 ${overspent ? "bg-state-changes" : summary.consumedPercentage >= 90 ? "bg-state-approved" : "bg-[#1468ff]"}`}
            style={{ transform: `scaleX(${summary.consumedPercentage / 100})` }}
          />
        </div>

        <div className="mt-5 grid gap-2 rounded-2xl bg-canvas p-4 text-xs sm:grid-cols-2">
          <p className="flex items-center justify-between gap-3">
            <span className="text-ink-faint">
              Mois de gestion inscrits{contractStartDate ? ` depuis le ${contractStartDate}` : ""}
            </span>
            <strong>{formatEuros(summary.recurringConsumedCents)}</strong>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="text-ink-faint">Prestations ponctuelles ajoutées</span>
            <strong>{formatEuros(summary.lineCents - summary.recurringConsumedCents)}</strong>
          </p>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Rythme vendu : {rhythm || "aucun"} par mois, soit{" "}
          <strong className="text-ink-soft">{formatEuros(summary.monthlyCadenceCostCents)} par mois</strong>{" "}
          de production récurrente.
          {contractEndDate && summary.monthsRemaining > 0 && (
            <> Il reste {summary.monthsRemaining.toFixed(1)} mois jusqu&apos;au {contractEndDate}.</>
          )}
        </p>
      </div>

      {summary.alerts.map((alert) => (
        <div
          key={alert.title}
          className={`card p-4 ${
            alert.level === "critique"
              ? "border-state-changes/40 bg-state-changes/5"
              : alert.level === "attention"
                ? "border-[#f0c36d] bg-[#fff8ec]"
                : "border-state-approved/30 bg-state-approved/5"
          }`}
        >
          <strong className={`text-sm ${alert.level === "critique" ? "text-state-changes" : alert.level === "attention" ? "text-[#8a5700]" : "text-state-approved"}`}>
            {alert.title}
          </strong>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{alert.detail}</p>
        </div>
      ))}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
