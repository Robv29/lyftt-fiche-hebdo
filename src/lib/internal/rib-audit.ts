import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { callerFingerprint } from "@/lib/security/caller";

export type RibEventType = "viewed" | "uploaded" | "replaced" | "removed" | "purged";

/**
 * Journalisation des accès aux coordonnées bancaires.
 *
 * Le RIB est la donnée la plus sensible de l'application : sa consultation ne
 * laissait aucune trace, ce qui rendait impossible de répondre à « qui y a
 * accédé, et quand » — question que posent aussi bien une enquête interne
 * qu'une notification de violation (art. 33).
 *
 * Le nom de l'auteur est recopié dans l'événement : un compte supprimé met
 * `profile_id` à nul, et un journal qui ne nomme plus personne ne vaut rien.
 *
 * L'écriture est faite au mieux : si le journal échoue, l'action de l'agence
 * n'est pas interrompue. Bloquer l'affichage d'une fiche budget parce qu'une
 * ligne de journal n'a pas pu s'écrire serait disproportionné — mais l'échec
 * est tracé dans les journaux de la plateforme, pour qu'il ne passe pas
 * inaperçu.
 */
export async function logRibAccess(params: {
  clientId: string;
  eventType: RibEventType;
  profile?: { id: string; full_name?: string | null } | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { clientId, eventType, profile, metadata = {} } = params;

  // Hors contexte de requête — une tâche planifiée, par exemple — il n'y a pas
  // d'en-têtes à lire : l'événement est consigné sans empreinte.
  let ipHash: string | null = null;
  let uaFamily: string | null = null;
  try {
    const fingerprint = await callerFingerprint();
    ipHash = fingerprint.ipHash;
    uaFamily = fingerprint.uaFamily;
  } catch {
    // sans objet : l'événement reste utile sans empreinte
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("client_rib_events").insert({
      client_id: clientId,
      profile_id: profile?.id ?? null,
      profile_label: profile?.full_name ?? (profile ? null : "Tâche automatique"),
      event_type: eventType,
      metadata,
      ip_hash: ipHash,
      user_agent_family: uaFamily,
    });
    if (error) {
      console.error("[rib-audit] événement non consigné", eventType, clientId, error.message);
    }
  } catch (error) {
    console.error("[rib-audit] journal indisponible", eventType, clientId, error);
  }
}
