import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CONTENT_BUCKETS, type ContentBucket } from "@/lib/domain/content-buckets";
import type { BucketStatus } from "@/lib/domain/planning";

export interface OverviewRow {
  clientId: string;
  clientName: string;
  hasSheet: boolean;
  topic: string | null;
  done: boolean;
  href: string;
  buckets: Record<ContentBucket, BucketStatus>;
}

function BucketCell({ status, color }: { status: BucketStatus; color: string }) {
  if (status === "none") return <span className="text-ink-faint">—</span>;
  if (status === "ready") {
    return (
      <span className="mx-auto grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: color }}>
        <Icon name="check" className="h-3.5 w-3.5"/>
      </span>
    );
  }
  return (
    <span className="mx-auto grid h-6 w-6 place-items-center rounded-full border-2 text-[11px] font-bold" style={{ borderColor: color, color }}>
      !
    </span>
  );
}

/**
 * Vue Monday : chaque client, chaque famille de contenu, prêt ou pas.
 *
 * Le pourcentage de complétion d'une fiche ne dit pas *quoi* manque ; ce
 * tableau répond directement, colonne par colonne, sans ouvrir chaque fiche.
 */
export function ProductionOverview({ rows, weekLabel, weekOffset, maxWeekOffset }: { rows: OverviewRow[]; weekLabel: string; weekOffset: number; maxWeekOffset: number }) {
  const done = rows.filter((row) => row.done).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          {weekLabel} · {done} client{done > 1 ? "s" : ""} prêt{done > 1 ? "s" : ""} sur {rows.length}.
        </p>
        <div className="flex items-center gap-1.5">
          {weekOffset > 0 ? (
            <Link href={`/production?week=${weekOffset - 1}`} className="btn-secondary min-h-9 px-3 text-xs">
              <Icon name="arrow" className="h-3.5 w-3.5 rotate-180"/>{weekOffset === 1 ? "Cette semaine" : "Semaine précédente"}
            </Link>
          ) : null}
          {weekOffset < maxWeekOffset && (
            <Link href={`/production?week=${weekOffset + 1}`} className="btn-secondary min-h-9 px-3 text-xs">
              Semaine suivante<Icon name="arrow" className="h-3.5 w-3.5"/>
            </Link>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-ink-faint">Aucun client actif cette semaine.</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Sujet de la semaine</th>
                  {CONTENT_BUCKETS.map((bucket) => <th key={bucket.key} className="px-2 py-3 text-center">{bucket.label}</th>)}
                  <th className="px-4 py-3 text-right">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.clientId} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3"><Link href={row.href} className="font-semibold hover:underline">{row.clientName}</Link></td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-ink-faint">{row.topic ?? "—"}</td>
                    {CONTENT_BUCKETS.map((bucket) => (
                      <td key={bucket.key} className="px-2 py-3 text-center"><BucketCell status={row.buckets[bucket.key]} color={bucket.accent}/></td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      {!row.hasSheet
                        ? <span className="badge bg-state-changes/10 text-state-changes">Fiche à créer</span>
                        : row.done
                          ? <span className="badge bg-state-approved/10 text-state-approved">Fait</span>
                          : <span className="badge bg-[#fff7e6] text-[#8a5700]">À faire</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
