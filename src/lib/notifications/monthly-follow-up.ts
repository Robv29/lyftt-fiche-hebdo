import { escape } from "./ticket-email";

/**
 * Proposition mensuelle de rendez-vous de suivi, envoyée le 5 du mois.
 *
 * Logique pure, sur le modèle du récapitulatif de transmission : le contenu se
 * teste sans rien envoyer. Le message tient en une idée — faire le point sur
 * le mois écoulé — et un seul bouton : un client pressé doit pouvoir réserver
 * sans lire le reste.
 */

export interface FollowUpEmailInput {
  /** Dossiers suivis par ce contact : presque toujours un seul. */
  clientNames: string[];
  firstName: string | null;
  /** Mois dont on fait le bilan, en toutes lettres : « septembre ». */
  reviewedMonth: string;
  bookingUrl: string;
}

const SIGNATURE = "L’équipe Lyftt";
const CTA_LABEL = "Choisir mon créneau";

/** « de septembre », « d’août » : l'élision suit la voyelle. */
function ofMonth(month: string): string {
  return /^[aeiouyéè]/i.test(month) ? `d’${month}` : `de ${month}`;
}

function salutation(input: FollowUpEmailInput): string {
  const firstName = (input.firstName ?? "").trim();
  return firstName ? `Bonjour ${firstName},` : "Bonjour,";
}

function intro(input: FollowUpEmailInput): string {
  return `Le mois ${ofMonth(input.reviewedMonth)} est derrière nous : c’est le bon moment pour`
    + " faire le point ensemble sur vos réseaux sociaux — ce qui a fonctionné, ce que l’on"
    + " ajuste, et ce qui arrive le mois prochain.";
}

const INVITATION = "Nous vous proposons un rendez-vous de suivi. Choisissez le créneau qui vous arrange :";
const CLOSING = "Une question d’ici là ? Répondez simplement à ce message.";

/** « A », « A et B », « A, B et C ». */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

export function buildFollowUpSubject(input: FollowUpEmailInput): string {
  return `Votre bilan du mois ${ofMonth(input.reviewedMonth)} — ${joinNames(input.clientNames)}`;
}

/** Version texte — certaines messageries n'affichent que celle-ci. */
export function buildFollowUpText(input: FollowUpEmailInput): string {
  return [
    salutation(input),
    "",
    intro(input),
    "",
    INVITATION,
    input.bookingUrl,
    "",
    CLOSING,
    "",
    "À très vite,",
    SIGNATURE,
  ].join("\n");
}

export function buildFollowUpHtml(input: FollowUpEmailInput): string {
  const url = escape(input.bookingUrl);
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">${escape(salutation(input))}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escape(intro(input))}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">${escape(INVITATION)}</p>

    <p style="margin:0 0 20px;">
      <a href="${url}" style="display:inline-block;padding:13px 22px;background:#111;color:#fff;
         border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">${escape(CTA_LABEL)}</a>
    </p>
    <p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#8a8a8a;">
      Le bouton ne s’ouvre pas ? Copiez ce lien : <a href="${url}" style="color:#8a8a8a;">${url}</a>
    </p>

    <p style="margin:0;font-size:15px;line-height:1.6;">${escape(CLOSING)}</p>

    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e4;
       font-size:15px;line-height:1.6;">
      À très vite,<br>
      <strong>${escape(SIGNATURE)}</strong>
    </p>
  </div>
</body></html>`;
}
