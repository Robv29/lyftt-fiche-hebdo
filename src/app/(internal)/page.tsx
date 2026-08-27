import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { deadlineState } from "@/lib/domain/deadline";
import { sheetStatusLabel, ticketStatusLabel, ticketPriorityLabel } from "@/lib/domain/types";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { requiresProduction } from "@/lib/domain/routing";
import { Icon } from "@/components/Icon";
import { planningWeekRange, sheetCompletion } from "@/lib/domain/planning";
import {
  SHOOTING_LINE_KEYS,
  isShootingLine,
  budgetSummary,
  parseCustomMonthly, parseShootingPlan,
  shootingPlanSummary,
  shootingSchedule,
  type BillingMode,
  type BudgetLine,
} from "@/lib/domain/budget";
import { clientLifecycle, todayInParis as civilToday } from "@/lib/domain/client-lifecycle";
import type { MonthlyCadence } from "@/lib/domain/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ShootingReminders, type ShootingReminderRow } from "./ShootingReminders";

function todayInParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Réglages du client, stockés en JSON libre dans le champ `notes`. */
function clientSettings(notes: string | null): Record<string, unknown> {
  try {
    const parsed = typeof notes === "string" ? JSON.parse(notes) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Vue opérationnelle du jour, exclusivement alimentée par Supabase. */
export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  const today = todayInParis();

  const isAdmin = profile?.role === "super_admin";

  const [ticketsResult, sheetsResult, publicationsResult, clientsResult, preparationResult] = await Promise.all([
    supabase.from("client_tickets").select("id, ticket_number, title, ticket_type, status, priority, due_at, created_at, clients ( name )").not("status", "in", "(closed,cancelled,rejected,approved_by_client)").order("created_at", { ascending: false }).limit(50),
    supabase.from("weekly_sheets").select("id, iso_week, status, validation_deadline_at, clients ( name )").in("status", ["sent_to_client", "partially_approved", "changes_requested", "corrections_in_progress", "new_version_to_send", "awaiting_revalidation"]).order("validation_deadline_at", { ascending: true }).limit(120),
    supabase.from("weekly_sheet_items").select("id, published_at").eq("scheduled_date", today).eq("is_cancelled", false),
    supabase.from("clients").select("id, name, is_active, notes, contract_start_date, contract_end_date, pause_start_date, pause_end_date, client_contacts ( first_name, is_primary )").eq("is_active", true),
    /*
     * Fiches de la semaine prochaine, avec de quoi juger si elles sont prêtes.
     * Un simple comptage de brouillons ne disait pas si le travail était fait :
     * une fiche peut rester en préparation alors que tout y est, et une autre
     * paraître avancée sans un seul média.
     */
    supabase.from("weekly_sheets")
      .select("id, client_id, weekly_sheet_items ( caption, hashtags, format, media_asset_id, media_external_url, is_cancelled )")
      .gte("period_start", planningWeekRange().nextStart)
      .lte("period_start", planningWeekRange().nextEnd),
  ]);

  /*
   * Fiches à préparer : celles de la semaine prochaine qui ne sont pas
   * complètes, plus les clients actifs pour lesquels aucune fiche n'existe
   * encore — une fiche absente est le cas le moins prêt de tous.
   */
  const activeClients = (clientsResult.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    is_active: boolean;
    notes: string | null;
    contract_start_date: string | null;
    contract_end_date: string | null;
    pause_start_date: string | null;
    pause_end_date: string | null;
    client_contacts: Array<{ first_name: string | null; is_primary: boolean }> | null;
  }>;

  const nextWeekSheets = (preparationResult.data ?? []) as unknown as Array<{
    id: string;
    client_id: string;
    weekly_sheet_items: Array<{ caption: string | null; hashtags: string[] | null; format: string; media_asset_id: string | null; media_external_url: string | null; is_cancelled: boolean }>;
  }>;
  const incompleteSheets = nextWeekSheets.filter((sheet) => sheetCompletion(
    (sheet.weekly_sheet_items ?? []).map((item) => ({
      caption: item.caption,
      hashtags: item.hashtags,
      format: item.format as never,
      mediaAssetId: item.media_asset_id,
      mediaExternalUrl: item.media_external_url,
      isCancelled: item.is_cancelled,
    })),
  ).percentage < 100).length;
  const coveredClients = new Set(nextWeekSheets.map((sheet) => sheet.client_id));
  const producible = (activeClients ?? []).filter((client) => clientLifecycle({
    isActive: client.is_active,
    contractEndDate: client.contract_end_date,
    pauseStartDate: client.pause_start_date,
    pauseEndDate: client.pause_end_date,
  }, civilToday()).canProduce);
  const toPrepare = incompleteSheets + producible.filter((client) => !coveredClients.has(client.id)).length;

  /*
   * Shootings du forfait à planifier.
   *
   * L'échéance se compte depuis le dernier shooting réalisé — ou depuis le début
   * de gestion s'il n'y en a pas encore eu — et le rappel s'ouvre un mois avant :
   * c'est le délai qu'il faut pour trouver une date avec un client qui travaille.
   *
   * Les dates de shooting vivent dans le budget, réservé à la direction par RLS.
   * La lecture passe donc par la clé service, bornée aux clients déjà filtrés
   * par le périmètre de la personne connectée.
   */
  const shootingClients = producible
    .map((client) => ({ client, plan: parseShootingPlan(clientSettings(client.notes).shootingPlan) }))
    .filter((entry): entry is { client: typeof entry.client; plan: NonNullable<typeof entry.plan> } => Boolean(entry.plan));

  let shootingRows: ShootingReminderRow[] = [];
  if (shootingClients.length > 0) {
    const { data: shootingLines } = await createSupabaseAdminClient()
      .from("client_budget_lines")
      .select("client_id, performed_on")
      .in("service_key", SHOOTING_LINE_KEYS)
      .in("client_id", shootingClients.map((entry) => entry.client.id));

    const datesByClient = new Map<string, string[]>();
    for (const row of shootingLines ?? []) {
      const list = datesByClient.get(row.client_id as string) ?? [];
      list.push(row.performed_on as string);
      datesByClient.set(row.client_id as string, list);
    }

    shootingRows = shootingClients.flatMap(({ client, plan }) => {
      const dates = (datesByClient.get(client.id) ?? []).sort();
      // Un shooting à venir est une date calée ; le dernier passé sert d'ancre.
      const lastDoneOn = [...dates].reverse().find((date) => date <= today) ?? null;
      const plannedOn = dates.find((date) => date > today) ?? null;
      const schedule = shootingSchedule({
        plan,
        lastDoneOn,
        contractStartDate: client.contract_start_date,
        today,
      });
      if (!schedule) return [];
      if (!schedule.remindNow && !plannedOn) return [];

      const contacts = client.client_contacts ?? [];
      const contact = contacts.find((row) => row.is_primary) ?? contacts[0];
      const reminderSentOn = clientSettings(client.notes).shootingReminderOn;
      return [{
        clientId: client.id,
        clientName: client.name,
        contactFirstName: contact?.first_name ?? null,
        planLabel: shootingPlanSummary(plan),
        dueOn: schedule.dueOn,
        overdue: schedule.overdue,
        plannedOn,
        reminderSentOn: typeof reminderSentOn === "string" ? reminderSentOn : null,
      }];
    }).sort((first, second) => first.dueOn.localeCompare(second.dueOn));
  }

  /*
   * Budgets à régulariser, pour la direction seule : dates de gestion
   * manquantes, enveloppe non renseignée ou déjà dépassée. Ce sont les
   * dossiers où l'on facture à l'aveugle, ce qui pèse plus lourd qu'un ticket
   * prioritaire — celui-ci reste visible juste en dessous.
   */
  let budgetIssues = 0;
  if (isAdmin) {
    const [{ data: budgets }, { data: budgetLines }] = await Promise.all([
      supabase.from("client_budgets").select("client_id, billing_mode, budget_cents, rib_storage_path"),
      supabase.from("client_budget_lines").select("client_id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, billed_directly, forfait_included"),
    ]);

    const budgetByClient = new Map((budgets ?? []).map((row) => [row.client_id as string, row]));
    /*
     * Shootings dont personne n'a dit s'ils étaient compris dans le forfait ou
     * vendus en plus. Tant que la question n'est pas tranchée, une prestation
     * vendue peut rester offerte sans que personne s'en aperçoive : le dossier
     * est donc à régulariser au même titre qu'un budget non renseigné.
     */
    const pendingShootings = new Set(
      (budgetLines ?? [])
        .filter((row) => isShootingLine(row.service_key as string) && row.forfait_included === null)
        .map((row) => row.client_id as string),
    );
    const linesByClient = new Map<string, BudgetLine[]>();
    for (const row of budgetLines ?? []) {
      const list = linesByClient.get(row.client_id as string) ?? [];
      list.push({
        id: "", serviceKey: row.service_key as string, label: row.label as string,
        billing: row.billing as BudgetLine["billing"],
        unitPriceCents: row.unit_price_cents as number,
        quantity: Number(row.quantity),
        months: row.months as number | null,
        performedOn: row.performed_on as string,
        billedDirectly: Boolean(row.billed_directly),
      });
      linesByClient.set(row.client_id as string, list);
    }

    budgetIssues = producible.filter((client) => {
      const settings = clientSettings(client.notes) as { monthlyCadence?: MonthlyCadence; shootingPlan?: unknown; customMonthlyService?: unknown };
      const budget = budgetByClient.get(client.id);
      const summary = budgetSummary({
        billingMode: (budget?.billing_mode ?? "comptant") as BillingMode,
        annualBudgetCents: budget?.budget_cents ?? 0,
        lines: linesByClient.get(client.id) ?? [],
        cadence: settings.monthlyCadence ?? {},
        shooting: parseShootingPlan(settings.shootingPlan),
        customMonthly: parseCustomMonthly(settings.customMonthlyService),
        // Un RIB manquant se compte comme un dossier à régulariser.
        ribOnFile: Boolean(budget?.rib_storage_path),
        contractStartDate: client.contract_start_date,
        contractEndDate: client.contract_end_date,
        today: civilToday(),
      });
      // Sans date de début, rien n'est décompté : le dossier est à l'aveugle.
      if (!client.contract_start_date) return true;
      if (pendingShootings.has(client.id)) return true;
      return summary.alerts.some((alert) => alert.level === "critique" || alert.level === "attention");
    }).length;
  }

  const tickets = ticketsResult.data ?? [];
  const sheets = sheetsResult.data ?? [];
  const publications = publicationsResult.data ?? [];
  const published = publications.filter((item) => item.published_at).length;
  const newTickets = tickets.filter((ticket) => ticket.status === "new");
  const urgent = tickets.filter((ticket) => ticket.priority === "urgent" || ticket.priority === "high");
  const production = tickets.filter((ticket) => requiresProduction(ticket.ticket_type));
  const toResend = sheets.filter((sheet) => sheet.status === "new_version_to_send");
  /*
   * En attente de validation : la balle est dans le camp du client. Une fiche
   * en cours de correction chez nous n'attend pas le client, elle nous attend.
   */
  const awaitingClient = sheets.filter((sheet) =>
    ["sent_to_client", "partially_approved", "awaiting_revalidation"].includes(sheet.status));
  /*
   * Retard de validation : la seule urgence de cet écran qui se compte, et
   * celle qui décide si l'on relance aujourd'hui ou non.
   */
  const overdueSheets = awaitingClient.filter((sheet) =>
    sheet.validation_deadline_at
    && deadlineState(new Date(sheet.validation_deadline_at)).isOverdue).length;

  /*
   * Plafond de la liste : la page ne doit jamais s'allonger.
   *
   * Huit tient exactement dans les deux colonnes, sur quatre rangées. Les
   * fiches arrivent triées par échéance : ce sont donc les plus urgentes qui
   * restent, et le lien mène au planning pour les autres.
   */
  const AWAITING_SHOWN = 8;
  const awaitingShown = awaitingClient.slice(0, AWAITING_SHOWN);
  const awaitingHidden = awaitingClient.length - awaitingShown.length;
  const greetingDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date());
  const publicationProgress = publications.length ? Math.round((published / publications.length) * 100) : 100;

  return (
    <div className="dashboard-page">
      {/*
        En-tête et indicateurs réunis.
        Ils occupaient deux blocs empilés — un bandeau de bienvenue, puis quatre
        grandes cartes — soit près de la moitié de l'écran avant d'arriver à ce
        qui demande une action. Les huit chiffres tiennent dans le bandeau, et
        chacun mène à l'écran correspondant : un compteur qu'on ne peut pas
        ouvrir n'est qu'une décoration.
      */}
      <section className="dashboard-hero relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#157bc3] via-[#1166a8] to-[#0b4f88] p-5 text-white shadow-[0_22px_52px_rgba(11,79,136,.20)] sm:p-6">
        <span aria-hidden="true" className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/[.07]" />
        <span aria-hidden="true" className="absolute -bottom-32 left-16 h-64 w-64 rounded-full bg-[#6bc1ff]/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.3rem,2vw,1.7rem)] font-semibold leading-tight tracking-[-.03em]">
              Bonjour {profile?.full_name?.split(" ")[0]}
            </h1>
            <p className="mt-0.5 text-xs capitalize text-white/65">{greetingDate}</p>
          </div>
          <Link href="/fiches" className="btn w-fit shrink-0 border border-white/20 bg-white/10 text-white shadow-none backdrop-blur-sm hover:bg-white/20"><Icon name="calendar" className="h-4 w-4"/>Ouvrir le planning</Link>
        </div>

        <div className="dashboard-hero-metrics relative mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric icon="check" label="Validations en attente" value={awaitingClient.length} href="#validations" tone={awaitingClient.length ? "alert" : "calm"} />
          <HeroMetric icon="clock" label="Fiches à renvoyer" value={toResend.length} href="/fiches" tone={toResend.length ? "alert" : "calm"} />
          <HeroMetric icon="message" label="Nouveaux retours" value={newTickets.length} href="/retours" tone={newTickets.length ? "alert" : "calm"} />
          <HeroMetric icon="layers" label="Fiches à préparer" value={toPrepare} href="/fiches?tab=next" />
          <HeroMetric icon="layers" label="Corrections production" value={production.length} href="/production" />
          <HeroMetric icon="send" label="Publications du jour" value={`${published}/${publications.length}`} href="/publications" detail={`${publicationProgress} %`} />
          {isAdmin
            ? <HeroMetric icon="euro" label="Budgets à régulariser" value={budgetIssues} href="/budget" tone={budgetIssues ? "alert" : "calm"} />
            : <HeroMetric icon="warning" label="Tickets prioritaires" value={urgent.length} href="/retours" tone={urgent.length ? "alert" : "calm"} />}
          <HeroMetric icon="users" label="Clients en gestion" value={producible.length} href="/clients" />
        </div>
      </section>

      {/*
        Validations en attente, juste sous l'en-tête.
        C'est le seul bloc d'où part une action vers le client — relancer — et
        il était relégué en bas de la colonne de droite, sous les shootings.
      */}
      <section className="section-card" id="validations">
        <div className="section-card-header">
          <div>
            <p className="eyebrow">Validation</p>
            <h2 className="mt-1 font-semibold">Fiches en attente de validation client</h2>
          </div>
          <div className="flex items-center gap-2">
            {overdueSheets > 0 && <span className="badge bg-state-changes/10 text-state-changes">{overdueSheets} en retard</span>}
            <span className="badge bg-[#e8f2ff] text-[#0b5e9f]">{awaitingClient.length}</span>
            <Link href="/fiches" className="text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">Tout voir →</Link>
          </div>
        </div>
        {awaitingClient.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-faint">Aucune validation en attente.</p>
        ) : (
          /*
            Deux colonnes sur grand écran : sept fiches sur une seule colonne
            repoussaient le reste hors de l'écran. « Relancer » ouvre la fiche
            avec le message de rappel déjà prêt.
          */
          <ul className="grid divide-y divide-line xl:grid-cols-2 xl:divide-x">
            {awaitingShown.map((sheet) => {
              const client = sheet.clients as unknown as { name: string } | null;
              const deadline = sheet.validation_deadline_at ? deadlineState(new Date(sheet.validation_deadline_at)) : null;
              return <li key={sheet.id} className="flex items-center gap-2 px-5 py-3 transition-colors hover:bg-[#f7fafe]">
                <Link href={`/fiches/${sheet.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="truncate text-sm">{client?.name ?? "Client"}</strong>
                    <span className={`shrink-0 text-[11px] font-semibold ${deadline?.isOverdue ? "text-state-changes" : "text-ink-faint"}`}>{deadline?.label ?? `S${sheet.iso_week}`}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">Semaine {sheet.iso_week} · {sheetStatusLabel(sheet.status)}</p>
                </Link>
                <Link
                  href={`/fiches/${sheet.id}?relance=1`}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${deadline?.isOverdue ? "bg-state-changes/10 text-state-changes hover:bg-state-changes/20" : "bg-[#e8f2ff] text-[#0b5e9f] hover:bg-[#d8e9ff]"}`}
                >
                  Relancer
                </Link>
              </li>;
            })}
          </ul>
        )}
        {awaitingHidden > 0 && (
          <Link
            href="/fiches"
            className="block border-t border-line px-5 py-2.5 text-center text-xs font-semibold text-[#0b63ad] hover:bg-[#f7fafe]"
          >
            {awaitingHidden} autre{awaitingHidden > 1 ? "s" : ""} fiche{awaitingHidden > 1 ? "s" : ""} en attente — voir le planning →
          </Link>
        )}
      </section>

      <div className="dashboard-bottom grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="section-card">
          <div className="section-card-header">
            <div><p className="eyebrow">File d’intervention</p><h2 className="mt-1 font-semibold">Retours clients à traiter</h2></div>
            <Link href="/retours" className="text-xs font-semibold text-[#0b63ad] hover:text-[#07487f]">Tout voir →</Link>
          </div>
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-5 text-center"><span className="empty-state-icon"><Icon name="check" className="h-5 w-5"/></span><strong className="mt-2 text-sm">Tout est à jour</strong><p className="mt-1 text-xs text-ink-faint">Aucun retour client ne demande votre attention.</p></div>
          ) : (
            <ul className="divide-y divide-line">
              {tickets.slice(0, 4).map((ticket) => {
                const client = ticket.clients as unknown as { name: string } | null;
                return <li key={ticket.id}><Link href={`/retours/${ticket.id}`} className="group grid gap-2 px-5 py-3 transition-colors hover:bg-[#f7fafe] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-xs font-bold text-[#0b4f88]">{(client?.name ?? "CL").slice(0,2).toUpperCase()}</span><div className="min-w-0"><strong className="block truncate text-sm">{client?.name ?? "Client"}</strong><p className="mt-0.5 truncate text-xs text-ink-faint">{getTicketTypeDefinition(ticket.ticket_type).label} · {ticket.ticket_number}</p></div></div>
                  <div className="flex items-center gap-2 pl-[48px] sm:pl-0">{ticket.priority !== "normal" && <span className="badge bg-state-changes/10 text-state-changes">{ticketPriorityLabel(ticket.priority)}</span>}<span className="badge bg-canvas text-ink-soft">{ticketStatusLabel(ticket.status)}</span><Icon name="arrow" className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5"/></div>
                </Link></li>;
              })}
            </ul>
          )}
        </section>

        {/* Rien à afficher tant qu'aucun shooting n'arrive à échéance. */}
        <ShootingReminders rows={shootingRows}/>
      </div>
    </div>
  );
}

/**
 * Chiffre du bandeau, cliquable.
 *
 * `tone="alert"` cercle le compteur quand il porte quelque chose à faire : sur
 * huit chiffres alignés, celui qui appelle une action doit se distinguer sans
 * qu'on lise les huit libellés.
 */
function HeroMetric({ icon, label, value, href, detail, tone = "plain" }: {
  icon: string;
  label: string;
  value: number | string;
  href: string;
  detail?: string;
  tone?: "plain" | "alert" | "calm";
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-2xl border p-3 backdrop-blur-sm transition-colors hover:bg-white/[.16] ${
        tone === "alert" ? "border-white/40 bg-white/[.16]" : "border-white/15 bg-white/[.09]"
      }`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/15"><Icon name={icon} className="h-4 w-4"/></span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-white/65">{label}</p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tracking-[-.03em]">{value}</span>
          {detail && <span className="text-[10px] text-white/55">{detail}</span>}
        </p>
      </div>
    </Link>
  );
}
