import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { rescheduleItems } from "@/lib/domain/planning";

/**
 * Recale les brouillons d'un client sur ses jours de publication.
 *
 * Appelé après une modification de la fiche client : les dates sont posées à la
 * création d'une fiche, et changer les jours laissait les fiches déjà créées sur
 * l'ancien rythme.
 *
 * **Brouillons seulement.** Une fiche envoyée porte des dates que le client a
 * vues ; une fiche validée porte des dates qu'il a approuvées ; une publication
 * sortie ne se replanifie pas. Déplacer l'une des trois reviendrait à réécrire
 * un engagement sans le dire.
 *
 * Renvoie le nombre de contenus déplacés, pour que l'appelant puisse le dire.
 */
export async function rescheduleClientDrafts(
  supabase: SupabaseClient,
  clientId: string,
  weekdays: readonly number[],
): Promise<number> {
  if (weekdays.length === 0) return 0;

  const { data: sheets, error } = await supabase
    .from("weekly_sheets")
    .select("id, period_start, weekly_sheet_items ( id, scheduled_date, created_at, is_cancelled )")
    .eq("client_id", clientId)
    .eq("status", "draft");

  if (error) {
    console.error("[replanification] lecture impossible", error.message);
    return 0;
  }

  let moved = 0;

  for (const sheet of sheets ?? []) {
    const items = ((sheet.weekly_sheet_items ?? []) as unknown as {
      id: string; scheduled_date: string; created_at: string; is_cancelled: boolean;
    }[])
      // Un contenu annulé ne compte pas dans la répartition : le garder
      // décalerait tous les suivants d'un cran.
      .filter((item) => !item.is_cancelled)
      .map((item) => ({ id: item.id, scheduledDate: item.scheduled_date, createdAt: item.created_at }));

    const changes = rescheduleItems(
      items,
      weekdays,
      new Date(`${sheet.period_start as string}T00:00:00Z`),
    );

    for (const change of changes) {
      const { error: updateError } = await supabase
        .from("weekly_sheet_items")
        .update({ scheduled_date: change.scheduledDate })
        .eq("id", change.id);

      if (updateError) {
        console.error("[replanification] date non enregistrée", change.id, updateError.message);
        continue;
      }
      moved += 1;
    }
  }

  return moved;
}
