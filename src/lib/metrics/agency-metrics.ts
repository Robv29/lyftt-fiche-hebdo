import "server-only";

import { clientFormula } from "@/lib/domain/client-formula";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  budgetSummary,
  countableShootings,
  shootingTally,
  type BillingMode,
  type BudgetLine,
  SHOOTING_SCORING_FROM,
} from "@/lib/domain/budget";
import { healthActions, healthScore, type HealthAction } from "@/lib/domain/health-score";
import { clientLifecycle, todayInParis, parseClientKind } from "@/lib/domain/client-lifecycle";
import { satisfactionPercentage, satisfactionSummary } from "@/lib/domain/planning";
import { productionPunctuality } from "@/lib/domain/production-requests";
import { ticketSlaSummary, TICKET_SLA_HOURS } from "@/lib/domain/ticket-sla";
import { resolveClientLogoUrl } from "@/lib/media/client-logo";
import type { TicketType } from "@/lib/domain/ticket-types";

/**
 * Lecture des indicateurs de l'agence, pour l'écran Indicateurs comme pour le
 * tableau de bord.
 *
 * Tout ce calcul vivait dans la page Indicateurs. Afficher le score de santé
 * sur la vue d'ensemble en le recopiant aurait donné deux notes à la même
 * agence dès la première règle corrigée d'un seul côté — ce qui est déjà
 * arrivé ailleurs dans l'application. Il n'y a donc qu'une lecture, ici, et
 * les écrans ne font que l'afficher.
 */

type AgencySupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type MetricsTone = "info" | "success" | "warning" | "danger" | "violet";

export const CHART_COLORS = ["#1b87dd", "#34c5bb", "#78d6a3", "#ef9c50", "#e65b67", "#7768e8"];

/**
 * Fenêtre par défaut, en jours.
 *
 * Le tableau de bord n'a pas de sélecteur : il lit la même fenêtre que celle
 * qu'ouvre Indicateurs sans paramètre, pour que le chiffre de l'accueil soit
 * celui qu'on retrouve en cliquant sur « Voir le détail ».
 */
export const DEFAULT_METRICS_DAYS = 90;

/*
 * Statuts d'un ticket encore à traiter.
 *
 * Le suivi interne se juge sur ce qui reste ouvert : un ticket clos, refusé ou
 * hors périmètre n'attend plus personne, et le compter en retard salirait la
 * note sans rien dire d'utile.
 */
const OPEN_TICKET_STATUSES = "(approved_by_client,closed,rejected,out_of_scope,cancelled)";

export type AgencyMetrics = {
  sent:number; viewed:number; approved:number; approvedWithoutCorrection:number; beforeDeadline:number;
  overdue:number; averageResponse:number; averageCorrection:number; averageVersions:number; outOfScope:number;
  ticketsPerSheet:number; viewRate:number; noCorrectionRate:number; deadlineRate:number;
  health:ReturnType<typeof healthScore>; healthActions:HealthAction[]; openTicketsLate:number;
  sla:ReturnType<typeof ticketSlaSummary>;
  /** Fenêtre analysée, telle qu'elle est écrite sur le sélecteur. */
  periodLabel:string;
  satisfaction:ReturnType<typeof satisfactionSummary>;
  /** `clientLogoUrl` reste null quand l'appelant n'affiche pas les logos. */
  satisfactionEntries:{ clientId:string; clientName:string; clientLogoUrl:string|null; score:number; percentage:number; comment:string|null; submittedAt:string }[];
  punctuality:ReturnType<typeof productionPunctuality>;
  ticketTotal:number; typeEntries:[TicketType,number][]; clientEntries:[string,number][]; donutGradient:string;
  signals:{tone:MetricsTone;icon:string;title:string;body:string}[];
};

/**
 * Santé des budgets, réservée à la direction.
 *
 * Les tables budgétaires sont fermées aux autres rôles : la requête ne
 * renverrait rien, et un malus silencieux fondé sur zéro donnée serait pire
 * qu'aucun malus.
 */
async function budgetHealth(
  supabase: AgencySupabase,
  isAdmin: boolean,
): Promise<{ withIssue: number; total: number; shootingsCategorised: number; shootingsTotal: number }> {
  if (!isAdmin) return { withIssue: 0, total: 0, shootingsCategorised: 0, shootingsTotal: 0 };

  const today = todayInParis();
  const [{ data: clients }, { data: budgets }, { data: lines }, { data: invoices }] = await Promise.all([
    supabase.from("clients").select("id, notes, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date").eq("is_active", true),
    supabase.from("client_budgets").select("client_id, billing_mode, budget_cents"),
    supabase.from("client_budget_lines").select("client_id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, billed_directly, forfait_included"),
    supabase.from("client_invoices").select("client_id, period_month, status"),
  ]);

  /*
   * Mois dont la facture est partie. Un shooting qui s'y rattache n'est plus
   * classable : le requalifier changerait un montant déjà transmis.
   */
  const settledMonths = new Set(
    (invoices ?? [])
      .filter((row) => row.status === "faite" || row.status === "prelevement_programme")
      .map((row) => `${row.client_id as string}|${String(row.period_month).slice(0, 7)}`),
  );

  const managed = (clients ?? []).filter((client) => clientLifecycle({
    isActive: client.is_active as boolean,
    kind: parseClientKind(client.client_kind),
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
    const budget = budgetByClient.get(client.id as string);
    const summary = budgetSummary({
      billingMode: (budget?.billing_mode ?? "comptant") as BillingMode,
      annualBudgetCents: budget?.budget_cents ?? 0,
      lines: linesByClient.get(client.id as string) ?? [],
      /*
       * Le forfait shooting et le supplément mensuel avaient déjà manqué ici,
       * puis le forfait de base négocié : chaque paramètre ajouté à la
       * formule devait être recopié à la main, et ne l'était jamais partout.
       * `clientFormula` est désormais la seule lecture.
       */
      ...clientFormula(client as never),
      today,
    });
    return summary.alerts.some((alert) => alert.level === "critique" || alert.level === "attention");
  }).length;

  /*
   * Shootings en attente de tri. Tant qu'on ne sait pas si un shooting est
   * compris au forfait ou vendu en plus, il n'est ni facturé ni écarté : c'est
   * exactement le trou par lequel une prestation part sans facture.
   */
  const tally = shootingTally(
    [...linesByClient.entries()].flatMap(([clientId, clientLines]) =>
      countableShootings(clientLines, {
        isSettledMonth: (performedOn) =>
          settledMonths.has(`${clientId}|${performedOn.slice(0, 7)}`),
        // La note ne juge que ce qui a été tourné depuis la bascule.
        since: SHOOTING_SCORING_FROM,
        // Une date calée d'avance n'a pas encore été tournée.
        until: today,
      })),
  );
  const shootingsTotal = tally.included + tally.extra + tally.pending;

  return {
    withIssue,
    total: managed.length,
    shootingsCategorised: tally.included + tally.extra,
    shootingsTotal,
  };
}

/**
 * Indicateurs de l'agence depuis `since` (AAAA-MM-JJ).
 *
 * `isAdmin` ouvre le volet budgétaire, fermé aux autres rôles. Les logos des
 * clients qui ont noté ne sont signés que si l'écran les montre : une URL
 * signée par note, jamais affichée, ralentirait l'accueil pour rien.
 */
export async function readAgencyMetrics(
  supabase: AgencySupabase,
  { since, isAdmin, withSatisfactionLogos }: { since: string; isAdmin: boolean; withSatisfactionLogos: boolean },
): Promise<AgencyMetrics> {
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

  /*
   * Le volet budgétaire ne dépend d'aucune des lectures ci-dessous : il part
   * en même temps, plutôt que d'allonger l'attente de chaque écran qui lit ces
   * indicateurs.
   */
  const [[
    { data: sentSheets }, { data: approvedSheets },
    { data: receivedTickets }, { data: resolvedTickets },
    { data: versions }, { data: ratings }, { data: deliveries }, { data: openTickets }, { count: overdueCount },
  ], budget] = await Promise.all([
    Promise.all([
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
    ]),
    /*
     * Malus budgétaire.
     *
     * Le score ne regardait que la relation client : on pouvait valider vite et
     * bien tout en pilotant ses enveloppes à l'aveugle. Les budgets en défaut
     * — dates manquantes, enveloppe non renseignée, dépassement — retirent donc
     * des points, dans la limite d'un tiers.
     */
    budgetHealth(supabase, isAdmin),
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
      clientLogoUrl: withSatisfactionLogos ? await resolveClientLogoUrl(client?.logo_url ?? null) : null,
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
  const typeEntries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const clientEntries = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const ticketTotal = typeEntries.reduce((total, entry) => total + entry[1], 0);
  const donutGradient = buildDonut(typeEntries.map(([, count]) => count), ticketTotal);
  const signals = [
    overdue > 0
      ? { tone:"danger" as const, icon:"warning", title:`${overdue} validation${overdue > 1 ? "s" : ""} en retard`, body:"Relance client recommandée aujourd’hui." }
      : { tone:"success" as const, icon:"check", title:"Échéances maîtrisées", body:"Aucune validation en retard." },
    averageCorrection > 48
      ? { tone:"danger" as const, icon:"clock", title:"Corrections trop longues", body:`Délai moyen : ${formatHours(averageCorrection)}.` }
      : averageCorrection > 24
        ? { tone:"warning" as const, icon:"clock", title:"Délai à surveiller", body:`Moyenne actuelle : ${formatHours(averageCorrection)}.` }
        : { tone:"success" as const, icon:"layers", title:"Corrections fluides", body:averageCorrection ? `Moyenne : ${formatHours(averageCorrection)}.` : "Pas encore assez de données." },
    sla.late > 0
      ? { tone:"danger" as const, icon:"clock", title:`${sla.late} retour${sla.late > 1 ? "s" : ""} hors délai`, body:`Promesse de ${TICKET_SLA_HOURS} h ouvrées${sla.worstLateHours === null ? "" : ` · pire retard ${formatHours(sla.worstLateHours)} ouvrées`}.` }
      : sla.measured > 0
        ? { tone:"success" as const, icon:"clock", title:`Délai de ${TICKET_SLA_HOURS} h ouvrées tenu`, body:`${sla.onTime}/${sla.measured} retours corrigés dans les temps.` }
        : { tone:"info" as const, icon:"message", title:"Retours stables", body:sent.length ? `${ticketsPerSheet.toFixed(1)} ticket par fiche.` : "Pas encore de fiche envoyée." },
  ];

  return {
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
}

function buildDonut(values:number[], total:number):string {
  if (!total) return "#edf1f6";
  let cursor=0;
  const stops=values.map((value,index)=>{const start=cursor;cursor+=value/total*100;return `${CHART_COLORS[index%CHART_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;});
  return `conic-gradient(${stops.join(",")})`;
}
function average(values:number[]):number { return values.length ? values.reduce((total,value)=>total+value,0)/values.length : 0; }
function ratio(part:number,total:number):number { return total ? part/total*100 : 0; }

/** Délai en heures, lisible : « 5.0 h » sous la journée, « 1.5 j » au-delà. */
export function formatHours(value:number):string { return value ? value<24?`${value.toFixed(1)} h`:`${(value/24).toFixed(1)} j` : "—"; }

/**
 * Nom de la fenêtre analysée.
 *
 * Le score se calcule bien sur la période choisie, mais rien ne le disait :
 * quand deux fenêtres donnent le même chiffre — ce qui arrive dès que les
 * taux bougent peu — on croit l'écran figé.
 */
export function periodLabel(since:string):string {
  const days = Math.round((Date.now() - new Date(`${since}T00:00:00Z`).getTime()) / 86_400_000);
  if (days <= 10) return "7 jours";
  if (days <= 45) return "30 jours";
  if (days <= 120) return "90 jours";
  return "6 mois";
}

/** Borne de début d'une fenêtre de `days` jours, au format de l'adresse. */
export function dateDaysAgo(days:number):string { return new Date(Date.now()-days*24*3600*1000).toISOString().slice(0,10); }

/**
 * Borne par défaut. C'est la même que l'option « 90 j » du sélecteur
 * d'Indicateurs : l'écran l'affiche active quand on arrive sans paramètre.
 */
export function defaultMetricsSince():string { return dateDaysAgo(DEFAULT_METRICS_DAYS); }
