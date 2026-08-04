import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import { ticketStatusLabel } from "@/lib/domain/types";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Corrections clients</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {isProductionRole
            ? "Les corrections qui vous sont affectées."
            : "Les corrections nécessitant une intervention graphique ou vidéo."}
        </p>
      </div>

      {(tickets ?? []).length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucune correction en attente.
        </p>
      ) : (
        <ul className="space-y-2">
          {(tickets ?? []).map((ticket) => {
            const client = ticket.clients as unknown as { name: string } | null;
            const item = ticket.weekly_sheet_items as unknown as {
              scheduled_date: string;
              caption: string;
            } | null;
            const due = ticket.due_at ? deadlineState(new Date(ticket.due_at)) : null;

            return (
              <li key={ticket.id} className="card">
                <Link
                  href={`/retours/${ticket.id}`}
                  className="block px-4 py-3 hover:bg-canvas"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {client?.name} — {getTicketTypeDefinition(ticket.ticket_type).label}
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="badge bg-canvas text-ink-soft">
                        {ticketStatusLabel(ticket.status)}
                      </span>
                      {due && (
                        <span
                          className={due.isOverdue ? "text-state-changes" : "text-ink-faint"}
                        >
                          {due.label}
                        </span>
                      )}
                    </span>
                  </div>
                  {item && (
                    <p className="mt-1 truncate text-sm text-ink-soft">
                      Publication du {item.scheduled_date} — {item.caption}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink-faint">{ticket.ticket_number}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-ink-faint">
        Le renvoi au client reste à la charge du community manager : déposez votre
        nouvelle version puis passez le ticket en « Prêt à contrôler ».
      </p>
    </div>
  );
}
