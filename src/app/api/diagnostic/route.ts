import { NextResponse } from "next/server";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

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
    marqueur: "diagnostic-v3",
    // Sans l'une de ces variables, l'application ne démarre pas.
    indispensable: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      IP_HASH_SALT: Boolean(process.env.IP_HASH_SALT),
      NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    },
    /*
     * Absentes, l'application fonctionne mais en silence : aucune alerte
     * e-mail sur un retour client, aucune validation tacite appliquée et
     * aucun média purgé. Autant de choses qui ne se voient pas tant qu'on ne
     * les cherche pas — d'où leur présence ici.
     */
    fonctionnementComplet: {
      RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
      MAIL_FROM: Boolean(process.env.MAIL_FROM),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
    },
    // Un secret non ASCII ne peut pas voyager dans un en-tête HTTP : la tâche
    // planifiée échouerait à chaque exécution.
    cronSecretUtilisable: process.env.CRON_SECRET
      ? /^[\x21-\x7E]+$/.test(process.env.CRON_SECRET)
      : null,
    // Utile pour vérifier que l'URL publique correspond au domaine réel :
    // c'est elle qui construit les liens envoyés aux clients.
    appUrlHote: process.env.NEXT_PUBLIC_APP_URL
      ? safeHost(process.env.NEXT_PUBLIC_APP_URL)
      : null,
    /*
     * L'hôte réellement utilisé, après réparation. L'application normalise
     * cette valeur avant de créer le moindre client Supabase : un schéma
     * oublié ou une barre oblique finale ne l'empêchent pas de fonctionner.
     */
    supabaseHote: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
      ? safeHost(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)!)
      : null,
    /*
     * Vrai si la valeur configurée est directement exploitable. Faux signale
     * une variable mal saisie — schéma absent, guillemets ou espace collés.
     * L'application s'en accommode, mais autant la corriger à la source.
     */
    supabaseUrlPropre: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? safeHost(process.env.NEXT_PUBLIC_SUPABASE_URL) !== "valeur invalide"
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
