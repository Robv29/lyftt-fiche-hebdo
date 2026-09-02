import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/domain/types";

/**
 * Gardes d'autorisation des actions internes.
 *
 * Les actions serveur qui écrivent utilisent le client service-role, lequel
 * contourne RLS. Vérifier le rôle ne suffit donc pas : un community manager a
 * le bon rôle pour éditer une fiche, mais seulement celles de ses clients.
 *
 * Le principe retenu : la vérification de périmètre se fait par une lecture
 * avec le client soumis à RLS. Si la ligne n'est pas visible, l'accès est
 * refusé — la politique SQL reste ainsi l'unique source de vérité, et une
 * évolution des règles n'a pas à être répercutée ici.
 */

export const EDITORIAL_ROLES: readonly AppRole[] = [
  "super_admin",
  "production_manager",
  "community_manager",
];

/**
 * Le commercial ne consulte que les clients et la carte.
 *
 * La navigation ne lui propose rien d'autre, mais une URL saisie à la main
 * atteindrait les autres écrans. Ceux-ci se videraient d'eux-mêmes — la RLS ne
 * lui montre ni fiche, ni ticket, ni budget — et une page vide se lit comme une
 * panne. Mieux vaut le renvoyer là où il a quelque chose à voir.
 *
 * À appeler en tête des pages qui sortent de son périmètre. Ce n'est pas la
 * barrière de sécurité : celle-ci est en base, et dans les gardes de rôle des
 * actions serveur.
 */
export async function denyCommercial(): Promise<void> {
  const profile = await getCurrentProfile();
  if (profile?.role === "commercial") redirect("/implantations");
}

export interface AuthorizedProfile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
}

/** Profil connecté disposant d'un rôle éditorial, ou null. */
export async function requireEditorialProfile(): Promise<AuthorizedProfile | null> {
  const profile = await getCurrentProfile();
  if (!profile || !EDITORIAL_ROLES.includes(profile.role)) return null;
  return profile as AuthorizedProfile;
}

/** Le client est-il dans le périmètre de l'utilisateur connecté ? */
export async function canAccessClient(clientId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  return Boolean(data);
}

/** Renvoie l'identifiant du client de la fiche, ou null si elle est hors périmètre. */
export async function resolveAccessibleSheet(
  sheetId: string,
): Promise<{ id: string; clientId: string; status: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("weekly_sheets")
    .select("id, client_id, status")
    .eq("id", sheetId)
    .maybeSingle();

  return data ? { id: data.id, clientId: data.client_id, status: data.status } : null;
}

/** Idem pour une publication, en remontant à sa fiche. */
export async function resolveAccessibleItem(
  itemId: string,
): Promise<{ id: string; sheetId: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("weekly_sheet_items")
    .select("id, weekly_sheet_id")
    .eq("id", itemId)
    .maybeSingle();

  return data ? { id: data.id, sheetId: data.weekly_sheet_id } : null;
}

/** Message unique : ne pas distinguer « inexistant » de « hors périmètre ». */
export const ACCESS_DENIED_MESSAGE = "Élément introuvable ou accès refusé.";
