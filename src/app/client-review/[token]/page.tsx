import type { Metadata } from "next";
import {
  loadReviewSheet,
  logReviewEvent,
  resolveReviewLink,
  touchReviewLink,
} from "@/lib/review/access";
import { checkVersionFreshness } from "@/lib/domain/edge-cases";
import { deadlineState, formatDeadline, formatPeriod } from "@/lib/domain/deadline";
import { SHEET_STATUS_LABELS, SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";
import { ReviewBoard } from "./ReviewBoard";
import { AccessDenied } from "./AccessDenied";
import { PrivacyNotice } from "./PrivacyNotice";

export const metadata: Metadata = {
  title: "Vos publications de la semaine — LYFTT",
  robots: { index: false, follow: false },
};

// Le portail reflète l'état courant : jamais de page mise en cache.
export const dynamic = "force-dynamic";

export default async function ClientReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveReviewLink(token);

  if (!resolved.ok) {
    return <AccessDenied reason={resolved.reason} />;
  }

  const sheet = await loadReviewSheet(resolved.context);
  if (!sheet) return <AccessDenied reason="not_found" />;

  await touchReviewLink(resolved.context.linkId);
  await logReviewEvent(resolved.context.linkId, "link_opened", {});

  const freshness = checkVersionFreshness(
    resolved.context.linkVersionNumber,
    sheet.currentVersionNumber,
  );
  if (freshness.isStale) {
    await logReviewEvent(resolved.context.linkId, "new_version_viewed", {});
  }

  const deadline = sheet.validationDeadlineAt
    ? new Date(sheet.validationDeadlineAt)
    : null;
  const deadlineInfo = deadline ? deadlineState(deadline) : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <span className="text-2xl font-bold tracking-tight">lyftt.</span>
          {sheet.clientLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sheet.clientLogoUrl}
              alt={sheet.clientName}
              className="h-10 w-auto object-contain"
            />
          ) : (
            <span className="text-sm font-medium text-ink-soft">{sheet.clientName}</span>
          )}
        </div>

        <h1 className="text-xl font-semibold sm:text-2xl">
          Vos publications de la semaine
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {sheet.clientName} — semaine {formatPeriod(
            new Date(`${sheet.periodStart}T00:00:00Z`),
            new Date(`${sheet.periodEnd}T00:00:00Z`),
          )}
        </p>

        <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-line pt-5 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-medium">Publications :</dt>
            <dd className="text-ink-soft">
              {sheet.items.filter((i) => !i.isCancelled).length}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Réseaux :</dt>
            <dd className="text-ink-soft">
              {sheet.networks.map((n) => SOCIAL_NETWORK_LABELS[n]).join(" + ") || "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Statut :</dt>
            <dd className="text-ink-soft">{SHEET_STATUS_LABELS[sheet.status]}</dd>
          </div>
          {sheet.currentVersionNumber !== null && (
            <div className="flex gap-2">
              <dt className="font-medium">Version :</dt>
              <dd className="text-ink-soft">{sheet.currentVersionNumber}</dd>
            </div>
          )}
        </dl>

        {deadline && deadlineInfo && (
          <p
            className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              deadlineInfo.isOverdue
                ? "border-state-changes/30 bg-state-changes/5 text-state-changes"
                : "border-line bg-surface text-ink"
            }`}
          >
            Merci de valider ou de transmettre vos retours avant le{" "}
            <strong>{formatDeadline(deadline, sheet.timezone)}</strong> ({deadlineInfo.label}).
            {sheet.approvalPolicy === "tacit_allowed" && (
              <>
                {" "}
                {sheet.tacitApprovalNotice ??
                  "Sans retour avant cette échéance, les contenus seront considérés comme validés, selon les modalités prévues ensemble."}
              </>
            )}
          </p>
        )}

        {freshness.isStale && (
          <p className="mt-3 rounded-md border border-state-progress/30 bg-state-progress/5 px-4 py-3 text-sm text-state-progress">
            {freshness.banner}
          </p>
        )}
      </header>

      <ReviewBoard token={token} sheet={sheet} />

      <PrivacyNotice />
    </main>
  );
}
