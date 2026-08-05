"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ACCESS_DENIED_MESSAGE,
  canAccessClient,
  requireEditorialProfile,
} from "@/lib/internal/authorization";
import { safeFileName } from "@/lib/security/attachments";

/**
 * Téléversement direct navigateur → Supabase.
 *
 * Le serveur ne reçoit jamais le fichier : il délivre une URL signée, le
 * navigateur écrit dessus, puis le serveur enregistre les métadonnées. C'est ce
 * qui permet d'accepter des vidéos, la limite de 4,5 Mo des fonctions Vercel
 * s'appliquant au corps de requête et n'étant pas configurable.
 */

/** Plafonds appliqués aux médias de production, distincts des pièces jointes client. */
export const SHEET_MEDIA_MAX_BYTES = {
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
} as const;

export const SHEET_MEDIA_MIME = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
} as const;

export interface UploadTicket {
  ok: boolean;
  message?: string;
  /** Chemin de destination dans le bucket. */
  path?: string;
  /** Jeton d'écriture à usage unique. */
  token?: string;
  previewPath?: string;
  previewToken?: string;
}

const ticketSchema = z.object({
  clientId: z.string().uuid(),
  sheetId: z.string().uuid().nullable(),
  fileName: z.string().min(1).max(200),
  kind: z.enum(["image", "video"]),
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(3).max(100),
  withPreview: z.boolean(),
});

export async function createMediaUploadTicket(input: {
  clientId: string;
  sheetId: string | null;
  fileName: string;
  kind: "image" | "video";
  byteSize: number;
  mimeType: string;
  withPreview: boolean;
}): Promise<UploadTicket> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Demande de téléversement invalide." };

  const { clientId, sheetId, kind, byteSize, mimeType } = parsed.data;

  if (!(await canAccessClient(clientId))) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  if (!(SHEET_MEDIA_MIME[kind] as readonly string[]).includes(mimeType)) {
    return {
      ok: false,
      message:
        kind === "video"
          ? "Formats vidéo acceptés : MP4, MOV, WEBM."
          : "Formats image acceptés : JPEG, PNG, WEBP, HEIC.",
    };
  }

  if (byteSize > SHEET_MEDIA_MAX_BYTES[kind]) {
    const limit = Math.round(SHEET_MEDIA_MAX_BYTES[kind] / 1024 / 1024);
    return { ok: false, message: `Fichier trop lourd : ${limit} Mo maximum.` };
  }

  const admin = createSupabaseAdminClient();
  const safeName = safeFileName(parsed.data.fileName);
  const folder = sheetId ? `sheets/${sheetId}` : "brouillons";
  const base = `clients/${clientId}/${folder}/${crypto.randomUUID()}`;

  const { data, error } = await admin.storage
    .from("media")
    .createSignedUploadUrl(`${base}-${safeName}`);

  if (error || !data) {
    return { ok: false, message: `Téléversement impossible : ${error?.message ?? "erreur"}` };
  }

  let previewPath: string | undefined;
  let previewToken: string | undefined;
  if (parsed.data.withPreview) {
    const preview = await admin.storage
      .from("media")
      .createSignedUploadUrl(`${base}-apercu.webp`);
    if (preview.data) {
      previewPath = preview.data.path;
      previewToken = preview.data.token;
    }
  }

  return { ok: true, path: data.path, token: data.token, previewPath, previewToken };
}

const registerSchema = z.object({
  clientId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  previewPath: z.string().min(1).max(500).nullable(),
  previewByteSize: z.number().int().nonnegative().nullable(),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
  kind: z.enum(["image", "video"]),
});

export interface RegisterResult {
  ok: boolean;
  message?: string;
  mediaAssetId?: string;
}

/** Enregistre le média une fois le fichier réellement écrit dans le bucket. */
export async function registerUploadedMedia(input: {
  clientId: string;
  storagePath: string;
  previewPath: string | null;
  previewByteSize: number | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  kind: "image" | "video";
}): Promise<RegisterResult> {
  const profile = await requireEditorialProfile();
  if (!profile) return { ok: false, message: "Action non autorisée." };

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Métadonnées invalides." };
  if (!(await canAccessClient(parsed.data.clientId))) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();

  // Le chemin est reconstruit à partir du client : un chemin forgé pointant
  // vers le dossier d'un autre client est rejeté.
  if (!parsed.data.storagePath.startsWith(`clients/${parsed.data.clientId}/`)) {
    return { ok: false, message: ACCESS_DENIED_MESSAGE };
  }

  // Le fichier doit exister : sinon on enregistrerait un média fantôme.
  const { error: headError } = await admin.storage
    .from("media")
    .createSignedUrl(parsed.data.storagePath, 60);
  if (headError) {
    return { ok: false, message: "Le fichier n'a pas été reçu. Réessayez." };
  }

  const { data, error } = await admin
    .from("media_assets")
    .insert({
      client_id: parsed.data.clientId,
      kind: parsed.data.kind,
      storage_path: parsed.data.storagePath,
      thumbnail_path: parsed.data.previewPath,
      preview_path: parsed.data.previewPath,
      preview_byte_size: parsed.data.previewByteSize,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      byte_size: parsed.data.byteSize,
      uploaded_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, message: `Média non enregistré : ${error?.message ?? "erreur"}` };
  }

  return { ok: true, mediaAssetId: data.id };
}
