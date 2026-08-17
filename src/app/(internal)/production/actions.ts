"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { checkAttachment, safeFileName } from "@/lib/security/attachments";

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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Déposez le fichier produit." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase
    .from("production_requests")
    .select("id, client_id, kind, media_asset_id")
    .eq("id", requestId.data)
    .maybeSingle();
  if (!request) return { ok: false, message: "Commande introuvable ou accès refusé." };

  const expected = KIND_EXPECTATIONS[request.kind as string] ?? "image";
  if (!file.type.startsWith(`${expected}/`)) {
    return {
      ok: false,
      message: expected === "video"
        ? "Cette commande attend une vidéo."
        : "Cette commande attend une image.",
    };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const check = checkAttachment({ size: file.size, type: file.type, name: file.name }, head);
  if (!check.valid) return { ok: false, message: check.message ?? "Fichier refusé." };

  const admin = createSupabaseAdminClient();
  const fileName = safeFileName(file.name);
  const storagePath = `clients/${request.client_id}/production/${request.id}/${crypto.randomUUID()}-${fileName}`;
  const { error: storageError } = await admin.storage.from("media").upload(
    storagePath,
    await file.arrayBuffer(),
    { contentType: file.type, upsert: false },
  );
  if (storageError) return { ok: false, message: `Téléversement impossible : ${storageError.message}` };

  const { data: asset, error: assetError } = await admin.from("media_assets").insert({
    client_id: request.client_id,
    kind: expected,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: file.type,
    byte_size: file.size,
    uploaded_by: profile.id,
  }).select("id").single();

  if (assetError || !asset) {
    await admin.storage.from("media").remove([storagePath]);
    return { ok: false, message: `Média non enregistré : ${assetError?.message ?? "erreur"}` };
  }

  const { error } = await supabase.from("production_requests").update({
    media_asset_id: asset.id,
    status: "livree",
    delivered_at: new Date().toISOString(),
  }).eq("id", request.id);

  if (error) {
    await admin.from("media_assets").delete().eq("id", asset.id);
    await admin.storage.from("media").remove([storagePath]);
    return { ok: false, message: `Livraison non enregistrée : ${error.message}` };
  }

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
