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


const requestSchema = z.object({
  clientId: z.string().uuid(),
  note: z.string().trim().min(3, "Dites en deux mots ce qui est demandé.").max(2_000),
});

/**
 * Demande de shooting adressée au chef de projet.
 *
 * Elle emprunte le circuit des tickets clients, qui sait déjà router, assigner
 * et clore — plutôt qu'un mécanisme parallèle qui aurait tout redemandé. Le
 * type `shooting_request` existait déjà pour les demandes venues du portail
 * client ; celle-ci vient de l'équipe, ce que dit `created_by_type: staff`.
 *
 * Le chef de projet la ferme depuis l'écran des tickets, ce qui vaut accusé de
 * réception : c'est exactement ce que fait `resolveServiceRequest`.
 */
export async function requestShooting(formData: FormData): Promise<ShootingActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !PRODUCING_ROLES.includes(profile.role)) {
    return { ok: false, message: "Action réservée à l'équipe de production." };
  }

  const parsed = requestSchema.safeParse({
    clientId: formData.get("clientId"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", parsed.data.clientId)
    .maybeSingle();
  if (!client) return { ok: false, message: "Client introuvable ou accès refusé." };

  /*
   * Un ticket doit se rattacher à une fiche : c'est ce qui lui donne son
   * contexte de semaine. Une demande de shooting ne porte sur aucune
   * publication, on la rattache donc à la fiche la plus récente du client,
   * comme le fait déjà le portail client pour ses demandes hors publication.
   */
  const { data: sheet } = await supabase
    .from("weekly_sheets")
    .select("id")
    .eq("client_id", client.id)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sheet) {
    return {
      ok: false,
      message: "Ce client n'a encore aucune fiche : créez-en une avant de demander un shooting.",
    };
  }

  const note = sanitizeText(parsed.data.note, 2_000);
  const { error } = await createSupabaseAdminClient().from("client_tickets").insert({
    client_id: client.id,
    weekly_sheet_id: sheet.id as string,
    weekly_sheet_item_id: null,
    ticket_type: "shooting_request",
    category: "scope",
    title: `Demande de shooting — ${client.name}`,
    description: note,
    details: {},
    priority: "normal",
    status: "new",
    created_by_type: "staff",
    created_by_name: profile.full_name,
  });

  if (error) return { ok: false, message: `Demande non enregistrée : ${error.message}` };

  revalidatePath("/retours");
  revalidatePath("/shootings");
  return {
    ok: true,
    message: "Demande envoyée au chef de projet. Elle apparaît dans les tickets clients.",
  };
}
