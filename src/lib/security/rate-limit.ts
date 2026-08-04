/**
 * §19 — Limitation des tentatives sur le portail client.
 *
 * Implémentation en mémoire, suffisante pour un déploiement mono-instance.
 * Sur plusieurs instances, remplacer le magasin par Redis en gardant la même
 * interface `RateLimitStore`.
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
  consume(key: string, rule: RateLimitRule, now: number): RateLimitResult;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  consume(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
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

const globalStore = new MemoryRateLimitStore();

export function rateLimit(
  name: RateLimitName,
  identifier: string,
  store: RateLimitStore = globalStore,
  now: number = Date.now(),
): RateLimitResult {
  return store.consume(`${name}:${identifier}`, RATE_LIMITS[name], now);
}

export function resetRateLimits(): void {
  globalStore.reset();
}
