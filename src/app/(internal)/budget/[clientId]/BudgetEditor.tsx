"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  BILLING_MODE_LABELS,
  CATEGORY_LABELS,
  SERVICE_CATALOGUE,
  classifyShootings,
  findService,
  formatEuros,
  isManagementMonth,
  isShootingLine,
  lineTotalCents,
  shootingMonthlyCostCents,
  shootingPlanSummary,
  shootingTally,
  shootingsPerYear,
  type BillingMode,
  type BudgetLine,
  type BudgetSummary,
  type ServiceDefinition,
  type ShootingPlan,
} from "@/lib/domain/budget";
import type { MonthlyCadence } from "@/lib/domain/planning";
import {
  INVOICE_STATUS_LABELS,
  isInvoiceSettled,
  nextInvoiceStatus,
  pendingInvoiceCount,
  type InvoiceMonth,
} from "@/lib/domain/invoicing";
import { addBudgetLine, deleteMonthInvoice, removeBudgetLine, removeClientRib, saveBudgetSettings, saveContractDates, setInvoiceStatus, setShootingBilling, uploadClientRib, type BudgetActionResult } from "../actions";

type EditorLine = BudgetLine & { note: string | null; forfaitIncluded: boolean | null };

const CATEGORY_ORDER: ServiceDefinition["category"][] = ["entree", "plat", "dessert"];

/** Jour et mois, pour situer une période sans alourdir la phrase. */
function formatShortFr(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

export function BudgetEditor({
  clientId,
  clientName,
  contractStartDate,
  contractEndDate,
  cadence,
  shooting,
  shootingDueOn,
  shootingPlannedOn,
  shootingDates,
  initialMode,
  initialBudgetCents,
  initialNote,
  rib,
  ribEvents,
  lines,
  months,
  summary,
}: {
  clientId: string;
  clientName: string;
  contractStartDate: string | null;
  contractEndDate: string | null;
  cadence: MonthlyCadence;
  /** Forfait shooting vendu dans la formule, repris de la fiche client. */
  shooting: ShootingPlan | null;
  /** Échéance du prochain shooting du forfait. */
  shootingDueOn: string | null;
  /** Date déjà calée avec le client, si elle l'est. */
  shootingPlannedOn: string | null;
  /** Toutes les dates de shooting inscrites, pour situer chacune dans sa période. */
  shootingDates: string[];
  initialMode: BillingMode;
  initialBudgetCents: number;
  initialNote: string;
  rib: { fileName: string | null; uploadedAt: string | null; url: string | null };
  ribEvents: RibEvent[];
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
  // Une enveloppe existe dès qu'une part est financée.
  const financed = mode !== "comptant";
  const hybrid = mode === "hybride";
  // Refus de prise en charge : la prestation part en facturation directe.
  const [billedDirectly, setBilledDirectly] = useState(false);
  const [performedOn, setPerformedOn] = useState(() => new Date().toISOString().slice(0, 10));

  /*
   * Décision proposée pour un shooting : la période tranche.
   *
   * On classe la date saisie parmi celles déjà inscrites. Si elle ouvre sa
   * période, c'est le shooting du forfait — déjà réglé par le lissage mensuel.
   * Sinon, il a été vendu en plus. Une date identique à une existante retient
   * le rang le plus élevé, donc bien « supplémentaire ».
   */
  const shootingDecision = shooting && isShootingLine(service.key)
    ? classifyShootings({
        plan: shooting,
        contractStartDate,
        dates: [...shootingDates, performedOn],
      }).get(performedOn) ?? null
    : null;
  const suggestedIncluded = (shootingDecision?.rankInPeriod ?? 1) === 1;

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
      {(!contractStartDate || !contractEndDate) && (
        <section className="card border-2 border-state-changes bg-state-changes/5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-state-changes text-white">
              <Icon name="warning" className="h-5 w-5"/>
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-base text-state-changes">
                {!contractStartDate && !contractEndDate
                  ? "Dates de gestion manquantes"
                  : !contractStartDate ? "Date de début de gestion manquante" : "Date de fin de gestion manquante"}
              </strong>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                {!contractStartDate
                  ? `Sans date de début, aucun mois n'est décompté : le consommé de ${clientName} reste à zéro et aucune facture mensuelle n'est établie.`
                  : `Sans date de fin, ni le budget restant par mois, ni le reliquat, ni l'alerte de rythme ne peuvent être calculés. Le suivi de ${clientName} est à l'aveugle.`}
              </p>
            </div>
          </div>
        </section>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => saveContractDates(formData));
        }}
        className="card space-y-4 p-5"
      >
        <div>
          <h2 className="font-semibold">Période de gestion</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Le début déclenche le décompte des mois ; la fin l&apos;arrête. Modifiables
            ici comme sur la fiche client.
          </p>
        </div>
        <input type="hidden" name="clientId" value={clientId}/>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contractStartDate">Début de gestion</label>
            <input id="contractStartDate" name="contractStartDate" type="date" className={`field ${contractStartDate ? "" : "border-state-changes"}`} defaultValue={contractStartDate ?? ""}/>
          </div>
          <div>
            <label className="label" htmlFor="contractEndDate">Fin de gestion</label>
            <input id="contractEndDate" name="contractEndDate" type="date" className={`field ${contractEndDate ? "" : "border-state-changes"}`} defaultValue={contractEndDate ?? ""}/>
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer les dates"}
        </button>
      </form>

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
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(["comptant", "financement", "hybride"] as const).map((value) => (
              <label key={value} className={`choice-chip ${mode === value ? "border-[#1468ff] bg-[#f0f6ff]" : ""}`}>
                <input
                  type="radio"
                  name="billingMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {BILLING_MODE_LABELS[value]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {mode === "comptant"
              ? "Tout est facturé au client : il n’y a pas d’enveloppe à suivre, et le reste de cet écran est désactivé."
              : mode === "financement"
                ? "Tout est pris sur l’enveloppe accordée, gestion mensuelle comprise."
                : "La gestion mensuelle est facturée au client ; les prestations ponctuelles — shootings, site, stratégie — passent sur l’enveloppe."}
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

      {/*
        Le RIB n'est exigé que si l'on prélève le client : au comptant toujours,
        en hybride pour la gestion mensuelle. Un financement intégral ne passe
        pas par son compte. Il suit le mode sélectionné, sans attendre
        l'enregistrement — c'est au clic qu'on doit savoir ce qui manque.
      */}
      {mode !== "financement" && (
        <RibPanel
          clientId={clientId}
          mode={mode}
          rib={rib}
          ribEvents={ribEvents}
          pending={pending}
          onUpload={(formData) => run(() => uploadClientRib(formData))}
          onRemove={() => run(() => removeClientRib(clientId))}
        />
      )}

      {shooting && (
        <ShootingPanel
          shooting={shooting}
          dueOn={shootingDueOn}
          plannedOn={shootingPlannedOn}
          lines={lines}
          contractStartDate={contractStartDate}
          shootingDates={shootingDates}
          pending={pending}
          onDecide={(lineId, included) => run(() => setShootingBilling(lineId, clientId, included))}
        />
      )}

      {financed && (
        <SummaryPanel summary={summary} cadence={cadence} shooting={shooting} contractStartDate={contractStartDate} contractEndDate={contractEndDate}/>
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
                <input id="performedOn" name="performedOn" type="date" required className="field" value={performedOn} onChange={(event) => setPerformedOn(event.target.value)}/>
              </div>

              <div>
                <label className="label" htmlFor="lineNote">Précision</label>
                <input id="lineNote" name="note" maxLength={300} className="field" placeholder="Lieu, thème, interlocuteur…"/>
              </div>
            </div>

            {/*
              Forfait shooting : la période décide, la saisie confirme. Sans ce
              choix, le shooting partait à plein tarif alors que le forfait le
              paie déjà mois par mois — ou pire, un supplémentaire vendu
              finissait offert.
            */}
            {shootingDecision && shooting && (
              <fieldset className="rounded-2xl border border-[#d8e4f8] bg-[#f7faff] p-4">
                <legend className="label px-1">Ce shooting est-il compris dans le forfait ?</legend>
                <p className="mb-3 text-xs leading-relaxed text-ink-faint">
                  {suggestedIncluded
                    ? `Aucun shooting n'est inscrit dans la période ouverte le ${formatShortFr(shootingDecision.periodStart)} : celui-ci est celui du forfait.`
                    : `Le forfait de la période ouverte le ${formatShortFr(shootingDecision.periodStart)} a déjà été utilisé : celui-ci a donc été vendu en plus.`}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="choice-chip bg-white">
                    <input type="radio" name="forfaitIncluded" value="oui" defaultChecked={suggestedIncluded}/>
                    Compris — 0 €
                  </label>
                  <label className="choice-chip bg-white">
                    <input type="radio" name="forfaitIncluded" value="non" defaultChecked={!suggestedIncluded}/>
                    Supplémentaire — {formatEuros(service.unitPriceCents)}
                  </label>
                </div>
              </fieldset>
            )}

            {financed && (
              <div className={`rounded-2xl border p-4 transition-colors ${billedDirectly ? "border-[#f0c36d] bg-[#fff8ec]" : "border-line bg-canvas"}`}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="billedDirectly"
                    className="mt-0.5"
                    checked={billedDirectly}
                    onChange={(event) => setBilledDirectly(event.target.checked)}
                  />
                  <span>
                    <strong className="text-sm">Facturer directement au client</strong>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
                      À cocher si le client ne souhaite pas faire passer cette prestation
                      sur son financement. Elle ne consommera pas l&apos;enveloppe et
                      rejoindra les factures du mois.
                      {hybrid && " En hybride, la gestion mensuelle est déjà facturée : ceci ne concerne que le ponctuel."}
                    </span>
                  </span>
                </label>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={pending}>
              {pending
                ? "Ajout…"
                : billedDirectly ? "Ajouter et facturer" : "Ajouter à l’addition"}
            </button>
          </form>

          {(!financed || months.length > 0) && (
            <InvoiceBoard
              months={months}
              pending={pending}
              onAdvance={(month, status) => run(() => setInvoiceStatus(clientId, month, status))}
              onDelete={(month) => run(() => deleteMonthInvoice(clientId, month))}
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
                        {line.billedDirectly && <span className="ml-2 badge bg-[#fff4e5] text-[#8a5700]">Facturé à part</span>}
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
 * Dépôt du RIB.
 *
 * L'absence de RIB n'empêche pas d'enregistrer le budget : bloquer la saisie
 * pour un document manquant la ferait perdre sans rien accélérer. Elle se
 * signale, en rouge, jusqu'à ce que le fichier soit là — c'est la facturation
 * qui se heurterait au mur, plus tard et plus cher.
 */
function RibPanel({
  clientId,
  mode,
  rib,
  ribEvents,
  pending,
  onUpload,
  onRemove,
}: {
  clientId: string;
  mode: BillingMode;
  rib: { fileName: string | null; uploadedAt: string | null; url: string | null };
  ribEvents: RibEvent[];
  pending: boolean;
  onUpload: (formData: FormData) => void;
  onRemove: () => void;
}) {
  const missing = !rib.fileName;

  return (
    <section className={`card p-5 ${missing ? "border-2 border-state-changes bg-state-changes/5" : "border-state-approved/40 bg-[#f6fdf9]"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white ${missing ? "bg-state-changes" : "bg-state-approved"}`}>
          <Icon name={missing ? "warning" : "check"} className="h-5 w-5"/>
        </span>
        <div className="min-w-0 flex-1">
          <strong className={`text-base ${missing ? "text-state-changes" : "text-state-approved"}`}>
            {missing ? "RIB manquant" : "RIB déposé"}
          </strong>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            {missing
              ? mode === "comptant"
                ? "Ce client est facturé au comptant : sans RIB, aucun prélèvement ne peut être mis en place. Le budget s’enregistre quand même, mais l’alerte restera."
                : "En hybride, la gestion mensuelle est prélevée : sans RIB, la facturation restera bloquée. Le budget s’enregistre quand même, mais l’alerte restera."
              : <>
                  {rib.fileName}
                  {rib.uploadedAt && ` · déposé le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(rib.uploadedAt))}`}
                </>}
          </p>

          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              onUpload(formData);
              event.currentTarget.reset();
            }}
          >
            <input type="hidden" name="clientId" value={clientId}/>
            <div className="min-w-0">
              <label className="label" htmlFor="rib">
                {missing ? "Fichier du RIB" : "Remplacer le RIB"}
              </label>
              <input
                id="rib"
                name="rib"
                type="file"
                required
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                className="field bg-white text-xs"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Dépôt…" : "Déposer"}
            </button>
          </form>

          {!missing && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {rib.url && (
                <a href={rib.url} target="_blank" rel="noreferrer" className="font-semibold text-[#0b63ad] hover:underline">
                  Ouvrir le RIB
                </a>
              )}
              <button
                type="button"
                className="text-state-changes hover:underline"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Retirer le RIB de ce client ?")) onRemove();
                }}
              >
                Retirer
              </button>
            </div>
          )}

          <RibAccessLog events={ribEvents}/>
        </div>
      </div>
    </section>
  );
}

export interface RibEvent {
  id: string;
  eventType: string;
  profileLabel: string | null;
  createdAt: string;
}

const RIB_EVENT_LABELS: Record<string, string> = {
  viewed: "Consultation",
  uploaded: "Dépôt",
  replaced: "Remplacement",
  removed: "Retrait",
  purged: "Purge automatique",
};

/*
 * Journal des accès aux coordonnées bancaires.
 *
 * Replié par défaut : il ne sert qu'à répondre à une question précise — qui a
 * consulté ce RIB, et quand — et n'a pas à peser sur l'écran le reste du temps.
 */
function RibAccessLog({ events }: { events: RibEvent[] }) {
  if (events.length === 0) return null;

  const format = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-faint hover:text-ink">
        Journal des accès ({events.length})
      </summary>
      <ul className="mt-2 space-y-1.5">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-soft">
            <span className="tabular-nums text-ink-faint">{format.format(new Date(event.createdAt))}</span>
            <span className="font-medium">{RIB_EVENT_LABELS[event.eventType] ?? event.eventType}</span>
            <span className="text-ink-faint">· {event.profileLabel ?? "Auteur inconnu"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Dix derniers accès. Le journal est conservé un an, puis purgé automatiquement.
      </p>
    </details>
  );
}

/**
 * Forfait shooting vendu dans la formule.
 *
 * Son prix ne s'ajoute pas à l'addition au moment du tournage : il est lissé
 * sur la période et déjà compris dans chaque mois de gestion. Ce qui se suit
 * ici, c'est le cycle — l'échéance suivante et la date convenue.
 */
function ShootingPanel({
  shooting,
  dueOn,
  plannedOn,
  lines,
  contractStartDate,
  shootingDates,
  pending,
  onDecide,
}: {
  shooting: ShootingPlan;
  dueOn: string | null;
  plannedOn: string | null;
  lines: EditorLine[];
  contractStartDate: string | null;
  shootingDates: string[];
  pending: boolean;
  onDecide: (lineId: string, included: boolean) => void;
}) {
  const formatDay = (date: string) => new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

  const tally = shootingTally(lines);
  const classification = classifyShootings({
    plan: shooting,
    contractStartDate,
    dates: shootingDates,
  });
  const shootingLines = lines.filter((line) => isShootingLine(line.serviceKey));
  const pendingLines = shootingLines
    .filter((line) => line.forfaitIncluded === null || line.forfaitIncluded === undefined)
    .map((line) => {
      const entry = classification.get(line.performedOn);
      return { line, classification: entry ?? null, alreadyUsed: (entry?.rankInPeriod ?? 1) > 1 };
    });
  // Compris dans le forfait, alors que la période avait déjà donné le sien.
  const suspicious = shootingLines
    .filter((line) => line.forfaitIncluded === true)
    .map((line) => ({ line, entry: classification.get(line.performedOn) }))
    .filter((row) => (row.entry?.rankInPeriod ?? 1) > 1);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Forfait shooting</p>
          <h2 className="mt-1 font-semibold">{shootingPlanSummary(shooting)}</h2>
        </div>
        <span className="badge bg-[#e8f2ff] text-[#0b5e9f]">
          {formatEuros(shootingMonthlyCostCents(shooting))} / mois
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        Soit {shootingsPerYear(shooting)} shooting{shootingsPerYear(shooting) > 1 ? "s" : ""} par an,
        étalés sur la facture : le montant est déjà compris dans chaque mois de gestion,
        et les shootings réalisés apparaissent à zéro euro dans l&apos;addition pour ne pas
        être payés deux fois.
        {plannedOn
          ? ` Prochain shooting calé le ${formatDay(plannedOn)}.`
          : dueOn ? ` Prochaine échéance le ${formatDay(dueOn)} — le rappel s'ouvre avant, sur le tableau de bord.` : ""}
      </p>

      {/* Ce que le forfait a couvert, et ce qu'il a fait facturer en plus. */}
      <p className="mt-3 grid gap-2 rounded-2xl bg-canvas p-3 text-xs sm:grid-cols-3">
        <span className="flex items-center justify-between gap-2">
          <span className="text-ink-faint">Compris dans le forfait</span>
          <strong>{tally.included}</strong>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="text-ink-faint">Supplémentaires facturés</span>
          <strong>{tally.extra} · {formatEuros(tally.extraCents)}</strong>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={tally.pending > 0 ? "font-semibold text-state-changes" : "text-ink-faint"}>À catégoriser</span>
          <strong className={tally.pending > 0 ? "text-state-changes" : ""}>{tally.pending}</strong>
        </span>
      </p>

      {/*
        Panneau de rattrapage, appelé à disparaître.
        
        Tant qu'un shooting n'est pas tranché, on ignore s'il était compris dans
        le forfait ou vendu en plus — et un supplémentaire oublié, c'est une
        prestation offerte sans le savoir. La liste s'efface d'elle-même quand
        tout est catégorisé.
      */}
      {pendingLines.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-state-changes bg-state-changes/5 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-state-changes text-white">
              <Icon name="warning" className="h-4 w-4"/>
            </span>
            <div className="min-w-0">
              <strong className="text-sm text-state-changes">
                {pendingLines.length} shooting{pendingLines.length > 1 ? "s" : ""} à catégoriser
              </strong>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                Chacun est-il compris dans le forfait, déjà réglé par le lissage
                mensuel, ou vendu en plus et donc à facturer ? Rien n&apos;est
                facturé tant que la question n&apos;est pas tranchée.
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {pendingLines.map(({ line, classification, alreadyUsed }) => (
              <li key={line.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong className="text-sm">{line.label}</strong>
                  <span className="text-xs text-ink-faint">{formatDay(line.performedOn)}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {classification
                    ? alreadyUsed
                      ? `Le forfait de la période ouverte le ${formatDay(classification.periodStart)} a déjà été utilisé : celui-ci a été vendu en plus.`
                      : `Premier shooting de la période ouverte le ${formatDay(classification.periodStart)} : c'est celui du forfait.`
                    : "Hors période de gestion connue."}
                  {line.note ? ` · ${line.note}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={alreadyUsed ? "btn-secondary" : "btn-primary"}
                    disabled={pending}
                    onClick={() => onDecide(line.id, true)}
                  >
                    Compris dans le forfait — 0 €
                  </button>
                  <button
                    type="button"
                    className={alreadyUsed ? "btn-primary" : "btn-secondary"}
                    disabled={pending}
                    onClick={() => onDecide(line.id, false)}
                  >
                    Supplémentaire — {formatEuros(findService(line.serviceKey)?.unitPriceCents ?? 0)} à facturer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Seconde vérification : un shooting déclaré compris alors que le forfait
        de sa période l'était déjà. C'est l'erreur qui coûte — une prestation
        vendue, offerte par inadvertance.
      */}
      {suspicious.length > 0 && (
        <div className="mt-3 rounded-2xl border border-[#f0c36d] bg-[#fff8ec] p-4">
          <strong className="text-sm text-[#8a5700]">
            {suspicious.length} shooting{suspicious.length > 1 ? "s" : ""} à 0 € alors que le forfait de la période était déjà pris
          </strong>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {suspicious.map((entry) => formatDay(entry.line.performedOn)).join(" · ")} — supplémentaires à facturer ?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suspicious.map((entry) => (
              <button
                key={entry.line.id}
                type="button"
                className="btn-secondary"
                disabled={pending}
                onClick={() => onDecide(entry.line.id, false)}
              >
                Facturer celui du {formatDay(entry.line.performedOn)}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
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
  onDelete,
}: {
  months: InvoiceMonth[];
  pending: boolean;
  onAdvance: (month: string, status: string) => void;
  onDelete: (month: string) => void;
}) {
  const remaining = pendingInvoiceCount(months);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Facturation directe</h2>
        <p className="text-xs text-ink-faint">
          {remaining === 0
            ? "Tout est facturé et prélevé."
            : `${remaining} mois à traiter`}
        </p>
      </div>

      {months.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune prestation à facturer. Ajoutez-en une : elle ouvrira la facture de son mois.
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

                  {/*
                    Supprimer efface les prestations du mois : sans elles la
                    facture n'a plus d'objet. Irréversible, donc confirmé, et
                    fermé dès la facture établie.
                  */}
                  {month.status === "a_faire" && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-state-changes hover:underline"
                      disabled={pending}
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Supprimer la facture de ${month.label} ?\n\n`
                          + `${month.lines.length} prestation${month.lines.length > 1 ? "s" : ""} `
                          + `(${formatEuros(month.totalCents)}) seront définitivement retirées.`,
                        );
                        if (confirmed) onDelete(month.month);
                      }}
                    >
                      Supprimer la facture
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
  shooting,
  contractStartDate,
  contractEndDate,
}: {
  summary: BudgetSummary;
  cadence: MonthlyCadence;
  shooting: ShootingPlan | null;
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
  // Le shooting du forfait pèse sur le coût mensuel : il doit se lire ici aussi.
  const rhythmWithShooting = shooting
    ? [rhythm, shootingPlanSummary(shooting).toLocaleLowerCase("fr")].filter(Boolean).join(" · ")
    : rhythm;

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
          Rythme vendu : {rhythmWithShooting || "aucun"} par mois, soit{" "}
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
            alert.level === "info"
              ? "border-state-approved/30 bg-state-approved/5"
              : alert.level === "reliquat"
                ? "border-[#f0c36d] bg-[#fff8ec]"
                : "border-state-changes/40 bg-state-changes/5"
          }`}
        >
          <strong className={`text-sm ${alert.level === "info" ? "text-state-approved" : alert.level === "reliquat" ? "text-[#8a5700]" : "text-state-changes"}`}>
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
