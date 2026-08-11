import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { billableLines, budgetSummary, type BillingMode, type BudgetLine } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { BudgetEditor } from "./BudgetEditor";
import { cadenceFromNotes, syncManagementMonths } from "@/lib/budget/management-months";
import { invoiceMonths, type InvoiceStatus } from "@/lib/domain/invoicing";

export const dynamic = "force-dynamic";

export default async function ClientBudgetPage({ params }: { params: Promise<{ clientId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") {
    return (
      <p className="card px-4 py-8 text-center text-sm text-ink-faint">
        Cet écran est réservé aux administrateurs.
      </p>
    );
  }

  const { clientId } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: client }, { data: budget }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, notes, contract_start_date, contract_end_date, pause_start_date, pause_end_date")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("client_budgets")
      .select("billing_mode, budget_cents, note")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);

  if (!client) notFound();

  /*
   * La tâche planifiée inscrit les mois écoulés chaque nuit ; on rattrape ici
   * ce qui s'est achevé depuis, pour que l'addition affichée soit toujours à
   * jour. L'opération est sans effet quand il n'y a rien à ajouter.
   */
  {
    await syncManagementMonths(supabase, {
      id: client.id,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      cadence: cadenceFromNotes(client.notes),
    });
  }

  const { data: invoices } = await supabase
    .from("client_invoices")
    .select("period_month, status")
    .eq("client_id", clientId);

  const { data: rawLines } = await supabase
    .from("client_budget_lines")
    .select("id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, note, billed_directly")
    .eq("client_id", clientId)
    .order("performed_on", { ascending: false });

  let settings: { monthlyCadence?: MonthlyCadence } = {};
  try {
    settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {};
  } catch {
    settings = {};
  }

  const lines: (BudgetLine & { note: string | null })[] = (rawLines ?? []).map((row) => ({
    id: row.id as string,
    serviceKey: row.service_key as string,
    label: row.label as string,
    billing: row.billing as BudgetLine["billing"],
    unitPriceCents: row.unit_price_cents as number,
    quantity: Number(row.quantity),
    months: row.months as number | null,
    performedOn: row.performed_on as string,
    billedDirectly: Boolean(row.billed_directly),
    note: (row.note as string | null) ?? null,
  }));

  const invoiceStatuses = Object.fromEntries(
    (invoices ?? []).map((row) => [row.period_month as string, row.status as InvoiceStatus]),
  );
  const mode = (budget?.billing_mode ?? "comptant") as BillingMode;
  // En financement, seules les prestations refusées par l'organisme se facturent.
  const months = invoiceMonths(billableLines(lines, mode), invoiceStatuses);

  const cadence = settings.monthlyCadence ?? {};
  const summary = budgetSummary({
    billingMode: mode,
    annualBudgetCents: budget?.budget_cents ?? 0,
    lines,
    cadence,
    contractStartDate: client.contract_start_date,
    contractEndDate: client.contract_end_date,
    today: todayInParis(),
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/budget" className="text-xs text-ink-faint hover:underline">← Tous les budgets</Link>
        <p className="eyebrow mt-3">Direction · Budget</p>
        <h1 className="page-title mt-1">{client.name}</h1>
      </div>

      <BudgetEditor
        clientId={client.id}
        clientName={client.name}
        contractStartDate={client.contract_start_date}
        contractEndDate={client.contract_end_date}
        cadence={cadence}
        initialMode={mode}
        initialBudgetCents={budget?.budget_cents ?? 0}
        initialNote={budget?.note ?? ""}
        lines={lines}
        months={months}
        summary={summary}
      />
    </div>
  );
}
