import { NextResponse } from "next/server";

/**
 * Route de diagnostic de déploiement — temporaire.
 *
 * Ne renvoie que des booléens de présence : aucune valeur de variable, aucun
 * secret. Elle sert à identifier quel build est en ligne et quelles variables
 * d'environnement manquent, informations impossibles à obtenir autrement sans
 * accès aux logs de la plateforme.
 *
 * À supprimer une fois le déploiement stabilisé.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    // Marqueur de build : permet de savoir si le déploiement contient bien
    // le dernier commit poussé.
    marqueur: "diagnostic-v1",
    variables: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      IP_HASH_SALT: Boolean(process.env.IP_HASH_SALT),
      NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    },
    // Utile pour vérifier que l'URL publique correspond au domaine réel :
    // c'est elle qui construit les liens envoyés aux clients.
    appUrlHote: process.env.NEXT_PUBLIC_APP_URL
      ? safeHost(process.env.NEXT_PUBLIC_APP_URL)
      : null,
    supabaseHote: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? safeHost(process.env.NEXT_PUBLIC_SUPABASE_URL)
      : null,
  });
}

/** N'expose que le nom d'hôte, jamais un éventuel jeton présent dans l'URL. */
function safeHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return "valeur invalide";
  }
}
