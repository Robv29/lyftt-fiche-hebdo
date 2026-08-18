import { normalizeKey, normalizeSupabaseUrl } from "./url";

/** Lecture centralisée de la configuration : une variable manquante échoue au démarrage. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Voir .env.example.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    const url = normalizeSupabaseUrl(required("NEXT_PUBLIC_SUPABASE_URL"));
    if (!url) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL n'est pas exploitable. Forme attendue : " +
          "https://votre-projet.supabase.co",
      );
    }
    return url;
  },
  get supabaseAnonKey() {
    return normalizeKey(required("NEXT_PUBLIC_SUPABASE_ANON_KEY"))!;
  },
  /** Jamais exposée au navigateur : uniquement dans du code serveur. */
  get supabaseServiceRoleKey() {
    return normalizeKey(required("SUPABASE_SERVICE_ROLE_KEY"))!;
  },
  /** Sel d'anonymisation des IP (§20). */
  get ipHashSalt() {
    return required("IP_HASH_SALT");
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  /**
   * Durée de validité d'un lien client, en jours.
   *
   * Plancher à 7 jours : un lien envoyé au client doit rester ouvrable une
   * semaine entière, quelle que soit la configuration du déploiement.
   */
  get reviewLinkTtlDays() {
    const configured = Number.parseInt(process.env.REVIEW_LINK_TTL_DAYS ?? "21", 10);
    return Number.isFinite(configured) ? Math.max(configured, 7) : 21;
  },
};
