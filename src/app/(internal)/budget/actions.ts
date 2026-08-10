"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/security/sanitize";
import { findService } from "@/lib/domain/budget";

export interface BudgetActionResult {
  ok: boolean;
  message?: string;
}

/*
 * Le budget est une donnée de direction. La vérification du rôle est doublée
 * par une politique RLS : ces actions passent par le client utilisateur, pas
 * par la clé service, pour que la base reste le dernier mot.
 */
async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "super_admin" ? profile : null;
}

const ACCESS_DENIED = "Écran réservé aux administrateurs.";

const settingsSchema = z.object({
  clientId: z.string().uuid(),
  billingMode: z.enum(["comptant", "financement"]),
  // Saisi en euros, stocké en centimes.
  budgetEuros: z.coerce.number().min(0, "Le budget ne peut pas être négatif.").max(1_000_000),
  note: z.string().trim().max(500, "Note trop longue (500 caractères maximum).").optional(),
});

export async function saveBudgetSettings(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = settingsSchema.safeParse({
    clientId: formData.get("clientId"),
    billingMode: formData.get("billingMode"),
    budgetEuros: formData.get("budgetEuros") || 0,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_budgets").upsert({
    client_id: parsed.data.clientId,
    billing_mode: parsed.data.billingMode,
    budget_cents: Math.round(parsed.data.budgetEuros * 100),
    note: parsed.data.note ? sanitizeText(parsed.data.note, 500) : null,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: "Budget enregistré." };
}

const lineSchema = z.object({
  clientId: z.string().uuid(),
  serviceKey: z.string().min(1, "Choisissez une prestation."),
  quantity: z.coerce.number().positive("La quantité doit être supérieure à zéro.").max(999),
  months: z.coerce.number().int().positive().max(120).optional(),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  note: z.string().trim().max(300, "Note trop longue (300 caractères maximum).").optional(),
});

export async function addBudgetLine(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const rawMonths = formData.get("months");
  const parsed = lineSchema.safeParse({
    clientId: formData.get("clientId"),
    serviceKey: formData.get("serviceKey"),
    quantity: formData.get("quantity") || 1,
    months: rawMonths ? rawMonths : undefined,
    performedOn: formData.get("performedOn"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const service = findService(parsed.data.serviceKey);
  if (!service) return { ok: false, message: "Prestation inconnue." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_budget_lines").insert({
    client_id: parsed.data.clientId,
    service_key: service.key,
    /*
     * Libellé et prix figés à l'ajout : une révision tarifaire ne doit pas
     * réécrire une addition déjà établie avec le client.
     */
    label: service.label,
    billing: service.billing,
    unit_price_cents: service.unitPriceCents,
    quantity: parsed.data.quantity,
    months: service.billing === "mensuel" ? parsed.data.months ?? 1 : null,
    performed_on: parsed.data.performedOn,
    note: parsed.data.note ? sanitizeText(parsed.data.note, 300) : null,
    created_by: profile.id,
  });

  if (error) return { ok: false, message: `Ajout impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: `${service.label} ajouté.` };
}

export async function removeBudgetLine(lineId: string, clientId: string): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const ids = z.object({ lineId: z.string().uuid(), clientId: z.string().uuid() })
    .safeParse({ lineId, clientId });
  if (!ids.success) return { ok: false, message: "Ligne invalide." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("client_budget_lines")
    .delete()
    .eq("id", ids.data.lineId)
    .eq("client_id", ids.data.clientId);

  if (error) return { ok: false, message: `Suppression impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${ids.data.clientId}`);
  return { ok: true, message: "Prestation retirée." };
}
