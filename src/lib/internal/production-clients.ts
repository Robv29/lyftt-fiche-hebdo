import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Noms des clients qui ont une commande de production.
 *
 * Depuis que chacun voit le plan de charge de tous, les commandes d'un client
 * hors périmètre reviennent sans leur nom : `clients_select` n'a pas bougé, et
 * ne bougera pas — la fiche client porte la formule vendue, les dates de
 * contrat et les coordonnées, qui n'ont rien à faire dans une file de
 * production.
 *
 * La fonction SQL `production_request_clients()` ne rend donc que
 * l'identifiant et le nom, et seulement pour les clients qui ont au moins une
 * commande. C'est le strict nécessaire pour nommer une ligne et la filtrer.
 */
export async function loadProductionRequestClients(): Promise<{
  names: Map<string, string>;
  error: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("production_request_clients");
  if (error) return { names: new Map(), error: error.message };

  return {
    names: new Map(((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name])),
    error: null,
  };
}
