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

export interface TopicActionResult { ok: boolean; message?: string }

const schema = z.object({
  sheetId: z.string().uuid(),
  topic: z.string().trim().max(300, "Sujet trop long (300 caractères maximum)."),
});

/**
 * Sujet de la semaine, saisi directement sur la carte du planning.
 *
 * C'est la consigne que la production lit avant de produire : elle doit
 * pouvoir s'écrire là où on regarde la semaine à venir, sans ouvrir la fiche.
 */
export async function setSheetTopic(sheetId: string, topic: string): Promise<TopicActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const parsed = schema.safeParse({ sheetId, topic });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Sujet invalide." };
  }

  // Le rôle ne suffit pas : la fiche doit être dans le périmètre du lecteur.
  if (!(await resolveAccessibleSheet(parsed.data.sheetId))) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  const cleaned = sanitizeText(parsed.data.topic, 300).trim();
  const { error } = await createSupabaseAdminClient()
    .from("weekly_sheets")
    .update({ topic: cleaned || null })
    .eq("id", parsed.data.sheetId);

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/fiches");
  revalidatePath(`/fiches/${parsed.data.sheetId}`);
  return { ok: true, message: cleaned ? "Sujet enregistré." : "Sujet effacé." };
}
