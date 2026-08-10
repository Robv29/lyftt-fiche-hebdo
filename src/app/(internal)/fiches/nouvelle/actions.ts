"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ACCESS_DENIED_MESSAGE,
  canAccessClient,
  requireEditorialProfile,
} from "@/lib/internal/authorization";
import { isoWeekStart } from "@/lib/domain/deadline";
import { clientLifecycle, productionBlockedMessage } from "@/lib/domain/client-lifecycle";
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
  format: z.enum(["visuel", "photo", "reels", "video", "story", "carrousel", "texte_seul"]),
  caption: z.string().max(5000).default(""),
  hashtags: z.string().max(1000).default(""),
  mediaPendingNote: z.string().max(200).optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
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
  const profile = await requireEditorialProfile();
  if (!profile) {
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

  // Le client visé vient du formulaire : on refuse de créer une fiche pour un
  // client hors du périmètre de l'utilisateur.
  if (!(await canAccessClient(input.clientId))) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  // Un client en pause ou dont la gestion est terminee ne recoit plus de fiche.
  // Le controle est fait ici, pas seulement dans l interface : le formulaire
  // reste atteignable par son adresse.
  const admin = createSupabaseAdminClient();
  const { data: clientRow } = await admin
    .from("clients")
    .select("is_active, contract_end_date, pause_start_date, pause_end_date")
    .eq("id", input.clientId)
    .maybeSingle();

  if (clientRow) {
    const lifecycle = clientLifecycle({
      isActive: clientRow.is_active,
      contractEndDate: clientRow.contract_end_date,
      pauseStartDate: clientRow.pause_start_date,
      pauseEndDate: clientRow.pause_end_date,
    });
    if (!lifecycle.canProduce) {
      return { ok: false, message: productionBlockedMessage(lifecycle) };
    }
  }

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
    // Le fichier a déjà été téléversé depuis le navigateur : on ne reçoit ici
    // que son identifiant.
    media_asset_id: item.mediaAssetId ?? null,
  }));

  const { error: itemsError } = await admin
    .from("weekly_sheet_items")
    .insert(rows)
    .select("id");
  if (itemsError) {
    await admin.from("weekly_sheets").delete().eq("id", sheet.id);
    return { ok: false, message: `Publications non enregistrées : ${itemsError?.message ?? "erreur"}` };
  }

  revalidatePath("/fiches");
  return { ok: true, message: "Fiche créée.", sheetId: sheet.id };
}
