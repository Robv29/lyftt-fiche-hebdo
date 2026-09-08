import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { denyCommercial } from "@/lib/internal/authorization";
import { formatEuros } from "@/lib/domain/budget";
import { accessibleShootingClients, readShootings } from "@/lib/shootings/query";
import { ShootingReminders } from "../ShootingReminders";
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
    // Une facture partie fige le tri : requalifier changerait un montant transmis.
    const settled = new Set(
      (invoices ?? [])
        .filter((row) => row.status === "faite" || row.status === "prelevement_programme")
        .map((row) => `${row.client_id as string}|${String(row.period_month).slice(0, 7)}`),
    );
    toClassify = entries.filter((entry) =>
      entry.forfaitIncluded === null
      && entry.status !== "annule"
      && !settled.has(`${entry.clientId}|${entry.month}`));
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
              Compris au forfait, ou vendu en plus&nbsp;? Tant que ce n&apos;est pas tranché, le
              shooting n&apos;est ni facturé ni écarté. Le tri se fait dans le budget du client.
            </p>
          </header>
          <ul className="divide-y divide-line">
            {toClassify.map((entry) => (
              <li key={entry.lineId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.clientName}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">
                    {entry.label} · {new Intl.DateTimeFormat("fr-FR", {
                      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
                    }).format(new Date(`${entry.date}T00:00:00Z`))}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold">{formatEuros(entry.amountCents)}</span>
                <Link
                  href={`/budget/${entry.clientId}`}
                  className="shrink-0 rounded-lg bg-state-progress/10 px-2.5 py-1.5 text-xs font-semibold text-state-progress hover:bg-state-progress/20"
                >
                  Classer
                </Link>
              </li>
            ))}
          </ul>
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
