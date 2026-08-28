import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";
import { planningWeekRange } from "@/lib/domain/planning";
import {
  buildWeekHistory,
  validationDelayHours,
  type HistoryEventKind,
  type WeekHistory,
} from "@/lib/domain/history";
import { HistoryToolbar } from "./HistoryToolbar";

export const dynamic = "force-dynamic";

/*
 * Couleur par nature d'événement : la chronologie se parcourt à la verticale,
 * et l'œil doit distinguer un envoi d'un retour sans lire chaque ligne.
 */
const EVENT_TONES: Record<HistoryEventKind, string> = {
  sheet_sent: "#1176d3",
  sheet_resent: "#6d28d9",
  reminder: "#e5484d",
  client_feedback: "#f5a524",
  feedback_resolved: "#14b8a6",
  special_request: "#ec4899",
  production_requested: "#8b5cf6",
  production_delivered: "#0e7490",
  approved: "#128359",
  published: "#64748b",
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
const dayOnly = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", timeZone: "Europe/Paris",
});

export default async function HistoriquePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: clients } = await supabase.from("clients").select("id, name").order("name");

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
   * Un historique s'arrête à aujourd'hui : les fiches des semaines à venir sont
   * du planning, pas du passé. La borne est la fin de la semaine en cours, pour
   * que la semaine commencée y figure entièrement.
   */
  const range = planningWeekRange();

  const [{ data: sheets }, { data: tickets }, { data: productionRequests }] = await Promise.all([
    supabase
      .from("weekly_sheets")
      .select(`id, iso_week, period_start, period_end, approved_at,
        weekly_sheet_versions ( version_number, sent_to_client_at ),
        client_message_dispatches ( template_type, sent_at ),
        weekly_sheet_items ( published_at, scheduled_date, format, is_cancelled )`)
      .eq("client_id", selected.id)
      .lte("period_start", range.currentEnd)
      .order("period_start", { ascending: false })
      .limit(52),
    supabase
      .from("client_tickets")
      .select("id, title, ticket_type, category, submitted_at, created_at, resolved_at, due_at, weekly_sheet_id, weekly_sheet_item_id")
      .eq("client_id", selected.id),
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
        scheduledLabel: dayOnly.format(new Date(`${item.scheduled_date}T12:00:00Z`)),
        formatLabel: MEDIA_FORMAT_LABELS[item.format],
      })),
    productionRequests: requestsForWeek(sheet.period_start as string, sheet.period_end as string),
  }));

  /* Synthèse : ce qu'on retient d'un client avant d'entrer dans le détail. */
  const delays = weeks.map(validationDelayHours).filter((d): d is number => d !== null);
  const totals = {
    semaines: weeks.length,
    retours: weeks.reduce((n, w) => n + w.events.filter((e) => e.kind === "client_feedback").length, 0),
    relances: weeks.reduce((n, w) => n + w.events.filter((e) => e.kind === "reminder").length, 0),
    publications: weeks.reduce((n, w) => n + w.events.filter((e) => e.kind === "published").length, 0),
    delaiMoyen: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
  };

  return (
    <div className="history-page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Suivi · semaine en cours et précédentes</p>
          <h1 className="page-title mt-1">Historique — {selected.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Envois, retours, validations et publications réelles, du plus récent au plus ancien.
          </p>
        </div>
        {/* Visible seulement à l'impression : un PDF doit porter sa date. */}
        <p className="print-only text-xs text-ink-faint">
          Édité le {dayOnly.format(new Date())}
        </p>
      </header>

      <HistoryToolbar clients={clients ?? []} selectedId={selected.id} clientName={selected.name}/>

      <section className="card grid gap-3 p-4 sm:grid-cols-5 sm:p-5">
        <Synthese valeur={totals.semaines} libelle={totals.semaines > 1 ? "semaines suivies" : "semaine suivie"}/>
        <Synthese valeur={totals.retours} libelle={totals.retours > 1 ? "retours clients" : "retour client"}/>
        <Synthese valeur={totals.relances} libelle={totals.relances > 1 ? "relances" : "relance"}/>
        <Synthese valeur={totals.publications} libelle={totals.publications > 1 ? "publications" : "publication"}/>
        <Synthese
          valeur={totals.delaiMoyen === null ? "—" : `${totals.delaiMoyen} h`}
          libelle="délai moyen de validation"
        />
      </section>

      {weeks.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune fiche pour {selected.name} sur la semaine en cours ou les précédentes.
        </p>
      ) : (
        <div className="space-y-4">
          {weeks.map((week) => {
            const delay = validationDelayHours(week);
            const retours = week.events.filter((e) => e.kind === "client_feedback").length;
            return (
              <section key={week.sheetId} className="history-week section-card">
                <div className="section-card-header flex-wrap gap-y-2">
                  <div className="min-w-0">
                    <p className="eyebrow">Semaine {week.isoWeek}</p>
                    <h2 className="mt-1 font-semibold">
                      {dayOnly.format(new Date(`${week.periodStart}T12:00:00Z`))}
                      {" — "}
                      {dayOnly.format(new Date(`${week.periodEnd}T12:00:00Z`))}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {retours > 0 && (
                      <span className="badge bg-[#fff4e0] text-[#a15c00]">{retours} retour{retours > 1 ? "s" : ""}</span>
                    )}
                    {delay !== null
                      ? <span className="badge bg-[#e8f8f1] text-state-approved">Validée en {delay} h</span>
                      : <span className="badge bg-canvas text-ink-faint">Pas de validation</span>}
                    <Link href={`/fiches/${week.sheetId}`} className="no-print text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">
                      Ouvrir →
                    </Link>
                  </div>
                </div>

                {week.events.length === 0 ? (
                  <p className="px-5 py-5 text-center text-xs text-ink-faint">
                    Fiche créée, jamais envoyée au client.
                  </p>
                ) : (
                  /*
                    Un filet vertical relie les événements : il donne à lire une
                    suite, là où des lignes séparées se lisaient comme un tableau
                    sans ordre.
                  */
                  <ol className="history-timeline space-y-0 px-5 py-3">
                    {week.events.map((event, index) => (
                      <li key={`${event.kind}-${event.at}-${index}`} className="history-event">
                        <span className="history-dot" style={{ background: EVENT_TONES[event.kind] }}/>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <strong className="text-sm">{event.label}</strong>
                            <span className="text-xs tabular-nums text-ink-faint">{dateTime.format(new Date(event.at))}</span>
                          </p>
                          {event.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{event.detail}</p>}
                          {event.dueAt && (
                            <p className="mt-0.5 text-xs text-ink-faint">
                              Échéance : {event.dueAt.length <= 10
                                ? dayOnly.format(new Date(`${event.dueAt}T12:00:00Z`))
                                : dateTime.format(new Date(event.dueAt))}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
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

function Synthese({ valeur, libelle }: { valeur: number | string; libelle: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2.5">
      <p className="text-xl font-semibold tracking-[-.02em]">{valeur}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-ink-faint">{libelle}</p>
    </div>
  );
}
