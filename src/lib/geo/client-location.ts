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
 * Ne lève jamais : la position est un agrément de la carte, pas une condition
 * d'enregistrement de la fiche. Renvoie `true` si une position a bien été
 * écrite — ce dont le rattrapage nocturne a besoin pour compter son travail.
 */
export async function syncClientLocation(
  supabase: SupabaseClient,
  clientId: string,
  city: string | null | undefined,
  postalCode: string | null | undefined,
  previous?: { city?: unknown; postalCode?: unknown; located: boolean },
): Promise<boolean> {
  const same = previous?.located === true
    && String(previous.city ?? "").trim().toLowerCase() === String(city ?? "").trim().toLowerCase()
    && String(previous.postalCode ?? "").trim() === String(postalCode ?? "").trim();
  if (same) return false;

  const found = await geocodeCommune(city, postalCode);
  if (!found) return false;

  const { error } = await supabase
    .from("clients")
    .update({
      latitude: found.latitude,
      longitude: found.longitude,
      geo_label: found.label,
      geo_updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (error) {
    console.error("[géocodage] position non enregistrée", clientId, error.message);
    return false;
  }
  return true;
}
