import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logRibAccess } from "@/lib/internal/rib-audit";
import { decideMediaRetention, formatBytes } from "@/lib/domain/media-retention";
import { cadenceFromNotes, customMonthlyFromNotes, shootingPlanFromNotes, syncManagementMonths } from "@/lib/budget/management-months";

/**
 * Entretien planifié : validations tacites, puis purge des médias.
 *
 * Déclenchée par une tâche cron. Applique d'abord les validations tacites
 * échues, puis supprime du stockage les originaux dont la publication est
 * faite et les aperçus dont la rétention est écoulée. Les lignes
 * `media_assets` sont conservées : la preuve de validation, l'historique des
 * versions et les indicateurs restent complets.
 *
 * Vercel déclenche ses tâches planifiées en **GET**. La route n'exposait que
 * POST : la tâche répondait 405 chaque nuit et rien n'était jamais purgé ni
 * validé tacitement. Les deux verbes pointent donc sur le même traitement.
 */

/**
 * Jours de conservation du RIB au-delà de la fin de gestion. Couvre le dernier
 * prélèvement et la facture de solde.
 */
const RIB_RETENTION_DAYS = 30;

/** Jours de conservation du journal des accès au RIB. */
const RIB_LOG_RETENTION_DAYS = 365;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle;
export const POST = handle;

async function handle(request: NextRequest) {
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

  /*
   * §16 — Validation tacite. Elle ne peut être appliquée que par une tâche
   * planifiée : c'est l'écoulement du délai qui la déclenche, sans action
   * humaine. La fonction vérifie elle-même que le client l'a autorisée, qu'un
   * message a bien été envoyé et qu'aucune demande n'est en cours.
   */
  const { data: tacit, error: tacitError } = await admin.rpc("apply_tacit_approvals");
  if (tacitError) {
    console.error("[entretien] validations tacites impossibles", tacitError.message);
  }

  /*
   * Mois de gestion écoulés, pour tous les clients gérés.
   *
   * Chacun est inscrit au tarif du rythme en vigueur, puis figé. En
   * financement, la ligne consomme l'enveloppe ; au comptant, elle devient la
   * facture mensuelle à établir. Dans les deux cas, personne n'a à y penser.
   */
  let managementMonths = 0;
  const { data: managed } = await admin
    .from("clients")
    .select("id, notes, contract_start_date, contract_end_date")
    .eq("is_active", true)
    .not("contract_start_date", "is", null);

  for (const client of managed ?? []) {
    try {
      managementMonths += await syncManagementMonths(admin, {
        id: client.id,
        contractStartDate: client.contract_start_date,
        contractEndDate: client.contract_end_date,
        cadence: cadenceFromNotes(client.notes),
        /*
         * Le forfait shooting manquait ici alors que l'écran budget le passe :
         * un mois inscrit par cette tâche valait moins cher que le même mois
         * inscrit en ouvrant la fiche du client. Le montant dépendait de qui
         * était passé le premier.
         */
        shooting: shootingPlanFromNotes(client.notes),
        customMonthly: customMonthlyFromNotes(client.notes),
      });
    } catch (error) {
      // Un budget en échec ne doit pas empêcher la purge des médias.
      console.error("[entretien] mois de gestion impossibles", client.id, error);
    }
  }

  /*
   * §RGPD — Purge des coordonnées bancaires.
   *
   * Le RIB est conservé jusqu'à la fin de la gestion, et trente jours au-delà :
   * le dernier prélèvement et la facture de solde tombent après la date de fin,
   * et supprimer le RIB à la minute obligerait à le redemander au client.
   *
   * Un client sans date de fin est un client dont la gestion se poursuit : son
   * RIB n'est pas purgé. C'est la seule lecture cohérente d'un champ vide —
   * l'absence de date n'y signifie pas « terminé depuis toujours ».
   *
   * Le fichier vit dans le bucket privé `media`, hors de `media_assets` : il
   * échappe donc au cycle de purge des médias, d'où cette étape distincte.
   */
  let purgedRibs = 0;
  const ribCutoff = new Date(Date.now() - RIB_RETENTION_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: endedClients } = await admin
    .from("clients")
    .select("id, contract_end_date, client_budgets ( rib_storage_path )")
    .not("contract_end_date", "is", null)
    .lt("contract_end_date", ribCutoff);

  for (const client of endedClients ?? []) {
    const budgets = (client.client_budgets ?? []) as unknown as { rib_storage_path: string | null }[];
    const paths = budgets.map((b) => b.rib_storage_path).filter((path): path is string => Boolean(path));
    if (paths.length === 0) continue;

    // Les colonnes d'abord : si le retrait du fichier échoue, la référence ne
    // survit pas à un fichier absent — l'inverse laisserait un lien mort.
    const { error: ribError } = await admin
      .from("client_budgets")
      .update({
        rib_storage_path: null,
        rib_file_name: null,
        rib_uploaded_at: null,
        rib_uploaded_by: null,
      })
      .eq("client_id", client.id);

    if (ribError) {
      console.error("[entretien] RIB non purgé", client.id, ribError.message);
      continue;
    }

    await admin.storage.from("media").remove(paths);
    purgedRibs += paths.length;

    // La suppression automatique est un accès au RIB comme un autre : elle
    // doit laisser la même trace qu'un retrait fait à la main.
    await logRibAccess({
      clientId: client.id,
      eventType: "purged",
      metadata: { contractEndDate: client.contract_end_date, retentionDays: RIB_RETENTION_DAYS },
    });
  }

  /*
   * Le journal des accès au RIB est lui-même une donnée : il dit qui consulte
   * les coordonnées bancaires de qui. Il se purge donc à son tour, passé un an
   * — assez pour reconstituer l'historique d'un incident, pas au point de
   * constituer un fichier de surveillance de l'équipe.
   */
  const { count: purgedRibEvents } = await admin
    .from("client_rib_events")
    .delete({ count: "exact" })
    .lt(
      "created_at",
      new Date(Date.now() - RIB_LOG_RETENTION_DAYS * 86_400_000).toISOString(),
    );

  // Chaque média, avec la publication qui le porte et la règle du client.
  const { data: assets, error } = await admin
    .from("media_assets")
    .select(
      `id, storage_path, preview_path, byte_size, preview_byte_size, purged_at, preview_purged_at, created_at,
       clients ( media_preview_retention_days ),
       weekly_sheet_items ( id, published_at, is_cancelled ),
       weekly_sheet_item_media ( weekly_sheet_items ( id, published_at, is_cancelled ) )`,
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
    type AttachedItem = { id: string; published_at: string | null; is_cancelled: boolean };

    /*
     * Un média peut être rattaché de deux façons : comme couverture de la
     * publication, ou comme image d'un carrousel. Ignorer la seconde revenait
     * à prendre toutes les images suivantes pour des orphelines, donc à les
     * supprimer 48 heures après leur dépôt.
     */
    const cover = (asset.weekly_sheet_items ?? []) as unknown as AttachedItem[];
    const gallery = ((asset.weekly_sheet_item_media ?? []) as unknown as {
      weekly_sheet_items: AttachedItem | null;
    }[]).map((row) => row.weekly_sheet_items).filter((item): item is AttachedItem => Boolean(item));

    const seen = new Set<string>();
    const items = [...cover, ...gallery].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    /*
     * Média orphelin : téléversé puis jamais rattaché à une publication, parce
     * que la création de la fiche a échoué ou que le community manager l'a
     * remplacé avant d'enregistrer. Sans ce traitement, ces fichiers ne sont
     * jamais purgés et occupent le stockage indéfiniment. On laisse passer
     * 48 heures pour ne pas supprimer un dépôt en cours de saisie.
     */
    if (items.length === 0) {
      const ageHours = (Date.now() - new Date(asset.created_at).getTime()) / 3_600_000;
      if (ageHours > 48 && !asset.purged_at) {
        originalsToRemove.push(asset.storage_path);
        if (asset.preview_path) previewsToRemove.push(asset.preview_path);
        purgedIds.push(asset.id);
        previewPurgedIds.push(asset.id);
        freed += asset.byte_size ?? 0;
      }
      continue;
    }

    // Un média peut être rattaché à plusieurs publications : on ne purge que
    // si toutes sont terminées.
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

  /*
   * Suppression des fiches au-delà d'une semaine d'historique.
   *
   * Opération destructive et irréversible : la cascade emporte les
   * publications, les versions, les validations client et les tickets de la
   * fiche. La preuve de validation disparaît avec eux, de même que les
   * indicateurs calculés sur ces semaines.
   *
   * Les fichiers ont déjà été retirés du stockage par la purge ci-dessus ;
   * ceux qui resteraient rattachés sont supprimés ici avant la ligne.
   */
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - 14);
  const cutoff = horizon.toISOString().slice(0, 10);

  const { data: expiredSheets } = await admin
    .from("weekly_sheets")
    .select("id, media_assets:weekly_sheet_items ( media_assets:media_asset_id ( storage_path, preview_path ) )")
    .lt("period_end", cutoff)
    .limit(100);

  let deletedSheets = 0;
  if (expiredSheets && expiredSheets.length > 0) {
    const leftovers: string[] = [];
    for (const sheet of expiredSheets) {
      for (const item of (sheet.media_assets ?? []) as unknown as {
        media_assets: { storage_path: string; preview_path: string | null } | null;
      }[]) {
        if (item.media_assets?.storage_path) leftovers.push(item.media_assets.storage_path);
        if (item.media_assets?.preview_path) leftovers.push(item.media_assets.preview_path);
      }
    }
    if (leftovers.length > 0) await admin.storage.from("media").remove(leftovers);

    const { error: deleteError } = await admin
      .from("weekly_sheets")
      .delete()
      .in("id", expiredSheets.map((sheet) => sheet.id));
    if (!deleteError) deletedSheets = expiredSheets.length;
  }

  return NextResponse.json({
    fichesValideesTacitement: Array.isArray(tacit) ? tacit.length : 0,
    moisDeGestionInscrits: managementMonths,
    originauxPurges: purgedIds.length,
    apercusPurges: previewPurgedIds.length,
    fichesSupprimees: deletedSheets,
    ribsPurges: purgedRibs,
    evenementsRibPurges: purgedRibEvents ?? 0,
    espaceLibere: formatBytes(freed),
  });
}
