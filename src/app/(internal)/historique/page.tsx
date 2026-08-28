import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { MEDIA_FORMAT_LABELS, type MediaFormat } from "@/lib/domain/types";
import { planningWeekRange } from "@/lib/domain/planning";
import {
  buildWeekHistory,
  validationDelayHours,
  type WeekHistory,
} from "@/lib/domain/history";
import { HistoryToolbar } from "./HistoryToolbar";
import { HistoryView } from "./HistoryView";

export const dynamic = "force-dynamic";

/** Natures de commande, telles que l'enum `production_request_kind` les nomme. */
const PRODUCTION_KIND_LABELS: Record<string, string> = {
  visuel: "Visuel",
  video: "Vidéo",
  photo: "Photo",
};

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

  const [sheetsResult, ticketsResult, requestsResult] = await Promise.all([
    supabase
      .from("weekly_sheets")
      /*
       * La clé étrangère est nommée explicitement : deux chemins relient une
       * fiche à ses versions — la liste, et la version courante portée par
       * `current_version_id`. Sans cette précision PostgREST refuse la requête
       * (PGRST201), et l'écran affichait « aucune fiche » pour un client qui en
       * avait.
       */
      .select(`id, iso_week, period_start, period_end, approved_at,
        weekly_sheet_versions!weekly_sheet_versions_weekly_sheet_id_fkey ( version_number, sent_to_client_at ),
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

  /*
   * Une requête en échec ne doit pas se lire comme une absence de données : un
   * écran vide laisse croire qu'il n'y a rien à montrer, et le défaut passe
   * inaperçu. On le dit.
   */
  const failure = sheetsResult.error ?? ticketsResult.error ?? requestsResult.error;
  if (failure) {
    console.error("[historique] chargement impossible", failure.message);
    return (
      <div className="space-y-6">
        <header><p className="eyebrow">Suivi</p><h1 className="page-title mt-1">Historique — {selected.name}</h1></header>
        <p className="card px-4 py-8 text-center text-sm text-state-changes">
          L’historique n’a pas pu être chargé. Réessayez dans un instant ; si le problème persiste,
          l’erreur technique est : {failure.message}
        </p>
      </div>
    );
  }

  const sheets = sheetsResult.data;
  const tickets = ticketsResult.data;
  const productionRequests = requestsResult.data;

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

      <HistoryView weeks={weeks} clientName={selected.name}/>
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
