import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Point d'arrivée d'une invitation.
 *
 * Le lien envoyé par courrier porte un jeton à usage unique. On l'échange ici
 * contre une session, puis la personne choisit son mot de passe.
 *
 * Le jeton passe par l'adresse plutôt que par le fragment : un fragment n'est
 * jamais transmis au serveur, et cette application ouvre ses sessions côté
 * serveur. En contrepartie il apparaît dans l'adresse — d'où l'usage unique,
 * et la redirection immédiate qui l'efface de la barre d'adresse.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    return NextResponse.redirect(new URL("/login?erreur=invitation", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    // Lien déjà utilisé, ou périmé. On ne dit pas lequel : ce serait renseigner
    // sur l'existence du compte.
    return NextResponse.redirect(new URL("/login?erreur=invitation", request.url));
  }

  return NextResponse.redirect(new URL("/nouveau-mot-de-passe", request.url));
}
