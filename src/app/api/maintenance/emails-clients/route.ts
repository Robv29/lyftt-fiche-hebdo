import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorizationError } from "@/lib/internal/cron-auth";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { runMonthlyFollowUp } from "@/lib/campaigns/monthly-follow-up";
import { runReviewRequests } from "@/lib/campaigns/review-requests";
import { runTrackingInvitations } from "@/lib/campaigns/tracking-invitations";

/**
 * E-mails automatiques aux clients, une tâche planifiée pour tous.
 *
 * Chaque jour à 9 h (heure d'été), chaque campagne regarde si c'est son jour :
 * le bilan mensuel du 5 au 7, la demande d'avis du 15 au 17 de janvier, avril,
 * juillet et octobre, les rendez-vous de suivi aux créneaux de leur fréquence
 * (le 10, ou le 10 et le 24, ou le 9, le 19 et le 28). Une seule tâche plutôt
 * qu'une par campagne : leur nombre est plafonné selon l'offre Vercel, et un
 * calendrier de plus ne doit pas coûter une tâche de plus.
 *
 * `?apercu=bilan`, `?apercu=avis` ou `?apercu=suivi` liste les destinataires du
 * jour sans rien envoyer, même hors calendrier.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel déclenche ses tâches planifiées en GET.
export const GET = handle;
export const POST = handle;

async function handle(request: NextRequest) {
  const denied = cronAuthorizationError(request);
  if (denied) return denied;

  const today = todayInParis();
  const preview = request.nextUrl.searchParams.get("apercu");
  // Un aperçu mal nommé ne lancerait rien et répondrait « personne » : mieux vaut le dire.
  const PREVIEWS = ["bilan", "avis", "suivi"] as const;
  if (preview !== null && !(PREVIEWS as readonly string[]).includes(preview)) {
    return NextResponse.json(
      { error: `apercu attend ${PREVIEWS.map((name) => `« ${name} »`).join(", ")}.` },
      { status: 400 },
    );
  }

  const runs = [];
  if (!preview || preview === "bilan") runs.push(await runMonthlyFollowUp(today, preview === "bilan"));
  if (!preview || preview === "avis") runs.push(await runReviewRequests(today, preview === "avis"));
  if (!preview || preview === "suivi") runs.push(await runTrackingInvitations(today, preview === "suivi"));

  // Le pire des résultats résume l'exécution : un échec ne doit pas se cacher derrière un succès.
  const status = Math.max(200, ...runs.map((run) => run.status));
  return NextResponse.json(
    { today, campaigns: runs.map((run) => ({ campaign: run.campaign, status: run.status, ...run.body })) },
    { status },
  );
}
