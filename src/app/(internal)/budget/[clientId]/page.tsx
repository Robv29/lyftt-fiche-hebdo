import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { billableLines, budgetSummary, type BillingMode, type BudgetLine } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { BudgetEditor } from "./BudgetEditor";
import { cadenceFromNotes, customMonthlyFromNotes, shootingPlanFromNotes, syncManagementMonths } from "@/lib/budget/management-months";
import { invoiceMonths, type InvoiceStatus } from "@/lib/domain/invoicing";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { logRibAccess } from "@/lib/internal/rib-audit";
import { isShootingLine, shootingSchedule } from "@/lib/domain/budget";

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
      .select("billing_mode, budget_cents, note, rib_storage_path, rib_file_name, rib_uploaded_at")
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
      shooting: shootingPlanFromNotes(client.notes),
      customMonthly: customMonthlyFromNotes(client.notes),
    });
  }

  const { data: invoices } = await supabase
    .from("client_invoices")
    .select("period_month, status")
    .eq("client_id", clientId);

  const { data: rawLines } = await supabase
    .from("client_budget_lines")
    .select("id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, note, billed_directly, forfait_included")
    .eq("client_id", clientId)
    .order("performed_on", { ascending: false });

  let settings: { monthlyCadence?: MonthlyCadence } = {};
  try {
    settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {};
  } catch {
    settings = {};
  }

  const lines: (BudgetLine & { note: string | null; forfaitIncluded: boolean | null })[] = (rawLines ?? []).map((row) => ({
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
    // Null tant que personne n'a dit si le shooting était compris ou vendu en plus.
    forfaitIncluded: (row.forfait_included as boolean | null) ?? null,
  }));

  const invoiceStatuses = Object.fromEntries(
    (invoices ?? []).map((row) => [row.period_month as string, row.status as InvoiceStatus]),
  );
  const mode = (budget?.billing_mode ?? "comptant") as BillingMode;
  // En financement, seules les prestations refusées par l'organisme se facturent.
  // Le début de gestion borne le rattachement : rien ne se facture avant lui.
  const months = invoiceMonths(
    billableLines(lines, mode),
    invoiceStatuses,
    client.contract_start_date as string | null,
  );

  const cadence = settings.monthlyCadence ?? {};
  const shooting = shootingPlanFromNotes(client.notes);
  const customMonthly = customMonthlyFromNotes(client.notes);
  const today = todayInParis();
  const summary = budgetSummary({
    billingMode: mode,
    annualBudgetCents: budget?.budget_cents ?? 0,
    lines,
    cadence,
    shooting,
    customMonthly,
    ribOnFile: Boolean(budget?.rib_storage_path),
    contractStartDate: client.contract_start_date,
    contractEndDate: client.contract_end_date,
    today,
  });

  /*
   * Le RIB vit dans le bucket privé : rien ne s'affiche sans URL signée, qui
   * n'est valable qu'une heure. Elle est donc calculée à chaque affichage.
   *
   * C'est ici, et non au clic sur le fichier, que l'accès se joue : une fois
   * l'URL signée remise au navigateur, les coordonnées bancaires sont
   * consultables. L'événement est donc consigné au moment où l'URL est
   * délivrée.
   */
  let ribUrl: string | null = null;
  if (budget?.rib_storage_path) {
    ribUrl = (await resolveMediaUrl({
      storagePath: budget.rib_storage_path as string,
      previewPath: null,
      purgedAt: null,
      previewPurgedAt: null,
    })).url;

    await logRibAccess({
      clientId,
      eventType: "viewed",
      profile,
      metadata: { fileName: budget.rib_file_name ?? null },
    });
  }

  /*
   * Journal des accès, lu par le client utilisateur : la policy réserve la
   * lecture aux `super_admin`, si bien que la base tranche elle aussi, et pas
   * seulement la garde du haut de cette page.
   *
   * Chargé après l'événement de consultation ci-dessus, qui n'a donc pas à
   * apparaître dans la liste qu'il produit.
   */
  const { data: ribEvents } = await supabase
    .from("client_rib_events")
    .select("id, event_type, profile_label, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(10);

  /*
   * Cycle du shooting vendu : les dates réalisées ou calées sont des lignes de
   * l'addition, à zéro euro — le forfait est déjà réglé par le lissage mensuel.
   */
  const shootingDates = lines
    .filter((line) => isShootingLine(line.serviceKey))
    .map((line) => line.performedOn)
    .sort();
  const schedule = shootingSchedule({
    plan: shooting,
    lastDoneOn: [...shootingDates].reverse().find((date) => date <= today) ?? null,
    contractStartDate: client.contract_start_date,
    today,
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
        shooting={shooting}
        shootingDates={shootingDates}
        shootingDueOn={schedule?.dueOn ?? null}
        shootingPlannedOn={shootingDates.find((date) => date > today) ?? null}
        initialMode={mode}
        initialBudgetCents={budget?.budget_cents ?? 0}
        initialNote={budget?.note ?? ""}
        ribEvents={(ribEvents ?? []).map((event) => ({
          id: event.id as string,
          eventType: event.event_type as string,
          profileLabel: (event.profile_label as string | null) ?? null,
          createdAt: event.created_at as string,
        }))}
        rib={{
          fileName: (budget?.rib_file_name as string | null) ?? null,
          uploadedAt: (budget?.rib_uploaded_at as string | null) ?? null,
          url: ribUrl,
        }}
        lines={lines}
        months={months}
        summary={summary}
      />
    </div>
  );
}
