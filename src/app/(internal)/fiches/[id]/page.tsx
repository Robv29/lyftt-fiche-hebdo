import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deadlineState,
  formatDeadline,
  formatPeriod,
} from "@/lib/domain/deadline";
import {
  itemApprovalStatusLabel,
  sheetStatusLabel,
  messageTemplateTypeLabel,
  type MessageTemplateType
} from "@/lib/domain/types";
import { DEFAULT_TEMPLATES } from "@/lib/domain/templates";
import { SendPanel } from "./SendPanel";

/** §21 — Onglet « Retours et validations » d'une fiche. */
export default async function SheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select(
      `id, iso_year, iso_week, period_start, period_end, status, validation_deadline_at,
       sent_to_client_at, first_viewed_at, current_version_id,
       clients ( id, name, timezone, approval_policy ),
       profiles:community_manager_id ( full_name ),
       weekly_sheet_items ( id, position, scheduled_date, caption, approval_status, is_cancelled ),
       weekly_sheet_versions!weekly_sheet_versions_weekly_sheet_id_fkey (
         id, version_number, status, change_summary, created_at, sent_to_client_at
       ),
       client_review_links ( id, token_prefix, expires_at, revoked_at, last_accessed_at, access_count ),
       client_message_dispatches ( id, template_type, channel, sent_at, recipient_label ),
       sheet_exports ( id, file_name, is_obsolete, generated_at )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!sheet) notFound();

  const client = sheet.clients as unknown as {
    id: string;
    name: string;
    timezone: string;
    approval_policy: string;
  };
  const manager = sheet.profiles as unknown as { full_name: string } | null;

  const { data: contacts } = await supabase
    .from("client_contacts")
    .select("first_name, last_name, phone, email, is_primary")
    .eq("client_id", client.id)
    .order("is_primary", { ascending: false });

  const items = (sheet.weekly_sheet_items ?? []) as unknown as {
    id: string;
    position: number;
    scheduled_date: string;
    caption: string;
    approval_status: string;
    is_cancelled: boolean;
  }[];

  const versions = ((sheet.weekly_sheet_versions ?? []) as unknown as {
    id: string;
    version_number: number;
    status: string;
    change_summary: string | null;
    created_at: string;
    sent_to_client_at: string | null;
  }[]).sort((a, b) => b.version_number - a.version_number);

  const links = (sheet.client_review_links ?? []) as unknown as {
    id: string;
    token_prefix: string;
    expires_at: string;
    revoked_at: string | null;
    last_accessed_at: string | null;
    access_count: number;
  }[];
  const activeLink = links.find((link) => !link.revoked_at) ?? null;

  const dispatches = ((sheet.client_message_dispatches ?? []) as unknown as {
    id: string;
    template_type: MessageTemplateType;
    channel: string;
    sent_at: string;
    recipient_label: string | null;
  }[]).sort((a, b) => b.sent_at.localeCompare(a.sent_at));

  const exports = (sheet.sheet_exports ?? []) as unknown as {
    id: string;
    file_name: string;
    is_obsolete: boolean;
    generated_at: string;
  }[];

  const { data: tickets } = await supabase
    .from("client_tickets")
    .select("id, ticket_number, title, status")
    .eq("weekly_sheet_id", id)
    .order("submitted_at", { ascending: false });

  const openTickets = (tickets ?? []).filter(
    (t) => !["closed", "cancelled", "rejected", "approved_by_client"].includes(t.status),
  );

  const deadline = sheet.validation_deadline_at
    ? new Date(sheet.validation_deadline_at)
    : null;
  const deadlineInfo = deadline ? deadlineState(deadline) : null;
  const primaryContact = contacts?.[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fiches" className="text-sm text-ink-soft hover:text-ink">
          ← Fiches
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {client.name} — semaine {sheet.iso_week}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {formatPeriod(
            new Date(`${sheet.period_start}T00:00:00Z`),
            new Date(`${sheet.period_end}T00:00:00Z`),
          )}
          {deadline && ` · échéance ${formatDeadline(deadline, client.timezone)}`}
          {manager && ` · ${manager.full_name}`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="badge bg-canvas text-ink-soft">
            {sheetStatusLabel(sheet.status)}
          </span>
          {versions[0] && (
            <span className="badge bg-canvas text-ink-soft">
              Version {versions[0].version_number}
            </span>
          )}
          {deadlineInfo && (
            <span
              className={`badge ${
                deadlineInfo.isOverdue
                  ? "bg-state-changes/10 text-state-changes"
                  : "bg-canvas text-ink-soft"
              }`}
            >
              {deadlineInfo.label}
            </span>
          )}
        </div>
      </div>

      {openTickets.length > 0 && (
        <p className="rounded-md border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">
          {openTickets.length} modification{openTickets.length > 1 ? "s" : ""} demandée
          {openTickets.length > 1 ? "s" : ""} par le client —{" "}
          <Link href="/retours" className="underline">
            voir les tickets
          </Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Contenus ({items.filter((i) => !i.is_cancelled).length})
            </h2>
            <ul className="divide-y divide-line">
              {items
                .sort((a, b) => a.position - b.position)
                .map((item) => (
                  <li key={item.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[96px_1fr_auto] sm:items-center sm:gap-3">
                    <span className="text-xs text-ink-faint">
                      {item.scheduled_date}
                    </span>
                    <span className="min-w-0 text-sm sm:truncate">
                      {item.caption || "—"}
                    </span>
                    <span className="badge mt-1 w-fit shrink-0 bg-canvas text-xs text-ink-soft sm:mt-0">
                      {itemApprovalStatusLabel(item.approval_status)}
                    </span>
                  </li>
                ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Versions
            </h2>
            {versions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-faint">
                Aucune version figée. Elle sera créée à la génération du lien client.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {versions.map((version) => (
                  <li key={version.id} className="px-4 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <strong>Version {version.version_number}</strong>
                      <span className="text-xs text-ink-faint">
                        {version.status}
                        {version.sent_to_client_at && " · envoyée"}
                      </span>
                    </div>
                    {version.change_summary && (
                      <p className="mt-0.5 text-ink-soft">{version.change_summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Exports
            </h2>
            {exports.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-faint">Aucun export généré.</p>
            ) : (
              <ul className="divide-y divide-line">
                {exports.map((file) => (
                  <li
                    key={file.id}
                    className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between"
                  >
                    <span>{file.file_name}</span>
                    {file.is_obsolete ? (
                      <span className="badge bg-state-changes/10 text-state-changes">
                        Obsolète
                      </span>
                    ) : (
                      <span className="badge bg-state-approved/10 text-state-approved">
                        À jour
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Messages envoyés
            </h2>
            {dispatches.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-faint">
                Aucun envoi enregistré. Sans preuve d&apos;envoi, la validation tacite ne
                peut pas s&apos;appliquer.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {dispatches.map((dispatch) => (
                  <li key={dispatch.id} className="px-4 py-3 text-sm">
                    {messageTemplateTypeLabel(dispatch.template_type)} ·{" "}
                    {dispatch.channel}
                    <span className="ml-2 text-xs text-ink-faint">
                      {new Intl.DateTimeFormat("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Europe/Paris",
                      }).format(new Date(dispatch.sent_at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <SendPanel
            sheetId={sheet.id}
            hasActiveLink={Boolean(activeLink)}
            activeLink={
              activeLink
                ? {
                    id: activeLink.id,
                    tokenPrefix: activeLink.token_prefix,
                    expiresAt: activeLink.expires_at,
                    lastAccessedAt: activeLink.last_accessed_at,
                    accessCount: activeLink.access_count,
                  }
                : null
            }
            templates={Object.entries(DEFAULT_TEMPLATES).map(([type, body]) => ({
              type: type as MessageTemplateType,
              label: messageTemplateTypeLabel(type as MessageTemplateType),
              body,
            }))}
            context={{
              contact_first_name: primaryContact?.first_name ?? "",
              client_name: client.name,
              publication_week: formatPeriod(
                new Date(`${sheet.period_start}T00:00:00Z`),
                new Date(`${sheet.period_end}T00:00:00Z`),
              ),
              publication_start_date: sheet.period_start,
              publication_end_date: sheet.period_end,
              validation_deadline: deadline
                ? formatDeadline(deadline, client.timezone)
                : "",
              community_manager_name: manager?.full_name ?? "",
            }}
            recipientPhone={primaryContact?.phone ?? undefined}
            recipientLabel={
              primaryContact
                ? `${primaryContact.first_name} ${primaryContact.last_name ?? ""}`.trim()
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
