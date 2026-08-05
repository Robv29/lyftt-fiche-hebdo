import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import type { TicketType } from "@/lib/domain/ticket-types";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

const CHART_COLORS = ["#1176d3", "#16a36a", "#e58a12", "#e5484d", "#7c5ce5", "#22a6b3"];

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ depuis?: string }> }) {
  const filters = await searchParams;
  const since = filters.depuis ?? dateDaysAgo(90);
  const supabase = await createSupabaseServerClient();

  const { data: sheets } = await supabase.from("weekly_sheets").select("id, status, sent_to_client_at, first_viewed_at, approved_at, validation_deadline_at, clients ( name )").gte("period_start", since);
  const { data: tickets } = await supabase.from("client_tickets").select("id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at, clients ( name )").gte("submitted_at", `${since}T00:00:00Z`);
  const { data: versions } = await supabase.from("weekly_sheet_versions").select("weekly_sheet_id, version_number");

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
  for (const ticket of ticketList) byType.set(ticket.ticket_type, (byType.get(ticket.ticket_type) ?? 0) + 1);
  const byClient = new Map<string, number>();
  for (const ticket of ticketList) {
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

  const typeEntries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const clientEntries = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const ticketTotal = typeEntries.reduce((total, entry) => total + entry[1], 0);
  const donutGradient = buildDonut(typeEntries.map(([, count]) => count), ticketTotal);
  const signals = [
    overdue > 0 ? { tone:"danger" as const, icon:"warning", title:`${overdue} validation${overdue > 1 ? "s" : ""} en retard`, body:"Relance client recommandée aujourd’hui." } : { tone:"success" as const, icon:"check", title:"Aucune validation en retard", body:"Les échéances clients sont maîtrisées." },
    averageCorrection > 48 ? { tone:"danger" as const, icon:"clock", title:"Corrections trop longues", body:`Délai moyen actuel : ${hours(averageCorrection)}.` } : averageCorrection > 24 ? { tone:"warning" as const, icon:"clock", title:"Délai de correction à surveiller", body:`Moyenne actuelle : ${hours(averageCorrection)}.` } : { tone:"success" as const, icon:"layers", title:"Corrections fluides", body:averageCorrection ? `Moyenne actuelle : ${hours(averageCorrection)}.` : "Pas encore assez de données." },
    ticketsPerSheet > 1.2 ? { tone:"warning" as const, icon:"message", title:"Beaucoup de retours par fiche", body:`${ticketsPerSheet.toFixed(1)} ticket en moyenne.` } : { tone:"info" as const, icon:"message", title:"Volume de retours stable", body:sent.length ? `${ticketsPerSheet.toFixed(1)} ticket par fiche.` : "Pas encore de fiche envoyée." },
  ];

  return <div className="metrics-page">
    <div className="metrics-header"><PageHeader eyebrow="Performance opérationnelle" title="Indicateurs" description={`Analyse de la production depuis le ${formatDate(since)}. Les couleurs signalent les actions nécessaires, jamais la performance individuelle.`} actions={<PeriodFilter since={since}/>} /></div>

    <section className="metrics-signals grid gap-3 lg:grid-cols-3" aria-label="Alertes opérationnelles">
      {signals.map((signal) => <Signal key={signal.title} {...signal}/>) }
    </section>

    <section className="metrics-kpis grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs principaux">
      <Metric icon="send" label="Fiches envoyées" value={sent.length} detail="sur la période" tone="info" />
      <Metric icon="users" label="Taux de consultation" value={percent(viewed.length, sent.length)} detail={`${viewed.length} fiche${viewed.length > 1 ? "s" : ""} consultée${viewed.length > 1 ? "s" : ""}`} tone={sent.length ? rateTone(viewRate) : "info"} />
      <Metric icon="check" label="Sans correction" value={percent(approvedWithoutCorrection.length, sent.length)} detail="validées au premier envoi" tone={sent.length ? rateTone(noCorrectionRate, 70, 45) : "info"} />
      <Metric icon="clock" label="Avant échéance" value={percent(beforeDeadline.length, approved.length)} detail={`${overdue} actuellement en retard`} tone={overdue ? "danger" : approved.length ? rateTone(deadlineRate) : "info"} />
      <Metric icon="message" label="Tickets par fiche" value={sent.length ? ticketsPerSheet.toFixed(1) : "—"} detail={`${ticketList.length} ticket${ticketList.length > 1 ? "s" : ""} au total`} tone={ticketsPerSheet > 1.2 ? "warning" : "success"} />
      <Metric icon="clock" label="Réponse client" value={hours(averageResponse)} detail="délai moyen de consultation" tone={delayTone(averageResponse)} />
      <Metric icon="layers" label="Délai de correction" value={hours(averageCorrection)} detail="entre demande et résolution" tone={delayTone(averageCorrection)} />
      <Metric icon="copy" label="Versions par fiche" value={averageVersions ? averageVersions.toFixed(1) : "—"} detail={`${outOfScope} hors périmètre`} tone={outOfScope ? "warning" : averageVersions > 2 ? "warning" : "success"} />
    </section>

    <section className="metrics-charts grid gap-6 xl:grid-cols-[1.05fr_.9fr_1.05fr]" aria-label="Analyses détaillées">
      <div className="metrics-chart-card section-card">
        <div className="section-card-header"><div><p className="eyebrow">Parcours client</p><h2 className="mt-1 font-semibold">De l’envoi à la validation</h2></div><span className="badge bg-[#e8f2ff] text-[#0b5e9f]">{sent.length} envois</span></div>
        <div className="metrics-funnel-content space-y-6 p-5 sm:p-6">
          <FunnelRow label="Fiches envoyées" value={sent.length} total={Math.max(sent.length, 1)} color="#1176d3" />
          <FunnelRow label="Consultées par le client" value={viewed.length} total={Math.max(sent.length, 1)} color="#22a6b3" />
          <FunnelRow label="Validées" value={approved.length} total={Math.max(sent.length, 1)} color="#16a36a" />
          <FunnelRow label="Validées sans correction" value={approvedWithoutCorrection.length} total={Math.max(sent.length, 1)} color="#7c5ce5" />
        </div>
      </div>

      <div className="metrics-chart-card section-card">
        <div className="section-card-header"><div><p className="eyebrow">Nature des demandes</p><h2 className="mt-1 font-semibold">Répartition des tickets</h2></div><span className="badge bg-canvas text-ink-soft">{ticketTotal} total</span></div>
        {ticketTotal ? <div className="metrics-ticket-content grid items-center gap-6 p-5 sm:grid-cols-[170px_1fr] xl:grid-cols-1 2xl:grid-cols-[170px_1fr]">
          <div className="metrics-donut relative mx-auto grid h-40 w-40 place-items-center rounded-full" style={{background:donutGradient}} role="img" aria-label={`Répartition de ${ticketTotal} tickets par type`}><span className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-inner"><span><strong className="block text-2xl">{ticketTotal}</strong><small className="text-[10px] text-ink-faint">tickets</small></span></span></div>
          <ul className="metrics-ticket-legend space-y-2.5">{typeEntries.slice(0,6).map(([type,count],index)=><li key={type} className="flex items-center gap-2 text-xs"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background:CHART_COLORS[index % CHART_COLORS.length]}}/><span className="min-w-0 flex-1 truncate text-ink-soft">{getTicketTypeDefinition(type).label}</span><strong>{count}</strong></li>)}</ul>
        </div> : <p className="px-5 py-12 text-center text-sm text-ink-faint">Aucun ticket sur cette période.</p>}
      </div>

      <div className="metrics-chart-card section-card">
        <div className="section-card-header"><div><p className="eyebrow">Concentration des retours</p><h2 className="mt-1 font-semibold">Corrections par client</h2></div><span className="text-xs text-ink-faint">7 premiers</span></div>
        {clientEntries.length ? <div className="metrics-client-bars space-y-4 p-5 sm:p-6">{clientEntries.map(([name,count],index)=><BarRow key={name} label={name} value={count} max={clientEntries[0]?.[1] ?? 1} color={index < 2 && count > 2 ? "#e58a12" : "#1176d3"}/>)}</div> : <p className="px-5 py-12 text-center text-sm text-ink-faint">Aucune correction sur cette période.</p>}
      </div>
    </section>
  </div>;
}

type Tone = "info" | "success" | "warning" | "danger";
const toneStyles: Record<Tone, { card:string; icon:string; bar:string }> = {
  info:{card:"border-[#cfe3f5] bg-[#f7fbff]",icon:"bg-[#e8f2ff] text-[#0b69b4]",bar:"bg-[#1176d3]"},
  success:{card:"border-[#c9ebdc] bg-[#f7fdf9]",icon:"bg-[#e8f8f1] text-[#128359]",bar:"bg-[#16a36a]"},
  warning:{card:"border-[#f3d9ae] bg-[#fffaf2]",icon:"bg-[#fff0d8] text-[#a55c00]",bar:"bg-[#e58a12]"},
  danger:{card:"border-[#f4c8cc] bg-[#fff7f8]",icon:"bg-[#ffedef] text-[#d83d47]",bar:"bg-[#e5484d]"},
};

function PeriodFilter({ since }: { since:string }) {
  const options=[{label:"30 j",date:dateDaysAgo(30)},{label:"90 j",date:dateDaysAgo(90)},{label:"6 mois",date:dateDaysAgo(180)}];
  return <nav className="flex rounded-xl border border-line bg-white p-1 shadow-sm" aria-label="Période analysée">{options.map((option)=><Link key={option.label} href={`/indicateurs?depuis=${option.date}`} className={`grid min-h-9 place-items-center rounded-lg px-3 text-xs font-semibold transition-colors ${since===option.date?"bg-[#1176d3] text-white":"text-ink-soft hover:bg-canvas"}`}>{option.label}</Link>)}</nav>;
}

function Signal({ tone, icon, title, body }: { tone:Tone; icon:string; title:string; body:string }) {
  const style=toneStyles[tone];
  return <article className={`metrics-signal flex items-start gap-3 rounded-[18px] border p-4 ${style.card}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.icon}`}><Icon name={icon} className="h-5 w-5"/></span><div><h2 className="text-sm font-semibold">{title}</h2><p className="metrics-signal-body mt-1 text-xs leading-relaxed text-ink-soft">{body}</p></div></article>;
}

function Metric({ icon, label, value, detail, tone }: { icon:string; label:string; value:string|number; detail:string; tone:Tone }) {
  const style=toneStyles[tone];
  return <article className={`metrics-stat metric-card lift-card border-t-4 ${style.card}`}><div className="flex items-start justify-between gap-3"><span className={`metric-icon ${style.icon}`}><Icon name={icon} className="h-5 w-5"/></span><span className={`h-2.5 w-2.5 rounded-full ${style.bar}`} aria-label={`État ${tone}`}/></div><p className="metrics-stat-label mt-5 text-xs font-semibold text-ink-soft">{label}</p><p className="metrics-stat-value mt-1 text-[30px] font-semibold tracking-[-.045em]">{value}</p><p className="metrics-stat-detail mt-2 text-[11px] text-ink-faint">{detail}</p></article>;
}

function FunnelRow({ label, value, total, color }: { label:string; value:number; total:number; color:string }) {
  const percentage=Math.round(value/total*100);
  return <div className="metrics-funnel-row"><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-ink-soft">{label}</span><span><strong>{value}</strong><span className="ml-1 text-ink-faint">· {percentage}%</span></span></div><div className="h-3 overflow-hidden rounded-full bg-[#edf1f6]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}><span className="block h-full origin-left rounded-full transition-transform duration-300" style={{background:color,transform:`scaleX(${Math.min(1,value/total)})`}}/></div></div>;
}

function BarRow({ label, value, max, color }: { label:string; value:number; max:number; color:string }) {
  return <div className="metrics-client-row grid items-center gap-2 sm:grid-cols-[180px_1fr_36px]"><span className="truncate text-xs font-medium text-ink-soft">{label}</span><div className="h-8 overflow-hidden rounded-lg bg-[#edf1f6]"><span className="flex h-full origin-left items-center rounded-lg px-2 text-[10px] font-semibold text-white transition-transform duration-300" style={{background:color,transform:`scaleX(${value/Math.max(max,1)})`}}><span className="origin-left" style={{transform:`scaleX(${Math.max(max,1)/value})`}}>{value} correction{value>1?"s":""}</span></span></div><strong className="text-right text-xs">{value}</strong></div>;
}

function buildDonut(values:number[], total:number):string {
  if (!total) return "#edf1f6";
  let cursor=0;
  const stops=values.map((value,index)=>{const start=cursor;cursor+=value/total*100;return `${CHART_COLORS[index%CHART_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;});
  return `conic-gradient(${stops.join(",")})`;
}
function average(values:number[]):number { return values.length ? values.reduce((total,value)=>total+value,0)/values.length : 0; }
function ratio(part:number,total:number):number { return total ? part/total*100 : 0; }
function percent(part:number,total:number):string { return total ? `${Math.round(part/total*100)} %` : "—"; }
function hours(value:number):string { return value ? value<24?`${value.toFixed(1)} h`:`${(value/24).toFixed(1)} j` : "—"; }
function rateTone(value:number, good=80, warning=50):Tone { return value>=good?"success":value>=warning?"warning":"danger"; }
function delayTone(value:number):Tone { return !value?"info":value<=24?"success":value<=48?"warning":"danger"; }
function dateDaysAgo(days:number):string { return new Date(Date.now()-days*24*3600*1000).toISOString().slice(0,10); }
function formatDate(value:string):string { return new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`)); }
