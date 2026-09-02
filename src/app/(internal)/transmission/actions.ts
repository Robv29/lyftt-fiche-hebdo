"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireEditorialProfile } from "@/lib/internal/authorization";
import { parisDateTimeToIso } from "@/lib/domain/crm-transmission";

/*
 * Gestes du chef de projet sur une fiche transmise par le CRM.
 *
 * Les écritures passent par le client soumis à RLS, et non par la clé service :
 * la politique `client_transmissions_write` reste ainsi le dernier mot, et
 * l'ajout d'un rôle en base n'a pas à être répercuté ici.
 */

export interface TransmissionActionResult {
  ok: boolean;
  message?: string;
}

const ACCESS_DENIED = "Action non autorisée.";
const NOT_FOUND = "Fiche introuvable ou accès refusé.";

const rendezVousSchema = z.object({
  transmissionId: z.string().uuid("Fiche invalide."),
  /*
   * Valeur d'un `<input type="datetime-local">` : une heure sans fuseau. Elle
   * est lue comme une heure de Paris — la seule que le chef de projet ait en
   * tête quand il recopie un créneau.
   */
  dateRdv: z.string().trim().min(1, "Indiquez la date et l’heure du rendez-vous."),
});

export async function setTransmissionRendezVous(formData: FormData): Promise<TransmissionActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = rendezVousSchema.safeParse({
    transmissionId: formData.get("transmissionId"),
    dateRdv: formData.get("dateRdv"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const iso = parisDateTimeToIso(parsed.data.dateRdv);
  if (!iso) return { ok: false, message: "Date de rendez-vous invalide." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_transmissions")
    .update({ date_rdv: iso })
    .eq("id", parsed.data.transmissionId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: `Rendez-vous non enregistré : ${error.message}` };
  if (!data) return { ok: false, message: NOT_FOUND };

  revalidatePath("/transmission");
  return { ok: true, message: "Rendez-vous enregistré." };
}

/**
 * Passe la fiche en « traitée ».
 *
 * Rien n'est supprimé : la fiche reste consultable dans sa section, avec le
 * menu composé par le client. C'est souvent le seul endroit où cette commande
 * est écrite noir sur blanc.
 */
export async function setTransmissionStatut(
  transmissionId: string,
  statut: "a_traiter" | "traite",
): Promise<TransmissionActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const id = z.string().uuid().safeParse(transmissionId);
  if (!id.success) return { ok: false, message: "Fiche invalide." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_transmissions")
    .update({ statut })
    .eq("id", id.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: `Statut non modifié : ${error.message}` };
  if (!data) return { ok: false, message: NOT_FOUND };

  revalidatePath("/transmission");
  return {
    ok: true,
    message: statut === "traite" ? "Fiche marquée comme traitée." : "Fiche remise à traiter.",
  };
}
