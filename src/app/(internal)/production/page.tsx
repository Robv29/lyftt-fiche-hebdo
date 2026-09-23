import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { productionUrgency } from "@/lib/domain/production";
import { denyCommercial } from "@/lib/internal/authorization";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { isActionableOverdue } from "@/lib/domain/planning";
import { deadlineState, formatPeriod } from "@/lib/domain/deadline";
import { ticketPriorityLabel, ticketStatusLabel, type MediaFormat } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { contentBucketProgress, depositSummary, isoWeekIdentity, planningWeekRange, sheetCompletion, visualsValidationState, type BucketProgress } from "@/lib/domain/planning";
import { weekExpectation } from "@/lib/domain/week-expectation";
import { bucketForFormat, CONTENT_BUCKETS, type ContentBucket } from "@/lib/domain/content-buckets";
import { ProductionRequests, type ProductionRequestRow } from "./ProductionRequests";
import { TicketCorrections, type TicketCorrectionRow } from "./TicketCorrections";
import { ProductionOverview, type OverviewRow } from "./ProductionOverview";
import { ProductionTabs } from "./ProductionTabs";
import { loadProductionAssignees } from "@/lib/internal/production-assignees";
import { loadProductionRequestClients } from "@/lib/internal/production-clients";
import { firstNameOf, PRODUCTION_ASSIGNEE_ROLES } from "@/lib/domain/production-requests";
import { productionRequestRights } from "@/lib/domain/production-board";

/**
 * §22 — Espace de production.
 *
 * Graphistes et vidéastes ne voient que les tickets qui leur sont affectés :
 * la restriction est appliquée par RLS (`can_access_ticket`), pas seulement ici.
 *
 * Les commandes internes, elles, se lisent en entier : toute l'équipe voit le
 * plan de charge de l'agence (`production_requests_select_equipe`). Agir dessus
 * reste réservé aux personnes concernées — demandeur, affectataire,
 * encadrement —, et c'est `productionRequestRights` qui le dit, ici comme dans
 * les actions serveur.
 */
const MAX_WEEK_OFFSET = 6;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await denyCommercial();
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  // Combien de semaines après celle-ci la vue d'ensemble regarde ; 0 = cette semaine.
  const weekOffset = Math.min(MAX_WEEK_OFFSET, Math.max(0, Math.trunc(Number((await searchParams).week)) || 0));

  const { data: tickets } = await supabase
    .from("client_tickets")
    .select(
      `id, ticket_number, title, description, ticket_type, category, status, priority, due_at,
       weekly_sheet_item_id, client_id,
       clients ( name ),
       weekly_sheets ( period_start, period_end ),
       client_ticket_assignments!inner ( assignment_role, profile_id, profiles ( full_name ) )`,
    )
    .in("category", ["graphic", "video"])
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)")
    .order("due_at", { ascending: true });

  const isProductionRole = ["graphic_designer", "video_editor"].includes(
    profile?.role ?? "",
  );

  /*
   * Commandes internes : la file porte celles de toute l'agence. Les commandes
   * validées sont closes — elles sont écartées ici plutôt qu'à l'écran, sans
   * quoi la page chargerait tout l'historique de l'agence pour n'en rien faire.
   *
   * Les médias livrés sont signés ici — bucket privé oblige. La signature
   * emploie la clé service : elle ne doit donc porter que sur ce que la
   * jointure a rendu, et la jointure est soumise à `media_assets_select`
   * (`can_access_client`). Hors périmètre, elle revient nulle et rien n'est
   * signé. Ne jamais signer depuis une colonne scalaire.
   */
  const viewedNow = new Date(Date.now() + weekOffset * 7 * 86400000);
  const weekRange = planningWeekRange(viewedNow);
  const currentIso = isoWeekIdentity(viewedNow);

  const [{ data: rawRequests }, { data: overviewClients }, { data: rawCurrentSheets }, { assignees }, { names: requestClientNames, error: clientNamesError }] = await Promise.all([
    supabase
      .from("production_requests")
      .select(`id, client_id, kind, title, brief, due_on, status, created_at, delivered_at,
        requested_by, requested_by_name, assigned_to, assigned_to_name,
        media_asset_id, reference_media_id,
        clients ( name ),
        media_assets:media_asset_id ( kind, file_name, storage_path, preview_path, purged_at, preview_purged_at ),
        reference:reference_media_id ( storage_path, preview_path, purged_at, preview_purged_at )`)
      .neq("status", "validee")
      .order("due_on", { ascending: true }),
    supabase
      .from("clients")
      .select("id, name, notes, is_active, client_kind, contract_start_date, contract_end_date, pause_start_date, pause_end_date")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("weekly_sheets")
      .select(`id, topic, status, visuals_validated_at, visuals_validated_by_name,
        clients ( id, name ),
        weekly_sheet_items ( caption, hashtags, format, media_asset_id, media_external_url, is_cancelled )`)
      .eq("period_start", weekRange.currentStart),
    // Personnes à qui confier une commande : le menu « Confier à ».
    loadProductionAssignees(),
    // Noms des clients de la file — et rien d'autre de leur fiche.
    loadProductionRequestClients(),
  ]);
  // La panne ne doit pas passer inaperçue : les noms retombent sur la jointure, mais on veut le savoir.
  if (clientNamesError) console.error("[production] noms des clients indisponibles", clientNamesError);
  /*
   * Le formulaire de commande, lui, reste borné au périmètre : on ne commande
   * que pour un client qu'on suit, et c'est `production_requests_write` qui le
   * tient en base.
   */
  const requestClients = overviewClients;
  const assigneeLabelById = new Map(assignees.map((person) => [person.id, person.label]));
  const viewer = profile ? { id: profile.id, role: profile.role } : null;

  const today = todayInParis();
  const requests: ProductionRequestRow[] = await Promise.all((rawRequests ?? []).map(async (row) => {
    const media = row.media_assets as unknown as { kind: string; file_name: string; storage_path: string; preview_path: string | null; purged_at: string | null; preview_purged_at: string | null } | null;
    const resolved = media
      ? await resolveMediaUrl({ storagePath: media.storage_path, previewPath: media.preview_path, purgedAt: media.purged_at, previewPurgedAt: media.preview_purged_at })
      : null;
    // L'exemple est signé comme le reste : le bucket est privé.
    const reference = row.reference as unknown as { storage_path: string; preview_path: string | null; purged_at: string | null; preview_purged_at: string | null } | null;
    const resolvedReference = reference
      ? await resolveMediaUrl({ storagePath: reference.storage_path, previewPath: reference.preview_path, purgedAt: reference.purged_at, previewPurgedAt: reference.preview_purged_at })
      : null;
    const status = row.status as ProductionRequestRow["status"];
    // Unique règle d'autorité : la même dans les six actions serveur.
    const rights = productionRequestRights(
      {
        requestedBy: (row.requested_by as string | null) ?? null,
        assignedTo: (row.assigned_to as string | null) ?? null,
        status,
      },
      viewer,
    );
    return {
      id: row.id as string,
      clientId: row.client_id as string,
      /*
       * Le nom vient de la fonction ouverte à toute l'équipe ; si elle manque
       * ou tombe, la jointure nomme encore les clients du périmètre du lecteur,
       * comme avant l'élargissement. Seules les lignes hors périmètre
       * retombent sur « Client ».
       */
      clientName: requestClientNames.get(row.client_id as string)
        ?? (row.clients as unknown as { name: string } | null)?.name
        ?? "Client",
      kind: row.kind as ProductionRequestRow["kind"],
      title: row.title as string,
      brief: (row.brief as string | null) ?? null,
      dueOn: row.due_on as string,
      createdAt: row.created_at as string,
      deliveredAt: (row.delivered_at as string | null) ?? null,
      status,
      requestedByName: (row.requested_by_name as string | null) ?? null,
      isMine: rights.isRequester,
      assignedToId: (row.assigned_to as string | null) ?? null,
      assigneeLabel: row.assigned_to
        ? assigneeLabelById.get(row.assigned_to as string) ?? firstNameOf(row.assigned_to_name as string | null)
        : firstNameOf(row.assigned_to_name as string | null),
      assignedToViewer: rights.isAssignee,
      isConcerned: rights.isConcerned,
      canDeliver: rights.canDeliver,
      canValidate: rights.canValidate,
      canReopen: rights.canReopen,
      canDelete: rights.canDelete,
      canReassign: rights.canReassign,
      mediaUrl: resolved?.url ?? null,
      mediaFileName: media?.file_name ?? null,
      mediaKind: media?.kind ?? null,
      /*
       * Un fichier a été livré, un exemple a été joint : la colonne le dit même
       * quand la jointure revient nulle faute d'accès au client. La carte
       * annonce alors leur existence sans les montrer — le contenu d'un client
       * ne circule pas hors de son équipe.
       */
      hasMedia: Boolean(row.media_asset_id),
      hasReference: Boolean(row.reference_media_id),
      referenceUrl: resolvedReference?.url ?? null,
      urgency: productionUrgency({ dueOn: row.due_on as string, status }, today),
    };
  }));

  /*
   * Corrections clients : on ne montre que ce qui sert à produire — qui, quoi,
   * pour quand. Le texte de la publication et ses hashtags restent à l'écran
   * éditorial ; ici, seul le fichier corrigé est attendu.
   */
  const corrections: TicketCorrectionRow[] = (tickets ?? []).map((ticket) => {
    const client = ticket.clients as unknown as { name: string } | null;
    const due = ticket.due_at ? deadlineState(new Date(ticket.due_at)) : null;
    /*
     * Même règle que les fiches en attente et les tickets clients : le retard
     * n'est signalé que sur la semaine en cours. Une correction attendue sur
     * une semaine déjà publiée ne se rattrape plus, et la marquer en rouge
     * noyait celles qu'on peut encore livrer à temps.
     */
    const period = ticket.weekly_sheets as unknown as { period_start: string | null; period_end: string | null } | null;
    // Chefs de projet et direction voient toutes les corrections : la carte dit pour qui elle est.
    const contributor = (ticket.client_ticket_assignments as unknown as {
      assignment_role: string; profile_id: string; profiles: { full_name: string } | null;
    }[]).find((assignment) => assignment.assignment_role === "contributor");
    return {
      id: ticket.id as string,
      ticketNumber: ticket.ticket_number as string,
      clientId: ticket.client_id as string,
      clientName: client?.name ?? "Client",
      typeLabel: getTicketTypeDefinition(ticket.ticket_type).label,
      title: ticket.title as string,
      description: (ticket.description as string | null) ?? "",
      status: ticket.status as string,
      statusLabel: ticketStatusLabel(ticket.status),
      category: (ticket.category === "video" ? "video" : "graphic") as "graphic" | "video",
      priorityLabel: ticket.priority !== "normal" ? ticketPriorityLabel(ticket.priority) : null,
      dueLabel: due?.label ?? null,
      overdue: isActionableOverdue({
        dueAt: ticket.due_at as string | null,
        periodStart: period?.period_start,
        periodEnd: period?.period_end,
      }),
      hasItem: Boolean(ticket.weekly_sheet_item_id),
      assigneeName: contributor?.profiles?.full_name ?? null,
      assignedToViewer: Boolean(contributor && contributor.profile_id === profile?.id),
    };
  });

  // Ce qui a dépassé son échéance : le sous-menu l'affiche sans qu'il faille ouvrir l'onglet pour le découvrir.
  const overdueCount = requests.filter((request) => request.urgency === "overdue").length
    + corrections.filter((correction) => correction.overdue).length;

  /*
   * Vue d'ensemble : un client sans fiche cette semaine a autant besoin d'être
   * vu qu'un client dont la fiche est incomplète — sa ligne existe donc même
   * sans fiche, avec « à créer » pour seul état.
   */
  interface OverviewSheetRow {
    id: string;
    topic: string | null;
    visuals_validated_at: string | null;
    visuals_validated_by_name: string | null;
    clients: { id: string; name: string } | null;
    weekly_sheet_items: Array<{ caption: string | null; hashtags: string[] | null; format: MediaFormat; media_asset_id: string | null; media_external_url: string | null; is_cancelled: boolean }>;
  }
  const currentSheets = (rawCurrentSheets ?? []) as unknown as OverviewSheetRow[];
  const sheetByClientId = new Map<string, OverviewSheetRow>();
  for (const sheet of currentSheets) if (sheet.clients?.id) sheetByClientId.set(sheet.clients.id, sheet);

  /*
   * Ce que le rythme vendu attend de chaque client cette semaine — même règle
   * que le planning et le tableau de bord. Hors gestion : la ligne disparaît.
   */
  const expectations = new Map((overviewClients ?? []).map((client) =>
    [client.id, weekExpectation(client, weekRange.currentStart)]));

  const overviewRows: OverviewRow[] = (overviewClients ?? [])
    .filter((client) => expectations.get(client.id)?.kind !== "off_contract")
    .map((client): OverviewRow => {
      const sheet = sheetByClientId.get(client.id);
      if (!sheet) {
        const expectation = expectations.get(client.id);
        /*
         * Sans fiche créée, une famille de contenu comprise dans le forfait du
         * client reste « attendue » (rond vide) plutôt que de se confondre avec
         * une famille qui ne fait simplement pas partie de sa formule (tiret).
         *
         * Semaine creuse du rythme vendu (deux vidéos par mois : une semaine
         * sur deux) : rien n'est attendu, et la ligne le dit au lieu de
         * réclamer une fiche à créer.
         */
        const expected = new Set(expectation?.kind === "publish" ? expectation.formats.map(bucketForFormat) : []);
        const progress = Object.fromEntries(
          CONTENT_BUCKETS.map((bucket) => {
            const status = expected.has(bucket.key) ? "expected" : "none";
            return [bucket.key, { files: status, texts: status }];
          }),
        ) as Record<ContentBucket, BucketProgress>;
        return {
          clientId: client.id, clientName: client.name, hasSheet: false, topic: null, done: false,
          offWeek: expectation?.kind === "off_week",
          href: `/fiches/nouvelle?client=${client.id}&isoYear=${currentIso.year}&isoWeek=${currentIso.week}`,
          progress,
          deposit: null,
          sheetId: null,
          visuals: null,
        };
      }
      const items = sheet.weekly_sheet_items.map((item) => ({
        caption: item.caption,
        hashtags: item.hashtags,
        format: item.format,
        mediaAssetId: item.media_asset_id,
        mediaExternalUrl: item.media_external_url,
        isCancelled: item.is_cancelled,
      }));
      const deposit = depositSummary(items);
      const visualsState = visualsValidationState(deposit, sheet.visuals_validated_at);
      return {
        clientId: client.id,
        clientName: client.name,
        hasSheet: true,
        offWeek: false,
        topic: sheet.topic,
        // Fait : tout est là, et les visuels ont été regardés — quand il y en a.
        done: sheetCompletion(items).percentage === 100 && visualsState !== "to_validate",
        href: `/fiches/${sheet.id}`,
        // Fichiers et textes comptés à part : l'un peut être livré sans l'autre.
        progress: contentBucketProgress(items),
        deposit,
        sheetId: sheet.id,
        visuals: {
          state: visualsState,
          validatedAt: sheet.visuals_validated_at,
          validatedByName: sheet.visuals_validated_by_name,
        },
      };
    })
    .sort((a, b) => {
      /*
       * D'abord les fiches à créer, puis les fichiers à déposer — ce qui bloque
       * la production —, puis les textes seuls à rédiger, enfin ce qui est fait.
       * Les semaines sans publication ferment la liste : rien à y faire.
       */
      const rank = (row: OverviewRow) => {
        if (row.offWeek) return 5;
        if (!row.hasSheet || !row.deposit) return 0;
        if (row.deposit.filesMissing > 0) return 1;
        if (row.visuals?.state === "to_validate") return 2;
        if (row.deposit.textsMissing > 0) return 3;
        return 4;
      };
      return rank(a) - rank(b) || a.clientName.localeCompare(b.clientName, "fr");
    });
  const weekLabel = `Semaine ${currentIso.week} · ${formatPeriod(new Date(`${weekRange.currentStart}T00:00:00Z`), new Date(`${weekRange.currentEnd}T00:00:00Z`))}`;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Studio de production" title={isProductionRole ? "Production" : "Production"} description={isProductionRole ? "Les corrections qui vous sont affectées et les commandes internes, triées selon leur échéance." : "Les retours clients à corriger et les commandes internes de l'équipe."} />

      <ProductionTabs
        overview={<ProductionOverview
          rows={overviewRows}
          weekLabel={weekLabel}
          weekOffset={weekOffset}
          maxWeekOffset={MAX_WEEK_OFFSET}
          // Mêmes rôles que la RLS des fiches : ceux qui tiennent la fiche valident ses visuels.
          canValidateVisuals={["super_admin", "production_manager", "community_manager"].includes(profile?.role ?? "")}
        />}
        detailAlertCount={overdueCount}
        detail={<div className="space-y-7">
      <ProductionRequests
        requests={requests}
        clients={(requestClients ?? []).map((client) => ({ id: client.id as string, name: client.name as string }))}
        canRequest={!isProductionRole}
        assignees={assignees.map((person) => ({ id: person.id, label: person.label }))}
        viewerProduces={(PRODUCTION_ASSIGNEE_ROLES as readonly string[]).includes(profile?.role ?? "")}
      />

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Corrections clients</h2>
        <span className="text-xs text-ink-faint">{(tickets ?? []).length} en cours</span>
      </div>

      <TicketCorrections tickets={corrections} canValidate={!isProductionRole}/>

      <p className="rounded-2xl bg-[#e8f2ff] px-4 py-3 text-xs leading-relaxed text-[#385a78]">
        Déposez le fichier corrigé puis validez : la correction part au contrôle du
        community manager, qui la valide et obtient le lien à envoyer au client.
      </p>
        </div>}
      />
    </div>
  );
}
