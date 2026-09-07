"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";

export interface ShootingActionResult {
  ok: boolean;
  message: string;
}

/*
 * Rôles qui produisent — les mêmes que la politique `shootings_write` en base.
 * L'écriture passe par le client soumis à RLS : cette liste est un confort
 * d'affichage et de message, la barrière est en base.
 */
const PRODUCING_ROLES = [
  "super_admin", "production_manager", "community_manager", "graphic_designer", "video_editor",
];

const detailsSchema = z.object({
  budgetLineId: z.string().uuid(),
  name: z.string().trim().max(160).optional(),
  kind: z.enum(["photo", "video", "photo_video"]).optional().or(z.literal("")),
  place: z.string().trim().max(160).optional(),
  leadName: z.string().trim().max(120).optional(),
  /* Saisie en heures et minutes, rangée en minutes : c'est ce qui se cumule. */
  durationHours: z.coerce.number().min(0).max(24).optional(),
  durationMinutes: z.coerce.number().min(0).max(59).optional(),
  deliveryDays: z.coerce.number().int().min(0).max(365).optional(),
  deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  assetsCount: z.coerce.number().int().min(0).max(10_000).optional(),
  cancelled: z.coerce.boolean().optional(),
});

const optional = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * Enregistre la fiche d'un shooting.
 *
 * La date n'est pas ici : elle appartient à la ligne de budget, et se change
 * par le bouton « Date calée ». Cette fiche ne porte que ce que la date ne dit
 * pas — et l'annulation, seul état qui ne se déduise d'aucune date.
 */
export async function saveShootingDetails(formData: FormData): Promise<ShootingActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !PRODUCING_ROLES.includes(profile.role)) {
    return { ok: false, message: "Action réservée à l'équipe de production." };
  }

  const parsed = detailsSchema.safeParse({
    budgetLineId: formData.get("budgetLineId"),
    name: optional(formData.get("name")),
    kind: optional(formData.get("kind")) ?? "",
    place: optional(formData.get("place")),
    leadName: optional(formData.get("leadName")),
    durationHours: optional(formData.get("durationHours")),
    durationMinutes: optional(formData.get("durationMinutes")),
    deliveryDays: optional(formData.get("deliveryDays")),
    deliveredOn: optional(formData.get("deliveredOn")) ?? "",
    assetsCount: optional(formData.get("assetsCount")),
    cancelled: formData.get("cancelled") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Fiche invalide." };
  }
  const input = parsed.data;

  /*
   * Le client de la ligne se lit avec la clé service : le budget est réservé à
   * la direction par RLS, alors que cette fiche est faite pour la production.
   * Le périmètre est ensuite vérifié par une lecture soumise à RLS, comme
   * partout ailleurs — la politique SQL reste seule juge.
   */
  const { data: line } = await createSupabaseAdminClient()
    .from("client_budget_lines")
    .select("id, client_id")
    .eq("id", input.budgetLineId)
    .maybeSingle();
  if (!line) return { ok: false, message: "Shooting introuvable." };

  const supabase = await createSupabaseServerClient();
  const { data: allowed } = await supabase
    .from("clients")
    .select("id")
    .eq("id", line.client_id as string)
    .maybeSingle();
  if (!allowed) return { ok: false, message: "Shooting introuvable ou accès refusé." };

  const totalMinutes = input.durationHours === undefined && input.durationMinutes === undefined
    ? null
    : Math.round((input.durationHours ?? 0) * 60 + (input.durationMinutes ?? 0));

  const { error } = await supabase
    .from("shootings")
    .upsert({
      budget_line_id: input.budgetLineId,
      client_id: line.client_id as string,
      name: input.name ? sanitizeText(input.name, 160) : null,
      kind: input.kind ? input.kind : null,
      place: input.place ? sanitizeText(input.place, 160) : null,
      lead_name: input.leadName ? sanitizeText(input.leadName, 120) : null,
      duration_minutes: totalMinutes,
      delivery_days: input.deliveryDays ?? null,
      delivered_on: input.deliveredOn ? input.deliveredOn : null,
      assets_count: input.assetsCount ?? null,
      cancelled: Boolean(input.cancelled),
    }, { onConflict: "budget_line_id" });

  if (error) return { ok: false, message: `Fiche non enregistrée : ${error.message}` };

  revalidatePath("/shootings");
  revalidatePath(`/shootings/${input.budgetLineId}`);
  // Un shooting annulé cesse d'ancrer le cycle : le rappel de l'accueil suit.
  revalidatePath("/");
  return { ok: true, message: "Fiche enregistrée." };
}
