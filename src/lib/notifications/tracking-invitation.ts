import { escape } from "./ticket-email";

/**
 * Invitation à un rendez-vous de suivi, pour les produits de suivi mensuel.
 *
 * Même forme que la proposition de bilan mensuel — une idée, un bouton — mais
 * elle dit en plus ce dont on parlera : le budget publicitaire, l'accompagnement
 * marketing, ou les deux. Un client qui détient les deux produits reçoit une
 * seule invitation par créneau, dont l'ordre du jour les nomme tous les deux :
 * c'est le même rendez-vous, avec la même personne.
 *
 * Logique pure : le contenu se teste sans rien envoyer.
 */

export interface TrackingInvitationEmailInput {
  /** Dossiers suivis par ce contact : presque toujours un seul. */
  clientNames: string[];
  firstName: string | null;
  /** Sujets à l'ordre du jour : « votre budget publicitaire »… */
  topics: string[];
  /** Rang du rendez-vous dans le mois, à partir de 1, et total du mois. */
  slotNumber: number;
  slotCount: number;
  bookingUrl: string;
}

const SIGNATURE = "L’équipe Lyftt";
const CTA_LABEL = "Choisir mon créneau";
const CLOSING = "Une question d’ici là ? Répondez simplement à ce message.";

/** « A », « A et B », « A, B et C ». */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

function salutation(input: TrackingInvitationEmailInput): string {
  const firstName = (input.firstName ?? "").trim();
  return firstName ? `Bonjour ${firstName},` : "Bonjour,";
}

/**
 * Le rang n'est annoncé que s'il y en a plusieurs : « 2ᵉ rendez-vous du mois »
 * est utile quand il y en a trois, absurde quand il n'y en a qu'un.
 */
function occurrence(input: TrackingInvitationEmailInput): string | null {
  if (input.slotCount <= 1) return null;
  const rank = input.slotNumber === 1 ? "1ᵉʳ" : `${input.slotNumber}ᵉ`;
  return `${rank} des ${input.slotCount} points de suivi prévus ce mois-ci.`;
}

function intro(input: Pick<TrackingInvitationEmailInput, "topics">): string {
  return `C’est le moment de faire le point sur ${joinNames(input.topics)} :`
    + " ce qui a été fait, les chiffres du mois, et ce que l’on ajuste pour la suite.";
}

const INVITATION = "Théo vous propose un rendez-vous. Choisissez le créneau qui vous arrange :";

export function buildTrackingInvitationSubject(input: TrackingInvitationEmailInput): string {
  return `Votre point de suivi — ${joinNames(input.clientNames)}`;
}

/** Version texte — certaines messageries n'affichent que celle-ci. */
export function buildTrackingInvitationText(input: TrackingInvitationEmailInput): string {
  const rank = occurrence(input);
  return [
    salutation(input),
    "",
    intro(input),
    ...(rank ? ["", rank] : []),
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

export function buildTrackingInvitationHtml(input: TrackingInvitationEmailInput): string {
  const url = escape(input.bookingUrl);
  const rank = occurrence(input);
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">${escape(salutation(input))}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escape(intro(input))}</p>
    ${rank ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#8a8a8a;">${escape(rank)}</p>` : ""}
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
