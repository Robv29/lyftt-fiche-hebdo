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

function recipientsOf(message: EmailMessage): string[] {
  return [...new Set(message.to.filter((address) => address?.includes("@")))];
}

/** Corps d'un message au format de l'API Resend, pour l'envoi seul ou groupé. */
function resendPayload(message: EmailMessage, from: string) {
  return {
    from: message.displayName ? withDisplayName(from, message.displayName) : from,
    to: recipientsOf(message),
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  };
}

export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  // Sans configuration, on n'échoue pas : l'alerte interne dans l'application
  // reste la source de vérité, l'e-mail n'en est qu'un rappel.
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  if (recipientsOf(message).length === 0) return { sent: false, reason: "no_recipient" };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload(message, from)),
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

const RESEND_BATCH_ENDPOINT = "https://api.resend.com/emails/batch";

/** Nombre maximal de messages par envoi groupé chez Resend. */
export const RESEND_BATCH_LIMIT = 100;

export type BatchOutcome =
  | { sent: true; ids: string[] }
  | { sent: false; reason: "not_configured" | "no_recipient" | "rejected" | "error"; detail?: string };

/**
 * Envoi groupé : jusqu'à cent messages, chacun avec son destinataire, en un
 * seul appel.
 *
 * Resend limite le débit à quelques requêtes par seconde : un message par
 * contact envoyé à la suite serait ralenti, voire refusé, et dépasserait la
 * durée d'exécution d'une tâche planifiée. Le lot passe ou échoue en entier —
 * l'appelant sait donc exactement ce qu'il doit réessayer.
 */
export async function sendEmailBatch(messages: EmailMessage[]): Promise<BatchOutcome> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  if (messages.length === 0 || messages.some((message) => recipientsOf(message).length === 0)) {
    return { sent: false, reason: "no_recipient" };
  }
  if (messages.length > RESEND_BATCH_LIMIT) {
    return { sent: false, reason: "rejected", detail: `${RESEND_BATCH_LIMIT} messages maximum par lot` };
  }

  try {
    const response = await fetch(RESEND_BATCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages.map((message) => resendPayload(message, from))),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[resend] envoi groupé refusé", response.status, detail.slice(0, 300));
      /*
       * 4xx : Resend a refusé le lot, rien n'est parti. 5xx : l'issue est
       * inconnue — le lot a pu être accepté avant l'erreur — et se traite
       * comme une coupure réseau, pour ne jamais renvoyer un doublon.
       */
      return {
        sent: false,
        reason: response.status >= 500 ? "error" : "rejected",
        detail: `HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as { data?: { id?: string }[] };
    return { sent: true, ids: (payload.data ?? []).map((entry) => entry.id ?? "") };
  } catch (error) {
    console.error("[resend] envoi groupé impossible", error);
    return {
      sent: false,
      reason: "error",
      detail: error instanceof Error ? error.message : "inconnue",
    };
  }
}
