"use client";

import { createBrowserClient } from "@supabase/ssr";
import { normalizeKey, normalizeSupabaseUrl } from "./url";

/**
 * Client Supabase du navigateur.
 *
 * Utilisé uniquement pour téléverser un fichier vers une URL signée obtenue du
 * serveur : c'est le jeton de l'URL qui autorise l'écriture, pas la clé anon.
 * Cela contourne la limite de 4,5 Mo imposée aux fonctions serverless, que la
 * vidéo dépasse systématiquement.
 */
export function createSupabaseBrowserClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error(
      "Configuration Supabase incomplète côté navigateur (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }

  return createBrowserClient(url, key);
}
