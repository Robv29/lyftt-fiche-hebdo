import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isServiceRequest, isServiceRequestOverdue, serviceRequestAgeInDays } from "@/lib/domain/ticket-types";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { deadlineState } from "@/lib/domain/deadline";
import {
  ticketPriorityLabel,
  ticketStatusLabel,
  type TicketStatus
} from "@/lib/domain/types";
import { ClientAvatar, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

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
       submitted_at, updated_at, resolved_at, weekly_sheet_id,
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
    <div className="space-y-7">
      <PageHeader eyebrow="File d’intervention" title="Tickets clients" description="Qualifiez les demandes, corrigez le contenu concerné et renvoyez la nouvelle version au client." actions={<span className="badge bg-[#e8f2ff] text-[#0b5e9f]">{tickets?.length ?? 0} ticket{(tickets?.length ?? 0) > 1 ? "s" : ""}</span>} />

      <nav className="filter-bar" aria-label="Filtrer les tickets par statut">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={`/retours?statut=${filter.value}`}
            className={`btn min-h-9 rounded-xl px-3 py-1.5 text-xs shadow-none ${
              statusFilter === filter.value
                ? "border border-[#1176d3] bg-[#1176d3] text-white"
                : "border border-transparent bg-transparent text-ink-soft hover:bg-canvas hover:text-ink"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {(tickets ?? []).length === 0 ? (
        <EmptyState icon="message" title="Aucun ticket" description="Aucune demande ne correspond au filtre sélectionné." />
      ) : (
        <ul className="space-y-3">
          {(tickets ?? []).map((ticket) => {
            const client = ticket.clients as unknown as { name: string } | null;
            const week = ticket.weekly_sheets as unknown as { iso_week: number } | null;
            const assignments = (ticket.client_ticket_assignments ?? []) as unknown as {
              assignment_role: string;
              profiles: { full_name: string } | null;
            }[];
            const due = ticket.due_at ? deadlineState(new Date(ticket.due_at)) : null;

            return (
              <li key={ticket.id} className="card lift-card overflow-hidden">
                <Link
                  href={`/retours/${ticket.id}`}
                  className="group grid gap-4 p-4 hover:bg-[#f7fafe] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5"
                >
                  <ClientAvatar name={client?.name ?? "Client"}/>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{client?.name ?? "Client"}</strong><span className="text-[11px] text-ink-faint">{ticket.ticket_number}{week && ` · semaine ${week.iso_week}`}</span></div><p className="mt-1 truncate text-sm text-ink-soft">{getTicketTypeDefinition(ticket.ticket_type).label} — {ticket.title}</p>{assignments.length > 0 && <p className="mt-1 truncate text-xs text-ink-faint">Responsable : {assignments.map((a) => a.profiles?.full_name).filter(Boolean).join(" · ")}</p>}</div>
                  <div className="flex flex-wrap items-center gap-2 pl-[60px] text-xs sm:max-w-60 sm:justify-end sm:pl-0">
                      {/*
                        Une demande hors publication ne suit pas le circuit de
                        correction : elle doit se repérer d'un coup d'œil, et
                        alerter dès qu'elle traîne au-delà de trois jours.
                      */}
                      {isServiceRequest(ticket.ticket_type) && (
                        isServiceRequestOverdue({ submittedAt: ticket.submitted_at, resolvedAt: ticket.resolved_at })
                          ? <span className="badge bg-state-changes text-white">Sans réponse depuis {Math.floor(serviceRequestAgeInDays(ticket.submitted_at))} j</span>
                          : <span className="badge bg-[#e8f2ff] text-[#0b5e9f]">Hors publication</span>
                      )}
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
                    <Icon name="arrow" className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5"/>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
