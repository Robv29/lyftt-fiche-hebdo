import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import {
  ticketPriorityLabel,
  ticketStatusLabel,
  type TicketStatus
} from "@/lib/domain/types";

/** §9 — Écran interne « Retours clients ». */

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "open", label: "Ouverts" },
  { value: "new", label: "Nouveau" },
  { value: "to_qualify", label: "À qualifier" },
  { value: "assigned", label: "Affecté" },
  { value: "in_progress", label: "En cours" },
  { value: "ready_for_review", label: "Prêt à contrôler" },
  { value: "internally_reviewed", label: "Contrôlé" },
  { value: "sent_back_to_client", label: "Renvoyé au client" },
  { value: "approved_by_client", label: "Validé" },
  { value: "closed", label: "Fermé" },
  { value: "reopened", label: "Rouvert" },
  { value: "overdue", label: "En retard" },
  { value: "all", label: "Tous" },
];

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; client?: string; type?: string }>;
}) {
  const filters = await searchParams;
  const statusFilter = filters.statut ?? "open";

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("client_tickets")
    .select(
      `id, ticket_number, title, ticket_type, category, status, priority, due_at,
       submitted_at, updated_at, weekly_sheet_id,
       clients ( id, name ),
       weekly_sheets ( iso_week ),
       client_ticket_assignments ( assignment_role, profiles ( full_name ) )`,
    )
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (statusFilter === "open") {
    query = query.not("status", "in", "(closed,cancelled,rejected,approved_by_client)");
  } else if (statusFilter === "overdue") {
    query = query
      .lt("due_at", new Date().toISOString())
      .not("status", "in", "(closed,cancelled,rejected,approved_by_client)");
  } else if (statusFilter !== "all") {
    query = query.eq("status", statusFilter as TicketStatus);
  }

  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.type) query = query.eq("ticket_type", filters.type);

  const { data: tickets } = await query;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Retours clients</h1>
        <p className="text-sm text-ink-soft">{tickets?.length ?? 0} ticket(s)</p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={`/retours?statut=${filter.value}`}
            className={`badge border ${
              statusFilter === filter.value
                ? "border-ink bg-ink text-white"
                : "border-line bg-surface text-ink-soft hover:border-ink"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {(tickets ?? []).length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucun ticket pour ce filtre.
        </p>
      ) : (
        <ul className="space-y-2">
          {(tickets ?? []).map((ticket) => {
            const client = ticket.clients as unknown as { name: string } | null;
            const week = ticket.weekly_sheets as unknown as { iso_week: number } | null;
            const assignments = (ticket.client_ticket_assignments ?? []) as unknown as {
              assignment_role: string;
              profiles: { full_name: string } | null;
            }[];
            const due = ticket.due_at ? deadlineState(new Date(ticket.due_at)) : null;

            return (
              <li key={ticket.id} className="card">
                <Link
                  href={`/retours/${ticket.id}`}
                  className="block px-4 py-3 hover:bg-canvas"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {ticket.ticket_number} — {client?.name ?? "Client"}
                      {week && (
                        <span className="font-normal text-ink-faint">
                          {" "}
                          · semaine {week.iso_week}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      {ticket.priority !== "normal" && (
                        <span className="badge bg-state-progress/10 text-state-progress">
                          {ticketPriorityLabel(ticket.priority)}
                        </span>
                      )}
                      <span className="badge bg-canvas text-ink-soft">
                        {ticketStatusLabel(ticket.status)}
                      </span>
                      {due && (
                        <span
                          className={due.isOverdue ? "text-state-changes" : "text-ink-faint"}
                        >
                          {due.isOverdue ? `en retard de ${due.label.replace("en retard de ", "")}` : due.label}
                        </span>
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-ink-soft">
                    {getTicketTypeDefinition(ticket.ticket_type).label} — {ticket.title}
                  </p>

                  {assignments.length > 0 && (
                    <p className="mt-1 text-xs text-ink-faint">
                      {assignments
                        .map((a) => a.profiles?.full_name)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
