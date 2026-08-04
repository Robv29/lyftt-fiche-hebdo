/**
 * Normalisation de l'URL Supabase.
 *
 * Les valeurs saisies dans une interface de déploiement arrivent souvent
 * imparfaites : schéma oublié, guillemets copiés avec la valeur, espace ou
 * retour à la ligne en fin de champ. `createServerClient` lève alors une
 * exception — et dans un middleware, cela fait échouer toutes les routes.
 *
 * On répare ce qui est réparable sans ambiguïté plutôt que de tomber en panne.
 * Ce module ne contient que des opérations sur chaînes : il est utilisable
 * aussi bien côté Node que dans le runtime Edge.
 */

export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;

  // Retire espaces, retours à la ligne, et guillemets éventuellement collés.
  let value = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (value === "") return null;

  // Schéma absent : le seul cas ambigu serait un choix entre http et https,
  // or Supabase ne sert qu'en https.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = `https://${value}`;
  }

  // Une barre oblique finale casse la concaténation des chemins d'API.
  value = value.replace(/\/+$/, "");

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Les clés arrivent parfois avec des guillemets ou un retour à la ligne. */
export function normalizeKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^["']|["']$/g, "").trim();
  return value === "" ? null : value;
}
