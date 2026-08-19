import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { budgetPenalty, budgetSummary, shootingTally, type BillingMode, type BudgetLine } from "@/lib/domain/budget";
import { healthActions, healthScore, HEALTH_TARGET, type HealthAction, type HealthPillar } from "@/lib/domain/health-score";
import { clientLifecycle, todayInParis } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { satisfactionPercentage, satisfactionSummary, SATISFACTION_LABELS } from "@/lib/domain/planning";
import { productionPunctuality } from "@/lib/domain/production-requests";
import { ticketSlaSummary, TICKET_SLA_HOURS } from "@/lib/domain/ticket-sla";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { resolveClientLogoUrl } from "@/lib/media/client-logo";
import type { TicketType } from "@/lib/domain/ticket-types";
import { Icon } from "@/components/Icon";
import Image from "next/image";

const CHART_COLORS = ["#1b87dd", "#34c5bb", "#78d6a3", "#ef9c50", "#e65b67", "#7768e8"];
/**
 * Statuts d'un ticket encore à traiter.
 *
 * Le suivi interne se juge sur ce qui reste ouvert : un ticket clos, refusé ou
 * hors périmètre n'attend plus personne, et le compter en retard salirait la
 * note sans rien dire d'utile.
 */
const OPEN_TICKET_STATUSES = "(approved_by_client,closed,rejected,out_of_scope,cancelled)";
const METRICS_VIEWS = ["overview", "validation", "returns", "satisfaction", "clients"] as const;
type MetricsView = typeof METRICS_VIEWS[number];
type Tone = "info" | "success" | "warning" | "danger" | "violet";

/**
 * Santé des budgets, réservée à la direction.
 *
 * Les tables budgétaires sont fermées aux autres rôles : la requête ne
 * renverrait rien, et un malus silencieux fondé sur zéro donnée serait pire
 * qu'aucun malus.
 */
async function budgetHealth(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  isAdmin: boolean,
): Promise<{ withIssue: number; total: number; shootingsCategorised: number; shootingsTotal: number }> {
  if (!isAdmin) return { withIssue: 0, total: 0, shootingsCategorised: 0, shootingsTotal: 0 };

  const today = todayInParis();
  const [{ data: clients }, { data: budgets }, { data: lines }] = await Promise.all([
    supabase.from("clients").select("id, notes, is_active, contract_start_date, contract_end_date, pause_start_date, pause_end_date").eq("is_active", true),
    supabase.from("client_budgets").select("client_id, billing_mode, budget_cents"),
    supabase.from("client_budget_lines").select("client_id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, billed_directly, forfait_included"),
  ]);

  const managed = (clients ?? []).filter((client) => clientLifecycle({
    isActive: client.is_active as boolean,
    contractEndDate: client.contract_end_date as string | null,
    pauseStartDate: client.pause_start_date as string | null,
    pauseEndDate: client.pause_end_date as string | null,
  }, today).canProduce);

  const budgetByClient = new Map((budgets ?? []).map((row) => [row.client_id as string, row]));
  const linesByClient = new Map<string, (BudgetLine & { forfaitIncluded: boolean | null })[]>();
  for (const row of lines ?? []) {
    const list = linesByClient.get(row.client_id as string) ?? [];
    list.push({
      id: "", serviceKey: row.service_key as string, label: row.label as string,
      billing: row.billing as BudgetLine["billing"],
      unitPriceCents: row.unit_price_cents as number,
      quantity: Number(row.quantity),
      months: row.months as number | null,
      performedOn: row.performed_on as string,
      billedDirectly: Boolean(row.billed_directly),
      forfaitIncluded: row.forfait_included as boolean | null,
    });
    linesByClient.set(row.client_id as string, list);
  }

  const withIssue = managed.filter((client) => {
    if (!client.contract_start_date) return true;
    let settings: { monthlyCadence?: MonthlyCadence } = {};
    try { settings = client.notes ? JSON.parse(client.notes as string) : {}; } catch { settings = {}; }
    const budget = budgetByClient.get(client.id as string);
    const summary = budgetSummary({
      billingMode: (budget?.billing_mode ?? "comptant") as BillingMode,
      annualBudgetCents: budget?.budget_cents ?? 0,
      lines: linesByClient.get(client.id as string) ?? [],
      cadence: settings.monthlyCadence ?? {},
      contractStartDate: client.contract_start_date as string | null,
      contractEndDate: client.contract_end_date as string | null,
      today,
    });
    return summary.alerts.some((alert) => alert.level === "critique" || alert.level === "attention");
  }).length;

  /*
   * Shootings en attente de tri. Tant qu'on ne sait pas si un shooting est
   * compris au forfait ou vendu en plus, il n'est ni facturé ni écarté : c'est
   * exactement le trou par lequel une prestation part sans facture.
   */
  const tally = shootingTally([...linesByClient.values()].flat());
  const shootingsTotal = tally.included + tally.extra + tally.pending;

  return {
    withIssue,
    total: managed.length,
    shootingsCategorised: tally.included + tally.extra,
    shootingsTotal,
  };
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ depuis?: string; vue?: string }>;
}) {
  const filters = await searchParams;
  /*
   * Une borne illisible dans l'adresse ferait échouer les requêtes, et l'écran
   * afficherait des zéros comme s'il n'y avait rien eu. On retombe sur la
   * période par défaut plutôt que de mentir.
   */
  const since = /^\d{4}-\d{2}-\d{2}$/.test(filters.depuis ?? "")
    ? filters.depuis!
    : dateDaysAgo(90);
  const view: MetricsView = METRICS_VIEWS.includes(filters.vue as MetricsView)
    ? filters.vue as MetricsView
    : "overview";
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();

  /*
   * La fenêtre porte sur les **événements**, pas sur la semaine des fiches.
   *
   * Le filtre s'appliquait à `period_start`, le lundi de la semaine produite.
   * Deux erreurs en découlaient : une fiche préparée pour la semaine prochaine
   * a un lundi dans le futur, donc postérieur à la borne, et entrait dans « les
   * 7 derniers jours » ; à l'inverse, une fiche envoyée hier pour une semaine
   * ancienne en était écartée. Chaque mesure se compte désormais à la date de
   * ce qu'elle mesure — envoi, validation, retour.
   */
  const sinceDate = new Date(`${since}T00:00:00Z`);
  const sinceTs = sinceDate.toISOString();
  const inWindow = (value: string | null | undefined) => Boolean(value) && new Date(value!) >= sinceDate;

  /*
   * Deux requêtes par famille plutôt qu'un `or` : un filtre composé mal
   * interprété ne lève pas d'erreur visible, il renvoie une liste vide — et
   * l'écran afficherait des zéros comme s'il ne s'était rien passé. Ici, chaque
   * requête ne dit qu'une chose, et les résultats se rejoignent en mémoire.
   */
  const SHEET_FIELDS = "id, status, sent_to_client_at, first_viewed_at, approved_at, validation_deadline_at, clients ( name )";
  const TICKET_FIELDS = "id, weekly_sheet_id, ticket_type, status, submitted_at, resolved_at, clients ( name )";

  const [
    { data: sentSheets }, { data: approvedSheets },
    { data: receivedTickets }, { data: resolvedTickets },
    { data: versions }, { data: ratings }, { data: deliveries }, { data: openTickets }, { count: overdueCount },
  ] = await Promise.all([
    supabase.from("weekly_sheets").select(SHEET_FIELDS).gte("sent_to_client_at", sinceTs),
    supabase.from("weekly_sheets").select(SHEET_FIELDS).gte("approved_at", sinceTs),
    supabase.from("client_tickets").select(TICKET_FIELDS).gte("submitted_at", sinceTs),
    supabase.from("client_tickets").select(TICKET_FIELDS).gte("resolved_at", sinceTs),
    supabase.from("weekly_sheet_versions").select("weekly_sheet_id, version_number, source_ticket_id, sent_to_client_at"),
    /*
     * Notes données par les clients sur la période. Une note par fiche validée,
     * posée à l'écran de validation : c'est la voix du client, à côté des
     * comportements que le reste de l'écran observe.
     */
    supabase.from("client_sheet_ratings")
      .select("score, comment, submitted_at, weekly_sheet_id, clients ( id, name, logo_url )")
      .gte("submitted_at", sinceTs),
    /*
     * Commandes internes livrées sur la période. La ponctualité se mesure à la
     * livraison, pas à la commande : ce qui traîne encore se lit sur l'écran de
     * production, où l'on peut agir.
     */
    supabase.from("production_requests")
      .select("due_on, delivered_at")
      .gte("delivered_at", sinceTs),
    /*
     * Le retard n'est pas un événement de la période : c'est l'état du jour.
     * Le borner à la fenêtre revenait à oublier les fiches en souffrance depuis
     * plus longtemps — précisément celles qu'il faut voir.
     */
    /*
     * Tickets encore ouverts. Comme le retard des fiches, c'est un état du
     * jour : le borner à la fenêtre masquerait les plus anciens. L'échéance ne
     * vient plus de la base mais de l'heure d'arrivée — vingt heures ouvrées
     * pour renvoyer la correction.
     */
    supabase.from("client_tickets")
      .select("id, submitted_at, resolved_at")
      .not("status", "in", OPEN_TICKET_STATUSES),
    supabase.from("weekly_sheets")
      .select("id", { count: "exact", head: true })
      .lt("validation_deadline_at", new Date().toISOString())
      // `archived` n'existe pas dans l'énumération : la base refuse la requête
      // et le compte revient vide, c'est-à-dire zéro retard affiché à tort.
      .not("status", "in", "(approved_by_client,tacitly_approved,rejected,expired)"),
  ]);

  // Une fiche envoyée puis validée dans la période ne doit compter qu'une fois.
  const sheetList = [...new Map(
    [...(sentSheets ?? []), ...(approvedSheets ?? [])].map((sheet) => [sheet.id as string, sheet]),
  ).values()];
  const ticketList = [...new Map(
    [...(receivedTickets ?? []), ...(resolvedTickets ?? [])].map((ticket) => [ticket.id as string, ticket]),
  ).values()];
  const sent = sheetList.filter((sheet) => inWindow(sheet.sent_to_client_at));
  const viewed = sent.filter((sheet) => sheet.first_viewed_at);
  const approved = sheetList.filter((sheet) =>
    inWindow(sheet.approved_at) && ["approved_by_client", "tacitly_approved"].includes(sheet.status));
  const sheetIds = new Set(sheetList.map((sheet) => sheet.id));
  // Retours reçus pendant la période : c'est eux que comptent les répartitions.
  const received = ticketList.filter((ticket) => inWindow(ticket.submitted_at));
  const sheetsWithTickets = new Set(ticketList.map((ticket) => ticket.weekly_sheet_id).filter(Boolean));
  const approvedWithoutCorrection = sent.filter((sheet) => !sheetsWithTickets.has(sheet.id) && sheet.status === "approved_by_client");
  const beforeDeadline = approved.filter((sheet) => sheet.approved_at && sheet.validation_deadline_at && new Date(sheet.approved_at) <= new Date(sheet.validation_deadline_at));
  const overdue = overdueCount ?? 0;

  const responseDelays = sent.filter((sheet) => sheet.first_viewed_at && sheet.sent_to_client_at).map((sheet) => (new Date(sheet.first_viewed_at!).getTime() - new Date(sheet.sent_to_client_at!).getTime()) / 3_600_000);
  // Délai de correction : les retours clos pendant la période, quelle que soit
  // leur date d'arrivée — sans quoi une correction longue n'est jamais comptée.
  const correctionDelays = ticketList.filter((ticket) => inWindow(ticket.resolved_at)).map((ticket) => (new Date(ticket.resolved_at!).getTime() - new Date(ticket.submitted_at).getTime()) / 3_600_000);
  const averageResponse = average(responseDelays);
  const averageCorrection = average(correctionDelays);

  const byType = new Map<TicketType, number>();
  const byClient = new Map<string, number>();
  for (const ticket of received) {
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
  /*
   * Satisfaction : la moyenne des notes, en pourcentage, et surtout le taux de
   * réponse à côté. Une satisfaction de 100 % sur une seule réponse ne dit
   * rien, et l'oublier conduit à décider sur du vide.
   */
  const satisfaction = satisfactionSummary({
    scores: (ratings ?? []).map((row) => row.score as number),
    eligible: approved.length,
  });
  const punctuality = productionPunctuality(
    (deliveries ?? [])
      .filter((row) => row.delivered_at)
      .map((row) => ({ dueOn: row.due_on as string, deliveredAt: row.delivered_at as string })),
  );
  /*
   * Qui a noté quoi.
   *
   * La moyenne de satisfaction dit un chiffre ; elle ne dit pas quel client a
   * trouvé la semaine décevante. Chaque note reste attachée à son client, avec
   * son logo, pour qu'un signal faible se voie avant de devenir un signal fort.
   */
  const satisfactionEntries = await Promise.all((ratings ?? []).map(async (row) => {
    const client = row.clients as unknown as { id: string; name: string; logo_url: string | null } | null;
    const score = row.score as number;
    return {
      clientId: client?.id ?? row.weekly_sheet_id,
      clientName: client?.name ?? "Client",
      clientLogoUrl: await resolveClientLogoUrl(client?.logo_url ?? null),
      score,
      percentage: satisfactionPercentage(score),
      comment: row.comment as string | null,
      submittedAt: row.submitted_at as string,
    };
  }));
  const outOfScope = received.filter((ticket) => ticket.status === "out_of_scope").length;
  const ticketsPerSheet = sent.length ? received.length / sent.length : 0;
  const viewRate = ratio(viewed.length, sent.length);
  const noCorrectionRate = ratio(approvedWithoutCorrection.length, sent.length);
  const deadlineRate = ratio(beforeDeadline.length, approved.length);
  /*
   * Malus budgétaire.
   *
   * Le score ne regardait que la relation client : on pouvait valider vite et
   * bien tout en pilotant ses enveloppes à l'aveugle. Les budgets en défaut
   * — dates manquantes, enveloppe non renseignée, dépassement — retirent donc
   * des points, dans la limite d'un tiers.
   */
  const budget = await budgetHealth(supabase, profile?.role === "super_admin");
  const relationScore = average([viewRate, noCorrectionRate, deadlineRate].filter((value) => Number.isFinite(value)));
  const penalty = budgetPenalty({ clientsWithIssue: budget.withIssue, clientsTotal: budget.total });

  /*
   * Score de santé, en trois piliers.
   *
   * Une mesure sans donnée vaut `null` et non zéro : sur sept jours, une
   * semaine sans commande interne ou sans note client ne doit pas faire
   * plonger l'agence. C'est le module qui écarte ces mesures et redistribue
   * les poids ; ici on se contente de dire ce qu'on sait vraiment.
   */
  /*
   * Respect du délai de retour.
   *
   * Deux populations, un seul barème : les tickets reçus dans la fenêtre, qui
   * disent la tenue de la période, et les tickets encore ouverts hors fenêtre,
   * qui traînent depuis plus longtemps. Ne compter que les premiers laisserait
   * les retards les plus anciens hors du score.
   */
  /*
   * La réponse au client, c'est le lien corrigé qui part — pas la clôture du
   * ticket, qu'on oublie de poser. On prend donc le premier envoi d'une
   * version issue du ticket, et `resolved_at` seulement en repli.
   */
  const answeredAt = new Map<string, string>();
  for (const version of versions ?? []) {
    const ticketId = version.source_ticket_id as string | null;
    const sentAt = version.sent_to_client_at as string | null;
    if (!ticketId || !sentAt) continue;
    const known = answeredAt.get(ticketId);
    if (!known || new Date(sentAt) < new Date(known)) answeredAt.set(ticketId, sentAt);
  }
  const slaInput = (ticket: { id: string; submitted_at: string; resolved_at: string | null }) => ({
    submittedAt: ticket.submitted_at,
    respondedAt: answeredAt.get(ticket.id) ?? ticket.resolved_at ?? null,
  });
  const slaTickets = [
    ...ticketList.filter((ticket) => inWindow(ticket.submitted_at)).map(slaInput),
    ...(openTickets ?? []).filter((ticket) => !inWindow(ticket.submitted_at)).map(slaInput),
  ];
  const sla = ticketSlaSummary(slaTickets);
  const health = healthScore({
    satisfactionPercentage: satisfaction.percentage,
    satisfactionAnswers: satisfaction.answers,
    viewRate: sent.length ? viewRate : null,
    noCorrectionRate: sent.length ? noCorrectionRate : null,
    sentBeforeDeadlineRate: approved.length ? deadlineRate : null,
    correctionHours: correctionDelays.length ? averageCorrection : null,
    productionPunctuality: punctuality.percentage,
    budgetsComplete: budget.total ? ratio(budget.total - budget.withIssue, budget.total) : null,
    shootingsCategorised: budget.shootingsTotal
      ? ratio(budget.shootingsCategorised, budget.shootingsTotal)
      : null,
    ticketsOnTime: sla.percentage,
  });
  const overallScore = health.score ?? Math.max(0, relationScore - penalty);
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
    sla.late > 0
      ? { tone:"danger" as const, icon:"clock", title:`${sla.late} retour${sla.late > 1 ? "s" : ""} hors délai`, body:`Promesse de ${TICKET_SLA_HOURS} h ouvrées${sla.worstLateHours === null ? "" : ` · pire retard ${hours(sla.worstLateHours)} ouvrées`}.` }
      : sla.measured > 0
        ? { tone:"success" as const, icon:"clock", title:`Délai de ${TICKET_SLA_HOURS} h ouvrées tenu`, body:`${sla.onTime}/${sla.measured} retours corrigés dans les temps.` }
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
    health,
    healthActions: healthActions(health),
    openTicketsLate: sla.late,
    sla,
    periodLabel: periodLabel(since),
    satisfaction,
    satisfactionEntries,
    punctuality,
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
      {view === "satisfaction" ? <SatisfactionView data={data}/> : null}
      {view === "clients" ? <ClientsView data={data}/> : null}
    </div>
  );
}

type MetricsData = {
  sent:number; viewed:number; approved:number; approvedWithoutCorrection:number; beforeDeadline:number;
  overdue:number; averageResponse:number; averageCorrection:number; averageVersions:number; outOfScope:number;
  ticketsPerSheet:number; viewRate:number; noCorrectionRate:number; deadlineRate:number; overallScore:number;
  health:ReturnType<typeof healthScore>; healthActions:HealthAction[]; openTicketsLate:number;
  sla:ReturnType<typeof ticketSlaSummary>;
  /** Fenêtre analysée, telle qu'elle est écrite sur le sélecteur. */
  periodLabel:string;
  satisfaction:ReturnType<typeof satisfactionSummary>;
  satisfactionEntries:{ clientId:string; clientName:string; clientLogoUrl:string|null; score:number; percentage:number; comment:string|null; submittedAt:string }[];
  punctuality:ReturnType<typeof productionPunctuality>;
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
          <div className="relative z-10 min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/65">Score de santé</p>
            <h2 className="mt-2 max-w-md text-2xl font-semibold tracking-[-.04em] sm:text-3xl">La production en un regard</h2>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/70">Satisfaction client, rapidité de production et rigueur du suivi interne, pondérées 40 / 30 / 30.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <HeroPill label="Fiches envoyées" value={String(data.sent)}/>
              <HeroPill label="Tickets reçus" value={String(data.ticketTotal)}/>
              <HeroPill label="En retard" value={String(data.overdue)}/>
            </div>

            {/*
              Un score nu ne se conteste pas et ne se corrige pas. Les trois
              piliers disent d'où il vient ; le détail est juste en dessous.
            */}
            <div className="mt-4 flex flex-wrap gap-2">
              {data.health.pillars.map((pillar) => (
                <span
                  key={pillar.key}
                  className="rounded-xl bg-white/10 px-3 py-2 text-[11px] leading-snug text-white/85"
                >
                  {pillar.label} ·{" "}
                  <strong>{pillar.percentage === null ? "non mesuré" : `${pillar.percentage} %`}</strong>
                </span>
              ))}
            </div>
          </div>
          <Ring value={data.overallScore} label={`santé · ${data.periodLabel}`} light/>
        </article>

        <div className="insights-overview-kpis">
          <KpiCard icon="users" label="Consultation" value={data.sent ? percentValue(data.viewRate) : "—"} detail={`${data.viewed} fiche${data.viewed > 1 ? "s" : ""} ouverte${data.viewed > 1 ? "s" : ""}`} tone={data.sent ? rateTone(data.viewRate) : "info"} progress={data.sent ? data.viewRate : undefined}/>
          <KpiCard icon="check" label="Sans correction" value={data.sent ? percentValue(data.noCorrectionRate) : "—"} detail="validées au premier envoi" tone={data.sent ? rateTone(data.noCorrectionRate,70,45) : "info"} progress={data.sent ? data.noCorrectionRate : undefined}/>
          {/*
            Satisfaction : le taux de réponse est dit avec la note, jamais après.
            Un 100 % sur une réponse n'est pas un 100 %.
          */}
          <KpiCard
            icon="message"
            label="Satisfaction client"
            value={data.satisfaction.percentage === null ? "—" : percentValue(data.satisfaction.percentage)}
            detail={data.satisfaction.answers === 0
              ? "aucune réponse sur la période"
              : `${data.satisfaction.answers} réponse${data.satisfaction.answers > 1 ? "s" : ""} sur ${data.satisfaction.eligible} validation${data.satisfaction.eligible > 1 ? "s" : ""}${data.satisfaction.responseRate === null ? "" : ` · ${data.satisfaction.responseRate} %`}`}
            tone={data.satisfaction.percentage === null
              ? "info"
              : data.satisfaction.unhappy > 0 ? "danger" : rateTone(data.satisfaction.percentage)}
            progress={data.satisfaction.percentage ?? undefined}
          />
          {/*
            Production interne : le délai tenu se lit avec le reste, pas dans un
            onglet secondaire. C'est lui qui décale la semaine quand il glisse.
          */}
          <KpiCard
            icon="layers"
            label="Production interne dans les temps"
            value={data.punctuality.percentage === null ? "—" : percentValue(data.punctuality.percentage)}
            detail={data.punctuality.delivered === 0
              ? "aucune commande livrée sur la période"
              : `${data.punctuality.onTime}/${data.punctuality.delivered} livrées dans les temps${data.punctuality.averageDelayDays === null ? "" : ` · ${data.punctuality.averageDelayDays} j de retard moyen`}`}
            tone={data.punctuality.percentage === null ? "info" : rateTone(data.punctuality.percentage, 90, 70)}
            progress={data.punctuality.percentage ?? undefined}
          />
        </div>
      </section>

      <HealthPanel health={data.health}/>

      <AdvicePanel score={data.health.score} actions={data.healthActions}/>

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
        <KpiCard
          icon="layers"
          label="Commandes internes tenues"
          value={data.punctuality.percentage === null ? "—" : percentValue(data.punctuality.percentage)}
          detail={data.punctuality.delivered === 0
            ? "aucune livraison sur la période"
            : `${data.punctuality.onTime}/${data.punctuality.delivered} dans les temps${data.punctuality.averageDelayDays === null ? "" : ` · ${data.punctuality.averageDelayDays} j de retard moyen`}`}
          tone={data.punctuality.percentage === null ? "info" : rateTone(data.punctuality.percentage, 90, 70)}
          progress={data.punctuality.percentage ?? undefined}
        />
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
        {/*
          La promesse tenue, à côté du délai moyen : une moyenne flatteuse peut
          cacher deux retours partis trois jours trop tard.
        */}
        <KpiCard
          icon="check"
          label={`Retours corrigés en ${TICKET_SLA_HOURS} h ouvrées`}
          value={data.sla.percentage === null ? "—" : percentValue(data.sla.percentage)}
          detail={data.sla.measured === 0
            ? `aucun retour jugeable · ${data.sla.running} en cours`
            : `${data.sla.onTime}/${data.sla.measured} dans les temps${data.sla.worstLateHours === null ? "" : ` · pire retard ${hours(data.sla.worstLateHours)}`}`}
          tone={data.sla.percentage === null ? "info" : rateTone(data.sla.percentage, 90, 70)}
          progress={data.sla.percentage ?? undefined}
        />
        <KpiCard icon="copy" label="Versions par fiche" value={data.averageVersions ? data.averageVersions.toFixed(1) : "—"} detail={`${data.outOfScope} hors périmètre`} tone={data.outOfScope || data.averageVersions > 2 ? "warning" : "success"}/>
      </section>
      <section className="insights-detail-grid insights-returns-grid">
        <TicketPanel data={data} roomy/>
        <SignalPanel signals={data.signals} roomy/>
      </section>
    </div>
  );
}

/**
 * La voix du client, à part.
 *
 * Elle vivait mêlée aux métriques de tickets : deux sujets différents — le
 * traitement opérationnel des retours, et ce que le client en pense — sous un
 * seul onglet. Elle a son propre onglet, pour qu'on sache où la trouver sans
 * la chercher au milieu d'autre chose.
 */
function SatisfactionView({ data }: { data:MetricsData }) {
  return (
    <div className="insights-view insights-detail-view">
      <section className="insights-kpi-row">
        <KpiCard
          icon="spark"
          label="Satisfaction moyenne"
          value={data.satisfaction.percentage === null ? "—" : percentValue(data.satisfaction.percentage)}
          detail={data.satisfaction.answers === 0 ? "aucune réponse sur la période" : `${data.satisfaction.answers} note${data.satisfaction.answers > 1 ? "s" : ""} reçue${data.satisfaction.answers > 1 ? "s" : ""}`}
          tone={data.satisfaction.percentage === null ? "info" : data.satisfaction.unhappy > 0 ? "danger" : rateTone(data.satisfaction.percentage)}
          progress={data.satisfaction.percentage ?? undefined}
        />
        <KpiCard
          icon="users"
          label="Taux de réponse"
          value={data.satisfaction.responseRate === null ? "—" : percentValue(data.satisfaction.responseRate)}
          detail={`${data.satisfaction.answers}/${data.satisfaction.eligible} fiches validées notées`}
          tone={data.satisfaction.responseRate === null ? "info" : rateTone(data.satisfaction.responseRate, 60, 30)}
          progress={data.satisfaction.responseRate ?? undefined}
        />
        <KpiCard
          icon="warning"
          label="Notes décevantes"
          value={String(data.satisfaction.unhappy)}
          detail="à recontacter en priorité"
          tone={data.satisfaction.unhappy > 0 ? "danger" : "success"}
        />
      </section>
      <SatisfactionBoard entries={data.satisfactionEntries}/>
    </div>
  );
}

/**
 * Qui a noté quoi.
 *
 * La moyenne ne dit pas quel client a trouvé la semaine décevante. Chaque
 * note reste ici attachée à son client, dans le niveau qu'il a choisi, du
 * plus préoccupant au plus rassurant — pour qu'un signal faible se voie
 * avant de devenir un client qui part.
 */
function SatisfactionBoard({ entries }: { entries:MetricsData["satisfactionEntries"] }) {
  if (entries.length === 0) {
    return (
      <article className="insights-card">
        <div className="insights-panel-heading"><div><p className="eyebrow">Voix du client</p><h2 className="mt-1 font-semibold">Qui a noté quoi</h2></div></div>
        <EmptyMetric text="Aucune note reçue sur cette période."/>
      </article>
    );
  }
  const buckets: { score:1|2|3; tone:Tone }[] = [
    { score:1, tone:"danger" },
    { score:2, tone:"warning" },
    { score:3, tone:"success" },
  ];
  return (
    <section className="insights-satisfaction-grid">
      {buckets.map(({ score, tone }) => {
        const group = entries.filter((entry) => entry.score === score).sort((a,b) => b.submittedAt.localeCompare(a.submittedAt));
        return (
          <article key={score} className="insights-card insights-satisfaction-card">
            <div className="insights-panel-heading">
              <div><p className="eyebrow">{SATISFACTION_LABELS[score]}</p><h2 className="mt-1 font-semibold">{group.length} client{group.length > 1 ? "s" : ""}</h2></div>
              <span className={`insights-health-note insights-tone-${tone}`}>{percentValue(satisfactionPercentage(score))}</span>
            </div>
            {group.length === 0
              ? <EmptyMetric text="Personne dans ce niveau."/>
              : (
                <ul className="insights-satisfaction-list">
                  {group.map((entry) => (
                    <li key={`${entry.clientId}-${entry.submittedAt}`} className="insights-satisfaction-row">
                      <ClientSatisfactionGauge name={entry.clientName} logoUrl={entry.clientLogoUrl} percentage={entry.percentage} tone={tone}/>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{entry.clientName}</strong>
                        <span className="text-[11px] text-ink-faint">{new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short"}).format(new Date(entry.submittedAt))}</span>
                        {entry.comment && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">« {entry.comment} »</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </article>
        );
      })}
    </section>
  );
}

/**
 * Le logo cerclé de sa propre note : la jauge n'est pas décorative, c'est le
 * pourcentage de cette note précise — 0, 50 ou 100 — en conic-gradient autour
 * de l'image. Sans logo, les initiales en tiennent lieu.
 */
function ClientSatisfactionGauge({ name, logoUrl, percentage, tone }: { name:string; logoUrl:string|null; percentage:number; tone:Tone }) {
  const initials = name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0,2).toUpperCase();
  return (
    <span
      className={`insights-client-gauge insights-tone-${tone}`}
      style={{ background:`conic-gradient(var(--kpi-accent) ${percentage}%, #edf1f6 ${percentage}% 100%)` }}
      role="img"
      aria-label={`${name} : ${percentage}% de satisfaction`}
    >
      <span className="insights-client-gauge-inner">
        {logoUrl
          ? <Image src={logoUrl} alt="" width={40} height={40} unoptimized className="h-full w-full rounded-full object-cover"/>
          : <span className="insights-client-gauge-initials">{initials}</span>}
      </span>
    </span>
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

/*
 * Le nom du sidebar est déjà « Vue d’ensemble » pour l’accueil (`/`) — le
 * reprendre ici pour un onglet différent créait une confusion. « Aperçu » et
 * « Retours » (au lieu de « Vue d’ensemble » et « Retours clients ») lèvent
 * l’ambiguïté et raccourcissent des libellés qui débordaient sur mobile.
 * « Satisfaction » a son propre onglet plutôt que de rester noyée dans
 * « Retours » : le traitement des tickets et ce que le client en pense sont
 * deux sujets, pas un seul.
 *
 * La grille tient toujours dans l’écran, sans défilement horizontal ni texte
 * qui disparaît : à l’étroit, l’icône passe au-dessus du libellé plutôt que
 * de le faire disparaître. Le nombre de colonnes suit `items.length`, pour ne
 * pas devoir retoucher la feuille de style au prochain onglet ajouté.
 */
function MetricsMenu({ view, since }: { view:MetricsView; since:string }) {
  const items:{id:MetricsView;label:string;icon:string}[]=[
    {id:"overview",label:"Aperçu",icon:"dashboard"},
    {id:"validation",label:"Validation",icon:"check"},
    {id:"returns",label:"Retours",icon:"message"},
    {id:"satisfaction",label:"Satisfaction",icon:"spark"},
    {id:"clients",label:"Clients",icon:"users"},
  ];
  return (
    <nav
      className="insights-menu"
      aria-label="Catégories d’indicateurs"
      style={{ "--tab-count": items.length } as React.CSSProperties}
    >
      {items.map((item)=><Link key={item.id} href={`/indicateurs?vue=${item.id}&depuis=${since}`} aria-current={view===item.id?"page":undefined} className={view===item.id?"active":""}><Icon name={item.icon}/><span>{item.label}</span></Link>)}
    </nav>
  );
}

function PeriodFilter({ since, view }: { since:string; view:MetricsView }) {
  /*
   * Sept jours en tête : c'est la maille de la production — une semaine, une
   * fiche. Sans elle, la plus courte fenêtre était le mois, qui noie ce qui
   * vient de se passer dans les trois semaines précédentes.
   */
  const options=[{label:"7 j",date:dateDaysAgo(7)},{label:"30 j",date:dateDaysAgo(30)},{label:"90 j",date:dateDaysAgo(90)},{label:"6 mois",date:dateDaysAgo(180)}];
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

/**
 * Détail du score de santé.
 *
 * Chaque pilier montre ses mesures, y compris celles qui manquent : « non
 * mesuré » se corrige (il suffit d'alimenter la donnée), un zéro affiché à
 * tort se conteste — et à force, on cesse de regarder l'écran.
 */
function HealthPanel({ health }: { health:MetricsData["health"] }) {
  return (
    <section className="insights-health-grid">
      {health.pillars.map((pillar) => <HealthCard key={pillar.key} pillar={pillar}/>)}
    </section>
  );
}

function HealthCard({ pillar }: { pillar:HealthPillar }) {
  return (
    <article className="insights-card insights-health-card">
      <div className="insights-panel-heading">
        <div>
          <p className="eyebrow">{pillar.weight} % du score</p>
          <h2 className="mt-1 font-semibold">{pillar.label}</h2>
        </div>
        <span className={`insights-health-note insights-tone-${pillar.percentage === null ? "info" : rateTone(pillar.percentage, 80, 55)}`}>
          {pillar.percentage === null ? "—" : `${pillar.percentage} %`}
        </span>
      </div>
      <ul className="insights-health-list">
        {pillar.parts.map((part) => (
          <li key={part.label}>
            <div>
              <span>{part.label}</span>
              <strong>{part.percentage === null ? "non mesuré" : `${Math.round(part.percentage)} %`}</strong>
            </div>
            <div className="insights-health-bar" role="presentation">
              <i style={{ transform:`scaleX(${(part.percentage ?? 0) / 100})` }}/>
            </div>
            {part.detail ? <small>{part.detail}</small> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Ce qu'il reste à faire pour atteindre l'objectif.
 *
 * Un score qui stagne sans mode d'emploi finit en décoration. Chaque conseil
 * annonce ce qu'il rapporte vraiment sur le score global, du plus payant au
 * moins payant — sinon on travaille au hasard, souvent au mauvais endroit.
 */
function AdvicePanel({ score, actions }: { score:number|null; actions:HealthAction[] }) {
  const toDo = actions.filter((action) => action.percentage !== null);
  const missing = actions.filter((action) => action.percentage === null);
  const gap = score === null ? null : Math.max(0, HEALTH_TARGET - score);
  const reachable = Math.round(toDo.reduce((total, action) => total + action.gain, 0) * 10) / 10;

  return (
    <article className="insights-card insights-advice-panel">
      <div className="insights-panel-heading">
        <div>
          <p className="eyebrow">Objectif {HEALTH_TARGET} %</p>
          <h2 className="mt-1 font-semibold">
            {gap === null
              ? "Pas encore assez de données pour viser"
              : gap === 0
                ? "Objectif atteint"
                : `${gap} point${gap > 1 ? "s" : ""} à rattraper`}
          </h2>
        </div>
        {toDo.length > 0 && <span className="insights-soft-badge">+{reachable} pts disponibles</span>}
      </div>

      {toDo.length === 0 && missing.length === 0
        ? <EmptyMetric text="Toutes les mesures sont au-dessus de l’objectif."/>
        : (
          <ol className="insights-advice-list">
            {toDo.map((action) => (
              <li key={action.key}>
                <div className="insights-advice-head">
                  <span className="insights-advice-gain">+{action.gain} pts</span>
                  <div>
                    <strong>{action.label}</strong>
                    <small>{action.pillarLabel} · {Math.round(action.percentage!)} % aujourd’hui</small>
                  </div>
                </div>
                <p>{action.advice}</p>
              </li>
            ))}
            {missing.map((action) => (
              <li key={action.key} className="insights-advice-missing">
                <div className="insights-advice-head">
                  <span className="insights-advice-gain">non mesuré</span>
                  <div>
                    <strong>{action.label}</strong>
                    <small>{action.pillarLabel}</small>
                  </div>
                </div>
                <p>{action.advice}</p>
              </li>
            ))}
          </ol>
        )}
    </article>
  );
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
/**
 * Nom de la fenêtre analysée.
 *
 * Le score se calcule bien sur la période choisie, mais rien ne le disait :
 * quand deux fenêtres donnent le même chiffre — ce qui arrive dès que les
 * taux bougent peu — on croit l'écran figé.
 */
function periodLabel(since:string):string {
  const days = Math.round((Date.now() - new Date(`${since}T00:00:00Z`).getTime()) / 86_400_000);
  if (days <= 10) return "7 jours";
  if (days <= 45) return "30 jours";
  if (days <= 120) return "90 jours";
  return "6 mois";
}

function dateDaysAgo(days:number):string { return new Date(Date.now()-days*24*3600*1000).toISOString().slice(0,10); }
function formatDate(value:string):string { return new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`)); }
