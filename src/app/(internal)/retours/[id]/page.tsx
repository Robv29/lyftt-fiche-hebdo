import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getTicketTypeDefinition } from "@/lib/domain/ticket-types";
import { availableTransitions } from "@/lib/domain/workflow";
import { diffWords, summarizeDiff } from "@/lib/domain/text-diff";
import {
  ticketPriorityLabel,
  ticketStatusLabel,
  itemApprovalStatusLabel
} from "@/lib/domain/types";
import { TicketActions } from "./TicketActions";

/** §9 / §12 — Vue détail d'un ticket, avec comparatif du texte. */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();

  const { data: ticket } = await supabase
    .from("client_tickets")
    .select(
      `id, ticket_number, title, description, client_suggestion, details, ticket_type,
       category, status, priority, due_at, submitted_at, created_by_name, created_by_email,
       reopen_count, weekly_sheet_id,
       clients ( id, name ),
       weekly_sheets ( iso_week, iso_year ),
       weekly_sheet_items ( id, caption, hashtags, scheduled_date, approval_status ),
       client_ticket_assignments ( assignment_role, accepted_at, completed_at, profiles ( full_name, role ) ),
       client_ticket_comments ( id, body, visibility, author_name, author_type, created_at ),
       client_ticket_attachments ( id, media_assets ( file_name, storage_path, kind ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!ticket || !profile) notFound();

  const client = ticket.clients as unknown as { name: string } | null;
  const week = ticket.weekly_sheets as unknown as { iso_week: number } | null;
  const item = ticket.weekly_sheet_items as unknown as {
    id: string;
    caption: string;
    hashtags: string[];
    scheduled_date: string;
    approval_status: string;
  } | null;

  const assignments = (ticket.client_ticket_assignments ?? []) as unknown as {
    assignment_role: string;
    profiles: { full_name: string; role: string } | null;
  }[];
  const comments = (ticket.client_ticket_comments ?? []) as unknown as {
    id: string;
    body: string;
    visibility: string;
    author_name: string | null;
    created_at: string;
  }[];
  const attachments = (ticket.client_ticket_attachments ?? []) as unknown as {
    id: string;
    media_assets: { file_name: string; kind: string } | null;
  }[];

  const definition = getTicketTypeDefinition(ticket.ticket_type);
  const transitions = availableTransitions(ticket.status, profile.role);
  const details = (ticket.details ?? {}) as Record<string, string>;

  // §12 — comparatif entre le texte actuel et la proposition du client.
  const showDiff = Boolean(item && ticket.client_suggestion);
  const segments = showDiff ? diffWords(item!.caption, ticket.client_suggestion!) : [];
  const summary = showDiff ? summarizeDiff(segments) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/retours" className="text-sm text-ink-soft hover:text-ink">
          ← Retours clients
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {ticket.ticket_number} — {definition.label}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {client?.name}
          {week && ` · semaine ${week.iso_week}`}
          {" · "}
          reçue le{" "}
          {new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "Europe/Paris",
          }).format(new Date(ticket.submitted_at))}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="badge bg-canvas text-ink-soft">
            {ticketStatusLabel(ticket.status)}
          </span>
          <span className="badge bg-canvas text-ink-soft">
            {ticketPriorityLabel(ticket.priority)}
          </span>
          {ticket.reopen_count > 0 && (
            <span className="badge bg-state-progress/10 text-state-progress">
              Rouvert {ticket.reopen_count} fois
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Demande du client</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.description}
            </p>

            {(details.option || details.timecode || details.selection) && (
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {details.option && (
                  <Detail label="Précision">{labelForOption(definition, details.option)}</Detail>
                )}
                {details.timecode && <Detail label="Timecode">{details.timecode}</Detail>}
                {details.selection && (
                  <Detail label="Passage visé">« {details.selection} »</Detail>
                )}
              </dl>
            )}

            {ticket.created_by_name && (
              <p className="mt-3 text-xs text-ink-faint">
                Envoyée par {ticket.created_by_name}
                {ticket.created_by_email && ` (${ticket.created_by_email})`}
              </p>
            )}

            {attachments.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="text-ink-soft">
                    Pièce jointe : {attachment.media_assets?.file_name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {item && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">Contenu concerné</h2>
              <p className="mt-1 text-xs text-ink-faint">
                Publication du {item.scheduled_date} ·{" "}
                {itemApprovalStatusLabel(item.approval_status)}
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-canvas px-3 py-2 text-sm">
                {item.caption || "—"}
              </p>
              {item.hashtags?.length > 0 && (
                <p className="mt-2 text-sm text-ink-soft">{item.hashtags.join(" ")}</p>
              )}
            </section>
          )}

          {showDiff && summary && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">
                Proposition du client
                <span className="ml-2 font-normal text-ink-faint">
                  +{summary.wordsAdded} / −{summary.wordsRemoved} mots
                </span>
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {segments.map((segment, index) => (
                  <span
                    key={index}
                    className={
                      segment.op === "insert"
                        ? "bg-state-approved/15 text-state-approved"
                        : segment.op === "delete"
                          ? "bg-state-changes/15 text-state-changes line-through"
                          : undefined
                    }
                  >
                    {segment.value}
                  </span>
                ))}
              </p>
            </section>
          )}

          <section className="card p-4">
            <h2 className="text-sm font-semibold">Historique interne</h2>
            {comments.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">Aucun commentaire.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="border-l-2 border-line pl-3">
                    <p className="text-xs text-ink-faint">
                      {comment.author_name ?? "Système"} ·{" "}
                      {new Intl.DateTimeFormat("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Europe/Paris",
                      }).format(new Date(comment.created_at))}
                      {comment.visibility === "client_visible" && " · visible client"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Affectations</h2>
            {assignments.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">Aucune affectation.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {assignments.map((assignment, index) => (
                  <li key={index} className="text-ink-soft">
                    {assignment.profiles?.full_name}
                    <span className="text-ink-faint">
                      {" "}
                      — {roleLabel(assignment.assignment_role)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TicketActions
            ticketId={ticket.id}
            sheetId={ticket.weekly_sheet_id}
            transitions={transitions.map((t) => ({
              to: t.to,
              label: t.label,
              requiresReason: Boolean(t.requiresReason),
            }))}
          />
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-medium">{label} :</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  );
}

function labelForOption(
  definition: ReturnType<typeof getTicketTypeDefinition>,
  value: string,
): string {
  return definition.options?.find((option) => option.value === value)?.label ?? value;
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "référent";
    case "contributor":
      return "production";
    case "reviewer":
      return "contrôle";
    default:
      return "notifié";
  }
}
