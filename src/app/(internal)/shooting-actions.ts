"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { SHOOTING_FORFAIT_KEY, findService, parseShootingPlan } from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";

export interface ShootingActionResult {
  ok: boolean;
  message?: string;
}

const EDITORIAL_ROLES = ["super_admin", "production_manager", "community_manager"];

/**
 * Planification des shootings du forfait.
 *
 * Caler une date est un acte de production, pas de direction : le community
 * manager qui parle au client doit pouvoir l'inscrire. Le budget, lui, reste
 * réservé à la direction par RLS — d'où l'écriture par la clé service, après
 * avoir vérifié que le client est bien dans le périmètre de la personne.
 */
async function requireClientAccess(clientId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !EDITORIAL_ROLES.includes(profile.role)) return null;

  const scoped = await createSupabaseServerClient();
  const { data: client } = await scoped
    .from("clients")
    .select("id, notes")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  return { profile, client };
}

const scheduleSchema = z.object({
  clientId: z.string().uuid(),
  shootingOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  note: z.string().trim().max(300, "Précision trop longue (300 caractères maximum).").optional(),
});

/**
 * Date de shooting convenue avec le client.
 *
 * La date est inscrite comme une ligne du budget, à zéro euro : le forfait est
 * déjà payé mois par mois dans la gestion, le compter une seconde fois à sa
 * réalisation doublerait la facture. La ligne sert d'ancre — c'est d'elle que
 * se déduit l'échéance suivante — et de trace de ce qui a réellement été tourné.
 */
export async function scheduleShooting(formData: FormData): Promise<ShootingActionResult> {
  const parsed = scheduleSchema.safeParse({
    clientId: formData.get("clientId"),
    shootingOn: formData.get("shootingOn"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const access = await requireClientAccess(parsed.data.clientId);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const plan = parseShootingPlan(readSettings(access.client.notes as string | null).shootingPlan);
  if (!plan) {
    return { ok: false, message: "Aucun shooting n'est vendu dans la formule de ce client." };
  }

  const admin = createSupabaseAdminClient();

  /*
   * Une date déjà calée est remplacée, jamais doublée : deux lignes à venir
   * pour le même shooting laisseraient l'écran choisir laquelle montrer, et le
   * cycle suivant se calculerait sur la mauvaise.
   */
  await admin
    .from("client_budget_lines")
    .delete()
    .eq("client_id", parsed.data.clientId)
    .eq("service_key", SHOOTING_FORFAIT_KEY)
    .gt("performed_on", todayInParis());

  const { error } = await admin.from("client_budget_lines").insert({
    client_id: parsed.data.clientId,
    service_key: SHOOTING_FORFAIT_KEY,
    label: `${findService(plan.serviceKey)?.label ?? "Shooting"} du forfait`,
    billing: "ponctuel",
    // Déjà réglé par le lissage mensuel : la ligne ne consomme rien.
    unit_price_cents: 0,
    quantity: 1,
    months: null,
    performed_on: parsed.data.shootingOn,
    note: parsed.data.note
      ? sanitizeText(parsed.data.note, 300)
      : "Date calée avec le client. Prestation déjà lissée sur la gestion mensuelle.",
    created_by: access.profile.id,
  });
  if (error) return { ok: false, message: `Date non enregistrée : ${error.message}` };

  // Le rappel n'a plus lieu d'être : la date est prise.
  await writeSettings(admin, parsed.data.clientId, access.client.notes as string | null, {
    shootingReminderOn: null,
  });

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: `Shooting calé au ${parsed.data.shootingOn}.` };
}

/**
 * Trace du message envoyé au client.
 *
 * Sans elle, personne ne sait si le client a déjà été sollicité : le bouton
 * proposerait indéfiniment le même premier message, et deux personnes de
 * l'équipe pourraient relancer le même jour.
 */
export async function markShootingReminder(clientId: string): Promise<ShootingActionResult> {
  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };

  const access = await requireClientAccess(parsed.data);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();
  const error = await writeSettings(admin, parsed.data, access.client.notes as string | null, {
    shootingReminderOn: todayInParis(),
  });
  if (error) return { ok: false, message: `Suivi non enregistré : ${error}` };

  revalidatePath("/");
  return { ok: true, message: "Message noté comme envoyé." };
}

function readSettings(notes: string | null): Record<string, unknown> {
  try {
    const parsed = typeof notes === "string" ? JSON.parse(notes) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Écriture d'un réglage sans écraser les autres.
 *
 * Les réglages du client tiennent dans un seul texte JSON : y écrire suppose de
 * relire ce qui s'y trouve déjà, sans quoi une date de shooting effacerait les
 * hashtags et le rythme vendu.
 */
async function writeSettings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  notes: string | null,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const settings = { ...readSettings(notes), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete settings[key];
  }
  const { error } = await admin
    .from("clients")
    .update({ notes: JSON.stringify(settings) })
    .eq("id", clientId);
  return error?.message ?? null;
}

/**
 * Retrait d'une date calée.
 *
 * Un rendez-vous se décale ou s'annule : la date inscrite n'est pas une
 * décision définitive. La retirer rouvre le rappel, et l'échéance se recalcule
 * depuis le dernier shooting réellement réalisé.
 */
export async function cancelShooting(clientId: string): Promise<ShootingActionResult> {
  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };

  const access = await requireClientAccess(parsed.data);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();
  const { error, count } = await admin
    .from("client_budget_lines")
    .delete({ count: "exact" })
    .eq("client_id", parsed.data)
    .eq("service_key", SHOOTING_FORFAIT_KEY)
    // Seule une date à venir s'annule : un shooting déjà réalisé est un fait.
    .gt("performed_on", todayInParis());

  if (error) return { ok: false, message: `Annulation impossible : ${error.message}` };
  if ((count ?? 0) === 0) {
    return { ok: false, message: "Aucune date à venir à annuler pour ce client." };
  }

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data}`);
  return { ok: true, message: "Date annulée. Le rappel est rouvert." };
}
