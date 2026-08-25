/**
 * §19 — Limitation des tentatives sur le portail client.
 *
 * Le compteur vit en base (`consume_rate_limit`), et non dans la mémoire du
 * processus : sur Vercel chaque fonction serverless est une instance distincte,
 * recyclée sans préavis, si bien qu'un compteur en mémoire est cloisonné par
 * instance et repart de zéro à froid — la limite annoncée n'était alors qu'une
 * limite *par instance* (H-03).
 *
 * `MemoryRateLimitStore` reste l'implémentation de repli : tests unitaires et
 * développement sans clé service-role.
 */

export interface RateLimitRule {
  /** Nombre d'actions autorisées sur la fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Ouverture d'un lien : protège contre le balayage de tokens. */
  linkAccess: { limit: 30, windowMs: 60_000 },
  /** Tentatives sur un token invalide, par IP. */
  invalidToken: { limit: 10, windowMs: 10 * 60_000 },
  /** Création de tickets, par lien. */
  ticketCreation: { limit: 20, windowMs: 60 * 60_000 },
  /** Validation de contenus, par lien. */
  approval: { limit: 60, windowMs: 60 * 60_000 },
  /** Dépôt de pièces jointes, par lien. */
  attachment: { limit: 15, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Instant auquel la fenêtre se réinitialise. */
  resetAt: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  consume(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  async consume(key: string, rule: RateLimitRule, now: number = Date.now()): Promise<RateLimitResult> {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: rule.limit - 1, resetAt, retryAfterSeconds: 0 };
    }

    if (bucket.count >= rule.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: rule.limit - bucket.count,
      resetAt: bucket.resetAt,
      retryAfterSeconds: 0,
    };
  }

  /** Purge périodique : évite que la table grossisse indéfiniment. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }
}

type RpcRow = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
  retry_after_seconds: number;
};

/**
 * Compteur partagé, porté par `public.consume_rate_limit`.
 *
 * L'atomicité est garantie côté base par `insert … on conflict do update`,
 * qui s'exécute sous verrou de ligne : deux instances concurrentes ne peuvent
 * pas s'écraser mutuellement.
 */
export class SupabaseRateLimitStore implements RateLimitStore {
  constructor(private readonly createClient: () => { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }) {}

  async consume(key: string, rule: RateLimitRule, now: number = Date.now()): Promise<RateLimitResult> {
    const { data, error } = await this.createClient().rpc("consume_rate_limit", {
      p_key: key,
      p_limit: rule.limit,
      p_window_ms: rule.windowMs,
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      /*
       * Repli passant, et non bloquant : sans base, l'application ne peut de
       * toute façon ni résoudre un lien ni lire une fiche — il n'y a plus rien
       * à protéger, alors qu'un repli bloquant fermerait le portail aux
       * clients légitimes le temps de l'incident. L'erreur est journalisée
       * pour que la panne reste visible.
       */
      console.error("[rate-limit] compteur partagé indisponible, repli passant", error);
      return { allowed: true, remaining: rule.limit, resetAt: now + rule.windowMs, retryAfterSeconds: 0 };
    }

    const row = data[0] as RpcRow;
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      resetAt: new Date(row.reset_at).getTime(),
      retryAfterSeconds: row.retry_after_seconds,
    };
  }
}

const memoryStore = new MemoryRateLimitStore();
let defaultStore: RateLimitStore | null = null;

/*
 * `@/lib/supabase/admin` est marqué `server-only` : il est chargé
 * dynamiquement, pour que ce module reste importable par les tests unitaires.
 */
async function resolveStore(): Promise<RateLimitStore> {
  if (defaultStore) return defaultStore;

  if (process.env.NODE_ENV === "test" || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    defaultStore = memoryStore;
    return defaultStore;
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  defaultStore = new SupabaseRateLimitStore(createSupabaseAdminClient);
  return defaultStore;
}

export async function rateLimit(
  name: RateLimitName,
  identifier: string,
  store?: RateLimitStore,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const resolved = store ?? (await resolveStore());
  return resolved.consume(`${name}:${identifier}`, RATE_LIMITS[name], now);
}

export function resetRateLimits(): void {
  memoryStore.reset();
  defaultStore = null;
}
