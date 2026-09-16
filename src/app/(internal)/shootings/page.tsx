import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { denyCommercial } from "@/lib/internal/authorization";
import { awaitsShootingDecision } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { isOnSettledInvoice, type InvoiceStatus } from "@/lib/domain/invoicing";
import { shootingDecisionSuggestion, shootingPlanFromNotes } from "@/lib/domain/shooting-decision";
import { accessibleShootingClients, readShootings } from "@/lib/shootings/query";
import { ShootingReminders } from "../ShootingReminders";
import { ShootingClassifier, type ShootingToClassify } from "./ShootingClassifier";
import { ShootingsView } from "./ShootingsView";

export const dynamic = "force-dynamic";

/**
 * Onglet Shootings.
 *
 * Répond aux trois questions du cahier des charges : ce qu'on a réalisé, ce
 * qui est prévu, et quelle activité de production cela représente.
 *
 * Les données viennent du même module que le tableau de bord. Les « prochaines
 * dates à caler » y sont reprises telles quelles, avec leurs boutons : caler
 * une date ici ou depuis l'accueil est le même geste, et produit la même ligne.
 */
export default async function ShootingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  await denyCommercial();

  const supabase = await createSupabaseServerClient();
  const clients = await accessibleShootingClients(supabase);
  const { entries, due } = await readShootings(clients);

  /*
   * Shootings encore à classer.
   *
   * Un shooting non classé n'est ni facturé ni écarté : c'est le trou par
   * lequel une prestation part sans facture. La note le dit depuis toujours,
   * mais sans jamais nommer lesquels — il fallait ouvrir les vingt-neuf
   * budgets pour les trouver. Ils sont listés ici.
   *
   * Réservé à la direction : le tri est une décision de facturation, et les
   * montants ne sont pas lisibles par la production.
   */
  const isAdmin = profile.role === "super_admin";
  let toClassify: typeof entries = [];
  if (isAdmin) {
    const { data: invoices } = await supabase
      .from("client_invoices")
      .select("client_id, period_month, status");
    const statusesByClient = new Map<string, Record<string, InvoiceStatus>>();
    for (const row of invoices ?? []) {
      const forClient = statusesByClient.get(row.client_id as string) ?? {};
      forClient[String(row.period_month).slice(0, 10)] = row.status as InvoiceStatus;
      statusesByClient.set(row.client_id as string, forClient);
    }
    const startByClient = new Map(clients.map((client) => [client.id, client.contract_start_date]));
    const today = todayInParis();
    toClassify = entries.filter((entry) =>
      awaitsShootingDecision({
        serviceKey: entry.serviceKey,
        performedOn: entry.date,
        forfaitIncluded: entry.forfaitIncluded,
      }, today)
      && entry.status !== "annule"
      /*
       * Une facture partie fige le tri : requalifier changerait un montant
       * transmis. Celle où la ligne figure vraiment — la même règle que
       * l'action, sans quoi la liste proposerait ce que l'action refuse.
       */
      && !isOnSettledInvoice(
        { performedOn: entry.date },
        startByClient.get(entry.clientId) ?? null,
        statusesByClient.get(entry.clientId) ?? {},
      ));
  }

  /*
   * De quoi trancher sur place : le forfait du client, sa période, son mode de
   * facturation. La proposition se calcule sur les shootings qui ont bien eu
   * lieu — un shooting annulé n'a pas consommé le forfait de sa période.
   */
  let classifyRows: ShootingToClassify[] = [];
  if (toClassify.length > 0) {
    const { data: budgets } = await supabase.from("client_budgets").select("client_id, billing_mode");
    const financed = new Set(
      (budgets ?? [])
        .filter((row) => row.billing_mode && row.billing_mode !== "comptant")
        .map((row) => row.client_id as string),
    );
    const clientById = new Map(clients.map((client) => [client.id, client]));
    classifyRows = toClassify.map((entry) => {
      const client = clientById.get(entry.clientId);
      const plan = shootingPlanFromNotes(client?.notes);
      return {
        lineId: entry.lineId,
        clientId: entry.clientId,
        clientName: entry.clientName,
        label: entry.label,
        date: entry.date,
        serviceKey: entry.serviceKey,
        planServiceKey: plan?.serviceKey ?? null,
        financed: financed.has(entry.clientId),
        billedDirectly: entry.billedDirectly,
        suggestion: shootingDecisionSuggestion({
          plan,
          contractStartDate: client?.contract_start_date ?? null,
          date: entry.date,
          dates: entries
            .filter((other) => other.clientId === entry.clientId && other.status !== "annule")
            .map((other) => other.date),
        }),
      };
    });
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Production</p>
        <h1 className="page-title mt-1">Shootings</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ce qui a été tourné, ce qui est calé, et ce qu&apos;il reste à caler.
        </p>
      </header>

      {due.length > 0 && (
        <ShootingReminders rows={due} />
      )}

      {toClassify.length > 0 && (
        <section className="rounded-2xl border border-state-progress/40 bg-white shadow-sm">
          <header className="border-b border-line px-5 py-4">
            <p className="eyebrow">À classer · direction</p>
            <h2 className="mt-1 font-semibold">
              {toClassify.length} shooting{toClassify.length > 1 ? "s" : ""} sans décision de facturation
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Compris au forfait, vendu en plus, ou pas eu lieu&nbsp;? Tant que ce n&apos;est pas
              tranché, le shooting n&apos;est ni facturé ni écarté. La proposition vient de la
              période du forfait : confirmez, ou corrigez.
            </p>
          </header>
          <ShootingClassifier rows={classifyRows} today={todayInParis()}/>
        </section>
      )}

      <ShootingsView
        shootings={entries.map((entry) => ({
          lineId: entry.lineId,
          clientId: entry.clientId,
          clientName: entry.clientName,
          date: entry.date,
          label: entry.details?.name || entry.label,
          status: entry.status,
          kind: entry.details?.kind ?? null,
          place: entry.details?.place ?? null,
          leadName: entry.details?.leadName ?? null,
          durationMinutes: entry.details?.durationMinutes ?? null,
          deliveryDays: entry.details?.deliveryDays ?? null,
          deliveredOn: entry.details?.deliveredOn ?? null,
          assetsCount: entry.details?.assetsCount ?? null,
        }))}
        clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      />
    </div>
  );
}
