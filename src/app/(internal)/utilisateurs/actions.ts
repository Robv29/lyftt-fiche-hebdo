"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { APP_ROLES, type AppRole } from "@/lib/domain/types";

/**
 * Administration des comptes de l'équipe.
 *
 * Réservé au rôle `super_admin` : la création et la suppression passent par
 * l'API d'administration Supabase, qui contourne RLS. Le contrôle du rôle est
 * donc fait ici, explicitement, à chaque action.
 */

export interface UserActionResult {
  ok: boolean;
  message?: string;
  /** Mot de passe provisoire, affiché une seule fois à la création. */
  temporaryPassword?: string;
}

async function requireSuperAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "super_admin") {
    return null;
  }
  return profile;
}

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Le nom est requis."),
  email: z.string().trim().email("Adresse e-mail invalide.").toLowerCase(),
  role: z.enum(APP_ROLES as unknown as [AppRole, ...AppRole[]]),
});

export async function createTeamMember(formData: FormData): Promise<UserActionResult> {
  const admin = await requireSuperAdmin();
  if (!admin) return { ok: false, message: "Action réservée à un administrateur." };

  const parsed = createSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const { fullName, email, role } = parsed.data;
  const supabase = createSupabaseAdminClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return { ok: false, message: "Un compte utilise déjà cette adresse." };

  // Mot de passe provisoire : affiché une fois à l'administrateur, qui le
  // transmet. La personne doit le changer à sa première connexion.
  const temporaryPassword = randomBytes(12).toString("base64url");

  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError || !created.user) {
    return {
      ok: false,
      message: `Compte non créé : ${authError?.message ?? "erreur inconnue"}`,
    };
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    email,
    role,
  });

  if (profileError) {
    // On ne laisse pas un compte d'authentification orphelin derrière soi.
    await supabase.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: `Profil non créé : ${profileError.message}` };
  }

  revalidatePath("/utilisateurs");
  return {
    ok: true,
    message: `${fullName} a été ajouté.`,
    temporaryPassword,
  };
}

export async function setMemberActive(
  profileId: string,
  isActive: boolean,
): Promise<UserActionResult> {
  const admin = await requireSuperAdmin();
  if (!admin) return { ok: false, message: "Action réservée à un administrateur." };

  if (profileId === admin.id && !isActive) {
    return { ok: false, message: "Vous ne pouvez pas désactiver votre propre compte." };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", profileId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/utilisateurs");
  return { ok: true, message: isActive ? "Compte réactivé." : "Compte désactivé." };
}

export async function changeMemberRole(
  profileId: string,
  role: AppRole,
): Promise<UserActionResult> {
  const admin = await requireSuperAdmin();
  if (!admin) return { ok: false, message: "Action réservée à un administrateur." };

  const supabase = createSupabaseAdminClient();

  // On ne se retire pas soi-même les droits, et on ne supprime pas le dernier
  // administrateur : l'application deviendrait ingérable.
  if (profileId === admin.id && role !== "super_admin") {
    return { ok: false, message: "Vous ne pouvez pas retirer vos propres droits." };
  }
  if (!(await hasAnotherAdmin(profileId)) && role !== "super_admin") {
    return { ok: false, message: "Il doit rester au moins un administrateur." };
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/utilisateurs");
  return { ok: true, message: "Rôle mis à jour." };
}

/**
 * Suppression définitive.
 *
 * Le compte d'authentification est supprimé ; le profil suit par cascade. Les
 * tickets et fiches créés par la personne sont conservés, avec leur auteur mis
 * à null — l'historique client ne doit pas disparaître avec un départ.
 */
export async function deleteTeamMember(profileId: string): Promise<UserActionResult> {
  const admin = await requireSuperAdmin();
  if (!admin) return { ok: false, message: "Action réservée à un administrateur." };

  if (profileId === admin.id) {
    return { ok: false, message: "Vous ne pouvez pas supprimer votre propre compte." };
  }
  if (!(await hasAnotherAdmin(profileId))) {
    return { ok: false, message: "Il doit rester au moins un administrateur." };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, message: `Suppression impossible : ${error.message}` };

  revalidatePath("/utilisateurs");
  return { ok: true, message: "Compte supprimé définitivement." };
}

/** Vrai s'il reste un administrateur actif en dehors du profil visé. */
async function hasAnotherAdmin(excludedProfileId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true)
    .neq("id", excludedProfileId);

  return (count ?? 0) > 0;
}
