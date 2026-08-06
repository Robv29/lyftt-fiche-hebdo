import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPeriod } from "@/lib/domain/deadline";
import {
  planningBucketForPeriod,
  planningWeekRange,
  sheetCompletion,
  weeklyFormatsForCadence,
  type MonthlyCadence,
} from "@/lib/domain/planning";
import { sheetStatusLabel, type MediaFormat, type SheetStatus, type TicketPriority, type TicketStatus } from "@/lib/domain/types";
import { isClientValidated, validationRate } from "@/lib/domain/sheet-status";
import { isTicketOpen } from "@/lib/domain/workflow";
import { Icon } from "@/components/Icon";
import { PlanningTabs } from "./PlanningTabs";

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

function SheetCard({ sheet, showProgress = false }: { sheet: PlanningSheet; showProgress?: boolean }) {
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
    </li>
  );
}

export default async function SheetsPage() {
  const supabase = await createSupabaseServerClient();
  const range = planningWeekRange();

  const [{ data: rawSheets }, { data: clients }] = await Promise.all([
    supabase
      .from("weekly_sheets")
      .select(`id, iso_year, iso_week, period_start, period_end, status,
        clients ( id, name ),
        weekly_sheet_items ( caption, hashtags, format, media_asset_id, media_external_url, is_cancelled ),
        client_tickets ( priority, status )`)
      .lte("period_start", range.nextEnd)
      .order("period_start", { ascending: false })
      .limit(80),
    supabase
      .from("clients")
      .select("id, name, notes")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const sheets = (rawSheets ?? []) as unknown as PlanningSheet[];
  const past = sheets.filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "past");
  const current = sheets
    .filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "current")
    .sort((a, b) => Number(hasHighPriorityChange(b)) - Number(hasHighPriorityChange(a))
      || completionForSheet(a).percentage - completionForSheet(b).percentage);
  const next = sheets.filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "next");
  const nextClientIds = new Set(next.map((sheet) => sheet.clients?.id).filter(Boolean));
  const proposals = (clients ?? []).filter((client) => !nextClientIds.has(client.id));
  const validation = validationRate(sheets.map((sheet) => sheet.status as SheetStatus));

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Production éditoriale</p>
        <h1 className="page-title mt-1">Planning</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">Le travail est proposé automatiquement selon les prestations de chaque client. Ouvrez simplement la fiche à préparer.</p>
      </div>

      {/*
        Part des fiches réellement validées par le client. Les brouillons sont
        exclus : ils n'ont jamais été soumis, les compter fausserait le taux.
      */}
      {validation.total > 0 && (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${validation.percentage === 100 ? "bg-[#e8f8f1] text-state-approved" : "bg-[#e8f2ff] text-[#1176d3]"}`}>
              <Icon name="check" className="h-5 w-5"/>
            </span>
            <div>
              <strong className="text-sm">
                {validation.validated} fiche{validation.validated > 1 ? "s" : ""} validée{validation.validated > 1 ? "s" : ""} sur {validation.total}
              </strong>
              <p className="mt-1 text-xs text-ink-faint">
                Validation client, explicite ou tacite. Les fiches en préparation ne sont pas comptées.
              </p>
            </div>
          </div>
          <div className="w-full sm:w-56">
            <div className="mb-2 flex justify-between text-[11px] text-ink-faint">
              <span>Taux de validation</span>
              <strong className={validation.percentage === 100 ? "text-state-approved" : "text-ink"}>{validation.percentage} %</strong>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label={`Taux de validation : ${validation.percentage}%`} aria-valuenow={validation.percentage} aria-valuemin={0} aria-valuemax={100}>
              <span className={`block h-full origin-left rounded-full transition-transform duration-300 ${validation.percentage === 100 ? "bg-state-approved" : "bg-[#1468ff]"}`} style={{ transform: `scaleX(${validation.percentage / 100})` }}/>
            </div>
          </div>
        </section>
      )}

      <PlanningTabs
        counts={{ past: past.length, current: current.length, next: next.length + proposals.length }}
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
          {next.map((sheet) => <SheetCard key={sheet.id} sheet={sheet} showProgress/>)}
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
