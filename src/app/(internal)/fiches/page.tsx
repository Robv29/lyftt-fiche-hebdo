import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deadlineState, formatPeriod } from "@/lib/domain/deadline";
import { sheetStatusLabel } from "@/lib/domain/types";
import { Icon } from "@/components/Icon";

export default async function SheetsPage() {
  const supabase = await createSupabaseServerClient();

  const { data: sheets } = await supabase
    .from("weekly_sheets")
    .select(
      "id, iso_year, iso_week, period_start, period_end, status, validation_deadline_at, clients ( name )",
    )
    .order("period_start", { ascending: false })
    .limit(60);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Production éditoriale</p><h1 className="page-title mt-1">Planning</h1><p className="mt-2 text-sm text-ink-soft">Toutes les semaines, du brouillon à la validation client.</p></div>
        <Link href="/fiches/nouvelle" className="btn-primary">
          <Icon name="plus" className="h-4 w-4"/>Nouvelle fiche
        </Link>
      </div>

      {(sheets ?? []).length === 0 ? (
        <div className="card flex min-h-64 flex-col items-center justify-center p-8 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#edf4ff] text-[#0759e6]"><Icon name="calendar" className="h-6 w-6"/></span><h2 className="font-semibold">Le planning est vide</h2><p className="mt-1 max-w-sm text-sm text-ink-faint">Créez une fiche : le rythme du client préparera automatiquement le bon nombre de contenus.</p><Link href="/fiches/nouvelle" className="btn-primary mt-5">Créer la première fiche</Link></div>
      ) : (
        <ul className="space-y-2">
          {(sheets ?? []).map((sheet) => {
            const client = sheet.clients as unknown as { name: string } | null;
            const info = sheet.validation_deadline_at
              ? deadlineState(new Date(sheet.validation_deadline_at))
              : null;

            return (
              <li key={sheet.id} className="card lift-card overflow-hidden">
                <Link
                  href={`/fiches/${sheet.id}`}
                  className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-canvas"
                >
                  <span className="text-sm">
                    <strong>{client?.name ?? "Client"}</strong>{" "}
                    <span className="text-ink-soft">
                      semaine {sheet.iso_week} —{" "}
                      {formatPeriod(
                        new Date(`${sheet.period_start}T00:00:00Z`),
                        new Date(`${sheet.period_end}T00:00:00Z`),
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="badge bg-canvas text-ink-soft">
                      {sheetStatusLabel(sheet.status)}
                    </span>
                    {info && (
                      <span className={info.isOverdue ? "text-state-changes" : "text-ink-faint"}>
                        {info.label}
                      </span>
                    )}
                  </span>
                  <Icon name="arrow" className="h-4 w-4 text-ink-faint"/>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
