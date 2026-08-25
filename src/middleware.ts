import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeKey, normalizeSupabaseUrl } from "@/lib/supabase/url";

/**
 * Rafraîchit la session Supabase et protège les écrans internes.
 *
 * Le portail client (`/client-review/...`) et le formulaire de demande
 * (`/demande/...`) sont volontairement exclus : ils sont
 * public et son contrôle d'accès repose sur le token, pas sur une session.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Ces deux variables sont figées au build. Si elles manquaient à ce
  // moment-là, elles valent `undefined` ici et `createServerClient` lève une
  // exception — ce qui, dans un middleware, fait échouer *toutes* les routes
  // avec un 500 opaque. On préfère un message explicite.
  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    return configurationError(
      "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être " +
        "définies, la première sous la forme https://votre-projet.supabase.co",
    );
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Une indisponibilité réseau côté Supabase ne doit pas rendre tout le site
  // inaccessible : on retombe sur la page de connexion.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  if (!user && !request.nextUrl.pathname.startsWith("/login")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", request.nextUrl.pathname);

    const redirectResponse = NextResponse.redirect(redirect);

    // Indispensable : `response` porte les cookies écrits par Supabase pendant
    // getUser() — jeton de rafraîchissement renouvelé, ou suppression d'une
    // session invalide. Les abandonner ici consomme l'ancien jeton sans jamais
    // écrire le nouveau : la session est perdue et l'utilisateur rebondit
    // indéfiniment vers la page de connexion.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
  }

  return response;
}

/** Message explicite plutôt qu'un 500 opaque sur l'ensemble du site. */
function configurationError(detail: string): NextResponse {
  return new NextResponse(
    `Configuration incomplète.\n\n${detail}\n\n` +
      "Après correction, redéployez en désactivant le cache de build : les " +
      "variables NEXT_PUBLIC_* sont intégrées au moment de la compilation.\n",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

export const config = {
  matcher: [
    /*
     * Tout sauf : le portail client, la page de connexion, les fichiers
     * statiques et les images.
     */
    /*
     * `api` est exclu dans son ensemble : ces routes sont appelées par des
     * machines (tâches planifiées, sondes) et portent leur propre
     * authentification. Les y soumettre renvoyait une redirection 307 vers la
     * page de connexion, que le cron ne peut évidemment pas suivre.
     */
    "/((?!client-review|demande|login|api|politique-de-confidentialite|mentions-legales|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
