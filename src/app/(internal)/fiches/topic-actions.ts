"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import {
  ACCESS_DENIED_MESSAGE,
  requireEditorialProfile,
  resolveAccessibleSheet,
} from "@/lib/internal/authorization";
import { canEditSheetTopic } from "@/lib/domain/sheet-status";
import type { SheetStatus } from "@/lib/domain/types";

export interface TopicActionResult { ok: boolean; message?: string }

const schema = z.object({
  sheetId: z.string().uuid(),
  topic: z.string().trim().max(300, "Sujet trop long (300 caractères maximum)."),
});

/**
 * Sujet de la semaine, saisi directement sur la carte du planning.
 *
 * C'est la consigne que la production lit avant de produire : elle doit
 * pouvoir s'écrire là où on regarde la semaine, sans ouvrir la fiche, et
 * **aussi longtemps que la fiche vit** — le sujet se précise souvent une fois
 * la semaine lancée ou la fiche validée. Rien ne s'y oppose côté base : le
 * sujet ne fait partie d'aucun engagement contractuel, aucun déclencheur ne le
 * gèle, et le client ne le voit nulle part. Seule la fin de parcours ferme la
 * porte, comme pour le contenu.
 */
export async function setSheetTopic(sheetId: string, topic: string): Promise<TopicActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const parsed = schema.safeParse({ sheetId, topic });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Sujet invalide." };
  }

  // Le rôle ne suffit pas : la fiche doit être dans le périmètre du lecteur.
  const sheet = await resolveAccessibleSheet(parsed.data.sheetId);
  if (!sheet) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  /*
   * Une fiche refusée ou périmée ne se reprend pas, elle se refait : y écrire
   * une consigne serait la donner à une semaine que personne ne produira. Même
   * frontière que l'édition du contenu, pour que « fiche encore vivante » ne
   * veuille pas dire deux choses selon l'écran.
   */
  if (!canEditSheetTopic(sheet.status as SheetStatus)) {
    return {
      ok: false,
      message: "Fiche refusée ou périmée : son sujet n'est plus modifiable.",
    };
  }

  const cleaned = sanitizeText(parsed.data.topic, 300).trim();
  const { error } = await createSupabaseAdminClient()
    .from("weekly_sheets")
    .update({ topic: cleaned || null })
    .eq("id", parsed.data.sheetId);

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/fiches");
  revalidatePath(`/fiches/${parsed.data.sheetId}`);
  // La production affiche le sujet dans son tableau : elle doit le relire.
  revalidatePath("/production");
  return { ok: true, message: cleaned ? "Sujet enregistré." : "Sujet effacé." };
}
