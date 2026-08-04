"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { SOCIAL_NETWORKS } from "@/lib/domain/types";
import { recommendHashtags } from "@/lib/domain/hashtags";

export interface ClientActionResult {
  ok: boolean;
  message?: string;
  clientId?: string;
}

const EDITORIAL_ROLES = ["super_admin", "production_manager", "community_manager"];

async function requireEditorial() {
  const profile = await getCurrentProfile();
  if (!profile || !EDITORIAL_ROLES.includes(profile.role)) return null;
  return profile;
}

const clientSchema = z.object({
  name: z.string().trim().min(2, "Le nom du client est requis."),
  contactFirstName: z.string().trim().min(1, "Le prénom du contact est requis."),
  contactLastName: z.string().trim().min(1, "Le nom du contact est requis."),
  contactPhone: z.string().trim().min(8, "Le téléphone du contact est requis.").max(30),
  contactEmail: z.string().trim().email("E-mail invalide."),
  activity: z.string().trim().min(2, "L’activité est requise.").max(120),
  website: z.string().trim().url("L’adresse du site internet est invalide."),
  city: z.string().trim().min(2, "La ville est requise.").max(100),
  postalCode: z.string().regex(/^\d{5}$/, "Le code postal doit contenir 5 chiffres."),
  audience: z.string().trim().min(3, "La clientèle cible est requise.").max(300),
  brandTone: z.enum(["chaleureux", "premium", "expert", "dynamique", "institutionnel"]),
  keywords: z.string().trim().min(3, "Ajoutez au moins un mot-clé.").max(1000),
  networks: z.array(z.enum(SOCIAL_NETWORKS as unknown as [string, ...string[]])).min(1,
    "Sélectionnez au moins un réseau."),
  deadlineWeekday: z.coerce.number().int().min(1).max(7),
  deadlineTime: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  approvalPolicy: z.enum(["explicit_required", "tacit_allowed"]),
  tacitNotice: z.string().trim().max(500).optional(),
  whatsappGroup: z.string().trim().min(2, "Le nom du groupe WhatsApp est requis.").max(120),
  communityManagerId: z.string().uuid("Sélectionnez un community manager."),
  photoPerMonth: z.coerce.number().int().min(0).max(31),
  videoPerMonth: z.coerce.number().int().min(0).max(31),
  visualPerMonth: z.coerce.number().int().min(0).max(31),
});

/** Identifiant lisible et unique, dérivé du nom. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "client";
}

export async function createClient(formData: FormData): Promise<ClientActionResult> {
  const profile = await requireEditorial();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    contactFirstName: formData.get("contactFirstName"),
    contactLastName: formData.get("contactLastName") ?? undefined,
    contactPhone: formData.get("contactPhone") ?? undefined,
    contactEmail: formData.get("contactEmail") ?? undefined,
    activity: formData.get("activity"),
    website: formData.get("website"),
    city: formData.get("city"),
    postalCode: formData.get("postalCode"),
    audience: formData.get("audience"),
    brandTone: formData.get("brandTone"),
    keywords: formData.get("keywords"),
    networks: formData.getAll("networks").map(String),
    deadlineWeekday: formData.get("deadlineWeekday"),
    deadlineTime: formData.get("deadlineTime"),
    approvalPolicy: formData.get("approvalPolicy"),
    tacitNotice: formData.get("tacitNotice") ?? undefined,
    whatsappGroup: formData.get("whatsappGroup") ?? undefined,
    communityManagerId: formData.get("communityManagerId") ?? undefined,
    photoPerMonth: formData.get("photoPerMonth"),
    videoPerMonth: formData.get("videoPerMonth"),
    visualPerMonth: formData.get("visualPerMonth"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  // Un slug déjà pris est suffixé plutôt que de faire échouer la création.
  let slug = slugify(input.name);
  const { data: taken } = await admin.from("clients").select("id").eq("slug", slug).maybeSingle();
  if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const { data: client, error } = await admin
    .from("clients")
    .insert({
      name: sanitizeText(input.name, 120),
      slug,
      validation_deadline_weekday: input.deadlineWeekday,
      validation_deadline_time: input.deadlineTime,
      approval_policy: input.approvalPolicy,
      // La mention n'a de sens que si la validation tacite est activée (§16).
      tacit_approval_notice:
        input.approvalPolicy === "tacit_allowed" && input.tacitNotice
          ? sanitizeText(input.tacitNotice, 500)
          : null,
      whatsapp_group_name: input.whatsappGroup || null,
    })
    .select("id")
    .single();

  if (error || !client) {
    return { ok: false, message: `Client non créé : ${error?.message ?? "erreur"}` };
  }

  await admin.from("client_contacts").insert({
    client_id: client.id,
    first_name: sanitizeText(input.contactFirstName, 80),
    last_name: input.contactLastName ? sanitizeText(input.contactLastName, 80) : null,
    phone: input.contactPhone || null,
    email: input.contactEmail || null,
    is_primary: true,
  });

  // Rattachement du community manager : c'est ce qui lui donne accès au client
  // et ce qui alimente le routage des tickets (§7).
  const managerId = input.communityManagerId;
  await admin.from("client_assignments").insert({
    client_id: client.id,
    profile_id: managerId,
    role: "community_manager",
  });

  const recommendedHashtags = recommendHashtags({
    brand: input.name,
    activity: input.activity,
    city: input.city,
    audience: input.audience,
    keywords: input.keywords,
  });

  // Le profil éditorial alimente automatiquement les prochaines fiches.
  await admin
    .from("clients")
    .update({ notes: JSON.stringify({
      defaultNetworks: input.networks,
      brandProfile: {
        activity: sanitizeText(input.activity, 120),
        website: input.website,
        city: sanitizeText(input.city, 100),
        postalCode: input.postalCode,
        audience: sanitizeText(input.audience, 300),
        tone: input.brandTone,
        keywords: sanitizeText(input.keywords, 1000),
      },
      recommendedHashtags,
      monthlyCadence: {
        photo: input.photoPerMonth,
        video: input.videoPerMonth,
        visual: input.visualPerMonth,
      },
    }) })
    .eq("id", client.id);

  revalidatePath("/clients");
  return { ok: true, message: `${input.name} a été créé.`, clientId: client.id };
}

export async function setClientActive(
  clientId: string,
  isActive: boolean,
): Promise<ClientActionResult> {
  const profile = await requireEditorial();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update({ is_active: isActive })
    .eq("id", clientId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/clients");
  return { ok: true, message: isActive ? "Client réactivé." : "Client archivé." };
}
