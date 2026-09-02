"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { APP_ROLES, type AppRole } from "@/lib/domain/types";
import { sendEmail } from "@/lib/notifications/resend";
import { env } from "@/lib/supabase/env";

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
  /**
   * Lien d'invitation, à afficher quand l'e-mail n'est pas parti.
   *
   * L'envoi peut échouer — clé absente, domaine non vérifié, adresse refusée.
   * Sans ce repli, l'invitation serait perdue sans que personne le sache : le
   * membre existe, il attend un courrier qui n'arrivera pas.
   */
  invitationLink?: string;
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

  let userId = created?.user?.id ?? null;
  /* Vrai si le compte d'authentification préexistait : on ne le supprimera pas. */
  let reattached = false;

  if (authError || !userId) {
    /*
     * Adresse déjà connue de l'authentification, sans membre associé.
     *
     * Le cas se produit dès qu'un compte a été créé ailleurs qu'ici — depuis
     * le tableau de bord Supabase, par exemple. Il n'apparaît alors nulle part
     * dans Équipe : impossible de le supprimer, impossible de le recréer,
     * l'adresse devenait inutilisable sans aucune issue depuis l'écran.
     *
     * On rattache le compte existant plutôt que de renvoyer l'utilisateur à
     * une impasse. Son mot de passe est remplacé par le mot de passe
     * provisoire : celui qui aurait pu être fixé auparavant cesse de valoir.
     */
    const existing = await findAuthUserByEmail(supabase, email);
    if (!existing) {
      return {
        ok: false,
        message: `Compte non créé : ${authError?.message ?? "erreur inconnue"}`,
      };
    }

    // Garde-fou : le contrôle par adresse ci-dessus ne verrait pas un profil
    // enregistré sous une autre adresse que celle de l'authentification.
    const { data: linked } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", existing.id)
      .maybeSingle();
    if (linked) return { ok: false, message: "Un compte utilise déjà cette adresse." };

    const { error: resetError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (resetError) {
      return { ok: false, message: `Compte non rattaché : ${resetError.message}` };
    }

    userId = existing.id;
    reattached = true;
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    full_name: fullName,
    email,
    role,
  });

  if (profileError) {
    /*
     * On ne laisse pas un compte d'authentification orphelin derrière soi —
     * sauf s'il préexistait : le supprimer effacerait un compte que nous
     * n'avons pas créé, et que son titulaire utilise peut-être ailleurs.
     */
    if (!reattached) await supabase.auth.admin.deleteUser(userId);
    return { ok: false, message: `Profil non créé : ${profileError.message}` };
  }

  revalidatePath("/utilisateurs");
  return {
    ok: true,
    message: reattached
      ? `${fullName} a été ajouté. Un compte existait déjà pour cette adresse sans membre associé : il a été rattaché, et son mot de passe remplacé par celui ci-dessous.`
      : `${fullName} a été ajouté.`,
    temporaryPassword,
  };
}

/**
 * Compte d'authentification portant cette adresse, s'il en existe un.
 *
 * L'API d'administration ne sait pas chercher par adresse : elle ne sait que
 * paginer. Le parcours est donc borné — une équipe interne tient largement
 * dans ces pages, et une boucle sans fin sur un service distant serait pire
 * que de ne pas trouver le compte.
 */
async function findAuthUserByEmail(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<{ id: string } | null> {
  const PER_PAGE = 200;
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data) return null;

    const found = data.users.find(
      (user) => (user.email ?? "").toLowerCase() === email,
    );
    if (found) return { id: found.id };
    if (data.users.length < PER_PAGE) return null;
  }
  return null;
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


// ---------------------------------------------------------------------------
// Invitation : la personne choisit son propre mot de passe
// ---------------------------------------------------------------------------

/**
 * Invite un membre à créer son compte.
 *
 * Différence avec la création directe : personne d'autre que l'intéressé ne
 * connaît son mot de passe. L'administrateur ne transmet plus un mot de passe
 * provisoire par un canal qu'il ne maîtrise pas.
 *
 * Le lien est fabriqué par nous et pointe sur nos écrans, plutôt que de passer
 * par le courrier de Supabase : c'est notre expéditeur qui écrit, comme pour
 * le reste de l'application, et l'envoi ne dépend pas d'un service tiers
 * configuré ailleurs.
 *
 * Le profil est créé tout de suite : le membre apparaît dans l'équipe avec son
 * rôle, en attente de première connexion. Ne le créer qu'à l'acceptation
 * laisserait l'invitation invisible, sans moyen de savoir qui a été invité.
 */
export async function inviteTeamMember(formData: FormData): Promise<UserActionResult> {
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

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) return { ok: false, message: "Un compte utilise déjà cette adresse." };

  /*
   * Deux cas, un seul résultat attendu : un jeton à usage unique.
   *
   * « invite » crée le compte au passage. Si l'adresse est déjà connue de
   * l'authentification — un compte créé ailleurs, sans membre associé — la
   * génération échoue ; on repart alors sur « recovery », qui pose le même
   * geste sur un compte existant.
   */
  let link = await generateInvitationLink(supabase, "invite", email, fullName);
  if (!link) link = await generateInvitationLink(supabase, "recovery", email, fullName);
  if (!link) {
    return { ok: false, message: "Invitation impossible : lien non généré." };
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: link.userId,
    full_name: fullName,
    email,
    role,
  });
  if (profileError) {
    return { ok: false, message: `Profil non créé : ${profileError.message}` };
  }

  const outcome = await sendEmail(invitationEmail(fullName, email, link.url));
  revalidatePath("/utilisateurs");

  if (outcome.sent) {
    return { ok: true, message: `Invitation envoyée à ${email}.` };
  }

  /*
   * L'envoi a échoué : on rend le lien plutôt que de laisser croire que
   * l'invitation est partie. Le membre est bien créé, il ne manque que le
   * message — que l'administrateur peut transmettre lui-même.
   */
  return {
    ok: true,
    message: `${fullName} a été ajouté, mais l'e-mail n'est pas parti (${outcome.reason}). Transmettez-lui ce lien, valable une seule fois :`,
    invitationLink: link.url,
  };
}

/** Jeton d'invitation, transformé en adresse de nos écrans. */
async function generateInvitationLink(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  type: "invite" | "recovery",
  email: string,
  fullName: string,
): Promise<{ url: string; userId: string } | null> {
  const { data, error } = await supabase.auth.admin.generateLink(
    type === "invite"
      ? { type, email, options: { data: { full_name: fullName } } }
      : { type, email },
  );

  const token = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || !token || !userId) return null;

  /*
   * On garde le jeton et on reconstruit l'adresse : le lien fourni par
   * Supabase passe par son propre point de vérification, qui renvoie les
   * jetons dans le fragment de l'URL — invisible côté serveur. Notre route
   * les reçoit en clair et ouvre la session elle-même.
   */
  const url = new URL("/invitation", env.appUrl);
  url.searchParams.set("token_hash", token);
  url.searchParams.set("type", type);
  return { url: url.toString(), userId };
}

function invitationEmail(fullName: string, email: string, link: string) {
  const subject = "Votre accès à l'espace équipe LYFTT";
  const intro = `Bonjour ${fullName}, votre accès à l'espace équipe LYFTT est prêt.`;
  const consigne = "Choisissez votre mot de passe en suivant ce lien. Il ne fonctionne qu'une fois.";

  return {
    to: [email],
    subject,
    text: `${intro}\n\n${consigne}\n\n${link}\n\nSi vous n'attendiez pas ce message, ignorez-le.`,
    html: `<p>${intro}</p><p>${consigne}</p><p><a href="${link}">Choisir mon mot de passe</a></p>`
      + `<p style="color:#667085;font-size:13px">Si vous n'attendiez pas ce message, ignorez-le.</p>`,
  };
}
