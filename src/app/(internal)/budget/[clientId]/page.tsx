import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { budgetSummary, type BillingMode, type BudgetLine } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { BudgetEditor } from "./BudgetEditor";

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

  const [{ data: client }, { data: budget }, { data: rawLines }] = await Promise.all([
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
    supabase
      .from("client_budget_lines")
      .select("id, label, billing, unit_price_cents, quantity, months, performed_on, note")
      .eq("client_id", clientId)
      .order("performed_on", { ascending: false }),
  ]);

  if (!client) notFound();

  let settings: { monthlyCadence?: MonthlyCadence } = {};
  try {
    settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {};
  } catch {
    settings = {};
  }

  const lines: (BudgetLine & { note: string | null })[] = (rawLines ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    billing: row.billing as BudgetLine["billing"],
    unitPriceCents: row.unit_price_cents as number,
    quantity: Number(row.quantity),
    months: row.months as number | null,
    performedOn: row.performed_on as string,
    note: (row.note as string | null) ?? null,
  }));

  const cadence = settings.monthlyCadence ?? {};
  const summary = budgetSummary({
    billingMode: (budget?.billing_mode ?? "comptant") as BillingMode,
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
        initialMode={(budget?.billing_mode ?? "comptant") as BillingMode}
        initialBudgetCents={budget?.budget_cents ?? 0}
        initialNote={budget?.note ?? ""}
        lines={lines}
        summary={summary}
      />
    </div>
  );
}
