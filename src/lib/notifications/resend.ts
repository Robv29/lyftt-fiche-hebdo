import "server-only";

/**
 * Envoi d'e-mails via Resend, en HTTP direct.
 *
 * Pas de dépendance supplémentaire : l'API tient en une requête. Le principe
 * directeur est qu'un échec d'envoi ne doit jamais faire échouer l'action
 * métier — un ticket client enregistré mais dont l'alerte n'est pas partie
 * reste très préférable à un ticket perdu.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Nom d'expéditeur à afficher, quand le destinataire est un client. */
  displayName?: string;
}

/**
 * Nom affiché à la place de celui de MAIL_FROM.
 *
 * L'adresse technique reste la même — c'est le seul domaine vérifié chez
 * Resend — mais un client n'a pas à voir « notifications » dans son courrier :
 * il attend un message de Lyftt.
 */
export function withDisplayName(from: string, displayName: string): string {
  const address = from.includes("<") ? from.slice(from.indexOf("<") + 1, from.indexOf(">")).trim() : from.trim();
  return `${displayName} <${address}>`;
}

export type EmailOutcome =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "no_recipient" | "rejected" | "error"; detail?: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  // Sans configuration, on n'échoue pas : l'alerte interne dans l'application
  // reste la source de vérité, l'e-mail n'en est qu'un rappel.
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const recipients = [...new Set(message.to.filter((address) => address?.includes("@")))];
  if (recipients.length === 0) return { sent: false, reason: "no_recipient" };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: message.displayName ? withDisplayName(from, message.displayName) : from,
        to: recipients,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      // Une messagerie lente ne doit pas bloquer la réponse au client.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[resend] envoi refusé", response.status, detail.slice(0, 300));
      return { sent: false, reason: "rejected", detail: `HTTP ${response.status}` };
    }

    const payload = (await response.json()) as { id?: string };
    return { sent: true, id: payload.id ?? "" };
  } catch (error) {
    console.error("[resend] envoi impossible", error);
    return {
      sent: false,
      reason: "error",
      detail: error instanceof Error ? error.message : "inconnue",
    };
  }
}
