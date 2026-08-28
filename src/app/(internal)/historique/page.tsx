import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";
import {
  buildWeekHistory,
  validationDelayHours,
  type HistoryEventKind,
  type WeekHistory,
} from "@/lib/domain/history";

export const dynamic = "force-dynamic";

/*
 * Couleur par nature d'événement : la chronologie se parcourt à la verticale,
 * et l'œil doit distinguer un envoi d'un retour sans lire chaque ligne.
 */
const EVENT_TONES: Record<HistoryEventKind, { dot: string; text: string }> = {
  sheet_sent: { dot: "#1176d3", text: "text-[#0b5e9f]" },
  sheet_resent: { dot: "#6d28d9", text: "text-[#6d28d9]" },
  reminder: { dot: "#e5484d", text: "text-state-changes" },
  client_feedback: { dot: "#f5a524", text: "text-[#a15c00]" },
  feedback_resolved: { dot: "#14b8a6", text: "text-[#0e7490]" },
  special_request: { dot: "#ec4899", text: "text-[#be185d]" },
  production_requested: { dot: "#8b5cf6", text: "text-[#6d28d9]" },
  production_delivered: { dot: "#14b8a6", text: "text-[#0e7490]" },
  approved: { dot: "#128359", text: "text-state-approved" },
  published: { dot: "#64748b", text: "text-ink-soft" },
};

/** Natures de commande, telles que l'enum `production_request_kind` les nomme. */
const PRODUCTION_KIND_LABELS: Record<string, string> = {
  visuel: "Visuel",
  video: "Vidéo",
  photo: "Photo",
};

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});

export default async function HistoriquePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");

  const requested = (await searchParams).client;
  const selected = (clients ?? []).find((c) => c.id === requested) ?? (clients ?? [])[0] ?? null;

  if (!selected) {
    return (
      <div className="space-y-6">
        <header><p className="eyebrow">Suivi</p><h1 className="page-title mt-1">Historique</h1></header>
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">Aucun client enregistré.</p>
      </div>
    );
  }

  /*
   * Tout ce qui porte une date, pour ce client. Les fiches emportent leurs
   * versions, leurs messages et leurs publications ; les retours arrivent à
   * part, un ticket pouvant survivre à la fiche qui l'a fait naître.
   */
  const [{ data: sheets }, { data: tickets }, { data: productionRequests }] = await Promise.all([
    supabase
      .from("weekly_sheets")
      .select(`id, iso_week, period_start, period_end, approved_at,
        weekly_sheet_versions ( version_number, sent_to_client_at ),
        client_message_dispatches ( template_type, sent_at ),
        weekly_sheet_items ( published_at, scheduled_date, format, is_cancelled )`)
      .eq("client_id", selected.id)
      .order("period_start", { ascending: false })
      .limit(40),
    supabase
      .from("client_tickets")
      .select("id, title, ticket_type, category, submitted_at, created_at, resolved_at, due_at, weekly_sheet_id, weekly_sheet_item_id")
      .eq("client_id", selected.id),
    /*
     * Commandes en production : elles ne dépendent d'aucune fiche et portent
     * leur propre cycle — demandée, échéance, livrée. On les rattache à la
     * semaine qui contient leur date de demande.
     */
    supabase
      .from("production_requests")
      .select("title, kind, created_at, due_on, delivered_at, validated_at")
      .eq("client_id", selected.id),
  ]);

  const ticketsBySheet = new Map<string, NonNullable<typeof tickets>>();
  for (const ticket of tickets ?? []) {
    const key = (ticket.weekly_sheet_id as string | null) ?? "";
    const list = ticketsBySheet.get(key) ?? [];
    list.push(ticket);
    ticketsBySheet.set(key, list);
  }

  const requestsForWeek = (start: string, end: string) =>
    (productionRequests ?? [])
      .filter((request) => {
        const day = (request.created_at as string).slice(0, 10);
        return day >= start && day <= end;
      })
      .map((request) => ({
        title: request.title as string | null,
        kindLabel: PRODUCTION_KIND_LABELS[request.kind as string] ?? "Production",
        created_at: request.created_at as string,
        due_on: request.due_on as string | null,
        delivered_at: request.delivered_at as string | null,
        validated_at: request.validated_at as string | null,
      }));

  const weeks: WeekHistory[] = (sheets ?? []).map((sheet) => buildWeekHistory({
    sheetId: sheet.id as string,
    isoWeek: sheet.iso_week as number,
    periodStart: sheet.period_start as string,
    periodEnd: sheet.period_end as string,
    approvedAt: sheet.approved_at as string | null,
    versions: ((sheet.weekly_sheet_versions ?? []) as unknown as { version_number: number; sent_to_client_at: string | null }[]),
    dispatches: ((sheet.client_message_dispatches ?? []) as unknown as { template_type: string; sent_at: string }[]),
    tickets: (ticketsBySheet.get(sheet.id as string) ?? []).map((ticket) => ({
      id: ticket.id as string,
      title: ticket.title as string | null,
      ticket_type: ticket.ticket_type as string,
      typeLabel: getTicketTypeDefinition(ticket.ticket_type).label,
      submitted_at: ticket.submitted_at as string | null,
      created_at: ticket.created_at as string,
      resolved_at: ticket.resolved_at as string | null,
      due_at: ticket.due_at as string | null,
      weekly_sheet_item_id: ticket.weekly_sheet_item_id as string | null,
      category: (ticket.category as string | null) ?? null,
    })),
    publications: ((sheet.weekly_sheet_items ?? []) as unknown as {
      published_at: string | null; scheduled_date: string; format: MediaFormat; is_cancelled: boolean;
    }[])
      .filter((item) => !item.is_cancelled)
      .map((item) => ({
        published_at: item.published_at,
        scheduled_date: item.scheduled_date,
        formatLabel: MEDIA_FORMAT_LABELS[item.format],
      })),
    productionRequests: requestsForWeek(sheet.period_start as string, sheet.period_end as string),
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Suivi</p>
        <h1 className="page-title mt-1">Historique</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ce qui s’est passé semaine par semaine : envois, retours, validations et publications réelles.
        </p>
      </header>

      {/* Un client à la fois : quarante semaines de chronologie ne se lisent pas côte à côte. */}
      <div className="flex flex-wrap gap-1.5">
        {(clients ?? []).map((client) => (
          <Link
            key={client.id}
            href={`/historique?client=${client.id}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              client.id === selected.id
                ? "bg-[#1176d3] text-white"
                : "bg-canvas text-ink-soft hover:bg-[#e8f2ff] hover:text-[#0b5e9f]"
            }`}
          >
            {client.name}
          </Link>
        ))}
      </div>

      {weeks.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune fiche pour {selected.name}.
        </p>
      ) : (
        <div className="space-y-4">
          {weeks.map((week) => {
            const delay = validationDelayHours(week);
            return (
              <section key={week.sheetId} className="section-card">
                <div className="section-card-header">
                  <div>
                    <p className="eyebrow">Semaine {week.isoWeek}</p>
                    <h2 className="mt-1 font-semibold">{week.periodStart} → {week.periodEnd}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {delay !== null && (
                      <span className="badge bg-[#e8f8f1] text-state-approved">Validée en {delay} h</span>
                    )}
                    <Link href={`/fiches/${week.sheetId}`} className="text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">
                      Ouvrir la fiche →
                    </Link>
                  </div>
                </div>

                {week.events.length === 0 ? (
                  <p className="px-5 py-5 text-center text-xs text-ink-faint">
                    Fiche créée, jamais envoyée au client.
                  </p>
                ) : (
                  <ol className="divide-y divide-line">
                    {week.events.map((event, index) => {
                      const tone = EVENT_TONES[event.kind];
                      return (
                        <li key={`${event.kind}-${event.at}-${index}`} className="flex items-start gap-3 px-5 py-2.5">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }}/>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-baseline gap-x-2">
                              <strong className={`text-sm ${tone.text}`}>{event.label}</strong>
                              <span className="text-xs text-ink-faint">{dateTime.format(new Date(event.at))}</span>
                            </p>
                            {event.detail && <p className="mt-0.5 text-xs text-ink-soft">{event.detail}</p>}
                            {event.dueAt && (
                              <p className="mt-0.5 text-xs text-ink-faint">
                                Échéance : {dateTime.format(new Date(event.dueAt))}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
