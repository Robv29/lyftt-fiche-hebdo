import type { TrackingReportHistory } from "@/lib/domain/monthly-tracking";

/**
 * Les comptes rendus de suivi mensuel d'un client, mois après mois.
 *
 * Son propre bloc, au-dessus des semaines, et pour une raison de fond :
 * l'historique hebdomadaire est indexé sur `weekly_sheets`, dont les fiches
 * sont supprimées quatorze jours après leur fin. Un bilan accroché à une
 * semaine aurait été lisible quelques jours puis aurait disparu avec elle,
 * alors que la demande est de le relire mois après mois. Et un mois n'est pas
 * une semaine : le présenter comme telle aurait fait juger « sans accroc » un
 * mois dont on n'a rien d'autre.
 *
 * Ce bloc ne juge rien, il montre : les chiffres relevés, les ratios calculés,
 * et le texte des améliorations tel qu'il a été écrit. La chronologie de la
 * semaine en garde la mention, pour qui remonte le fil.
 */
const dayLabel = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris",
});

export function TrackingReports({ reports }: { reports: TrackingReportHistory[] }) {
  if (reports.length === 0) return null;

  return (
    <section className="section-card">
      <div className="section-card-header">
        <div className="min-w-0">
          <p className="eyebrow">Suivi mensuel · mois après mois</p>
          <h2 className="mt-1 font-semibold">Comptes rendus de suivi</h2>
        </div>
        <span className="badge bg-canvas text-ink-soft">
          {reports.length} mois
        </span>
      </div>

      <ul className="divide-y divide-line">
        {reports.map((report) => (
          <li key={report.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold capitalize">{report.monthLabel}</h3>
              <span className="badge bg-[#e6f6f3] text-[#0f766e]">{report.productLabel}</span>
            </div>

            {/* Les chiffres relevés, puis les ratios — toujours dans cet ordre. */}
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {report.figures.map((figure) => (
                <div key={figure.label} className="rounded-xl bg-canvas px-3 py-2">
                  <p className="text-[11px] leading-tight text-ink-faint">{figure.label}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{figure.text}</p>
                </div>
              ))}
            </div>
            {report.ratios.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {report.ratios.map((ratio) => (
                  <span key={ratio.key} className="text-[#0f766e]">
                    {ratio.label} <strong className="tabular-nums">{ratio.text}</strong>
                  </span>
                ))}
              </div>
            )}

            {report.improvements && (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                {report.improvements}
              </p>
            )}

            <p className="mt-2 text-xs text-ink-faint">
              {report.filledAt
                ? `Rempli le ${dayLabel.format(new Date(report.filledAt))}`
                : "Rempli"}
              {report.filledByName ? ` par ${report.filledByName}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
