import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Contrôle d'accès des tâches planifiées.
 *
 * Vercel appelle chaque tâche avec `Authorization: Bearer <CRON_SECRET>`. Le
 * contrôle vit ici, une seule fois : deux copies d'une barrière de sécurité
 * finissent par diverger, et c'est l'oubliée qui laisse passer.
 *
 * Renvoie la réponse de refus, ou `null` quand l'appel est autorisé.
 */
export function cronAuthorizationError(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  }

  // Un en-tête HTTP n'accepte que de l'ASCII visible. Un secret contenant un
  // accent ou une espace insécable ne pourra jamais être transmis : la tâche
  // échouerait silencieusement à chaque exécution. Mieux vaut le dire.
  if (!/^[\x21-\x7E]+$/.test(secret)) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET contient des caractères invalides pour un en-tête HTTP. " +
          "N'utilisez que des lettres non accentuées, des chiffres et des symboles simples.",
      },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  return null;
}
