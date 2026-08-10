"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { SOCIAL_NETWORKS } from "@/lib/domain/types";
import {
  buildClientHashtagLibrary,
  hashtagsForClientType,
  LYFTT_CLIENT_TYPE_IDS,
  normalizeHashtag,
} from "@/lib/domain/hashtags";
import { removeClientLogo, uploadClientLogo } from "@/lib/media/client-logo";

export interface ClientActionResult {
  ok: boolean;
  message?: string;
  clientId?: string;
  /**
   * Erreurs rattachées à leur champ, pour les signaler sur place plutôt que
   * de renvoyer un message unique en haut du formulaire.
   */
  fieldErrors?: Record<string, string>;
}

/**
 * Première erreur par champ, indexée par son chemin complet
 * (« contacts.1.email », « customHashtags.3 ») pour viser le bon champ
 * jusque dans les listes répétées.
 */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(field in result)) result[field] = issue.message;
  }
  return result;
}

const EDITORIAL_ROLES = ["super_admin", "production_manager", "community_manager"];

async function requireEditorial() {
  const profile = await getCurrentProfile();
  if (!profile || !EDITORIAL_ROLES.includes(profile.role)) return null;
  return profile;
}

const clientSchema = z.object({
  name: z.string().trim().min(2, "Le nom du client est requis.").max(120, "Nom de client trop long (120 caractères maximum)."),
  contacts: z.array(z.object({
    firstName: z.string().trim().min(1, "Le prénom du contact est requis."),
    lastName: z.string().trim().min(1, "Le nom du contact est requis."),
    phone: z.string().trim().min(8, "Le téléphone du contact est requis.").max(30, "Téléphone trop long (30 caractères maximum)."),
    email: z.string().trim().email("E-mail invalide."),
  })).min(1, "Au moins un contact est requis."),
  activity: z.string().trim().min(2, "L’activité est requise.").max(120, "Activité trop longue (120 caractères maximum)."),
  website: z.string().trim().url("L’adresse du site internet est invalide."),
  city: z.string().trim().min(2, "La ville est requise.").max(100, "Ville trop longue (100 caractères maximum)."),
  postalCode: z.string().regex(/^\d{5}$/, "Le code postal doit contenir 5 chiffres."),
  audience: z.string().trim().min(3, "La clientèle cible est requise.").max(300, "Clientèle cible trop longue (300 caractères maximum)."),
  brandTone: z.enum(["chaleureux", "premium", "expert", "dynamique", "institutionnel"]),
  keywords: z.string().trim().min(3, "Ajoutez au moins un mot-clé.").max(1000, "Mots-clés trop longs : 1000 caractères maximum."),
  clientType: z.enum(LYFTT_CLIENT_TYPE_IDS),
  customHashtags: z.array(z.string().trim().min(2, "Les 5 hashtags client sont obligatoires.").max(60, "Hashtag trop long (60 caractères maximum).")).length(5),
  networks: z.array(z.enum(SOCIAL_NETWORKS as unknown as [string, ...string[]])).min(1,
    "Sélectionnez au moins un réseau."),
  deadlineWeekday: z.coerce.number().int().min(1).max(7),
  deadlineTime: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  approvalPolicy: z.enum(["explicit_required", "tacit_allowed"]),
  tacitNotice: z.string().trim().max(500, "Mention contractuelle trop longue (500 caractères maximum).").optional(),
  whatsappGroup: z.string().trim().min(2, "Le nom du groupe WhatsApp est requis.").max(120, "Nom de groupe trop long (120 caractères maximum)."),
  communityManagerId: z.string().uuid("Sélectionnez un community manager."),
  photoPerMonth: z.coerce.number().int().min(0).max(31),
  videoPerMonth: z.coerce.number().int().min(0).max(31),
  storyPerMonth: z.coerce.number().int().min(0).max(31),
  visualPerMonth: z.coerce.number().int().min(0).max(31),
  postSignature: z.string().trim().max(300, "Signature trop longue (300 caractères maximum).").optional(),
});

function clientFormValues(formData: FormData) {
  return {
    name: formData.get("name"),
    contacts: formData.getAll("contactFirstName").map((firstName, index) => ({
      firstName,
      lastName: formData.getAll("contactLastName")[index],
      phone: formData.getAll("contactPhone")[index],
      email: formData.getAll("contactEmail")[index],
    })),
    activity: formData.get("activity"),
    website: normalizeWebsite(formData.get("website")),
    city: formData.get("city"),
    postalCode: formData.get("postalCode"),
    audience: formData.get("audience"),
    brandTone: formData.get("brandTone"),
    keywords: formData.get("keywords"),
    clientType: formData.get("clientType"),
    customHashtags: Array.from({ length: 5 }, (_, index) => formData.get(`customHashtag${index + 1}`)),
    networks: formData.getAll("networks").map(String),
    deadlineWeekday: formData.get("deadlineWeekday"),
    deadlineTime: formData.get("deadlineTime"),
    approvalPolicy: formData.get("approvalPolicy"),
    tacitNotice: formData.get("tacitNotice") ?? undefined,
    whatsappGroup: formData.get("whatsappGroup") ?? undefined,
    communityManagerId: formData.get("communityManagerId") ?? undefined,
    photoPerMonth: formData.get("photoPerMonth"),
    videoPerMonth: formData.get("videoPerMonth"),
    storyPerMonth: formData.get("storyPerMonth"),
    visualPerMonth: formData.get("visualPerMonth"),
    postSignature: formData.get("postSignature") ?? undefined,
  };
}

/** Accepte aussi « exemple.fr » : l'interface complète le protocole attendu. */
function normalizeWebsite(value: FormDataEntryValue | null): string {
  const website = String(value ?? "").trim();
  if (!website || /^[a-z][a-z0-9+.-]*:\/\//i.test(website)) return website;
  return `https://${website}`;
}

function prepareHashtags(input: z.infer<typeof clientSchema>): {
  baseHashtags: string[];
  customHashtags: string[];
  recommendedHashtags: string[];
} | null {
  const baseHashtags = hashtagsForClientType(input.clientType);
  const customHashtags = input.customHashtags.map(normalizeHashtag);
  const baseHashtagKeys = new Set(baseHashtags.map((hashtag) => hashtag.toLocaleLowerCase("fr")));
  const customHashtagKeys = customHashtags.map((hashtag) => hashtag.toLocaleLowerCase("fr"));
  const valid = customHashtagKeys.every((key, index) =>
    Boolean(key) && !baseHashtagKeys.has(key) && customHashtagKeys.indexOf(key) === index,
  );
  if (!valid) return null;
  return {
    baseHashtags,
    customHashtags,
    recommendedHashtags: buildClientHashtagLibrary(input.clientType, customHashtags),
  };
}

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

  const parsed = clientSchema.safeParse(clientFormValues(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Formulaire invalide.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const input = parsed.data;
  const hashtags = prepareHashtags(input);
  if (!hashtags) {
    return { ok: false, message: "Les 5 hashtags client doivent être différents entre eux et des hashtags métier." };
  }
  const { baseHashtags, customHashtags, recommendedHashtags } = hashtags;

  const admin = createSupabaseAdminClient();

  const notes = JSON.stringify({
    defaultNetworks: input.networks,
    brandProfile: {
      clientType: input.clientType,
      activity: sanitizeText(input.activity, 120),
      website: input.website,
      city: sanitizeText(input.city, 100),
      postalCode: input.postalCode,
      audience: sanitizeText(input.audience, 300),
      tone: input.brandTone,
      keywords: sanitizeText(input.keywords, 1000),
    },
    baseHashtags,
    customHashtags,
    recommendedHashtags,
    monthlyCadence: {
      photo: input.photoPerMonth,
      video: input.videoPerMonth,
      story: input.storyPerMonth,
      visual: input.visualPerMonth,
    },
  });

  // Un slug déjà pris est suffixé plutôt que de faire échouer la création.
  let slug = slugify(input.name);
  const { data: taken, error: slugError } = await admin.from("clients").select("id").eq("slug", slug).maybeSingle();
  if (slugError) {
    return { ok: false, message: `Création impossible : ${slugError.message}` };
  }
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
      whatsapp_group_name: sanitizeText(input.whatsappGroup, 120),
      post_signature: input.postSignature ? sanitizeText(input.postSignature, 300) : null,
      // Enregistrer le profil éditorial dès la création évite un client vide si
      // une requête suivante est interrompue.
      notes,
    })
    .select("id")
    .single();

  if (error || !client) {
    return { ok: false, message: `Client non créé : ${error?.message ?? "erreur"}` };
  }

  const logo = await uploadClientLogo(client.id, formData.get("logo"), true);
  if (!logo.path) {
    await admin.from("clients").delete().eq("id", client.id);
    return { ok: false, message: logo.error ?? "Le logo du client est requis." };
  }

  const { error: logoError } = await admin
    .from("clients")
    .update({ logo_url: logo.path })
    .eq("id", client.id);
  if (logoError) {
    await removeClientLogo(logo.path);
    await admin.from("clients").delete().eq("id", client.id);
    return { ok: false, message: `Logo non enregistré : ${logoError.message}` };
  }

  // Tous les contacts saisis reçoivent le planning ; le premier fait office de
  // référent pour l'affichage et pour le prénom des messages préremplis.
  const { error: contactError } = await admin.from("client_contacts").insert(
    input.contacts.map((contact) => ({
      client_id: client.id,
      first_name: sanitizeText(contact.firstName, 80),
      last_name: sanitizeText(contact.lastName, 80),
      phone: contact.phone || null,
      email: contact.email || null,
      is_primary: true,
      receives_planning: true,
    })),
  );
  if (contactError) {
    await removeClientLogo(logo.path);
    await admin.from("clients").delete().eq("id", client.id);
    return { ok: false, message: `Contact non enregistré : ${contactError.message}` };
  }

  // Rattachement du community manager : c'est ce qui lui donne accès au client
  // et ce qui alimente le routage des tickets (§7).
  const managerId = input.communityManagerId;
  const { error: assignmentError } = await admin.from("client_assignments").insert({
    client_id: client.id,
    profile_id: managerId,
    role: "community_manager",
  });
  if (assignmentError) {
    await removeClientLogo(logo.path);
    await admin.from("clients").delete().eq("id", client.id);
    return { ok: false, message: `Responsable non enregistré : ${assignmentError.message}` };
  }

  revalidatePath("/clients");
  return { ok: true, message: `${input.name} a été créé.`, clientId: client.id };
}

export async function updateClient(formData: FormData): Promise<ClientActionResult> {
  const profile = await requireEditorial();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const clientId = z.string().uuid().safeParse(formData.get("clientId"));
  const parsed = clientSchema.safeParse(clientFormValues(formData));
  if (!clientId.success) return { ok: false, message: "Client invalide." };
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Formulaire invalide.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const scopedClient = await createSupabaseServerClient();
  const { data: accessibleClient } = await scopedClient
    .from("clients")
    .select("id")
    .eq("id", clientId.data)
    .maybeSingle();
  if (!accessibleClient) return { ok: false, message: "Client introuvable ou accès refusé." };

  const input = parsed.data;
  const hashtags = prepareHashtags(input);
  if (!hashtags) {
    return { ok: false, message: "Les 5 hashtags client doivent être différents entre eux et des hashtags métier." };
  }

  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from("clients")
    .select("id, notes, logo_url, client_contacts ( id, is_primary )")
    .eq("id", clientId.data)
    .maybeSingle();
  if (!current) return { ok: false, message: "Client introuvable." };

  const newLogo = await uploadClientLogo(clientId.data, formData.get("logo"), false);
  if (newLogo.error) return { ok: false, message: newLogo.error };
  if (!current.logo_url && !newLogo.path) {
    return { ok: false, message: "Ajoutez le logo du client avant d’enregistrer." };
  }

  let currentNotes: Record<string, unknown> = {};
  try { currentNotes = typeof current.notes === "string" ? JSON.parse(current.notes) : {}; } catch { currentNotes = {}; }
  const existingBrandProfile = typeof currentNotes.brandProfile === "object" && currentNotes.brandProfile
    ? currentNotes.brandProfile as Record<string, unknown>
    : {};

  const notes = {
    ...currentNotes,
    defaultNetworks: input.networks,
    brandProfile: {
      ...existingBrandProfile,
      clientType: input.clientType,
      activity: sanitizeText(input.activity, 120),
      website: input.website,
      city: sanitizeText(input.city, 100),
      postalCode: input.postalCode,
      audience: sanitizeText(input.audience, 300),
      tone: input.brandTone,
      keywords: sanitizeText(input.keywords, 1000),
    },
    baseHashtags: hashtags.baseHashtags,
    customHashtags: hashtags.customHashtags,
    recommendedHashtags: hashtags.recommendedHashtags,
    monthlyCadence: {
      photo: input.photoPerMonth,
      video: input.videoPerMonth,
      story: input.storyPerMonth,
      visual: input.visualPerMonth,
    },
  };

  const { error: clientError } = await admin.from("clients").update({
    name: sanitizeText(input.name, 120),
    validation_deadline_weekday: input.deadlineWeekday,
    validation_deadline_time: input.deadlineTime,
    approval_policy: input.approvalPolicy,
    tacit_approval_notice: input.approvalPolicy === "tacit_allowed" && input.tacitNotice
      ? sanitizeText(input.tacitNotice, 500)
      : null,
    whatsapp_group_name: sanitizeText(input.whatsappGroup, 120),
    post_signature: input.postSignature ? sanitizeText(input.postSignature, 300) : null,
    logo_url: newLogo.path ?? current.logo_url,
    notes: JSON.stringify(notes),
  }).eq("id", clientId.data);
  if (clientError) {
    if (newLogo.path) await removeClientLogo(newLogo.path);
    return { ok: false, message: `Client non modifié : ${clientError.message}` };
  }
  if (newLogo.path) await removeClientLogo(current.logo_url);

  // La liste des contacts est remplacée par celle du formulaire : c'est le seul
  // moyen simple de gérer ajouts, modifications et retraits en une opération.
  const { error: clearError } = await admin
    .from("client_contacts")
    .delete()
    .eq("client_id", clientId.data);
  if (clearError) {
    return { ok: false, message: `Contacts non modifiés : ${clearError.message}` };
  }

  const { error: contactError } = await admin.from("client_contacts").insert(
    input.contacts.map((contact) => ({
      client_id: clientId.data,
      first_name: sanitizeText(contact.firstName, 80),
      last_name: sanitizeText(contact.lastName, 80),
      phone: contact.phone,
      email: contact.email,
      is_primary: true,
      receives_planning: true,
    })),
  );
  if (contactError) return { ok: false, message: `Contacts non modifiés : ${contactError.message}` };

  const { error: assignmentError } = await admin.from("client_assignments").upsert({
    client_id: clientId.data,
    profile_id: input.communityManagerId,
    role: "community_manager",
  }, { onConflict: "client_id,profile_id,role" });
  if (assignmentError) return { ok: false, message: `Référent non modifié : ${assignmentError.message}` };
  await admin.from("client_assignments")
    .delete()
    .eq("client_id", clientId.data)
    .eq("role", "community_manager")
    .neq("profile_id", input.communityManagerId);

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId.data}`);
  revalidatePath("/fiches");
  return { ok: true, message: "Modifications enregistrées.", clientId: clientId.data };
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

const lifecycleSchema = z.object({
  clientId: z.string().uuid(),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pauseStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pauseEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/**
 * Fin de gestion et pause.
 *
 * Réservé à l'encadrement : ce sont des décisions contractuelles, pas
 * éditoriales. Les dates ne sont pas recopiées dans un indicateur d'état —
 * celui-ci est recalculé à chaque lecture par `clientLifecycle`, ce qui évite
 * toute dérive si une date change ou si une tâche planifiée ne tourne pas.
 */
export async function updateClientLifecycle(formData: FormData): Promise<ClientActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["super_admin", "production_manager"].includes(profile.role)) {
    return { ok: false, message: "Seul un administrateur peut modifier la gestion d'un client." };
  }

  const readDate = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };

  const parsed = lifecycleSchema.safeParse({
    clientId: formData.get("clientId"),
    contractEndDate: readDate("contractEndDate"),
    pauseStartDate: readDate("pauseStartDate"),
    pauseEndDate: readDate("pauseEndDate"),
  });
  if (!parsed.success) return { ok: false, message: "Dates invalides." };

  const input = parsed.data;
  if (input.pauseEndDate && input.pauseStartDate && input.pauseEndDate < input.pauseStartDate) {
    return { ok: false, message: "La fin de pause précède son début." };
  }
  if (input.pauseEndDate && !input.pauseStartDate) {
    return { ok: false, message: "Indiquez la date de début de pause." };
  }

  const scoped = await createSupabaseServerClient();
  const { data: accessible } = await scoped
    .from("clients")
    .select("id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (!accessible) return { ok: false, message: "Client introuvable ou accès refusé." };

  const { error } = await createSupabaseAdminClient()
    .from("clients")
    .update({
      contract_end_date: input.contractEndDate,
      pause_start_date: input.pauseStartDate,
      pause_end_date: input.pauseEndDate,
    })
    .eq("id", input.clientId);

  if (error) return { ok: false, message: `Modification impossible : ${error.message}` };

  revalidatePath("/clients");
  revalidatePath("/fiches");
  return { ok: true, message: "Gestion du client mise à jour." };
}
