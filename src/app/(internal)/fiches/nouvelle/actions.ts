"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isoWeekStart } from "@/lib/domain/deadline";
import { normalizeHashtags, sanitizeText } from "@/lib/security/sanitize";
import { SOCIAL_NETWORKS } from "@/lib/domain/types";

export interface SheetActionResult {
  ok: boolean;
  message?: string;
  sheetId?: string;
}

const itemSchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  publicationType: z.enum(["post", "reel", "story", "carousel", "video", "article", "other"]),
  format: z.enum(["visuel", "photo", "reels", "video", "carrousel", "texte_seul"]),
  caption: z.string().max(5000).default(""),
  hashtags: z.string().max(1000).default(""),
  mediaPendingNote: z.string().max(200).optional(),
});

const sheetSchema = z.object({
  clientId: z.string().uuid(),
  isoYear: z.coerce.number().int().min(2020).max(2100),
  isoWeek: z.coerce.number().int().min(1).max(53),
  networks: z.array(z.enum(SOCIAL_NETWORKS as unknown as [string, ...string[]])).min(1,
    "Sélectionnez au moins un réseau."),
  items: z.array(itemSchema).min(1, "Ajoutez au moins une publication."),
});

export async function createSheet(formData: FormData): Promise<SheetActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Action non autorisée." };
  }

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "Publications illisibles." };
  }

  const parsed = sheetSchema.safeParse({
    clientId: formData.get("clientId"),
    isoYear: formData.get("isoYear"),
    isoWeek: formData.get("isoWeek"),
    networks: formData.getAll("networks").map(String),
    items: rawItems,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  // La période est déduite de la semaine ISO : l'échéance de validation est
  // ensuite calculée par la base à partir du paramétrage du client (§3).
  const monday = isoWeekStart(input.isoYear, input.isoWeek);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const { data: existing } = await admin
    .from("weekly_sheets")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("iso_year", input.isoYear)
    .eq("iso_week", input.isoWeek)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      message: "Une fiche existe déjà pour ce client sur cette semaine.",
    };
  }

  const { data: sheet, error } = await admin
    .from("weekly_sheets")
    .insert({
      client_id: input.clientId,
      iso_year: input.isoYear,
      iso_week: input.isoWeek,
      period_start: monday.toISOString().slice(0, 10),
      period_end: sunday.toISOString().slice(0, 10),
      networks: input.networks,
      status: "draft",
      community_manager_id: profile.id,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !sheet) {
    return { ok: false, message: `Fiche non créée : ${error?.message ?? "erreur"}` };
  }

  const rows = input.items.map((item, index) => ({
    weekly_sheet_id: sheet.id,
    position: index + 1,
    scheduled_date: item.scheduledDate,
    scheduled_time: item.scheduledTime || null,
    publication_type: item.publicationType,
    format: item.format,
    networks: input.networks,
    caption: sanitizeText(item.caption, 5000),
    hashtags: normalizeHashtags(item.hashtags),
    media_pending_note: item.mediaPendingNote
      ? sanitizeText(item.mediaPendingNote, 200)
      : null,
  }));

  const { error: itemsError } = await admin.from("weekly_sheet_items").insert(rows);
  if (itemsError) {
    await admin.from("weekly_sheets").delete().eq("id", sheet.id);
    return { ok: false, message: `Publications non enregistrées : ${itemsError.message}` };
  }

  revalidatePath("/fiches");
  return { ok: true, message: "Fiche créée.", sheetId: sheet.id };
}
