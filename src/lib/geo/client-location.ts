import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeCommune } from "./geocode";

/**
 * Tient à jour la position d'un client sur la carte des implantations.
 *
 * Appelée à la création et à la modification d'une fiche, par une seule
 * fonction pour les deux : c'est en corrigeant le calcul d'un seul côté qu'on
 * fabrique des écarts durables entre un client créé et un client modifié.
 *
 * Ne fait rien quand la commune n'a pas bougé et qu'une position existe déjà —
 * inutile d'appeler un service public à chaque changement d'horaire de
 * validation.
 *
 * Ne renvoie rien et ne lève jamais : la position est un agrément de la carte,
 * pas une condition d'enregistrement de la fiche.
 */
export async function syncClientLocation(
  supabase: SupabaseClient,
  clientId: string,
  city: string | null | undefined,
  postalCode: string | null | undefined,
  previous?: { city?: unknown; postalCode?: unknown; located: boolean },
): Promise<void> {
  const same = previous?.located === true
    && String(previous.city ?? "").trim().toLowerCase() === String(city ?? "").trim().toLowerCase()
    && String(previous.postalCode ?? "").trim() === String(postalCode ?? "").trim();
  if (same) return;

  const found = await geocodeCommune(city, postalCode);
  if (!found) return;

  const { error } = await supabase
    .from("clients")
    .update({
      latitude: found.latitude,
      longitude: found.longitude,
      geo_label: found.label,
      geo_updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (error) console.error("[géocodage] position non enregistrée", clientId, error.message);
}
