import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAttachment, safeFileName } from "@/lib/security/attachments";

export const CLIENT_LOGO_MAX_BYTES = 3 * 1024 * 1024;
export const CLIENT_LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ClientLogoUploadResult {
  path?: string;
  error?: string;
}

function isStoredClientLogo(value: string): boolean {
  return /^clients\/[0-9a-f-]+\/brand\//i.test(value);
}

/**
 * Enregistre le logo dans le bucket privé déjà utilisé par les médias.
 * Le chemin, et non une URL temporaire, est conservé dans `clients.logo_url`.
 */
export async function uploadClientLogo(
  clientId: string,
  entry: FormDataEntryValue | null,
  required: boolean,
): Promise<ClientLogoUploadResult> {
  if (!(entry instanceof File) || entry.size === 0) {
    return required ? { error: "Ajoutez le logo du client." } : {};
  }

  if (!(CLIENT_LOGO_TYPES as readonly string[]).includes(entry.type)) {
    return { error: "Logo refusé : utilisez un fichier PNG, JPEG ou WEBP." };
  }
  if (entry.size > CLIENT_LOGO_MAX_BYTES) {
    return { error: "Logo trop lourd : 3 Mo maximum." };
  }

  const head = new Uint8Array(await entry.slice(0, 12).arrayBuffer());
  const check = checkAttachment(
    { size: entry.size, type: entry.type, name: entry.name },
    head,
  );
  if (!check.valid) {
    return { error: check.message ?? "Le fichier du logo est invalide." };
  }

  const admin = createSupabaseAdminClient();
  const path = `clients/${clientId}/brand/${crypto.randomUUID()}-${safeFileName(entry.name)}`;
  const { error } = await admin.storage.from("media").upload(
    path,
    await entry.arrayBuffer(),
    { contentType: entry.type, upsert: false },
  );

  if (error) return { error: `Logo non envoyé : ${error.message}` };
  return { path };
}

/** Transforme le chemin privé stocké en URL temporaire affichable. */
export async function resolveClientLogoUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (!isStoredClientLogo(value)) return null;

  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.from("media").createSignedUrl(value, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Supprime uniquement les logos que l'application a elle-même stockés. */
export async function removeClientLogo(value: string | null): Promise<void> {
  if (!value || !isStoredClientLogo(value)) return;
  const admin = createSupabaseAdminClient();
  await admin.storage.from("media").remove([value]);
}
