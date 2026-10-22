import Link from "next/link";

/**
 * Encart des comptes rendus de suivi mensuel à remplir.
 *
 * Même intention que les shootings à planifier : l'encart n'apparaît que
 * lorsqu'il y a quelque chose à faire, et la colonne ne reste donc jamais
 * vide. La tâche a une échéance — le 8, avant le premier rendez-vous proposé au
 * client — et le retard se dit en toutes lettres, pas seulement en couleur.
 *
 * Aucun montant n'y figure : la table des comptes rendus n'en porte pas, et
 * c'est ce qui permet de montrer cet encart à l'équipe qui suit le client
 * plutôt qu'à la seule direction.
 */
export interface TrackingReportReminderRow {
  id: string;
  clientName: string;
  productLabel: string;
  monthLabel: string;
  dueOn: string;
  overdue: boolean;
}

const shortDay = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", timeZone: "UTC",
});

export function TrackingReportReminders({ rows }: { rows: TrackingReportReminderRow[] }) {
  if (rows.length === 0) return null;

  const late = rows.filter((row) => row.overdue).length;

  return (
    <section className="section-card">
      <div className="section-card-header">
        <div className="min-w-0">
          <p className="eyebrow">Suivi mensuel</p>
          <h2 className="mt-1 font-semibold">Comptes rendus à remplir</h2>
        </div>
        <span className={`badge ${late > 0 ? "bg-state-changes/10 text-state-changes" : "bg-[#e6f6f3] text-[#0f766e]"}`}>
          {late > 0 ? `${late} en retard` : rows.length}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="px-5 py-3">
            <Link href="/comptes-rendus" className="group block">
              <strong className="block truncate text-sm group-hover:text-[#0b63ad]">{row.clientName}</strong>
              <p className="mt-0.5 text-xs text-ink-faint">
                {row.productLabel} · {row.monthLabel}
                {" · "}
                <span className={row.overdue ? "font-semibold text-state-changes" : ""}>
                  {row.overdue ? "attendu le " : "à rendre le "}
                  {shortDay.format(new Date(`${row.dueOn}T12:00:00Z`))}
                </span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
