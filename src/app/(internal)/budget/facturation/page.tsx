import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { lineTotalCents, type BudgetLine } from "@/lib/domain/budget";
import { monthKey, monthLabel, type InvoiceStatus } from "@/lib/domain/invoicing";
import { InvoiceRun, type MonthDossier } from "./InvoiceRun";

export const dynamic = "force-dynamic";

/**
 * Récapitulatif de facturation, tous clients au comptant confondus.
 *
 * Les factures d'un mois s'établissent d'une traite : cet écran les regroupe
 * par mois plutôt que par client, pour qu'une session de facturation se mène
 * de bout en bout sans naviguer de fiche en fiche.
 */
export default async function InvoicingPage() {
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

  const [{ data: clients }, { data: budgets }, { data: lines }, { data: invoices }] =
    await Promise.all([
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("client_budgets").select("client_id, billing_mode"),
      supabase
        .from("client_budget_lines")
        .select("id, client_id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, billed_directly"),
      supabase.from("client_invoices").select("client_id, period_month, status"),
    ]);

  /*
   * Un client sans réglage de budget est au comptant : c'est la valeur par
   * défaut de la colonne, et le cas le plus courant. Le financement est une
   * exception qu'on déclare.
   */
  const financedIds = new Set(
    (budgets ?? [])
      .filter((row) => row.billing_mode === "financement")
      .map((row) => row.client_id as string),
  );
  const nameById = new Map((clients ?? []).map((row) => [row.id as string, row.name as string]));

  const statusByKey = new Map<string, InvoiceStatus>();
  for (const row of invoices ?? []) {
    statusByKey.set(`${row.client_id}|${row.period_month}`, row.status as InvoiceStatus);
  }

  // Mois → client → prestations du mois.
  const byMonth = new Map<string, Map<string, BudgetLine[]>>();
  for (const row of lines ?? []) {
    const clientId = row.client_id as string;
    if (!nameById.has(clientId)) continue;
    /*
     * Chez un client en financement, seules les prestations refusées par son
     * organisme sont à facturer ; le reste est pris sur l'enveloppe. Au
     * comptant, tout se facture, gestion mensuelle comprise.
     */
    const billable = financedIds.has(clientId) ? Boolean(row.billed_directly) : true;
    if (!billable) continue;

    const month = monthKey(row.performed_on as string);
    const clientsOfMonth = byMonth.get(month) ?? new Map<string, BudgetLine[]>();
    const list = clientsOfMonth.get(clientId) ?? [];
    list.push({
      id: row.id as string,
      serviceKey: row.service_key as string,
      label: row.label as string,
      billing: row.billing as BudgetLine["billing"],
      unitPriceCents: row.unit_price_cents as number,
      quantity: Number(row.quantity),
      months: row.months as number | null,
      performedOn: row.performed_on as string,
      billedDirectly: Boolean(row.billed_directly),
    });
    clientsOfMonth.set(clientId, list);
    byMonth.set(month, clientsOfMonth);
  }

  const dossiers: MonthDossier[] = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, clientsOfMonth]) => {
      const rows = [...clientsOfMonth.entries()]
        .map(([clientId, clientLines]) => ({
          clientId,
          clientName: nameById.get(clientId) ?? "Client",
          totalCents: clientLines.reduce((total, line) => total + lineTotalCents(line), 0),
          lineCount: clientLines.length,
          status: statusByKey.get(`${clientId}|${month}`) ?? ("a_faire" as InvoiceStatus),
          details: clientLines
            .sort((a, b) => a.performedOn.localeCompare(b.performedOn))
            .map((line) => `${line.label} · ${line.performedOn}`),
        }))
        .sort((a, b) => a.clientName.localeCompare(b.clientName, "fr"));

      return {
        month,
        label: monthLabel(month),
        clients: rows,
        totalCents: rows.reduce((total, row) => total + row.totalCents, 0),
      };
    });

  return (
    <div className="space-y-6">
      <header>
        <Link href="/budget" className="text-xs text-ink-faint hover:underline">← Budget</Link>
        <p className="eyebrow mt-3">Direction · Comptant</p>
        <h1 className="page-title mt-1">Factures du mois</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Toutes les prestations des clients au comptant, regroupées par mois.
          Marquez un mois entier d&apos;un geste, ou client par client.
        </p>
      </header>

      <InvoiceRun dossiers={dossiers}/>
    </div>
  );
}
