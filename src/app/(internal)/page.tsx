import Link from "next/link";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { deadlineState } from "@/lib/domain/deadline";
import {
  sheetStatusLabel,
  ticketStatusLabel,
  ticketPriorityLabel
} from "@/lib/domain/types";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { requiresProduction } from "@/lib/domain/routing";
import { Icon } from "@/components/Icon";

/** §21 — Tableau de bord du community manager. */
export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();

  const { data: tickets } = await supabase
    .from("client_tickets")
    .select(
      "id, ticket_number, title, ticket_type, status, priority, due_at, created_at, clients ( name )",
    )
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: sheets } = await supabase
    .from("weekly_sheets")
    .select("id, iso_week, status, validation_deadline_at, clients ( name )")
    .in("status", [
      "sent_to_client",
      "partially_approved",
      "changes_requested",
      "corrections_in_progress",
      "new_version_to_send",
      "awaiting_revalidation",
    ])
    .order("validation_deadline_at", { ascending: true })
    .limit(20);

  const list = tickets ?? [];
  const newTickets = list.filter((t) => t.status === "new");
  const urgent = list.filter((t) => t.priority === "urgent" || t.priority === "high");
  const editorial = list.filter((t) => !requiresProduction(t.ticket_type));
  const production = list.filter((t) => requiresProduction(t.ticket_type));
  const toResend = (sheets ?? []).filter((s) => s.status === "new_version_to_send");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Aujourd’hui</p><h1 className="page-title mt-1">Bonjour {profile?.full_name?.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Voici ce qui attend une action de votre part.
        </p></div><Link href="/fiches/nouvelle" className="btn-primary"><Icon name="plus" className="h-4 w-4"/>Préparer une fiche</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Nouveaux retours" value={newTickets.length} highlight />
        <Stat label="Tickets urgents" value={urgent.length} />
        <Stat label="Corrections texte" value={editorial.length} />
        <Stat label="Nécessitent la production" value={production.length} />
      </div>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          Retours clients à traiter
        </h2>

        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-faint">Aucun retour en attente.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.slice(0, 8).map((ticket) => {
              const client = ticket.clients as unknown as { name: string } | null;
              return (
                <li key={ticket.id}>
                  <Link
                    href={`/retours/${ticket.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-canvas"
                  >
                    <span className="text-sm">
                      <strong>{client?.name ?? "Client"}</strong>
                      {" — "}
                      {getTicketTypeDefinition(ticket.ticket_type).label}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">
                      {ticket.priority !== "normal" && (
                        <span className="badge bg-state-progress/10 text-state-progress">
                          {ticketPriorityLabel(ticket.priority)}
                        </span>
                      )}
                      <span className="badge bg-canvas text-ink-soft">
                        {ticketStatusLabel(ticket.status)}
                      </span>
                      {ticket.ticket_number}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          Validations clients en attente
          {toResend.length > 0 && (
            <span className="ml-2 badge bg-state-progress/10 text-state-progress">
              {toResend.length} fiche{toResend.length > 1 ? "s" : ""} à renvoyer
            </span>
          )}
        </h2>

        {(sheets ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-faint">
            Aucune fiche en attente de validation.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {(sheets ?? []).map((sheet) => {
              const client = sheet.clients as unknown as { name: string } | null;
              const info = sheet.validation_deadline_at
                ? deadlineState(new Date(sheet.validation_deadline_at))
                : null;

              return (
                <li key={sheet.id}>
                  <Link
                    href={`/fiches/${sheet.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-canvas"
                  >
                    <span className="text-sm">
                      <strong>{client?.name ?? "Client"}</strong> — semaine {sheet.iso_week}
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="badge bg-canvas text-ink-soft">
                        {sheetStatusLabel(sheet.status)}
                      </span>
                      {info && (
                        <span
                          className={
                            info.isOverdue ? "text-state-changes" : "text-ink-faint"
                          }
                        >
                          échéance {info.label}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          highlight && value > 0 ? "text-state-changes" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
