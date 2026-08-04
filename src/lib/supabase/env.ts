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
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  /** Jamais exposée au navigateur : uniquement dans du code serveur. */
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Sel d'anonymisation des IP (§20). */
  get ipHashSalt() {
    return required("IP_HASH_SALT");
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  /** Durée de validité par défaut d'un lien client, en jours. */
  get reviewLinkTtlDays() {
    return Number.parseInt(process.env.REVIEW_LINK_TTL_DAYS ?? "21", 10);
  },
};
