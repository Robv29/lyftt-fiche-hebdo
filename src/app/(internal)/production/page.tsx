import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import { ticketStatusLabel } from "@/lib/domain/types";
import { ClientAvatar, EmptyState, PageHeader, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";

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

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Studio de production" title="Corrections clients" description={isProductionRole ? "Les corrections qui vous sont affectées, triées selon leur échéance." : "Les retours qui nécessitent une intervention graphique ou vidéo."} />

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
