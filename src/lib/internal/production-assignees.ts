import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assigneeLabels } from "@/lib/domain/production-requests";

export interface ProductionAssignee {
  id: string;
  fullName: string;
  /** Prénom affiché dans les menus : « Sinclair », « Simon ». */
  label: string;
}

/**
 * Personnes à qui confier une commande de production.
 *
 * Lues par la fonction SQL `production_assignees()`, au nom de l'utilisateur
 * connecté : la liste ne dépend pas de ce que son rôle lui permet de lire dans
 * `profiles`, et l'écran comme l'action serveur appliquent la même règle — un
 * nouvel arrivant en production y apparaît sans rien changer ici.
 */
export async function loadProductionAssignees(): Promise<{ assignees: ProductionAssignee[]; error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("production_assignees");
  if (error) return { assignees: [], error: error.message };

  const people = ((data ?? []) as { id: string; full_name: string }[])
    .map((row) => ({ id: row.id, fullName: row.full_name }));
  const labels = assigneeLabels(people);
  return {
    assignees: people.map((person) => ({ ...person, label: labels.get(person.id) ?? person.fullName })),
    error: null,
  };
}
