import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Rafraîchit la session Supabase et protège les écrans internes.
 *
 * Le portail client (`/client-review/...`) est volontairement exclu : il est
 * public et son contrôle d'accès repose sur le token, pas sur une session.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Ces deux variables sont figées au build. Si elles manquaient à ce
  // moment-là, elles valent `undefined` ici et `createServerClient` lève une
  // exception — ce qui, dans un middleware, fait échouer *toutes* les routes
  // avec un 500 opaque. On préfère un message explicite.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse(
      "Configuration incomplète.\n\n" +
        "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être " +
        "définies dans les variables d'environnement, puis l'application " +
        "redéployée : ces valeurs sont intégrées au moment du build.\n",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
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
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Tout sauf : le portail client, la page de connexion, les fichiers
     * statiques et les images.
     */
    "/((?!client-review|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
