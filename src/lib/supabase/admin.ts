import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Client à privilèges élevés, réservé au portail client.
 *
 * Le portail est public : il n'y a pas d'utilisateur authentifié, donc pas de
 * RLS exploitable. L'accès est donc contrôlé en amont — vérification du token,
 * expiration, révocation — puis chaque requête est explicitement bornée à la
 * fiche du lien. Ce module est marqué `server-only` : toute tentative de
 * l'importer dans un composant client casse la compilation.
 */
export function createSupabaseAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
