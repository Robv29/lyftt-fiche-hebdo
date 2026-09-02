"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireEditorialProfile } from "@/lib/internal/authorization";
import {
  formatParisDateTime,
  menuAffiche,
  parisDateTimeToIso,
} from "@/lib/domain/crm-transmission";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/resend";
import {
  buildRecapHtml,
  buildRecapSubject,
  buildRecapText,
} from "@/lib/notifications/transmission-recap";
import { sanitizeText } from "@/lib/security/sanitize";

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

/** Même plafond que la route CRM : un menu tronqué ici serait un menu faux. */
const MENU_MAX = 20_000;

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

/* ---------------------------------------------------------------------------
 * Étape 1 — relecture du menu
 * ------------------------------------------------------------------------- */

const idSchema = z.string().uuid("Fiche invalide.");

/**
 * Marque le menu comme relu, sans y toucher.
 *
 * Le cas de loin le plus fréquent : le commercial a bien saisi, il n'y a rien
 * à corriger. Obliger à passer par la zone de texte pour valider ferait courir
 * le risque inverse — une correction involontaire à chaque relecture.
 */
export async function validerTransmissionMenu(
  transmissionId: string,
): Promise<TransmissionActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const id = idSchema.safeParse(transmissionId);
  if (!id.success) return { ok: false, message: id.error.issues[0]?.message ?? "Fiche invalide." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_transmissions")
    .update({ menu_valide_le: new Date().toISOString(), menu_valide_par: profile.id })
    .eq("id", id.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: `Menu non validé : ${error.message}` };
  if (!data) return { ok: false, message: NOT_FOUND };

  revalidatePath("/transmission");
  return { ok: true, message: "Menu relu et validé." };
}

const menuSchema = z.object({
  transmissionId: idSchema,
  menu: z.string().max(MENU_MAX, "Le menu dépasse la taille acceptée."),
});

/**
 * Enregistre la correction du menu, et la vaut pour relecture.
 *
 * La correction va dans `menu_corrige` et jamais dans `fiche_mission` : le CRM
 * renvoie la fiche à chaque modification du dossier commercial, et l'upsert de
 * /api/crm/transmission réécrit `fiche_mission`. Une correction rangée là
 * disparaîtrait à la première retouche de numéro de téléphone — sans que
 * personne ne le remarque, puisque le menu réapparaîtrait plausible.
 */
export async function corrigerTransmissionMenu(
  formData: FormData,
): Promise<TransmissionActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = menuSchema.safeParse({
    transmissionId: formData.get("transmissionId"),
    menu: formData.get("menu"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: fiche, error: lectureError } = await supabase
    .from("client_transmissions")
    .select("id, fiche_mission")
    .eq("id", parsed.data.transmissionId)
    .maybeSingle();

  if (lectureError) return { ok: false, message: `Menu non enregistré : ${lectureError.message}` };
  if (!fiche) return { ok: false, message: NOT_FOUND };

  const corrige = sanitizeText(parsed.data.menu, MENU_MAX);

  /*
   * Un texte redevenu identique à celui du CRM efface la correction plutôt que
   * de la figer : c'est ce qui permet de « reprendre le menu du CRM » et de
   * laisser à nouveau passer ses mises à jour. Sans cela, une correction
   * annulée à la main gèlerait la fiche pour toujours.
   */
  const identiqueAuCrm = corrige === sanitizeText(fiche.fiche_mission ?? "", MENU_MAX);
  const menuCorrige = corrige.length === 0 || identiqueAuCrm ? null : corrige;

  const { data, error } = await supabase
    .from("client_transmissions")
    .update({
      menu_corrige: menuCorrige,
      menu_valide_le: new Date().toISOString(),
      menu_valide_par: profile.id,
    })
    .eq("id", parsed.data.transmissionId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: `Menu non enregistré : ${error.message}` };
  if (!data) return { ok: false, message: NOT_FOUND };

  revalidatePath("/transmission");
  return {
    ok: true,
    message: menuCorrige ? "Menu corrigé et validé." : "Menu du CRM repris et validé.",
  };
}

/* ---------------------------------------------------------------------------
 * Étape 2 — envoi du récapitulatif au client
 * ------------------------------------------------------------------------- */

/**
 * Envoie au client le récapitulatif de son accompagnement, puis date l'envoi.
 *
 * Contrairement aux alertes internes, où un e-mail perdu n'empêche pas le
 * geste métier, ici l'e-mail *est* le geste : un échec ne doit surtout pas
 * être daté, sinon la carte affirmerait un envoi qui n'a jamais eu lieu. Rien
 * n'est donc écrit tant que Resend n'a pas accepté le message.
 *
 * L'envoi reste possible sans validation du menu à l'étape 1 : un menu déjà
 * juste n'a pas besoin d'être corrigé. L'écran le signale, il ne l'interdit
 * pas.
 */
export async function envoyerTransmissionRecap(
  transmissionId: string,
): Promise<TransmissionActionResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const id = idSchema.safeParse(transmissionId);
  if (!id.success) return { ok: false, message: id.error.issues[0]?.message ?? "Fiche invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: fiche, error: lectureError } = await supabase
    .from("client_transmissions")
    .select("id, entreprise, contact_prenom, email, fiche_mission, menu_corrige, date_rdv")
    .eq("id", id.data)
    .maybeSingle();

  if (lectureError) return { ok: false, message: `Envoi impossible : ${lectureError.message}` };
  if (!fiche) return { ok: false, message: NOT_FOUND };

  const destinataire = (fiche.email ?? "").trim().toLowerCase();
  if (!destinataire.includes("@")) {
    return {
      ok: false,
      message: "Aucune adresse e-mail sur cette fiche : complétez le contact dans le CRM.",
    };
  }

  if (!isEmailConfigured()) {
    return {
      ok: false,
      message: "Messagerie non configurée (RESEND_API_KEY et MAIL_FROM). Le récapitulatif n’a pas été envoyé.",
    };
  }

  const recap = {
    entreprise: fiche.entreprise,
    contactPrenom: fiche.contact_prenom,
    menu: menuAffiche({
      ficheMission: fiche.fiche_mission,
      menuCorrige: fiche.menu_corrige,
    }).texte,
    rendezVousLabel: fiche.date_rdv ? formatParisDateTime(fiche.date_rdv) : null,
    chefDeProjet: profile.full_name,
  };

  const outcome = await sendEmail({
    to: [destinataire],
    subject: buildRecapSubject(recap),
    html: buildRecapHtml(recap),
    text: buildRecapText(recap),
    // Le client répond au chef de projet, pas à une boîte technique : c'est
    // souvent par ce fil que remonte la première correction de menu.
    replyTo: profile.email,
  });

  if (!outcome.sent) {
    return {
      ok: false,
      message: `Le récapitulatif n’est pas parti (${outcome.reason}${outcome.detail ? ` : ${outcome.detail}` : ""}).`,
    };
  }

  const { data, error } = await supabase
    .from("client_transmissions")
    .update({
      recap_envoye_le: new Date().toISOString(),
      recap_envoye_par: profile.id,
      recap_envoye_a: destinataire,
    })
    .eq("id", id.data)
    .select("id")
    .maybeSingle();

  /*
   * Le message est parti : le signaler prime sur l'échec d'écriture, qui ne
   * ferait qu'oublier la date. Laisser croire à un envoi raté ferait renvoyer
   * un second e-mail au client.
   */
  if (error || !data) {
    console.error("[transmission] envoi non daté", id.data, error?.message);
    return {
      ok: true,
      message: `Récapitulatif envoyé à ${destinataire}, mais la date n’a pas pu être enregistrée.`,
    };
  }

  revalidatePath("/transmission");
  return { ok: true, message: `Récapitulatif envoyé à ${destinataire}.` };
}

/* ---------------------------------------------------------------------------
 * Suivi de la fiche
 * ------------------------------------------------------------------------- */

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
