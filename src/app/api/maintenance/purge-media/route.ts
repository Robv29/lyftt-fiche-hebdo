import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decideMediaRetention, formatBytes } from "@/lib/domain/media-retention";

/**
 * Purge planifiée des fichiers médias.
 *
 * Déclenchée par une tâche cron. Supprime du stockage les originaux dont la
 * publication est faite, puis les aperçus dont la rétention est écoulée. Les
 * lignes `media_assets` sont conservées : la preuve de validation, l'historique
 * des versions et les indicateurs restent complets.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  }

  // Un en-tête HTTP n'accepte que de l'ASCII visible. Un secret contenant un
  // accent ou une espace insécable ne pourra jamais être transmis : la purge
  // échouerait silencieusement à chaque exécution. Mieux vaut le dire.
  if (!/^[\x21-\x7E]+$/.test(secret)) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET contient des caractères invalides pour un en-tête HTTP. " +
          "N'utilisez que des lettres non accentuées, des chiffres et des symboles simples.",
      },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // Chaque média, avec la publication qui le porte et la règle du client.
  const { data: assets, error } = await admin
    .from("media_assets")
    .select(
      `id, storage_path, preview_path, byte_size, preview_byte_size, purged_at, preview_purged_at,
       clients ( media_preview_retention_days ),
       weekly_sheet_items ( id, published_at, is_cancelled )`,
    )
    .is("preview_purged_at", null)
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Contenus portant encore une demande de modification : leur original sert.
  const { data: openTickets } = await admin
    .from("client_tickets")
    .select("weekly_sheet_item_id")
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)");
  const blocked = new Set(
    (openTickets ?? []).map((t) => t.weekly_sheet_item_id).filter(Boolean),
  );

  const originalsToRemove: string[] = [];
  const previewsToRemove: string[] = [];
  const purgedIds: string[] = [];
  const previewPurgedIds: string[] = [];
  let freed = 0;

  for (const asset of assets ?? []) {
    const items = (asset.weekly_sheet_items ?? []) as unknown as {
      id: string;
      published_at: string | null;
      is_cancelled: boolean;
    }[];

    // Un média peut être rattaché à plusieurs publications : on ne purge que
    // si toutes sont terminées.
    if (items.length === 0) continue;
    if (items.some((item) => blocked.has(item.id))) continue;

    const allPublished = items.every((item) => item.published_at !== null);
    const allDone = items.every((item) => item.published_at !== null || item.is_cancelled);
    const client = asset.clients as unknown as { media_preview_retention_days: number } | null;

    const decision = decideMediaRetention({
      publishedAt: allPublished ? new Date() : null,
      isCancelled: allDone && !allPublished,
      hasOpenTicket: false,
      purgedAt: asset.purged_at ? new Date(asset.purged_at) : null,
      previewPurgedAt: asset.preview_purged_at ? new Date(asset.preview_purged_at) : null,
      previewRetentionDays: client?.media_preview_retention_days ?? 30,
    });

    if (decision.action === "purge_original") {
      originalsToRemove.push(asset.storage_path);
      purgedIds.push(asset.id);
      freed += Math.max(0, (asset.byte_size ?? 0) - (asset.preview_byte_size ?? 0));
    } else if (decision.action === "purge_preview") {
      if (asset.preview_path) previewsToRemove.push(asset.preview_path);
      previewPurgedIds.push(asset.id);
    }
  }

  const now = new Date().toISOString();

  if (originalsToRemove.length > 0) {
    await admin.storage.from("media").remove(originalsToRemove);
    await admin.from("media_assets").update({ purged_at: now }).in("id", purgedIds);
  }

  if (previewPurgedIds.length > 0) {
    if (previewsToRemove.length > 0) {
      await admin.storage.from("media").remove(previewsToRemove);
    }
    await admin
      .from("media_assets")
      .update({ preview_purged_at: now })
      .in("id", previewPurgedIds);
  }

  return NextResponse.json({
    originauxPurges: purgedIds.length,
    apercusPurges: previewPurgedIds.length,
    espaceLibere: formatBytes(freed),
  });
}
