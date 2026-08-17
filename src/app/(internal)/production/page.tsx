import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import { ticketStatusLabel } from "@/lib/domain/types";
import { ClientAvatar, EmptyState, PageHeader, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { ProductionRequests, type ProductionRequestRow } from "./ProductionRequests";

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
      `id, ticket_number, title, ticket_type, status, priority, due_at,
       clients ( name ),
       weekly_sheet_items ( scheduled_date, caption ),
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
        media_assets:media_asset_id ( kind, file_name, storage_path, preview_path, purged_at, preview_purged_at )`)
      .order("due_on", { ascending: true }),
    supabase.from("clients").select("id, name").eq("is_active", true).order("name"),
  ]);

  const today = todayInParis();
  const requests: ProductionRequestRow[] = await Promise.all((rawRequests ?? []).map(async (row) => {
    const media = row.media_assets as unknown as { kind: string; file_name: string; storage_path: string; preview_path: string | null; purged_at: string | null; preview_purged_at: string | null } | null;
    const resolved = media
      ? await resolveMediaUrl({ storagePath: media.storage_path, previewPath: media.preview_path, purgedAt: media.purged_at, previewPurgedAt: media.preview_purged_at })
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
      overdue: (row.due_on as string) < today && row.status === "a_faire",
    };
  }));

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

      {(tickets ?? []).length === 0 ? (
        <EmptyState icon="layers" title="Production à jour" description="Aucune correction graphique ou vidéo n’attend d’intervention." />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {(tickets ?? []).map((ticket) => {
            const client = ticket.clients as unknown as { name: string } | null;
            const item = ticket.weekly_sheet_items as unknown as {
              scheduled_date: string;
              caption: string;
            } | null;
            const due = ticket.due_at ? deadlineState(new Date(ticket.due_at)) : null;

            return (
              <li key={ticket.id} className="card lift-card overflow-hidden">
                <Link
                  href={`/retours/${ticket.id}`}
                  className="group block p-5 hover:bg-[#f7fafe]"
                >
                  <div className="flex items-start gap-3">
                    <ClientAvatar name={client?.name ?? "Client"}/>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="truncate text-sm font-semibold">{client?.name}</h2><p className="mt-1 text-xs text-ink-faint">{getTicketTypeDefinition(ticket.ticket_type).label}</p></div><Icon name="arrow" className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5"/></div>
                    {item && <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-ink-soft">Publication du {item.scheduled_date} — {item.caption}</p>}
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                      <StatusDot tone="info">{ticketStatusLabel(ticket.status)}</StatusDot>
                      {due && (
                        <span
                          className={due.isOverdue ? "text-state-changes" : "text-ink-faint"}
                        >
                          {due.label}
                        </span>
                      )}
                      <span className="ml-auto text-ink-faint">{ticket.ticket_number}</span>
                    </div></div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-2xl bg-[#e8f2ff] px-4 py-3 text-xs leading-relaxed text-[#385a78]">
        Le renvoi au client reste à la charge du community manager : déposez votre
        nouvelle version puis passez le ticket en « Prêt à contrôler ».
      </p>
    </div>
  );
}
