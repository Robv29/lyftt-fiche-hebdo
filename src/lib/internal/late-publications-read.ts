import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  latePublicationWindow,
  latePublications,
  type LatePublicationRow,
  type LatePublicationsView,
} from "@/lib/domain/late-publications";
import { parisFields } from "@/lib/domain/paris-time";
import type { ItemApprovalStatus, MediaFormat, SheetStatus } from "@/lib/domain/types";

export type { LatePublicationsView };

/**
 * Lecture des publications en retard, pour celui qui regarde.
 *
 * Soumise à RLS, et c'est tout le point. `weekly_sheet_items_select` remonte à
 * `can_access_client`, qui est `is_staff_lead() OR une affectation explicite` :
 * un community manager ne voit que ses dossiers, un commercial aucune ligne —
 * sans qu'un seul contrôle de périmètre soit écrit ici. Une seconde barrière
 * recopiée dans le code aurait fini par diverger de la politique SQL. Aucun
 * client service-role : cette lecture n'a rien à écrire.
 *
 * ## Ce que la requête décide, et ce qu'elle ne décide pas
 *
 * Elle ne borne que la **fenêtre** — la plage de dates, la case « publié » et
 * l'annulation, les trois prédicats que porte déjà l'index partiel
 * `weekly_sheet_items_daily_publication_idx (scheduled_date, published_at)
 * where not is_cancelled`. Aucune migration n'est donc nécessaire.
 *
 * Le statut de la fiche, la validation du contenu et le drapeau du dossier sont
 * filtrés en TypeScript, dans `late-publications.ts`, et nulle part ailleurs :
 * c'est ce qui garantit que l'écran et la pop-up ne peuvent pas diverger. La
 * pastille de l'écran disait 37 là où 10 étaient pertinents, précisément parce
 * qu'elle portait sa propre version du prédicat.
 *
 * Coût mesuré sur les données réelles : `Index Scan` sur l'index ci-dessus,
 * 59 lignes, 109 buffers, 1,0 ms — l'ordre de grandeur des pastilles que la
 * coquille lit déjà, et moins que le bloc des six compteurs de production.
 */

/**
 * Borne dure. Huit jours de contenus font une soixantaine de lignes
 * aujourd'hui ; le plafond protège d'une semaine pathologique sans jamais
 * mordre sur une semaine normale.
 */
const READ_LIMIT = 150;

const FIELDS =
  "id, scheduled_date, scheduled_time, format, approval_status, published_at, is_cancelled, weekly_sheets!inner ( status, clients!inner ( name, weekly_sheet_alert ) )";

type SheetJoin = { status: SheetStatus; clients: { name: string; weekly_sheet_alert: boolean | null } | null } | null;

export async function readLatePublications(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<LatePublicationsView> {
  const today = parisFields(now).day;
  const window = latePublicationWindow(today);

  const { data, error } = await supabase
    .from("weekly_sheet_items")
    .select(FIELDS)
    .gte("scheduled_date", window.since)
    // Jusqu'à aujourd'hui inclus : le jour même ne compte pas dans le retard,
    // mais la fenêtre ouverte le rappelle en une ligne.
    .lte("scheduled_date", today)
    .eq("is_cancelled", false)
    .is("published_at", null)
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(READ_LIMIT);

  if (error) throw new Error(error.message);

  const rows: LatePublicationRow[] = (data ?? []).map((row) => {
    const sheet = row.weekly_sheets as unknown as SheetJoin;
    return {
      id: row.id as string,
      scheduledDate: row.scheduled_date as string,
      scheduledTime: (row.scheduled_time as string | null) ?? null,
      clientName: sheet?.clients?.name ?? "Client",
      format: row.format as MediaFormat,
      approvalStatus: row.approval_status as ItemApprovalStatus,
      /*
       * Les deux jointures sont `!inner` : la fiche et le dossier sont là, ou
       * la ligne n'est pas rendue. Les replis ne couvrent donc qu'une forme
       * inattendue, et chacun choisit le silence plutôt que la fausse alerte :
       * sans preuve que la fiche est partie, on ne réclame pas sa publication.
       * Le drapeau, lui, est `not null default true` en base.
       */
      sheetStatus: (sheet?.status ?? "draft") as SheetStatus,
      publishedAt: (row.published_at as string | null) ?? null,
      isCancelled: Boolean(row.is_cancelled),
      alertEnabled: sheet?.clients?.weekly_sheet_alert !== false,
    };
  });

  return latePublications({ rows, today });
}
