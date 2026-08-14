import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPeriod } from "@/lib/domain/deadline";
import {
  civilDaysBefore,
  planningBucketForPeriod,
  planningWeekRange,
  sheetCompletion,
  weeklyFormatsForCadence,
  type MonthlyCadence,
} from "@/lib/domain/planning";
import { sheetStatusLabel, type MediaFormat, type SheetStatus, type TicketPriority, type TicketStatus } from "@/lib/domain/types";
import { isClientValidated, validationRate } from "@/lib/domain/sheet-status";
import { clientLifecycle } from "@/lib/domain/client-lifecycle";
import { isTicketOpen } from "@/lib/domain/workflow";
import { Icon } from "@/components/Icon";
import { PlanningTabs } from "./PlanningTabs";
import { SheetTopic } from "./SheetTopic";

interface PlanningItem {
  caption: string | null;
  hashtags: string[] | null;
  format: MediaFormat;
  media_asset_id: string | null;
  media_external_url: string | null;
  is_cancelled: boolean;
}

interface PlanningTicket {
  priority: TicketPriority;
  status: TicketStatus;
}

interface PlanningSheet {
  id: string;
  topic: string | null;
  iso_year: number;
  iso_week: number;
  period_start: string;
  period_end: string;
  status: string;
  clients: { id: string; name: string } | null;
  weekly_sheet_items: PlanningItem[];
  client_tickets: PlanningTicket[];
}

function completionForSheet(sheet: PlanningSheet) {
  return sheetCompletion(sheet.weekly_sheet_items.map((item) => ({
    caption: item.caption,
    hashtags: item.hashtags,
    format: item.format,
    mediaAssetId: item.media_asset_id,
    mediaExternalUrl: item.media_external_url,
    isCancelled: item.is_cancelled,
  })));
}

function hasHighPriorityChange(sheet: PlanningSheet): boolean {
  return sheet.client_tickets.some((ticket) =>
    ["high", "urgent"].includes(ticket.priority)
    && isTicketOpen(ticket.status),
  );
}

function ProgressBar({ percentage, label }: { percentage: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px] font-medium">
        <span className="text-ink-faint">{label}</span>
        <span className={percentage === 100 ? "text-state-approved" : "text-[#0759e6]"}>{percentage}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`${label} : ${percentage}%`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <span className={`block h-full origin-left rounded-full transition-transform duration-300 ${percentage === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${percentage / 100})` }}/>
      </div>
    </div>
  );
}

function SheetCard({ sheet, showProgress = false, showTopic = false }: { sheet: PlanningSheet; showProgress?: boolean; showTopic?: boolean }) {
  const completion = completionForSheet(sheet);
  const urgent = hasHighPriorityChange(sheet);
  const validated = isClientValidated(sheet.status as SheetStatus);
  const period = formatPeriod(
    new Date(`${sheet.period_start}T00:00:00Z`),
    new Date(`${sheet.period_end}T00:00:00Z`),
  );

  return (
    <li className={`card lift-card overflow-hidden ${validated ? "border-state-approved/40 bg-[#f6fdf9]" : urgent ? "ring-2 ring-state-changes/20" : ""}`}>
      <Link href={`/fiches/${sheet.id}`} className="block p-4 hover:bg-canvas sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{sheet.clients?.name ?? "Client"}</h3>
              {validated && <span className="badge gap-1 bg-[#e8f8f1] text-state-approved"><Icon name="check" className="h-3 w-3"/>Validée par le client</span>}
              {!validated && urgent && <span className="badge bg-state-changes/10 text-state-changes">Modification haute</span>}
              {!validated && !urgent && completion.percentage < 100 && <span className="badge bg-[#fff7e6] text-[#8a5700]">À compléter</span>}
            </div>
            <p className="mt-1 text-xs text-ink-faint">Semaine {sheet.iso_week} · {period}</p>
          </div>
          <Icon name="arrow" className="mt-1 h-4 w-4 shrink-0 text-ink-faint"/>
        </div>

        {showProgress && completion.percentage < 100 && (
          <div className="mt-4"><ProgressBar percentage={completion.percentage} label="Préparation de la fiche"/></div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
          <span className={validated ? "font-semibold text-state-approved" : "text-ink-soft"}>{sheetStatusLabel(sheet.status)}</span>
          <span className={completion.percentage === 100 ? "font-semibold text-state-approved" : "text-ink-faint"}>
            {completion.percentage === 100 ? "Fiche complète" : `${completion.completed}/${completion.total} éléments prêts`}
          </span>
        </div>
      </Link>

      {/* Hors du lien : le sujet se saisit sur place, sans ouvrir la fiche. */}
      {showTopic && <div className="px-4 pb-4 sm:px-5 sm:pb-5"><SheetTopic sheetId={sheet.id} initialTopic={sheet.topic}/></div>}
    </li>
  );
}

export default async function SheetsPage() {
  const supabase = await createSupabaseServerClient();
  const range = planningWeekRange();

  const [{ data: rawSheets }, { data: clients }] = await Promise.all([
    supabase
      .from("weekly_sheets")
      .select(`id, iso_year, iso_week, period_start, period_end, status, topic,
        clients ( id, name ),
        weekly_sheet_items ( caption, hashtags, format, media_asset_id, media_external_url, is_cancelled ),
        client_tickets ( priority, status )`)
      .lte("period_start", range.nextEnd)
      .order("period_start", { ascending: false })
      .limit(300),
    supabase
      .from("clients")
      .select("id, name, notes, is_active, contract_start_date, contract_end_date, pause_start_date, pause_end_date")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const sheets = (rawSheets ?? []) as unknown as PlanningSheet[];
  // Une seule semaine d'historique est conservee ; la purge planifiee supprime
  // les fiches plus anciennes.
  const previousWeekStart = civilDaysBefore(range.currentStart, 7);
  /*
   * Un client en pause, dont la gestion est terminée ou pas encore commencée
   * n'a rien à faire dans le planning : ses fiches y encombrent la vue d'un
   * travail qu'on ne fera pas cette semaine. Elles restent accessibles depuis
   * sa fiche client.
   */
  const producibleClientIds = new Set(
    (clients ?? []).filter((client) => clientLifecycle({
      isActive: client.is_active,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      pauseStartDate: client.pause_start_date,
      pauseEndDate: client.pause_end_date,
    }).canProduce).map((client) => client.id),
  );
  const sheetsOfManagedClients = sheets.filter((sheet) =>
    sheet.clients?.id ? producibleClientIds.has(sheet.clients.id) : true);

  const past = sheetsOfManagedClients.filter((sheet) =>
    planningBucketForPeriod(sheet.period_start, sheet.period_end) === "past"
    && sheet.period_start >= previousWeekStart);
  const current = sheetsOfManagedClients
    .filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "current")
    .sort((a, b) => Number(hasHighPriorityChange(b)) - Number(hasHighPriorityChange(a))
      || completionForSheet(a).percentage - completionForSheet(b).percentage);
  const next = sheetsOfManagedClients.filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "next");
  const nextClientIds = new Set(next.map((sheet) => sheet.clients?.id).filter(Boolean));
  // Aucune proposition pour un client en pause ou dont la gestion est terminée.
  const proposals = (clients ?? []).filter((client) => !nextClientIds.has(client.id)
    && clientLifecycle({
      isActive: client.is_active,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      pauseStartDate: client.pause_start_date,
      pauseEndDate: client.pause_end_date,
    }).canProduce);
  // Un taux par période : l'indicateur en tête suit l'onglet consulté.
  const rateOf = (group: PlanningSheet[]) =>
    validationRate(group.map((sheet) => sheet.status as SheetStatus));
  const validation = { past: rateOf(past), current: rateOf(current), next: rateOf(next) };

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Production éditoriale</p>
        <h1 className="page-title mt-1">Planning</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">Le travail est proposé automatiquement selon les prestations de chaque client. Ouvrez simplement la fiche à préparer.</p>
      </div>

      <PlanningTabs
        counts={{ past: past.length, current: current.length, next: next.length + proposals.length }}
        validation={validation}
        toCreate={proposals.length}
        past={past.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">{past.map((sheet) => <SheetCard key={sheet.id} sheet={sheet}/>)}</ul>
        ) : (
          <p className="card px-4 py-6 text-center text-sm text-ink-faint">Aucune fiche passée.</p>
        )}
        current={current.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">{current.map((sheet) => <SheetCard key={sheet.id} sheet={sheet}/>)}</ul>
        ) : (
          <p className="card px-4 py-6 text-center text-sm text-ink-faint">Tout est calme cette semaine.</p>
        )}
        next={<>
          <ul className="grid gap-3 lg:grid-cols-2">
          {next.map((sheet) => <SheetCard key={sheet.id} sheet={sheet} showProgress showTopic/>)}
          {proposals.map((client) => {
            let settings: { monthlyCadence?: MonthlyCadence; recommendedHashtags?: string[] } = {};
            try { settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {}; } catch { settings = {}; }
            const formats = weeklyFormatsForCadence(settings.monthlyCadence ?? {}, range.nextIsoWeek);
            const proposalProgress = settings.recommendedHashtags?.length ? 33 : 0;
            const formatCounts = formats.reduce<Record<string, number>>((counts, format) => ({ ...counts, [format]: (counts[format] ?? 0) + 1 }), {});
            const summary = Object.entries(formatCounts).map(([format, count]) => `${count} ${format === "visuel" ? "visuel" : format}`).join(" · ");

            return (
              <li key={client.id} className="card reveal-panel overflow-hidden border-[#bfd4ff] bg-[#f8fbff]">
                <Link href={`/fiches/nouvelle?client=${client.id}&isoYear=${range.nextIsoYear}&isoWeek=${range.nextIsoWeek}`} className="block p-4 hover:bg-[#f0f6ff] sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="badge bg-[#dbeafe] text-[#0759e6]">Fiche proposée</span>
                      <h3 className="mt-2 truncate text-sm font-semibold">{client.name}</h3>
                      <p className="mt-1 text-xs text-ink-faint">{summary} · hashtags déjà sélectionnés</p>
                    </div>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#0759e6] shadow-sm"><Icon name="arrow" className="h-4 w-4"/></span>
                  </div>
                  <div className="mt-4"><ProgressBar percentage={proposalProgress} label="Préparation préremplie"/></div>
                  <div className="mt-4 border-t border-[#dbe7fb] pt-3 text-xs font-semibold text-[#0759e6]">Remplir la fiche préprogrammée</div>
                </Link>
              </li>
            );
          })}
          </ul>
          {next.length + proposals.length === 0 && <p className="card px-4 py-6 text-center text-sm text-ink-faint">Ajoutez un client actif pour préparer sa prochaine semaine.</p>}
        </>}
      />
    </div>
  );
}
