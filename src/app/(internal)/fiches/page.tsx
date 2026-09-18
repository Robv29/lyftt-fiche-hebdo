import { createSupabaseServerClient } from "@/lib/supabase/server";
import { denyCommercial } from "@/lib/internal/authorization";
import { formatPeriod } from "@/lib/domain/deadline";
import {
  civilDaysBefore,
  contentBucketStatuses,
  planningBucketForPeriod,
  planningWeekRange,
  sheetCompletion,
} from "@/lib/domain/planning";
import { sheetStatusLabel, type MediaFormat, type SheetStatus, type TicketPriority, type TicketStatus } from "@/lib/domain/types";
import { isClientValidated, validationRate } from "@/lib/domain/sheet-status";
import { sheetShownForWeek, sheetsToCreate } from "@/lib/domain/week-expectation";
import { isTicketOpen } from "@/lib/domain/workflow";
import { PlanningTabs } from "./PlanningTabs";
import { isPlanningTab } from "./planning-tab";
import { PlanningSheetList, type PlanningEntry } from "./PlanningSheetList";

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

function completionItems(sheet: PlanningSheet) {
  return sheet.weekly_sheet_items.map((item) => ({
    caption: item.caption,
    hashtags: item.hashtags,
    format: item.format,
    mediaAssetId: item.media_asset_id,
    mediaExternalUrl: item.media_external_url,
    isCancelled: item.is_cancelled,
  }));
}

function completionForSheet(sheet: PlanningSheet) {
  return sheetCompletion(completionItems(sheet));
}

function hasHighPriorityChange(sheet: PlanningSheet): boolean {
  return sheet.client_tickets.some((ticket) =>
    ["high", "urgent"].includes(ticket.priority)
    && isTicketOpen(ticket.status),
  );
}

function sheetEntry(sheet: PlanningSheet): PlanningEntry {
  const completion = completionForSheet(sheet);
  const period = formatPeriod(
    new Date(`${sheet.period_start}T00:00:00Z`),
    new Date(`${sheet.period_end}T00:00:00Z`),
  );
  return {
    kind: "sheet",
    id: sheet.id,
    href: `/fiches/${sheet.id}`,
    clientName: sheet.clients?.name ?? "Client",
    isoWeek: sheet.iso_week,
    periodLabel: period,
    statusLabel: sheetStatusLabel(sheet.status),
    validated: isClientValidated(sheet.status as SheetStatus),
    urgent: hasHighPriorityChange(sheet),
    percentage: completion.percentage,
    completed: completion.completed,
    total: completion.total,
    /*
     * Un pourcentage dit *combien* il reste, jamais *quoi*. Les familles de
     * contenu répondent à la seconde question sans ouvrir la fiche — même
     * découpage que la vue Production, pour ne pas avoir deux lectures du
     * même état selon l'écran.
     */
    buckets: contentBucketStatuses(completionItems(sheet)),
    topic: sheet.topic,
  };
}

export default async function SheetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await denyCommercial();
  const requestedTab = (await searchParams).tab;
  const initialTab = isPlanningTab(requestedTab) ? requestedTab : "current";
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
      .select("id, name, notes, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const sheets = (rawSheets ?? []) as unknown as PlanningSheet[];
  // Une seule semaine d'historique est conservee ; la purge planifiee supprime
  // les fiches plus anciennes.
  const previousWeekStart = civilDaysBefore(range.currentStart, 7);
  /*
   * Un client en pause, dont la gestion est terminée ou pas encore commencée
   * n'a rien à faire dans le planning.
   *
   * La question se pose **à la semaine concernée**, pas aujourd'hui : une
   * gestion qui s'arrête le 15 août n'a rien à produire la semaine du 17, et
   * une gestion qui démarre le 17 doit au contraire y figurer. Juger sur la
   * date du jour donnait les deux erreurs à la fois.
   */
  const clientById = new Map((clients ?? []).map((client) => [client.id, client]));

  // Une fiche partie chez le client reste visible ; un brouillon hors gestion disparaît (règle partagée).
  const isVisible = (sheet: PlanningSheet, weekStart: string): boolean =>
    sheetShownForWeek(sheet.status, sheet.clients?.id ? clientById.get(sheet.clients.id) : undefined, weekStart);

  const past = sheets.filter((sheet) =>
    planningBucketForPeriod(sheet.period_start, sheet.period_end) === "past"
    && sheet.period_start >= previousWeekStart
    && isVisible(sheet, sheet.period_start));
  const current = sheets
    .filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "current"
      && isVisible(sheet, range.currentStart))
    .sort((a, b) => Number(hasHighPriorityChange(b)) - Number(hasHighPriorityChange(a))
      || completionForSheet(a).percentage - completionForSheet(b).percentage);
  const next = sheets.filter((sheet) => planningBucketForPeriod(sheet.period_start, sheet.period_end) === "next"
    && isVisible(sheet, range.nextStart));
  const nextClientIds = new Set(next.map((sheet) => sheet.clients?.id).filter((id): id is string => Boolean(id)));
  /*
   * Une proposition ne vaut que si le client produit la semaine prochaine
   * **et** que son rythme y prévoit une publication. Un client vendu à deux
   * vidéos par mois ne publie qu'une semaine sur deux : lui proposer une fiche
   * l'autre semaine, c'était réclamer un travail que personne n'a vendu. Même
   * règle que « Fiches à préparer » sur le tableau de bord.
   */
  const proposals = sheetsToCreate(clients ?? [], nextClientIds, range.nextStart);
  // Un taux par période : l'indicateur en tête suit l'onglet consulté.
  const rateOf = (group: PlanningSheet[]) =>
    validationRate(group.map((sheet) => sheet.status as SheetStatus));
  const validation = { past: rateOf(past), current: rateOf(current), next: rateOf(next) };

  const nextEntries: PlanningEntry[] = [
    ...next.map(sheetEntry),
    ...proposals.map(({ client, formats }): PlanningEntry => {
      let settings: { recommendedHashtags?: string[] } = {};
      try { settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {}; } catch { settings = {}; }
      const formatCounts = formats.reduce<Record<string, number>>((counts, format) => ({ ...counts, [format]: (counts[format] ?? 0) + 1 }), {});
      const summary = Object.entries(formatCounts).map(([format, count]) => `${count} ${format === "visuel" ? "visuel" : format}`).join(" · ");
      return {
        kind: "proposal",
        id: client.id,
        href: `/fiches/nouvelle?client=${client.id}&isoYear=${range.nextIsoYear}&isoWeek=${range.nextIsoWeek}`,
        clientName: client.name,
        summary,
        percentage: settings.recommendedHashtags?.length ? 33 : 0,
      };
    }),
  ];

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
        initialTab={initialTab}
        past={<PlanningSheetList entries={past.map(sheetEntry)} emptyLabel="Aucune fiche passée."/>}
        current={<PlanningSheetList entries={current.map(sheetEntry)} emptyLabel="Tout est calme cette semaine."/>}
        next={<PlanningSheetList entries={nextEntries} emptyLabel="Ajoutez un client actif pour préparer sa prochaine semaine." showProgress showTopic/>}
      />
    </div>
  );
}
