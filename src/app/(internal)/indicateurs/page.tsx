import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import type { TicketType } from "@/lib/domain/ticket-types";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

/**
 * §23 — Indicateurs.
 *
 * Volontairement descriptifs : ils servent à piloter la charge, pas à noter
 * les personnes.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ depuis?: string }>;
}) {
  const filters = await searchParams;
  const since =
    filters.depuis ?? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const supabase = await createSupabaseServerClient();

  const { data: sheets } = await supabase
    .from("weekly_sheets")
    .select("id, status, sent_to_client_at, first_viewed_at, approved_at, validation_deadline_at, clients ( name )")
    .gte("period_start", since);

  const { data: tickets } = await supabase
    .from("client_tickets")
    .select("id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at, clients ( name )")
    .gte("submitted_at", `${since}T00:00:00Z`);

  const { data: versions } = await supabase
    .from("weekly_sheet_versions")
    .select("weekly_sheet_id, version_number");

  const sheetList = sheets ?? [];
  const ticketList = tickets ?? [];

  const sent = sheetList.filter((s) => s.sent_to_client_at);
  const viewed = sent.filter((s) => s.first_viewed_at);
  const approved = sheetList.filter((s) =>
    ["approved_by_client", "tacitly_approved"].includes(s.status),
  );

  const sheetsWithTickets = new Set(
    ticketList.map((t) => t.weekly_sheet_id).filter(Boolean),
  );

  const approvedWithoutCorrection = sent.filter(
    (s) => !sheetsWithTickets.has(s.id) && s.status === "approved_by_client",
  );

  const beforeDeadline = approved.filter(
    (s) =>
      s.approved_at &&
      s.validation_deadline_at &&
      new Date(s.approved_at) <= new Date(s.validation_deadline_at),
  );

  const responseDelays = sent
    .filter((s) => s.first_viewed_at && s.sent_to_client_at)
    .map(
      (s) =>
        (new Date(s.first_viewed_at!).getTime() - new Date(s.sent_to_client_at!).getTime()) /
        3_600_000,
    );

  const correctionDelays = ticketList
    .filter((t) => t.resolved_at)
    .map(
      (t) =>
        (new Date(t.resolved_at!).getTime() - new Date(t.submitted_at).getTime()) /
        3_600_000,
    );

  const byType = new Map<TicketType, number>();
  for (const ticket of ticketList) {
    byType.set(ticket.ticket_type, (byType.get(ticket.ticket_type) ?? 0) + 1);
  }

  const byClient = new Map<string, number>();
  for (const ticket of ticketList) {
    const name = (ticket.clients as unknown as { name: string } | null)?.name ?? "—";
    byClient.set(name, (byClient.get(name) ?? 0) + 1);
  }

  const versionCounts = new Map<string, number>();
  for (const version of versions ?? []) {
    versionCounts.set(
      version.weekly_sheet_id,
      Math.max(versionCounts.get(version.weekly_sheet_id) ?? 0, version.version_number),
    );
  }
  const averageVersions = average([...versionCounts.values()]);

  const outOfScope = ticketList.filter((t) => t.status === "out_of_scope").length;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Performance opérationnelle" title="Indicateurs" description={`Vue descriptive de l’activité depuis le ${since}, sans classement individuel.`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon="send" label="Fiches envoyées" value={sent.length} />
        <Metric icon="users" label="Taux de consultation" value={percent(viewed.length, sent.length)} />
        <Metric
          icon="check"
          label="Validées sans correction"
          value={percent(approvedWithoutCorrection.length, sent.length)}
        />
        <Metric
          icon="clock"
          label="Validées avant échéance"
          value={percent(beforeDeadline.length, approved.length)}
        />
        <Metric icon="message"
          label="Tickets par fiche"
          value={sent.length ? (ticketList.length / sent.length).toFixed(1) : "—"}
        />
        <Metric icon="clock" label="Délai moyen de réponse client" value={hours(average(responseDelays))} />
        <Metric icon="layers" label="Délai moyen de correction" value={hours(average(correctionDelays))} />
        <Metric
          icon="copy"
          label="Versions par fiche"
          value={averageVersions ? averageVersions.toFixed(1) : "—"}
        />
        <Metric icon="warning" label="Tickets hors périmètre" value={outOfScope} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
            Tickets par type
          </h2>
          <ul className="divide-y divide-line">
            {[...byType.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <li
                  key={type}
                  className="flex items-baseline justify-between px-4 py-2 text-sm"
                >
                  <span>{getTicketTypeDefinition(type).label}</span>
                  <span className="text-ink-soft">{count}</span>
                </li>
              ))}
            {byType.size === 0 && (
              <li className="px-4 py-6 text-sm text-ink-faint">Aucun ticket.</li>
            )}
          </ul>
        </section>

        <section className="card">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
            Corrections par client
          </h2>
          <ul className="divide-y divide-line">
            {[...byClient.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <li
                  key={name}
                  className="flex items-baseline justify-between px-4 py-2 text-sm"
                >
                  <span>{name}</span>
                  <span className="text-ink-soft">{count}</span>
                </li>
              ))}
            {byClient.size === 0 && (
              <li className="px-4 py-6 text-sm text-ink-faint">Aucun ticket.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="metric-card lift-card">
      <span className="metric-icon"><Icon name={icon} className="h-5 w-5"/></span>
      <p className="mt-5 text-xs font-medium text-ink-soft">{label}</p>
      <p className="mt-1 text-[30px] font-semibold tracking-[-.04em]">{value}</p>
    </div>
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percent(part: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)} %`;
}

function hours(value: number): string {
  if (!value) return "—";
  return value < 24 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} j`;
}
