import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import type { TicketType } from "@/lib/domain/ticket-types";
import { Icon } from "@/components/Icon";

const CHART_COLORS = ["#1b87dd", "#34c5bb", "#78d6a3", "#ef9c50", "#e65b67", "#7768e8"];
const METRICS_VIEWS = ["overview", "validation", "returns", "clients"] as const;
type MetricsView = typeof METRICS_VIEWS[number];
type Tone = "info" | "success" | "warning" | "danger" | "violet";

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ depuis?: string; vue?: string }>;
}) {
  const filters = await searchParams;
  const since = filters.depuis ?? dateDaysAgo(90);
  const view: MetricsView = METRICS_VIEWS.includes(filters.vue as MetricsView)
    ? filters.vue as MetricsView
    : "overview";
  const supabase = await createSupabaseServerClient();

  const [{ data: sheets }, { data: tickets }, { data: versions }] = await Promise.all([
    supabase.from("weekly_sheets").select("id, status, sent_to_client_at, first_viewed_at, approved_at, validation_deadline_at, clients ( name )").gte("period_start", since),
    supabase.from("client_tickets").select("id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at, clients ( name )").gte("submitted_at", `${since}T00:00:00Z`),
    supabase.from("weekly_sheet_versions").select("weekly_sheet_id, version_number"),
  ]);

  const sheetList = sheets ?? [];
  const ticketList = tickets ?? [];
  const sent = sheetList.filter((sheet) => sheet.sent_to_client_at);
  const viewed = sent.filter((sheet) => sheet.first_viewed_at);
  const approved = sheetList.filter((sheet) => ["approved_by_client", "tacitly_approved"].includes(sheet.status));
  const sheetIds = new Set(sheetList.map((sheet) => sheet.id));
  const sheetsWithTickets = new Set(ticketList.map((ticket) => ticket.weekly_sheet_id).filter(Boolean));
  const approvedWithoutCorrection = sent.filter((sheet) => !sheetsWithTickets.has(sheet.id) && sheet.status === "approved_by_client");
  const beforeDeadline = approved.filter((sheet) => sheet.approved_at && sheet.validation_deadline_at && new Date(sheet.approved_at) <= new Date(sheet.validation_deadline_at));
  const overdue = sheetList.filter((sheet) => sheet.validation_deadline_at && new Date(sheet.validation_deadline_at) < new Date() && !["approved_by_client", "tacitly_approved", "archived"].includes(sheet.status)).length;

  const responseDelays = sent.filter((sheet) => sheet.first_viewed_at && sheet.sent_to_client_at).map((sheet) => (new Date(sheet.first_viewed_at!).getTime() - new Date(sheet.sent_to_client_at!).getTime()) / 3_600_000);
  const correctionDelays = ticketList.filter((ticket) => ticket.resolved_at).map((ticket) => (new Date(ticket.resolved_at!).getTime() - new Date(ticket.submitted_at).getTime()) / 3_600_000);
  const averageResponse = average(responseDelays);
  const averageCorrection = average(correctionDelays);

  const byType = new Map<TicketType, number>();
  const byClient = new Map<string, number>();
  for (const ticket of ticketList) {
    byType.set(ticket.ticket_type, (byType.get(ticket.ticket_type) ?? 0) + 1);
    const name = (ticket.clients as unknown as { name: string } | null)?.name ?? "—";
    byClient.set(name, (byClient.get(name) ?? 0) + 1);
  }

  const versionCounts = new Map<string, number>();
  for (const version of versions ?? []) {
    if (!sheetIds.has(version.weekly_sheet_id)) continue;
    versionCounts.set(version.weekly_sheet_id, Math.max(versionCounts.get(version.weekly_sheet_id) ?? 0, version.version_number));
  }

  const averageVersions = average([...versionCounts.values()]);
  const outOfScope = ticketList.filter((ticket) => ticket.status === "out_of_scope").length;
  const ticketsPerSheet = sent.length ? ticketList.length / sent.length : 0;
  const viewRate = ratio(viewed.length, sent.length);
  const noCorrectionRate = ratio(approvedWithoutCorrection.length, sent.length);
  const deadlineRate = ratio(beforeDeadline.length, approved.length);
  const overallScore = average([viewRate, noCorrectionRate, deadlineRate].filter((value) => Number.isFinite(value)));
  const typeEntries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const clientEntries = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const ticketTotal = typeEntries.reduce((total, entry) => total + entry[1], 0);
  const donutGradient = buildDonut(typeEntries.map(([, count]) => count), ticketTotal);
  const signals = [
    overdue > 0
      ? { tone:"danger" as const, icon:"warning", title:`${overdue} validation${overdue > 1 ? "s" : ""} en retard`, body:"Relance client recommandée aujourd’hui." }
      : { tone:"success" as const, icon:"check", title:"Échéances maîtrisées", body:"Aucune validation en retard." },
    averageCorrection > 48
      ? { tone:"danger" as const, icon:"clock", title:"Corrections trop longues", body:`Délai moyen : ${hours(averageCorrection)}.` }
      : averageCorrection > 24
        ? { tone:"warning" as const, icon:"clock", title:"Délai à surveiller", body:`Moyenne actuelle : ${hours(averageCorrection)}.` }
        : { tone:"success" as const, icon:"layers", title:"Corrections fluides", body:averageCorrection ? `Moyenne : ${hours(averageCorrection)}.` : "Pas encore assez de données." },
    ticketsPerSheet > 1.2
      ? { tone:"warning" as const, icon:"message", title:"Retours nombreux", body:`${ticketsPerSheet.toFixed(1)} ticket en moyenne par fiche.` }
      : { tone:"info" as const, icon:"message", title:"Retours stables", body:sent.length ? `${ticketsPerSheet.toFixed(1)} ticket par fiche.` : "Pas encore de fiche envoyée." },
  ];

  const data = {
    sent: sent.length,
    viewed: viewed.length,
    approved: approved.length,
    approvedWithoutCorrection: approvedWithoutCorrection.length,
    beforeDeadline: beforeDeadline.length,
    overdue,
    averageResponse,
    averageCorrection,
    averageVersions,
    outOfScope,
    ticketsPerSheet,
    viewRate,
    noCorrectionRate,
    deadlineRate,
    overallScore,
    ticketTotal,
    typeEntries,
    clientEntries,
    donutGradient,
    signals,
  };

  return (
    <div className="insights-page">
      <header className="insights-header">
        <div>
          <p className="eyebrow">Performance opérationnelle</p>
          <h1 className="page-title mt-1">Indicateurs</h1>
          <p className="mt-2 text-sm text-ink-soft">Une lecture claire de la production depuis le {formatDate(since)}.</p>
        </div>
        <PeriodFilter since={since} view={view}/>
      </header>

      <MetricsMenu view={view} since={since}/>

      {view === "overview" ? <OverviewView data={data}/> : null}
      {view === "validation" ? <ValidationView data={data}/> : null}
      {view === "returns" ? <ReturnsView data={data}/> : null}
      {view === "clients" ? <ClientsView data={data}/> : null}
    </div>
  );
}

type MetricsData = {
  sent:number; viewed:number; approved:number; approvedWithoutCorrection:number; beforeDeadline:number;
  overdue:number; averageResponse:number; averageCorrection:number; averageVersions:number; outOfScope:number;
  ticketsPerSheet:number; viewRate:number; noCorrectionRate:number; deadlineRate:number; overallScore:number;
  ticketTotal:number; typeEntries:[TicketType,number][]; clientEntries:[string,number][]; donutGradient:string;
  signals:{tone:Tone;icon:string;title:string;body:string}[];
};

function OverviewView({ data }: { data:MetricsData }) {
  return (
    <div className="insights-view insights-overview">
      <section className="insights-overview-top">
        <article className="insights-hero-panel">
          <span aria-hidden="true" className="insights-orb insights-orb-one"/>
          <span aria-hidden="true" className="insights-orb insights-orb-two"/>
          <div className="relative z-10">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/65">Santé éditoriale</p>
            <h2 className="mt-2 max-w-md text-2xl font-semibold tracking-[-.04em] sm:text-3xl">La production en un regard</h2>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/70">Synthèse des consultations, validations au premier envoi et respect des échéances.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <HeroPill label="Fiches envoyées" value={String(data.sent)}/>
              <HeroPill label="Tickets reçus" value={String(data.ticketTotal)}/>
              <HeroPill label="En retard" value={String(data.overdue)}/>
            </div>
          </div>
          <Ring value={data.overallScore} label="score global" light/>
        </article>

        <div className="insights-overview-kpis">
          <KpiCard icon="users" label="Consultation" value={data.sent ? percentValue(data.viewRate) : "—"} detail={`${data.viewed} fiche${data.viewed > 1 ? "s" : ""} ouverte${data.viewed > 1 ? "s" : ""}`} tone={data.sent ? rateTone(data.viewRate) : "info"} progress={data.sent ? data.viewRate : undefined}/>
          <KpiCard icon="check" label="Sans correction" value={data.sent ? percentValue(data.noCorrectionRate) : "—"} detail="validées au premier envoi" tone={data.sent ? rateTone(data.noCorrectionRate,70,45) : "info"} progress={data.sent ? data.noCorrectionRate : undefined}/>
        </div>
      </section>

      <section className="insights-overview-bottom">
        <SignalPanel signals={data.signals}/>
        <FunnelPanel data={data}/>
        <TicketPanel data={data}/>
      </section>
    </div>
  );
}

function ValidationView({ data }: { data:MetricsData }) {
  return (
    <div className="insights-view insights-detail-view">
      <section className="insights-kpi-row">
        <KpiCard icon="send" label="Fiches envoyées" value={String(data.sent)} detail="sur la période" tone="info"/>
        <KpiCard icon="users" label="Consultation" value={data.sent ? percentValue(data.viewRate) : "—"} detail={`${data.viewed}/${data.sent || 0} consultées`} tone={data.sent ? rateTone(data.viewRate) : "info"} progress={data.sent ? data.viewRate : undefined}/>
        <KpiCard icon="clock" label="Réponse client" value={hours(data.averageResponse)} detail="délai moyen d’ouverture" tone={delayTone(data.averageResponse)}/>
        <KpiCard icon="check" label="Avant échéance" value={data.approved ? percentValue(data.deadlineRate) : "—"} detail={`${data.overdue} en retard actuellement`} tone={data.overdue ? "danger" : data.approved ? rateTone(data.deadlineRate) : "info"} progress={data.approved ? data.deadlineRate : undefined}/>
      </section>
      <section className="insights-detail-grid insights-validation-grid">
        <FunnelPanel data={data} roomy/>
        <article className="insights-card insights-gauge-panel">
          <div><p className="eyebrow">Qualité de validation</p><h2 className="mt-1 text-lg font-semibold">Premier envoi</h2><p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-soft">Part des fiches approuvées sans demande de modification.</p></div>
          <Ring value={data.noCorrectionRate} label="sans correction"/>
          <div className="insights-gauge-footer"><span>{data.approvedWithoutCorrection} validation{data.approvedWithoutCorrection > 1 ? "s" : ""} directe{data.approvedWithoutCorrection > 1 ? "s" : ""}</span><strong>{data.approved} validées</strong></div>
        </article>
      </section>
    </div>
  );
}

function ReturnsView({ data }: { data:MetricsData }) {
  return (
    <div className="insights-view insights-detail-view">
      <section className="insights-kpi-row">
        <KpiCard icon="message" label="Tickets reçus" value={String(data.ticketTotal)} detail="sur la période" tone="info"/>
        <KpiCard icon="layers" label="Tickets par fiche" value={data.sent ? data.ticketsPerSheet.toFixed(1) : "—"} detail="moyenne après envoi" tone={data.ticketsPerSheet > 1.2 ? "warning" : "success"}/>
        <KpiCard icon="clock" label="Délai de correction" value={hours(data.averageCorrection)} detail="demande → résolution" tone={delayTone(data.averageCorrection)}/>
        <KpiCard icon="copy" label="Versions par fiche" value={data.averageVersions ? data.averageVersions.toFixed(1) : "—"} detail={`${data.outOfScope} hors périmètre`} tone={data.outOfScope || data.averageVersions > 2 ? "warning" : "success"}/>
      </section>
      <section className="insights-detail-grid insights-returns-grid">
        <TicketPanel data={data} roomy/>
        <SignalPanel signals={data.signals} roomy/>
      </section>
    </div>
  );
}

function ClientsView({ data }: { data:MetricsData }) {
  const busiest = data.clientEntries[0];
  const averagePerClient = data.clientEntries.length ? data.ticketTotal / data.clientEntries.length : 0;
  return (
    <div className="insights-view insights-detail-view">
      <section className="insights-kpi-row insights-client-kpis">
        <KpiCard icon="users" label="Clients avec retours" value={String(data.clientEntries.length)} detail="sur la période" tone="info"/>
        <KpiCard icon="message" label="Moyenne par client" value={averagePerClient ? averagePerClient.toFixed(1) : "—"} detail="tickets enregistrés" tone="violet"/>
        <KpiCard icon="warning" label="Volume le plus élevé" value={busiest ? String(busiest[1]) : "—"} detail={busiest?.[0] ?? "Aucune donnée"} tone={busiest && busiest[1] > 2 ? "warning" : "success"}/>
      </section>
      <section className="insights-client-panel insights-card">
        <div className="insights-panel-heading"><div><p className="eyebrow">Concentration des retours</p><h2 className="mt-1 text-lg font-semibold">Corrections par client</h2><p className="mt-1 text-xs text-ink-soft">Classement par volume de demandes, sans notation de performance individuelle.</p></div><span className="insights-soft-badge">7 premiers clients</span></div>
        {data.clientEntries.length
          ? <div className="insights-client-bars">{data.clientEntries.map(([name,count],index)=><BarRow key={name} label={name} value={count} max={data.clientEntries[0]?.[1] ?? 1} color={index < 2 && count > 2 ? "#ef9c50" : `linear-gradient(90deg,#1b87dd,#34c5bb)`}/>)}</div>
          : <EmptyMetric text="Aucune correction sur cette période."/>}
      </section>
    </div>
  );
}

function MetricsMenu({ view, since }: { view:MetricsView; since:string }) {
  const items:{id:MetricsView;label:string;icon:string}[]=[
    {id:"overview",label:"Vue d’ensemble",icon:"dashboard"},
    {id:"validation",label:"Validation",icon:"check"},
    {id:"returns",label:"Retours clients",icon:"message"},
    {id:"clients",label:"Clients",icon:"users"},
  ];
  return <nav className="insights-menu" aria-label="Catégories d’indicateurs">{items.map((item)=><Link key={item.id} href={`/indicateurs?vue=${item.id}&depuis=${since}`} aria-current={view===item.id?"page":undefined} className={view===item.id?"active":""}><Icon name={item.icon}/><span>{item.label}</span></Link>)}</nav>;
}

function PeriodFilter({ since, view }: { since:string; view:MetricsView }) {
  const options=[{label:"30 j",date:dateDaysAgo(30)},{label:"90 j",date:dateDaysAgo(90)},{label:"6 mois",date:dateDaysAgo(180)}];
  return <nav className="insights-period" aria-label="Période analysée">{options.map((option)=><Link key={option.label} href={`/indicateurs?vue=${view}&depuis=${option.date}`} aria-current={since===option.date?"page":undefined} className={since===option.date?"active":""}>{option.label}</Link>)}</nav>;
}

function KpiCard({ icon, label, value, detail, tone, progress }: { icon:string;label:string;value:string;detail:string;tone:Tone;progress?:number }) {
  return <article className={`insights-kpi insights-tone-${tone}`}><div className="insights-kpi-top"><span><Icon name={icon}/></span><i aria-hidden="true"/></div><p>{label}</p><strong>{value}</strong><small>{detail}</small>{progress !== undefined && <div className="insights-kpi-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{transform:`scaleX(${Math.min(100,Math.max(0,progress))/100})`}}/></div>}</article>;
}

function HeroPill({ label, value }: { label:string;value:string }) {
  return <span className="insights-hero-pill"><small>{label}</small><strong>{value}</strong></span>;
}

function Ring({ value, label, light=false }: { value:number;label:string;light?:boolean }) {
  const safe=Math.round(Math.min(100,Math.max(0,value||0)));
  return <div className={`insights-ring ${light?"light":""}`} style={{background:`conic-gradient(${light?"#fff":"#1b87dd"} 0 ${safe}%,${light?"rgba(255,255,255,.16)":"#e8eef5"} ${safe}% 100%)`}} role="img" aria-label={`${label} : ${safe} %`}><span><strong>{safe}%</strong><small>{label}</small></span></div>;
}

function SignalPanel({ signals, roomy=false }: { signals:MetricsData["signals"];roomy?:boolean }) {
  return <article className={`insights-card insights-signal-panel ${roomy?"roomy":""}`}><div className="insights-panel-heading"><div><p className="eyebrow">À surveiller</p><h2 className="mt-1 font-semibold">Signaux opérationnels</h2></div><span className="insights-live"><i/>Temps réel</span></div><div className="insights-signal-list">{signals.map((signal)=><Signal key={signal.title} {...signal}/>)}</div></article>;
}

function Signal({ tone, icon, title, body }: { tone:Tone;icon:string;title:string;body:string }) {
  return <div className={`insights-signal insights-tone-${tone}`}><span><Icon name={icon}/></span><div><strong>{title}</strong><p>{body}</p></div></div>;
}

function FunnelPanel({ data, roomy=false }: { data:MetricsData;roomy?:boolean }) {
  return <article className={`insights-card insights-funnel-panel ${roomy?"roomy":""}`}><div className="insights-panel-heading"><div><p className="eyebrow">Parcours client</p><h2 className="mt-1 font-semibold">De l’envoi à la validation</h2></div><span className="insights-soft-badge">{data.sent} envois</span></div><div className="insights-funnel-list"><FunnelRow label="Envoyées" value={data.sent} total={Math.max(data.sent,1)} color="linear-gradient(90deg,#176fc0,#1b87dd)"/><FunnelRow label="Consultées" value={data.viewed} total={Math.max(data.sent,1)} color="linear-gradient(90deg,#1b87dd,#34c5bb)"/><FunnelRow label="Validées" value={data.approved} total={Math.max(data.sent,1)} color="linear-gradient(90deg,#34c5bb,#78d6a3)"/><FunnelRow label="Sans correction" value={data.approvedWithoutCorrection} total={Math.max(data.sent,1)} color="linear-gradient(90deg,#7768e8,#a48ef0)"/></div></article>;
}

function TicketPanel({ data, roomy=false }: { data:MetricsData;roomy?:boolean }) {
  return <article className={`insights-card insights-ticket-panel ${roomy?"roomy":""}`}><div className="insights-panel-heading"><div><p className="eyebrow">Nature des demandes</p><h2 className="mt-1 font-semibold">Répartition des tickets</h2></div><span className="insights-soft-badge">{data.ticketTotal} total</span></div>{data.ticketTotal?<div className="insights-ticket-body"><div className="insights-donut" style={{background:data.donutGradient}} role="img" aria-label={`Répartition de ${data.ticketTotal} tickets`}><span><strong>{data.ticketTotal}</strong><small>tickets</small></span></div><ul>{data.typeEntries.slice(0,6).map(([type,count],index)=><li key={type}><i style={{background:CHART_COLORS[index%CHART_COLORS.length]}}/><span>{getTicketTypeDefinition(type).label}</span><strong>{count}</strong></li>)}</ul></div>:<EmptyMetric text="Aucun ticket sur cette période."/>}</article>;
}

function FunnelRow({ label, value, total, color }: { label:string;value:number;total:number;color:string }) {
  const percentage=Math.round(value/total*100);
  return <div className="insights-funnel-row"><div><span>{label}</span><strong>{value}<small>· {percentage}%</small></strong></div><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}><span style={{background:color,transform:`scaleX(${Math.min(1,value/total)})`}}/></div></div>;
}

function BarRow({ label, value, max, color }: { label:string;value:number;max:number;color:string }) {
  return <div className="insights-client-row"><span>{label}</span><div><i style={{background:color,transform:`scaleX(${value/Math.max(max,1)})`}}/></div><strong>{value}</strong></div>;
}

function EmptyMetric({ text }: { text:string }) { return <div className="insights-empty"><Icon name="chart"/><p>{text}</p></div>; }

function buildDonut(values:number[], total:number):string {
  if (!total) return "#edf1f6";
  let cursor=0;
  const stops=values.map((value,index)=>{const start=cursor;cursor+=value/total*100;return `${CHART_COLORS[index%CHART_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;});
  return `conic-gradient(${stops.join(",")})`;
}
function average(values:number[]):number { return values.length ? values.reduce((total,value)=>total+value,0)/values.length : 0; }
function ratio(part:number,total:number):number { return total ? part/total*100 : 0; }
function percentValue(value:number):string { return Number.isFinite(value) ? `${Math.round(value)} %` : "—"; }
function hours(value:number):string { return value ? value<24?`${value.toFixed(1)} h`:`${(value/24).toFixed(1)} j` : "—"; }
function rateTone(value:number, good=80, warning=50):Tone { return value>=good?"success":value>=warning?"warning":"danger"; }
function delayTone(value:number):Tone { return !value?"info":value<=24?"success":value<=48?"warning":"danger"; }
function dateDaysAgo(days:number):string { return new Date(Date.now()-days*24*3600*1000).toISOString().slice(0,10); }
function formatDate(value:string):string { return new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`)); }
