import "server-only";
import { headers } from "next/headers";
import { hashIp, userAgentFamily } from "@/lib/domain/tokens";
import { env } from "@/lib/supabase/env";

/**
 * Empreinte de l'appelant : jamais l'adresse IP en clair.
 *
 * L'IP est hachée avec un sel, et l'User-Agent réduit à une famille — assez
 * pour reconnaître un comportement, pas assez pour profiler quelqu'un (§19,
 * minimisation art. 5.1.c).
 */
export async function callerFingerprint(): Promise<{ ipHash: string; uaFamily: string | null }> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "inconnu";

  return {
    ipHash: hashIp(ip, env.ipHashSalt),
    uaFamily: userAgentFamily(headerList.get("user-agent")),
  };
}
