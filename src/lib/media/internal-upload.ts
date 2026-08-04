import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAttachment, safeFileName } from "@/lib/security/attachments";

export interface UploadedSheetMedia {
  assetId: string;
  storagePath: string;
}

export async function uploadSheetMedia(params: {
  file: File;
  clientId: string;
  sheetId: string;
  uploadedBy: string;
  expectedKind: "image" | "video";
  replacesMediaId?: string | null;
}): Promise<{ data?: UploadedSheetMedia; error?: string }> {
  const { file } = params;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    return { error: "Seules les photos et vidéos sont acceptées dans une publication." };
  }
  if (!file.type.startsWith(`${params.expectedKind}/`)) {
    return { error: params.expectedKind === "video" ? "Cette zone attend une vidéo." : "Cette zone attend une image." };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const check = checkAttachment({ size: file.size, type: file.type, name: file.name }, head);
  if (!check.valid) return { error: check.message ?? "Fichier refusé." };

  const admin = createSupabaseAdminClient();
  const fileName = safeFileName(file.name);
  const storagePath = `clients/${params.clientId}/sheets/${params.sheetId}/${crypto.randomUUID()}-${fileName}`;
  const { error: storageError } = await admin.storage.from("media").upload(
    storagePath,
    await file.arrayBuffer(),
    { contentType: file.type, upsert: false },
  );
  if (storageError) return { error: `Téléversement impossible : ${storageError.message}` };

  const { data: asset, error: assetError } = await admin.from("media_assets").insert({
    client_id: params.clientId,
    kind: params.expectedKind,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: file.type,
    byte_size: file.size,
    replaces_media_id: params.replacesMediaId ?? null,
    uploaded_by: params.uploadedBy,
  }).select("id").single();

  if (assetError || !asset) {
    await admin.storage.from("media").remove([storagePath]);
    return { error: `Média non enregistré : ${assetError?.message ?? "erreur"}` };
  }

  return { data: { assetId: asset.id, storagePath } };
}
