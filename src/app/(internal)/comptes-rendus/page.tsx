import Link from "next/link";
import { redirect } from "next/navigation";
import { denyCommercial } from "@/lib/internal/authorization";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { EmptyState, PageHeader } from "@/components/ui";
import {
  buildTrackingReportHistory,
  trackingMonthLabel,
} from "@/lib/domain/monthly-tracking";
import { ReportForm, type ReportCard } from "./ReportForm";

/**
 * Les comptes rendus de suivi mensuel à remplir.
 *
 * Un écran, et pas un recoin d'un autre : la tâche a une échéance, un
 * responsable et un formulaire, et elle se signale au tableau de bord, dans la
 * navigation et sur le calendrier de production. Ce qui est rempli reste
 * lisible en dessous quelques mois — c'est la preuve que le travail est fait,
 * et le moyen de corriger une saisie le lendemain.
 *
 * Le périmètre est tenu par la RLS : chacun ne voit que les clients qu'il suit,
 * et l'encadrement voit tout. Aucun montant ne figure sur cette table.
 */
export const dynamic = "force-dynamic";

const FILLED_SHOWN = 12;

export default async function ComptesRendusPage() {
  await denyCommercial();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const today = todayInParis();

  /*
   * Deux requêtes, chacune filtrée et triée pour ce qu'elle alimente. Une seule
   * fenêtre de 200 lignes triée par échéance croissante finissait par ne plus
   * contenir que des comptes rendus remplis : l'écran annonçait « rien à
   * remplir » alors que la pastille du menu, elle, compte sans plafond.
   */
  const columns =
    "id, client_id, service_key, period_month, due_on, status, improvements, stats, filled_at, clients ( name ), filled:filled_by ( full_name )";
  const [{ data: todoRows, error: todoError }, { data: doneRows, error: doneError }] = await Promise.all([
    supabase
      .from("client_tracking_reports")
      .select(columns)
      .eq("status", "a_faire")
      .order("due_on", { ascending: true }),
    supabase
      .from("client_tracking_reports")
      .select(columns)
      .eq("status", "rempli")
      .order("period_month", { ascending: false })
      .limit(FILLED_SHOWN),
  ]);
  const error = todoError ?? doneError;

  if (error) {
    console.error("[comptes rendus] chargement impossible", error.message);
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Suivi mensuel" title="Comptes rendus"/>
        <p className="card px-4 py-8 text-center text-sm text-state-changes">
          La liste n’a pas pu être chargée. Réessayez dans un instant ; si le problème persiste,
          l’erreur technique est : {error.message}
        </p>
      </div>
    );
  }

  const nameOf = (row: Record<string, unknown>) =>
    (row.clients as unknown as { name: string } | null)?.name ?? "Client";

  const todo: ReportCard[] = (todoRows ?? [])
    .map((row) => ({
      id: row.id as string,
      serviceKey: row.service_key as string,
      clientName: nameOf(row),
      monthLabel: trackingMonthLabel(String(row.period_month).slice(0, 10)),
      dueOn: String(row.due_on).slice(0, 10),
      overdue: String(row.due_on).slice(0, 10) < today,
      stats: row.stats,
      improvements: (row.improvements as string | null) ?? null,
    }));

  /*
   * Ce qui est rempli : relu par la même mécanique que l'historique du client,
   * pour que les chiffres et les ratios s'y lisent exactement pareil. Le nom du
   * client, lui, n'appartient pas au compte rendu : il est repris à côté.
   */
  const filledRows = doneRows ?? [];
  const clientNames = new Map(filledRows.map((row) => [row.id as string, nameOf(row)]));
  const filled = buildTrackingReportHistory(filledRows.map((row) => ({
    id: row.id as string,
    serviceKey: row.service_key as string,
    periodMonth: String(row.period_month).slice(0, 10),
    improvements: (row.improvements as string | null) ?? null,
    stats: row.stats,
    filledAt: (row.filled_at as string | null) ?? null,
    filledByName: (row.filled as unknown as { full_name: string } | null)?.full_name ?? null,
  }))).slice(0, FILLED_SHOWN);

  const late = todo.filter((report) => report.overdue).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Suivi mensuel"
        title="Comptes rendus"
        description="Pour chaque prestation de suivi vendue : les améliorations faites et les chiffres du mois écoulé. Enregistré, le compte rendu rejoint l’historique du client."
        actions={late > 0
          ? <span className="badge bg-state-changes/10 text-state-changes">{late} en retard</span>
          : undefined}
      />

      {todo.length === 0 ? (
        <EmptyState
          icon="check"
          title="Aucun compte rendu à remplir"
          description="Les comptes rendus du mois écoulé s’ouvrent au premier du mois suivant, et sont attendus le 8 — avant le premier rendez-vous proposé au client."
        />
      ) : (
        <div className="space-y-4">
          {todo.map((report) => <ReportForm key={report.id} report={report}/>)}
        </div>
      )}

      {filled.length > 0 && (
        <section className="section-card">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">Derniers remplis</p>
              <h2 className="mt-1 font-semibold">Comptes rendus enregistrés</h2>
            </div>
            <Link href="/historique" className="text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">
              Historique client →
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {filled.map((report) => (
              <li key={report.id} className="px-5 py-4">
                <p className="text-sm font-semibold">
                  {clientNames.get(report.id) ?? "Client"} · {report.productLabel} — {report.monthLabel}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {report.figures.map((figure) => (
                    <span key={figure.label} className="text-ink-soft">
                      {figure.label} <strong className="tabular-nums">{figure.text}</strong>
                    </span>
                  ))}
                  {report.ratios.map((ratio) => (
                    <span key={ratio.key} className="text-[#0b5e9f]">
                      {ratio.label} <strong className="tabular-nums">{ratio.text}</strong>
                    </span>
                  ))}
                </div>
                {report.improvements && (
                  <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-soft">
                    {report.improvements}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
