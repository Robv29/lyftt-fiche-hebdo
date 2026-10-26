import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_FALLBACK_ROLES } from "@/lib/domain/routing";
import type { AppRole } from "@/lib/domain/types";

/**
 * À qui s'adresse une alerte qui concerne l'agence entière.
 *
 * Par rôle, jamais par adresse ni par identifiant. « Théo et Robin » sont
 * aujourd'hui les deux `super_admin` actifs : écrire leurs adresses dans le
 * code aurait tenu jusqu'au premier départ, au premier changement de domaine ou
 * à la première arrivée d'un troisième dirigeant — et l'alerte serait partie
 * dans le vide sans que personne ne s'en aperçoive, puisque son objet est
 * précisément de signaler ce que personne ne regarde.
 *
 * `LEAD_FALLBACK_ROLES` donne l'ordre : les `super_admin` d'abord, le
 * responsable de production seulement si aucun dirigeant actif n'existe. Ce
 * repli ne doit pas devenir la règle — il écrirait à deux personnes que
 * personne n'a désignées —, d'où l'arrêt au premier rôle pourvu.
 */
export interface LeadRecipients {
  emails: string[];
  /** Rôle réellement servi, pour la trace et le compte rendu de la tâche. */
  role: AppRole | null;
}

export async function leadRecipients(
  admin: SupabaseClient,
  context: string,
): Promise<LeadRecipients> {
  for (const role of LEAD_FALLBACK_ROLES) {
    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .eq("role", role)
      .eq("is_active", true)
      // Ordre déterministe : les mêmes destinataires, dans le même ordre, d'une
      // semaine sur l'autre.
      .order("created_at", { ascending: true })
      .order("email", { ascending: true });

    if (error) {
      console.error(`[${context}] lecture des dirigeants impossible`, error.message);
      return { emails: [], role: null };
    }

    const emails = [...new Set(
      (data ?? [])
        .map((profile) => String(profile.email ?? "").trim().toLowerCase())
        .filter((email) => email.includes("@")),
    )];
    if (emails.length > 0) return { emails, role };
  }

  console.error(`[${context}] aucun dirigeant actif à alerter`);
  return { emails: [], role: null };
}
