import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { deadlineState } from "@/lib/domain/deadline";
import { sheetStatusLabel, ticketStatusLabel, ticketPriorityLabel } from "@/lib/domain/types";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { requiresProduction } from "@/lib/domain/routing";
import { Icon } from "@/components/Icon";

function todayInParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Vue opérationnelle du jour, exclusivement alimentée par Supabase. */
export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  const today = todayInParis();

  const [ticketsResult, sheetsResult, publicationsResult, clientsResult, preparationResult] = await Promise.all([
    supabase.from("client_tickets").select("id, ticket_number, title, ticket_type, status, priority, due_at, created_at, clients ( name )").not("status", "in", "(closed,cancelled,rejected,approved_by_client)").order("created_at", { ascending: false }).limit(50),
    supabase.from("weekly_sheets").select("id, iso_week, status, validation_deadline_at, clients ( name )").in("status", ["sent_to_client", "partially_approved", "changes_requested", "corrections_in_progress", "new_version_to_send", "awaiting_revalidation"]).order("validation_deadline_at", { ascending: true }).limit(120),
    supabase.from("weekly_sheet_items").select("id, published_at").eq("scheduled_date", today).eq("is_cancelled", false),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("weekly_sheets").select("id", { count: "exact", head: true }).in("status", ["draft", "internal_review"]),
  ]);

  const tickets = ticketsResult.data ?? [];
  const sheets = sheetsResult.data ?? [];
  const publications = publicationsResult.data ?? [];
  const published = publications.filter((item) => item.published_at).length;
  const newTickets = tickets.filter((ticket) => ticket.status === "new");
  const urgent = tickets.filter((ticket) => ticket.priority === "urgent" || ticket.priority === "high");
  const production = tickets.filter((ticket) => requiresProduction(ticket.ticket_type));
  const toResend = sheets.filter((sheet) => sheet.status === "new_version_to_send");
  const greetingDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date());
  const publicationProgress = publications.length ? Math.round((published / publications.length) * 100) : 100;

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#157bc3] via-[#1166a8] to-[#0b4f88] p-6 text-white shadow-[0_22px_52px_rgba(11,79,136,.20)] sm:p-8">
        <span aria-hidden="true" className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/[.07]" />
        <span aria-hidden="true" className="absolute -bottom-32 left-16 h-64 w-64 rounded-full bg-[#6bc1ff]/10" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold capitalize text-white/70">{greetingDate}</p>
            <h1 className="mt-2 text-[clamp(1.8rem,3vw,2.55rem)] font-semibold leading-tight tracking-[-.04em]">Bonjour {profile?.full_name?.split(" ")[0]}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">Votre production, vos validations et les retours clients réunis dans une seule vue.</p>
          </div>
          <Link href="/fiches" className="btn w-fit border border-white/20 bg-white/10 text-white shadow-none backdrop-blur-sm hover:bg-white/20"><Icon name="calendar" className="h-4 w-4"/>Ouvrir le planning</Link>
        </div>

        <div className="dashboard-hero-metrics relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HeroMetric icon="layers" label="Fiches à préparer" value={preparationResult.count ?? 0} />
          <HeroMetric icon="check" label="Validations en attente" value={sheets.length} />
          <HeroMetric icon="warning" label="Tickets prioritaires" value={urgent.length} />
          <HeroMetric icon="send" label="Publications aujourd’hui" value={publications.length} />
        </div>
      </section>

      <section className="dashboard-kpis" aria-labelledby="dashboard-metrics">
        <div className="dashboard-kpis-heading mb-4 flex items-end justify-between gap-3">
          <div><p className="eyebrow">Pilotage</p><h2 id="dashboard-metrics" className="mt-1 text-lg font-semibold">L’essentiel en un regard</h2></div>
          <span className="text-xs text-ink-faint">{clientsResult.count ?? 0} clients actifs</span>
        </div>
        <div className="dashboard-kpi-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon="message" label="Nouveaux retours" value={newTickets.length} tone={newTickets.length ? "danger" : "blue"} detail="à qualifier" />
          <Stat icon="layers" label="Corrections production" value={production.length} tone="violet" detail="photo ou vidéo" />
          <Stat icon="send" label="Contenus publiés" value={`${published}/${publications.length}`} tone="success" detail={`${publicationProgress}% de la journée`} />
          <Stat icon="clock" label="Fiches à renvoyer" value={toResend.length} tone="warning" detail="nouvelle version prête" />
        </div>
      </section>

      <div className="dashboard-bottom grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <section className="section-card">
          <div className="section-card-header">
            <div><p className="eyebrow">File d’intervention</p><h2 className="mt-1 font-semibold">Retours clients à traiter</h2></div>
            <Link href="/retours" className="text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">Tout voir →</Link>
          </div>
          {tickets.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center"><span className="empty-state-icon"><Icon name="check" className="h-5 w-5"/></span><strong className="mt-3 text-sm">Tout est à jour</strong><p className="mt-1 text-xs text-ink-faint">Aucun retour client ne demande votre attention.</p></div>
          ) : (
            <ul className="divide-y divide-line">
              {tickets.slice(0, 3).map((ticket) => {
                const client = ticket.clients as unknown as { name: string } | null;
                return <li key={ticket.id}><Link href={`/retours/${ticket.id}`} className="group grid gap-2 px-5 py-4 transition-colors hover:bg-[#f7fafe] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-xs font-bold text-[#0b4f88]">{(client?.name ?? "CL").slice(0,2).toUpperCase()}</span><div className="min-w-0"><strong className="block truncate text-sm">{client?.name ?? "Client"}</strong><p className="mt-0.5 truncate text-xs text-ink-faint">{getTicketTypeDefinition(ticket.ticket_type).label} · {ticket.ticket_number}</p></div></div>
                  <div className="flex items-center gap-2 pl-[52px] sm:pl-0">{ticket.priority !== "normal" && <span className="badge bg-state-changes/10 text-state-changes">{ticketPriorityLabel(ticket.priority)}</span>}<span className="badge bg-canvas text-ink-soft">{ticketStatusLabel(ticket.status)}</span><Icon name="arrow" className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5"/></div>
                </Link></li>;
              })}
            </ul>
          )}
        </section>

        <div>
          <section className="section-card">
            <div className="section-card-header"><div><p className="eyebrow">Validation</p><h2 className="mt-1 font-semibold">Fiches en attente</h2></div><span className="badge bg-[#e8f2ff] text-[#0b5e9f]">{sheets.length}</span></div>
            {sheets.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">Aucune validation en attente.</p> : <ul className="divide-y divide-line">{sheets.slice(0, 3).map((sheet) => {
              const client = sheet.clients as unknown as { name: string } | null;
              const deadline = sheet.validation_deadline_at ? deadlineState(new Date(sheet.validation_deadline_at)) : null;
              return <li key={sheet.id}><Link href={`/fiches/${sheet.id}`} className="block px-5 py-4 transition-colors hover:bg-[#f7fafe]"><div className="flex items-center justify-between gap-3"><strong className="truncate text-sm">{client?.name ?? "Client"}</strong><span className={`text-[11px] font-semibold ${deadline?.isOverdue ? "text-state-changes" : "text-ink-faint"}`}>{deadline?.label ?? `S${sheet.iso_week}`}</span></div><p className="mt-1 truncate text-xs text-ink-faint">Semaine {sheet.iso_week} · {sheetStatusLabel(sheet.status)}</p></Link></li>;
            })}</ul>}
          </section>

        </div>
      </div>
    </div>
  );
}

function HeroMetric({ icon, label, value }: { icon: string; label: string; value: number }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[.09] p-4 backdrop-blur-sm"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15"><Icon name={icon} className="h-4 w-4"/></span><div><p className="text-[11px] text-white/65">{label}</p><p className="mt-0.5 text-2xl font-semibold tracking-[-.03em]">{value}</p></div></div>;
}

function Stat({ icon, label, value, detail, tone }: { icon: string; label: string; value: string | number; detail: string; tone: "blue" | "success" | "warning" | "danger" | "violet" }) {
  const tones = { blue:"bg-[#e8f2ff] text-[#1176d3]", success:"bg-[#e8f8f1] text-[#128359]", warning:"bg-[#fff4e5] text-[#a75b00]", danger:"bg-[#ffedef] text-[#ce3540]", violet:"bg-[#f1edff] text-[#6f50c9]" };
  return <article className="dashboard-stat metric-card lift-card"><div className="flex items-start justify-between gap-3"><span className={`metric-icon ${tones[tone]}`}><Icon name={icon} className="h-5 w-5"/></span><span className="text-[11px] font-semibold text-ink-faint">Temps réel</span></div><p className="dashboard-stat-label mt-5 text-[13px] font-medium text-ink-soft">{label}</p><p className="dashboard-stat-value mt-1 text-[30px] font-semibold leading-none tracking-[-.04em]">{value}</p><p className="dashboard-stat-detail mt-2 text-xs text-ink-faint">{detail}</p></article>;
}
