import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import { ticketPriorityLabel, ticketStatusLabel } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { ProductionRequests, type ProductionRequestRow } from "./ProductionRequests";
import { TicketCorrections, type TicketCorrectionRow } from "./TicketCorrections";

/**
 * §22 — Espace de production.
 *
 * Graphistes et vidéastes ne voient que les tickets qui leur sont affectés :
 * la restriction est appliquée par RLS (`can_access_ticket`), pas seulement ici.
 */
export default async function ProductionPage() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();

  const { data: tickets } = await supabase
    .from("client_tickets")
    .select(
      `id, ticket_number, title, description, ticket_type, category, status, priority, due_at,
       weekly_sheet_item_id,
       clients ( name ),
       client_ticket_assignments!inner ( assignment_role, profile_id )`,
    )
    .in("category", ["graphic", "video"])
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)")
    .order("due_at", { ascending: true });

  const isProductionRole = ["graphic_designer", "video_editor"].includes(
    profile?.role ?? "",
  );

  /*
   * Commandes internes : la RLS borne déjà la lecture au périmètre de chacun.
   * Les médias livrés sont signés ici — bucket privé oblige.
   */
  const [{ data: rawRequests }, { data: requestClients }] = await Promise.all([
    supabase
      .from("production_requests")
      .select(`id, client_id, kind, title, brief, due_on, status, requested_by, requested_by_name, clients ( name ),
        media_assets:media_asset_id ( kind, file_name, storage_path, preview_path, purged_at, preview_purged_at ),
        reference:reference_media_id ( storage_path, preview_path, purged_at, preview_purged_at )`)
      .order("due_on", { ascending: true }),
    supabase.from("clients").select("id, name").eq("is_active", true).order("name"),
  ]);

  const today = todayInParis();
  const requests: ProductionRequestRow[] = await Promise.all((rawRequests ?? []).map(async (row) => {
    const media = row.media_assets as unknown as { kind: string; file_name: string; storage_path: string; preview_path: string | null; purged_at: string | null; preview_purged_at: string | null } | null;
    const resolved = media
      ? await resolveMediaUrl({ storagePath: media.storage_path, previewPath: media.preview_path, purgedAt: media.purged_at, previewPurgedAt: media.preview_purged_at })
      : null;
    // La référence est signée comme le reste : le bucket est privé.
    const reference = row.reference as unknown as { storage_path: string; preview_path: string | null; purged_at: string | null; preview_purged_at: string | null } | null;
    const resolvedReference = reference
      ? await resolveMediaUrl({ storagePath: reference.storage_path, previewPath: reference.preview_path, purgedAt: reference.purged_at, previewPurgedAt: reference.preview_purged_at })
      : null;
    return {
      id: row.id as string,
      clientId: row.client_id as string,
      clientName: (row.clients as unknown as { name: string } | null)?.name ?? "Client",
      kind: row.kind as ProductionRequestRow["kind"],
      title: row.title as string,
      brief: (row.brief as string | null) ?? null,
      dueOn: row.due_on as string,
      status: row.status as ProductionRequestRow["status"],
      requestedByName: (row.requested_by_name as string | null) ?? null,
      isMine: row.requested_by === profile?.id,
      mediaUrl: resolved?.url ?? null,
      mediaFileName: media?.file_name ?? null,
      mediaKind: media?.kind ?? null,
      referenceUrl: resolvedReference?.url ?? null,
      overdue: (row.due_on as string) < today && row.status === "a_faire",
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
    return {
      id: ticket.id as string,
      ticketNumber: ticket.ticket_number as string,
      clientName: client?.name ?? "Client",
      typeLabel: getTicketTypeDefinition(ticket.ticket_type).label,
      title: ticket.title as string,
      description: (ticket.description as string | null) ?? "",
      status: ticket.status as string,
      statusLabel: ticketStatusLabel(ticket.status),
      category: (ticket.category === "video" ? "video" : "graphic") as "graphic" | "video",
      priorityLabel: ticket.priority !== "normal" ? ticketPriorityLabel(ticket.priority) : null,
      dueLabel: due?.label ?? null,
      overdue: Boolean(due?.isOverdue),
      hasItem: Boolean(ticket.weekly_sheet_item_id),
    };
  });

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Studio de production" title={isProductionRole ? "Production" : "Production"} description={isProductionRole ? "Les corrections qui vous sont affectées et les commandes internes, triées selon leur échéance." : "Les retours clients à corriger et les commandes internes de l'équipe."} />

      <ProductionRequests
        requests={requests}
        clients={(requestClients ?? []).map((client) => ({ id: client.id as string, name: client.name as string }))}
        canRequest={!isProductionRole}
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
    </div>
  );
}
