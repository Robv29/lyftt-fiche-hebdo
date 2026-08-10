import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { Icon } from "@/components/Icon";
import { budgetSummary, formatEuros, type BillingMode, type BudgetLine } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { invoiceMonths, pendingInvoiceCount, type InvoiceStatus } from "@/lib/domain/invoicing";

export const dynamic = "force-dynamic";

interface ClientRow {
  id: string;
  name: string;
  notes: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  is_active: boolean;
}

export default async function BudgetPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") {
    return (
      <p className="card px-4 py-8 text-center text-sm text-ink-faint">
        Cet écran est réservé aux administrateurs.
      </p>
    );
  }

  const supabase = await createSupabaseServerClient();
  const today = todayInParis();

  const [{ data: clients }, { data: budgets }, { data: lines }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, notes, contract_start_date, contract_end_date, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase.from("client_budgets").select("client_id, billing_mode, budget_cents"),
    supabase
      .from("client_budget_lines")
      .select("id, client_id, service_key, label, billing, unit_price_cents, quantity, months, performed_on"),
  ]);

  const { data: invoices } = await supabase
    .from("client_invoices")
    .select("client_id, period_month, status");

  const invoiceStatusByClient = new Map<string, Record<string, InvoiceStatus>>();
  for (const row of invoices ?? []) {
    const clientId = row.client_id as string;
    const statuses = invoiceStatusByClient.get(clientId) ?? {};
    statuses[row.period_month as string] = row.status as InvoiceStatus;
    invoiceStatusByClient.set(clientId, statuses);
  }

  const budgetByClient = new Map(
    (budgets ?? []).map((row) => [row.client_id as string, row]),
  );
  const linesByClient = new Map<string, BudgetLine[]>();
  for (const row of lines ?? []) {
    const list = linesByClient.get(row.client_id as string) ?? [];
    list.push({
      id: row.id as string,
      serviceKey: row.service_key as string,
      label: row.label as string,
      billing: row.billing as BudgetLine["billing"],
      unitPriceCents: row.unit_price_cents as number,
      quantity: Number(row.quantity),
      months: row.months as number | null,
      performedOn: row.performed_on as string,
    });
    linesByClient.set(row.client_id as string, list);
  }

  const rows = ((clients ?? []) as ClientRow[]).map((client) => {
    let settings: { monthlyCadence?: MonthlyCadence } = {};
    try {
      settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {};
    } catch {
      settings = {};
    }
    const budget = budgetByClient.get(client.id);
    const summary = budgetSummary({
      billingMode: (budget?.billing_mode ?? "comptant") as BillingMode,
      annualBudgetCents: budget?.budget_cents ?? 0,
      lines: linesByClient.get(client.id) ?? [],
      cadence: settings.monthlyCadence ?? {},
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      today,
    });
    // Un client comptant se suit au nombre de factures encore à traiter.
    const toInvoice = pendingInvoiceCount(invoiceMonths(
      linesByClient.get(client.id) ?? [],
      invoiceStatusByClient.get(client.id) ?? {},
    ));
    return { client, summary, toInvoice };
  });

  const financed = rows.filter((row) => row.summary.applicable);
  const cash = rows.filter((row) => !row.summary.applicable);
  const critical = financed.filter((row) =>
    row.summary.alerts.some((alert) => alert.level === "critique"),
  );

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Direction</p>
        <h1 className="page-title mt-1">Budget</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Suivi des enveloppes de financement. Un budget non consommé à la fin de
          gestion est perdu : l&apos;objectif est de le remplir entièrement.
        </p>
      </header>

      {critical.length > 0 && (
        <section className="card border-state-changes/40 bg-state-changes/5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-state-changes/10 text-state-changes">
              <Icon name="message" className="h-5 w-5"/>
            </span>
            <div>
              <strong className="text-sm text-state-changes">
                {critical.length} client{critical.length > 1 ? "s" : ""} à régulariser
              </strong>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                Date de fin de gestion manquante, budget non renseigné ou déjà dépassé.
                Aucune projection n&apos;est possible tant que ce n&apos;est pas corrigé.
              </p>
              <p className="mt-2 text-xs font-semibold text-state-changes">
                {critical.map((row) => row.client.name).join(" · ")}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Clients en financement</h2>
        {financed.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-ink-faint">
            Aucun client en financement. Ouvrez une fiche pour basculer un client
            du comptant vers le financement.
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {financed.map(({ client, summary }) => {
              const worst = summary.alerts.find((alert) => alert.level === "critique")
                ?? summary.alerts.find((alert) => alert.level === "attention");
              const overspent = summary.remainingCents < 0;
              return (
                <li key={client.id} className={`card lift-card p-5 ${worst?.level === "critique" ? "border-state-changes/40" : ""}`}>
                  <Link href={`/budget/${client.id}`} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{client.name}</h3>
                        <p className="mt-1 text-xs text-ink-faint">
                          {client.contract_end_date
                            ? `Fin de gestion : ${client.contract_end_date}`
                            : "Fin de gestion non renseignée"}
                        </p>
                      </div>
                      <Icon name="arrow" className="mt-1 h-4 w-4 shrink-0 text-ink-faint"/>
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <dt className="text-[11px] text-ink-faint">Budget</dt>
                        <dd className="mt-0.5 text-sm font-semibold">{formatEuros(summary.budgetCents)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-ink-faint">Consommé</dt>
                        <dd className="mt-0.5 text-sm font-semibold">{formatEuros(summary.consumedCents)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-ink-faint">Restant</dt>
                        <dd className={`mt-0.5 text-sm font-semibold ${overspent ? "text-state-changes" : "text-state-approved"}`}>
                          {formatEuros(summary.remainingCents)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Budget consommé : ${summary.consumedPercentage}%`} aria-valuenow={summary.consumedPercentage} aria-valuemin={0} aria-valuemax={100}>
                      <span
                        className={`block h-full origin-left rounded-full transition-transform duration-300 ${overspent ? "bg-state-changes" : summary.consumedPercentage >= 90 ? "bg-state-approved" : "bg-[#1468ff]"}`}
                        style={{ transform: `scaleX(${summary.consumedPercentage / 100})` }}
                      />
                    </div>

                    {worst && (
                      <p className={`mt-3 rounded-xl px-3 py-2 text-[11px] leading-relaxed ${worst.level === "critique" ? "bg-state-changes/10 text-state-changes" : "bg-[#fff4e5] text-[#8a5700]"}`}>
                        {worst.title}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Clients au comptant</h2>
        <p className="text-xs text-ink-faint">
          Facturés à la prestation : aucune enveloppe à suivre, mais une facture à
          établir chaque mois où ils ont consommé.
        </p>
        {cash.length === 0 ? (
          <p className="card px-4 py-6 text-center text-sm text-ink-faint">Aucun client au comptant.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cash.map(({ client, toInvoice }) => (
              <li key={client.id}>
                <Link href={`/budget/${client.id}`} className="card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-canvas">
                  <span className="truncate text-ink-soft">{client.name}</span>
                  {toInvoice > 0
                    ? <span className="badge shrink-0 bg-[#fff4e5] text-[#8a5700]">{toInvoice} à facturer</span>
                    : <span className="badge shrink-0 bg-canvas text-ink-faint">À jour</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
