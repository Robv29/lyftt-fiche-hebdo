"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { prepareCorrectionForClient, transitionTicket } from "@/lib/internal/actions";

export interface ProductionActionResult {
  ok: boolean;
  message?: string;
}

/*
 * Commandes de production internes.
 *
 * Les demandes entre collègues — « une vidéo pour Muratet avant vendredi » —
 * passaient par messages et se perdaient. Elles s'inscrivent ici avec leur
 * échéance et leur brief ; le graphiste ou vidéaste dépose le fichier attendu,
 * le demandeur valide.
 *
 * Le périmètre client est tenu par la RLS de `production_requests` : les
 * écritures passent donc par le client utilisateur, et non par la clé service,
 * pour que la base reste le dernier mot. Seul le stockage du fichier, qui n'a
 * pas de politique par ligne, emploie la clé service.
 */
async function requireProfile() {
  const profile = await getCurrentProfile();
  return profile ?? null;
}

const ACCESS_DENIED = "Action non autorisée.";

const createSchema = z.object({
  clientId: z.string().uuid("Choisissez le client concerné."),
  kind: z.enum(["video", "photo", "visuel"]),
  title: z.string().trim().min(3, "Décrivez la demande en quelques mots.").max(160, "Titre trop long (160 caractères maximum)."),
  brief: z.string().trim().max(2000, "Brief trop long (2000 caractères maximum).").optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date limite."),
  /*
   * Visuel d'exemple, déjà téléversé depuis le navigateur : on ne reçoit ici
   * que son identifiant. Le fichier ne transite pas par l'action, dont le corps
   * est plafonné — une photo de téléphone le dépasse sans peine.
   */
  referenceMediaId: z.string().uuid().optional(),
});

export async function createProductionRequest(formData: FormData): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = createSchema.safeParse({
    clientId: formData.get("clientId"),
    kind: formData.get("kind"),
    title: formData.get("title"),
    brief: formData.get("brief") ?? undefined,
    dueOn: formData.get("dueOn"),
    referenceMediaId: formData.get("referenceMediaId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("production_requests").insert({
    client_id: parsed.data.clientId,
    kind: parsed.data.kind,
    title: sanitizeText(parsed.data.title, 160),
    brief: parsed.data.brief ? sanitizeText(parsed.data.brief, 2000) : null,
    due_on: parsed.data.dueOn,
    requested_by: profile.id,
    /*
     * Le nom est recopié : la commande doit rester lisible même si la personne
     * quitte l'agence et que son profil est effacé.
     */
    requested_by_name: profile.full_name ?? null,
    reference_media_id: parsed.data.referenceMediaId ?? null,
  });

  if (error) return { ok: false, message: `Demande non enregistrée : ${error.message}` };

  revalidatePath("/production");
  return { ok: true, message: "Demande envoyée à la production." };
}

const KIND_EXPECTATIONS: Record<string, "image" | "video"> = {
  video: "video",
  photo: "image",
  visuel: "image",
};

/**
 * Livraison du fichier produit.
 *
 * C'est le geste central de l'écran : on dépose le fichier sur la commande, et
 * elle passe en « livrée ». Le type attendu découle de la demande — une commande
 * de vidéo n'accepte pas une image, sans quoi le demandeur validerait sans
 * regarder et découvrirait l'erreur devant le client.
 */
export async function deliverProductionRequest(formData: FormData): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const requestId = z.string().uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return { ok: false, message: "Commande invalide." };

  /*
   * Le fichier a déjà été envoyé au stockage depuis le navigateur : on ne
   * reçoit ici que son identifiant. Le faire transiter par l'action butait sur
   * le plafond du corps de requête — une vidéo de montage le dépasse toujours,
   * et la livraison échouait précisément quand elle comptait le plus.
   */
  const mediaAssetId = z.string().uuid().safeParse(formData.get("mediaAssetId"));
  if (!mediaAssetId.success) return { ok: false, message: "Déposez le fichier produit." };

  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase
    .from("production_requests")
    .select("id, client_id, kind, media_asset_id")
    .eq("id", requestId.data)
    .maybeSingle();
  if (!request) return { ok: false, message: "Commande introuvable ou accès refusé." };

  const expected = KIND_EXPECTATIONS[request.kind as string] ?? "image";
  const admin = createSupabaseAdminClient();
  const { data: asset } = await admin
    .from("media_assets")
    .select("id, kind, client_id")
    .eq("id", mediaAssetId.data)
    .maybeSingle();

  // Le média doit appartenir au client de la commande : un identifiant deviné
  // ne doit pas rattacher le fichier d'un autre client.
  if (!asset || asset.client_id !== request.client_id) {
    return { ok: false, message: "Fichier introuvable pour ce client." };
  }
  if (asset.kind !== expected) {
    return {
      ok: false,
      message: expected === "video"
        ? "Cette commande attend une vidéo."
        : "Cette commande attend une image.",
    };
  }

  const { error } = await supabase.from("production_requests").update({
    media_asset_id: asset.id,
    status: "livree",
    delivered_at: new Date().toISOString(),
  }).eq("id", request.id);

  if (error) return { ok: false, message: `Livraison non enregistrée : ${error.message}` };

  revalidatePath("/production");
  return { ok: true, message: "Fichier livré. Le demandeur peut valider." };
}

/** Validation par le demandeur : la commande est close. */
export async function validateProductionRequest(requestId: string): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return { ok: false, message: "Commande invalide." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("production_requests").update({
    status: "validee",
    validated_at: new Date().toISOString(),
  }).eq("id", parsed.data);

  if (error) return { ok: false, message: `Validation impossible : ${error.message}` };

  revalidatePath("/production");
  return { ok: true, message: "Commande validée." };
}

/**
 * Retour en production.
 *
 * Une livraison qui ne convient pas ne se supprime pas : la commande repart en
 * « à faire », le fichier déjà déposé reste attaché comme point de départ.
 */
export async function reopenProductionRequest(requestId: string): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return { ok: false, message: "Commande invalide." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("production_requests").update({
    status: "a_faire",
    delivered_at: null,
    validated_at: null,
  }).eq("id", parsed.data);

  if (error) return { ok: false, message: `Réouverture impossible : ${error.message}` };

  revalidatePath("/production");
  return { ok: true, message: "Commande renvoyée en production." };
}

/** Retrait d'une commande. Réservé à son demandeur et à l'encadrement. */
export async function deleteProductionRequest(requestId: string): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return { ok: false, message: "Commande invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase
    .from("production_requests")
    .select("id, requested_by")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!request) return { ok: false, message: "Commande introuvable ou accès refusé." };

  const isOwner = request.requested_by === profile.id;
  const isManager = ["super_admin", "production_manager"].includes(profile.role);
  if (!isOwner && !isManager) {
    return { ok: false, message: "Seul le demandeur peut retirer cette commande." };
  }

  const { error } = await supabase.from("production_requests").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: `Retrait impossible : ${error.message}` };

  revalidatePath("/production");
  return { ok: true, message: "Commande retirée." };
}

// ---------------------------------------------------------------------------
// Corrections demandées par le client
//
// La production n'a pas à rouvrir le ticket pour livrer : elle dépose le
// fichier, elle valide, et la correction part au contrôle du community
// manager. Le texte de la publication, les hashtags et la date restent à
// l'écran éditorial — ici, seul le fichier compte.
// ---------------------------------------------------------------------------

/** Nature du fichier attendu, déduite de la famille du ticket. */
function expectedKindForCategory(category: string): "image" | "video" {
  return category === "video" ? "video" : "image";
}

export async function deliverTicketMedia(formData: FormData): Promise<ProductionActionResult> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const ticketId = z.string().uuid().safeParse(formData.get("ticketId"));
  if (!ticketId.success) return { ok: false, message: "Ticket invalide." };

  const mediaAssetId = z.string().uuid().safeParse(formData.get("mediaAssetId"));
  if (!mediaAssetId.success) return { ok: false, message: "Déposez le fichier corrigé." };

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("client_tickets")
    .select("id, status, category, client_id, weekly_sheet_id, weekly_sheet_item_id")
    .eq("id", ticketId.data)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "Ticket introuvable ou accès refusé." };

  const expected = expectedKindForCategory(ticket.category as string);

  if (!ticket.weekly_sheet_item_id) {
    return {
      ok: false,
      message: "Cette demande ne porte pas sur une publication précise : traitez-la depuis le ticket.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: item } = await admin
    .from("weekly_sheet_items")
    .select("id, media_asset_id")
    .eq("id", ticket.weekly_sheet_item_id)
    .maybeSingle();

  /*
   * Le fichier est déjà au stockage : envoyé depuis le navigateur, il ne passe
   * pas par le corps de l'action, plafonné bien en dessous d'une vidéo.
   */
  const { data: asset } = await admin
    .from("media_assets")
    .select("id, kind, client_id")
    .eq("id", mediaAssetId.data)
    .maybeSingle();
  if (!asset || asset.client_id !== ticket.client_id) {
    return { ok: false, message: "Fichier introuvable pour ce client." };
  }
  if (asset.kind !== expected) {
    return {
      ok: false,
      message: expected === "video"
        ? "Cette correction attend une vidéo."
        : "Cette correction attend une image.",
    };
  }

  /*
   * Le fichier remplacé n'est pas effacé : il reste chaîné par
   * `replaces_media_id`, ce qui permet de remonter aux versions précédentes
   * d'une publication corrigée plusieurs fois.
   */
  if (item?.media_asset_id) {
    await admin.from("media_assets")
      .update({ replaces_media_id: item.media_asset_id })
      .eq("id", asset.id);
  }

  const { error } = await admin
    .from("weekly_sheet_items")
    .update({ media_asset_id: asset.id, media_external_url: null })
    .eq("id", ticket.weekly_sheet_item_id);
  if (error) return { ok: false, message: `Correction non enregistrée : ${error.message}` };

  /*
   * Sur un carrousel, la couverture est la première image de la série : c'est
   * elle que remplace le fichier déposé. Les autres images restent en place —
   * on ne devine pas laquelle le client visait.
   */
  const { data: gallery } = await admin
    .from("weekly_sheet_item_media")
    .select("id, position")
    .eq("weekly_sheet_item_id", ticket.weekly_sheet_item_id)
    .order("position", { ascending: true });
  const cover = (gallery ?? [])[0];
  if (cover) {
    await admin
      .from("weekly_sheet_item_media")
      .update({ media_asset_id: asset.id })
      .eq("id", cover.id as string);
  }

  // Un ticket seulement affecté passe en cours dès le premier dépôt.
  if (ticket.status === "assigned") {
    const transition = new FormData();
    transition.set("ticketId", ticketId.data);
    transition.set("nextStatus", "in_progress");
    await transitionTicket(transition);
  }

  revalidatePath("/production");
  revalidatePath(`/retours/${ticketId.data}`);
  return {
    ok: true,
    message: cover
      ? "Fichier déposé : il remplace l'image de couverture."
      : "Fichier déposé.",
  };
}

/** La production rend sa copie : la correction part au contrôle interne. */
export async function submitTicketForReview(ticketId: string): Promise<ProductionActionResult> {
  const parsed = z.string().uuid().safeParse(ticketId);
  if (!parsed.success) return { ok: false, message: "Ticket invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("client_tickets")
    .select("id, status")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "Ticket introuvable ou accès refusé." };

  /*
   * Un ticket seulement affecté passe d'abord en cours : la machine à états
   * n'admet pas de saut, et l'on ne va pas demander deux clics pour dire la
   * même chose — la correction est faite, elle part au contrôle.
   */
  if (ticket.status === "assigned") {
    const start = new FormData();
    start.set("ticketId", parsed.data);
    start.set("nextStatus", "in_progress");
    const started = await transitionTicket(start);
    if (!started.ok) return { ok: false, message: started.message };
  }

  const transition = new FormData();
  transition.set("ticketId", parsed.data);
  transition.set("nextStatus", "ready_for_review");
  const result = await transitionTicket(transition);

  revalidatePath("/production");
  return result.ok
    ? { ok: true, message: "Correction envoyée au contrôle." }
    : { ok: false, message: result.message };
}

/**
 * Contrôle interne validé : la version corrigée part au client.
 *
 * C'est le bout de la chaîne demandé — déposer, valider, obtenir le lien. La
 * validation enchaîne d'un geste ce qui demandait trois écrans : le contrôle
 * interne, la génération de la version corrigée, et le lien de validation de
 * la fiche, accompagné de son message prêt à coller.
 *
 * Le lien produit est celui de la fiche : le client rouvre le tableau qu'il
 * connaît et y retrouve la publication corrigée à sa place. Multiplier les
 * liens à usage unique lui ferait chercher lequel ouvrir.
 */
export async function validateTicketCorrection(
  ticketId: string,
): Promise<ProductionActionResult & { reviewUrl?: string; messageBody?: string; whatsappUrl?: string }> {
  const profile = await requireProfile();
  if (!profile) return { ok: false, message: ACCESS_DENIED };
  if (!["super_admin", "production_manager", "community_manager"].includes(profile.role)) {
    return { ok: false, message: "Seul le community manager valide le contrôle interne." };
  }

  const parsed = z.string().uuid().safeParse(ticketId);
  if (!parsed.success) return { ok: false, message: "Ticket invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("client_tickets")
    .select("id, status, weekly_sheet_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "Ticket introuvable ou accès refusé." };

  const transition = new FormData();
  transition.set("ticketId", parsed.data);
  transition.set("nextStatus", "internally_reviewed");
  const reviewed = await transitionTicket(transition);
  if (!reviewed.ok) return { ok: false, message: reviewed.message };

  /*
   * Le texte et les hashtags ne sont pas touchés ici : ils ont été arrêtés à
   * l'écran éditorial. Seule la version est datée — son libellé se déduit du
   * ticket — puis le lien est préparé.
   */
  const correction = new FormData();
  correction.set("ticketId", parsed.data);
  correction.set("sheetId", ticket.weekly_sheet_id as string);
  correction.set("itemId", "");
  correction.set("caption", "");
  correction.set("hashtags", "");
  const prepared = await prepareCorrectionForClient(correction);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  revalidatePath("/production");
  revalidatePath("/retours");
  return {
    ok: true,
    message: "Correction validée. Le lien client est prêt.",
    reviewUrl: prepared.reviewUrl,
    messageBody: prepared.messageBody,
    whatsappUrl: prepared.whatsappUrl,
  };
}
