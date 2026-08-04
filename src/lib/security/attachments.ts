/**
 * §19 / §24 — Contrôle des pièces jointes déposées par le client.
 *
 * Le type déclaré par le navigateur n'est pas digne de confiance : on vérifie
 * aussi la signature binaire du fichier.
 */

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 Mo

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
] as const;

export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export type AttachmentRejection =
  | "too_large"
  | "empty"
  | "type_not_allowed"
  | "content_mismatch";

export interface AttachmentCheck {
  valid: boolean;
  reason?: AttachmentRejection;
  message?: string;
}

const MAGIC_NUMBERS: { type: AllowedAttachmentType; test: (bytes: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    type: "application/pdf",
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
  {
    // RIFF....WEBP
    type: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    // Boîte ISO-BMFF « ftyp » (mp4, mov, heic)
    type: "video/mp4",
    test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  },
];

export function checkAttachment(
  file: { size: number; type: string; name: string },
  head?: Uint8Array,
): AttachmentCheck {
  if (file.size === 0) {
    return { valid: false, reason: "empty", message: "Le fichier est vide." };
  }

  if (file.size > ATTACHMENT_MAX_BYTES) {
    return {
      valid: false,
      reason: "too_large",
      message: `Le fichier dépasse ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} Mo. Envoyez-le plutôt par WhatsApp, nous le rattacherons à votre demande.`,
    };
  }

  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return {
      valid: false,
      reason: "type_not_allowed",
      message: "Formats acceptés : photo (JPEG, PNG, WEBP, HEIC), PDF ou vidéo (MP4, MOV).",
    };
  }

  if (head && head.length >= 12) {
    const looksLikeIsoBmff = MAGIC_NUMBERS.find((m) => m.type === "video/mp4")!.test(head);
    const matches = MAGIC_NUMBERS.some((magic) => magic.test(head));

    // HEIC, MOV et MP4 partagent la boîte « ftyp ».
    const isContainerFamily =
      ["video/mp4", "video/quicktime", "image/heic"].includes(file.type) && looksLikeIsoBmff;

    if (!matches && !isContainerFamily) {
      return {
        valid: false,
        reason: "content_mismatch",
        message: "Le contenu du fichier ne correspond pas à son extension.",
      };
    }
  }

  return { valid: true };
}

/** Nom de fichier neutralisé avant écriture dans le stockage. */
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "fichier";
  return base
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-120)
    .replace(/^[.\-]+/, "") || "fichier";
}
