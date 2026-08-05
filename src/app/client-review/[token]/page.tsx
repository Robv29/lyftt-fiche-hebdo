import type { Metadata } from "next";
import {
  loadReviewSheet,
  logReviewEvent,
  resolveReviewLink,
  touchReviewLink,
} from "@/lib/review/access";
import { checkVersionFreshness } from "@/lib/domain/edge-cases";
import { deadlineState, formatDeadline, formatPeriod } from "@/lib/domain/deadline";
import { SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";
import { ReviewBoard } from "./ReviewBoard";
import { AccessDenied } from "./AccessDenied";
import { PrivacyNotice } from "./PrivacyNotice";
import { BrandLogo } from "@/components/BrandLogo";

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
  const activeItems = sheet.items.filter((item) => !item.isCancelled);
  const approvedItems = activeItems.filter((item) => ["approved", "approved_after_fix"].includes(item.approvalStatus));
  const progress = activeItems.length ? Math.round((approvedItems.length / activeItems.length) * 100) : 100;

  return (
    <main className="min-h-screen bg-[#edf3f9] px-3 py-3 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[26px] border border-white bg-[#f7fafe] shadow-[0_28px_80px_rgba(38,76,112,.13)]">
      <header className="border-b border-line bg-white px-5 py-5 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <BrandLogo variant="ink" className="w-[96px]" priority />
          {sheet.clientLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sheet.clientLogoUrl}
              alt={sheet.clientName}
              className="h-9 w-auto object-contain"
            />
          ) : (
            <span className="text-sm font-medium text-ink-soft">{sheet.clientName}</span>
          )}
        </div>
      </header>

      <div className="px-4 py-5 sm:px-8 sm:py-8">
      <section className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#157bc3] to-[#0b4f88] p-6 text-white shadow-[0_18px_40px_rgba(11,79,136,.17)] sm:p-8">
        <span aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/[.07]"/>
        <div className="relative"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/60">Planning éditorial</p><h1 className="mt-2 text-2xl font-semibold tracking-[-.035em] sm:text-3xl">Vos publications de la semaine</h1>
        <p className="mt-2 text-sm text-white/75">
          {sheet.clientName} · {formatPeriod(
            new Date(`${sheet.periodStart}T00:00:00Z`),
            new Date(`${sheet.periodEnd}T00:00:00Z`),
          )}
        </p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/15 bg-white/[.09] p-4"><dt className="text-[11px] text-white/60">Publications</dt><dd className="mt-1 text-2xl font-semibold">{activeItems.length}</dd></div>
          <div className="rounded-2xl border border-white/15 bg-white/[.09] p-4"><dt className="text-[11px] text-white/60">Réseaux</dt><dd className="mt-1 truncate text-sm font-semibold">
              {sheet.networks.map((n) => SOCIAL_NETWORK_LABELS[n]).join(" + ") || "—"}
            </dd></div>
          <div className="rounded-2xl border border-white/15 bg-white/[.09] p-4"><dt className="text-[11px] text-white/60">Validation</dt><dd className="mt-1 text-sm font-semibold">{approvedItems.length}/{activeItems.length} validée{approvedItems.length > 1 ? "s" : ""}</dd><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"><span className="block h-full origin-left rounded-full bg-white transition-transform" style={{transform:`scaleX(${progress/100})`}}/></div></div>
        </dl></div>
      </section>

        {deadline && deadlineInfo && (
          <p
            className={`mt-5 rounded-2xl border px-4 py-4 text-sm leading-relaxed ${
              deadlineInfo.isOverdue
                ? "border-state-changes/30 bg-state-changes/5 text-state-changes"
                : "border-[#cbdff1] bg-white text-ink"
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
          <p className="mt-3 rounded-2xl border border-state-progress/30 bg-state-progress/5 px-4 py-3 text-sm text-state-progress">
            {freshness.banner}
          </p>
        )}
      <div className="mt-6">
      <ReviewBoard token={token} sheet={sheet} />
      </div>

      <PrivacyNotice />
      </div>
      </div>
    </main>
  );
}
