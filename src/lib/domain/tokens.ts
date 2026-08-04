import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * §19 — Tokens des liens de consultation.
 *
 * Le token brut n'existe qu'une fois : il est affiché au community manager au
 * moment de la génération, puis seul son SHA-256 est conservé. Une fuite de la
 * base ne permet donc pas de reconstituer les liens.
 */

/** 32 octets = 256 bits d'entropie, encodés en base64url (43 caractères). */
const TOKEN_BYTES = 32;

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedToken {
  /** À transmettre au client, jamais stocké. */
  token: string;
  /** À stocker. */
  tokenHash: string;
  /** Repère lisible pour l'équipe, non secret. */
  tokenPrefix: string;
}

export function generateReviewToken(): GeneratedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, 8),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rejette les formats invalides avant toute requête : pas de scan de la base. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Comparaison à temps constant, pour les cas où deux hashs sont comparés en mémoire. */
export function safeCompareHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export type LinkRejectionReason =
  | "malformed"
  | "not_found"
  | "revoked"
  | "expired";

export interface LinkValidation {
  valid: boolean;
  reason?: LinkRejectionReason;
}

export interface ReviewLinkState {
  revokedAt: Date | null;
  expiresAt: Date;
}

export function validateLinkState(
  link: ReviewLinkState | null,
  now: Date = new Date(),
): LinkValidation {
  if (!link) return { valid: false, reason: "not_found" };
  if (link.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (link.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

/**
 * Empreinte d'IP salée et tronquée (§20) : suffisante pour détecter un abus,
 * insuffisante pour réidentifier une personne.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

/** Famille de navigateur, plutôt que l'User-Agent complet (§20). */
export function userAgentFamily(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes("whatsapp")) return "WhatsApp";
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome") && !ua.includes("chromium")) return "Chrome";
  if (ua.includes("firefox")) return "Firefox";
  if (ua.includes("safari")) return "Safari";
  return "Autre";
}
