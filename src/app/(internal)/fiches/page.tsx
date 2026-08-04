import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deadlineState, formatPeriod } from "@/lib/domain/deadline";
import { sheetStatusLabel } from "@/lib/domain/types";

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
      <h1 className="text-xl font-semibold">Fiches hebdomadaires</h1>

      {(sheets ?? []).length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune fiche pour le moment.
        </p>
      ) : (
        <ul className="space-y-2">
          {(sheets ?? []).map((sheet) => {
            const client = sheet.clients as unknown as { name: string } | null;
            const info = sheet.validation_deadline_at
              ? deadlineState(new Date(sheet.validation_deadline_at))
              : null;

            return (
              <li key={sheet.id} className="card">
                <Link
                  href={`/fiches/${sheet.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-canvas"
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
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
