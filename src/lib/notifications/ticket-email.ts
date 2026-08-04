import { getTicketTypeDefinition, type TicketType } from "@/lib/domain/ticket-types";
import type { TicketPriority } from "@/lib/domain/types";

/**
 * Composition des alertes e-mail envoyées à l'équipe quand un client demande
 * une modification.
 *
 * Logique pure, sans réseau : c'est ce qui rend les objets d'e-mail testables.
 * L'objet doit être lisible dans une liste de messagerie, sur téléphone, sans
 * ouvrir : nom du client, nature de la demande, urgence.
 */

export interface TicketEmailInput {
  ticketNumber: string;
  clientName: string;
  ticketType: TicketType;
  priority: TicketPriority;
  description: string;
  clientSuggestion?: string | null;
  /** Libellé du contenu concerné, ex. « mardi 28 juillet ». */
  itemLabel?: string | null;
  /** Nom de l'auteur côté client, s'il l'a renseigné. */
  authorName?: string | null;
  ticketUrl: string;
  /** Échéance de validation de la fiche, déjà formatée. */
  deadlineLabel?: string | null;
  /** Motifs d'escalade, quand le responsable de production est destinataire. */
  escalationReasons?: string[];
  /** La demande est arrivée après l'échéance. */
  afterDeadline?: boolean;
}

/** Accroche par famille de demande, pour que l'objet se lise d'un coup d'œil. */
function hook(input: TicketEmailInput): string {
  const category = getTicketTypeDefinition(input.ticketType).category;

  switch (input.ticketType) {
    case "text_typo":
      return "une faute à corriger";
    case "text_tone":
      return "le ton ne va pas";
    case "hashtags":
      return "les hashtags à revoir";
    case "photo_replace":
      return "veut une autre photo";
    case "photo_retouch":
      return "une photo à retoucher";
    case "graphic_edit":
      return "le visuel à reprendre";
    case "image_order":
      return "l'ordre des visuels à changer";
    case "video_replace":
      return "veut une autre vidéo";
    case "video_edit":
      return "la vidéo à remonter";
    case "schedule_change":
      return "veut décaler une publication";
    case "network_change":
      return "veut changer de réseau";
    case "publication_remove":
      return "veut retirer une publication";
    case "publication_add":
      return "demande une publication en plus";
    default:
      return category === "editorial" ? "un texte à retoucher" : "une demande à traiter";
  }
}

/** Objet de l'e-mail : accrocheur, mais toujours informatif. */
export function buildSubject(input: TicketEmailInput): string {
  const marker =
    input.priority === "urgent"
      ? "🚨 URGENT — "
      : input.afterDeadline
        ? "⏰ Hors délai — "
        : getTicketTypeDefinition(input.ticketType).category === "editorial"
          ? "✏️ "
          : getTicketTypeDefinition(input.ticketType).category === "video"
            ? "🎬 "
            : getTicketTypeDefinition(input.ticketType).category === "graphic"
              ? "🖼️ "
              : "📅 ";

  const where = input.itemLabel ? ` (${input.itemLabel})` : "";
  return `${marker}${input.clientName} : ${hook(input)}${where}`;
}

/** Version texte — certains clients de messagerie n'affichent que celle-ci. */
export function buildTextBody(input: TicketEmailInput): string {
  const lines = [
    `${input.clientName} vient de demander une modification.`,
    "",
    `Demande : ${getTicketTypeDefinition(input.ticketType).label}`,
  ];

  if (input.itemLabel) lines.push(`Publication : ${input.itemLabel}`);
  if (input.authorName) lines.push(`Envoyée par : ${input.authorName}`);
  lines.push(`Référence : ${input.ticketNumber}`);
  if (input.deadlineLabel) lines.push(`Échéance de validation : ${input.deadlineLabel}`);

  lines.push("", "Ce que dit le client :", input.description);

  if (input.clientSuggestion) {
    lines.push("", "Sa proposition :", input.clientSuggestion);
  }

  if (input.escalationReasons?.length) {
    lines.push("", `À arbitrer : ${input.escalationReasons.join(" · ")}`);
  }

  lines.push("", `Traiter la demande : ${input.ticketUrl}`, "", "— LYFTT");
  return lines.join("\n");
}

export function buildHtmlBody(input: TicketEmailInput): string {
  const definition = getTicketTypeDefinition(input.ticketType);

  const rows: string[] = [
    row("Demande", definition.label),
    input.itemLabel ? row("Publication", input.itemLabel) : "",
    input.authorName ? row("Envoyée par", input.authorName) : "",
    row("Référence", input.ticketNumber),
    input.deadlineLabel ? row("Échéance", input.deadlineLabel) : "",
  ].filter(Boolean);

  const escalation = input.escalationReasons?.length
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#fdf3ef;border-left:3px solid #b4451f;
         font-size:14px;color:#b4451f;">À arbitrer : ${escape(input.escalationReasons.join(" · "))}</p>`
    : "";

  const suggestion = input.clientSuggestion
    ? `<p style="margin:16px 0 0;font-size:13px;color:#8a8a8a;">Sa proposition</p>
       <p style="margin:4px 0 0;padding:12px 14px;background:#f4f8f5;border-radius:6px;
          font-size:15px;line-height:1.6;white-space:pre-wrap;">${escape(input.clientSuggestion)}</p>`
    : "";

  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">
      ${escape(input.clientName)} a demandé une modification
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#8a8a8a;">${escape(hook(input))}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows.join("")}</table>

    <p style="margin:20px 0 0;font-size:13px;color:#8a8a8a;">Ce que dit le client</p>
    <p style="margin:4px 0 0;padding:12px 14px;background:#fafaf9;border-radius:6px;
       font-size:15px;line-height:1.6;white-space:pre-wrap;">${escape(input.description)}</p>

    ${suggestion}
    ${escalation}

    <p style="margin:24px 0 0;">
      <a href="${escape(input.ticketUrl)}" style="display:inline-block;background:#111;color:#fff;
         text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:500;">
        Traiter la demande
      </a>
    </p>

    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e4;
       font-size:12px;color:#8a8a8a;">
      Alerte automatique — module de validation client.
    </p>
  </div>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:5px 0;color:#8a8a8a;width:130px;vertical-align:top;">${escape(label)}</td>
    <td style="padding:5px 0;">${escape(value)}</td>
  </tr>`;
}

/** Les textes viennent du client : ils ne doivent jamais être injectés bruts. */
export function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
