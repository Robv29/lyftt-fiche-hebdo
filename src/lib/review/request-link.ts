import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Lien permanent de demande, propre à un client.
 *
 * Distinct du lien de validation : celui-ci ne porte sur aucune fiche, ne se
 * périme pas, et sert à toutes les demandes du client. On peut donc le lui
 * donner une fois pour toutes — dans un contact, sur un devis, en signature.
 */
export interface RequestLinkContext {
  clientId: string;
  clientName: string;
}

/** Jeton d'URL, assez long pour n'être pas devinable. */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Le lien du client, créé au premier besoin.
 *
 * Réutilisé ensuite tel quel : en émettre un nouveau à chaque clic ferait
 * mourir celui que le client a déjà enregistré.
 */
export async function ensureRequestLink(
  clientId: string,
  createdBy: string,
): Promise<{ token: string } | { error: string }> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("client_request_links")
    .select("token, revoked_at")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing && !existing.revoked_at) return { token: existing.token as string };

  const token = generateToken();
  const { error } = await admin.from("client_request_links").upsert({
    client_id: clientId,
    token,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    revoked_at: null,
  });
  if (error) return { error: error.message };
  return { token };
}

/** Client derrière un jeton, ou rien si le lien est inconnu ou révoqué. */
export async function resolveRequestLink(token: string): Promise<RequestLinkContext | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("client_request_links")
    .select("client_id, revoked_at, use_count, clients ( name, is_active )")
    .eq("token", token)
    .maybeSingle();

  if (!data || data.revoked_at) return null;
  const client = data.clients as unknown as { name: string; is_active: boolean } | null;
  if (!client?.is_active) return null;

  // Trace d'usage, utile pour savoir si le lien vit vraiment.
  await admin.from("client_request_links").update({
    last_used_at: new Date().toISOString(),
    use_count: (data.use_count as number) + 1,
  }).eq("token", token);

  return { clientId: data.client_id as string, clientName: client.name };
}
