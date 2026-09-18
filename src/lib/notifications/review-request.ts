import { escape } from "./ticket-email";

/**
 * Demande d'avis Google, une fois par trimestre — sur un ton léger.
 *
 * Quatre versions, une par saison : le même message reçu quatre fois par an
 * deviendrait vite un courriel qu'on n'ouvre plus. L'humour tient dans
 * l'accroche ; la demande, elle, reste nette : un avis honnête, un bouton.
 * On n'oriente pas vers les bonnes notes — les règles de Google l'interdisent,
 * et un avis qu'on a soufflé ne vaut rien.
 *
 * Le message revient chaque trimestre, sans savoir qui a déjà laissé un avis :
 * il remercie donc ceux qui l'ont fait, et dit comment ne plus le recevoir —
 * une sollicitation récurrente doit l'indiquer.
 *
 * Typographie française : apostrophes courbes, espace insécable avant « ! ? : »
 * pour que la ponctuation ne parte pas seule à la ligne sur un téléphone.
 */

export interface ReviewEmailInput {
  firstName: string | null;
  /** Dossiers suivis par ce contact : presque toujours un seul. */
  clientNames: string[];
  quarter: 1 | 2 | 3 | 4;
  reviewUrl: string;
}

const NBSP = " ";

const SEASONS: Record<ReviewEmailInput["quarter"], { subject: string; hook: string }> = {
  1: {
    subject: `Une bonne résolution qui prend deux minutes${NBSP}🥂`,
    hook: `On ne va pas vous souhaiter une bonne année une énième fois (bon, si${NBSP}: bonne année${NBSP}!). `
      + `On a plutôt une résolution à vous proposer, sans salle de sport ni régime${NBSP}: nous laisser un petit avis.`,
  },
  2: {
    subject: `Petit service de printemps (promis, pas de ménage)${NBSP}🌷`,
    hook: "Le printemps est là, les oiseaux chantent, et notre fiche Google aimerait bien avoir de vos nouvelles. "
      + "On a demandé aux oiseaux de faire passer le message, mais ils ne parlent qu’en gazouillis.",
  },
  3: {
    subject: `Avant la crème solaire, deux minutes pour nous${NBSP}?${NBSP}☀️`,
    hook: "Avant que vous ne partiez vous dorer la pilule (c’est bien mérité), une toute petite mission, "
      + "plus courte qu’une file d’attente chez le glacier.",
  },
  4: {
    subject: `Un avis, et on vous laisse ranger les feuilles mortes${NBSP}🍂`,
    hook: "Les feuilles tombent, les pulls ressortent, et nous, on prend notre courage à deux mains "
      + "pour vous demander un petit service.",
  },
};

const CTA_LABEL = "Laisser mon avis";
const SIGNATURE = "L’équipe Lyftt";
const ALREADY_DONE = `Vous nous avez déjà laissé un avis${NBSP}? Merci mille fois${NBSP}! Vous pouvez ignorer ce message, `
  + "ou mettre votre avis à jour si l’envie vous prend.";
const CLOSING = `Et s’il y a quelque chose à améliorer, dites-le aussi${NBSP}: on lit absolument tout, même les virgules.`;
const OPT_OUT = `Plus envie de recevoir ce petit message trimestriel${NBSP}? Répondez «${NBSP}stop${NBSP}» à ce message, `
  + "on vous retire de la liste.";

/** « A », « A et B », « A, B et C ». */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/**
 * Prénom tel qu'on l'écrit dans une lettre : « GRÉGORY » ou « grégory »
 * deviennent « Grégory », « jean-pierre » devient « Jean-Pierre ». Un prénom
 * déjà en casse mixte est laissé tel quel — c'est qu'on l'a voulu ainsi.
 */
export function formatFirstName(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed
    .toLocaleLowerCase("fr")
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase("fr"));
}

function salutation(input: ReviewEmailInput): string {
  const firstName = (input.firstName ?? "").trim();
  return firstName ? `Bonjour ${formatFirstName(firstName)},` : "Bonjour,";
}

function ask(input: ReviewEmailInput): string {
  const clients = joinNames(input.clientNames);
  return `Votre avis honnête sur notre travail${clients ? ` pour ${clients}` : ""} nous aiderait vraiment${NBSP}: `
    + "c’est comme ça que d’autres entreprises nous découvrent. Deux minutes, montre en main.";
}

export function buildReviewSubject(input: ReviewEmailInput): string {
  return SEASONS[input.quarter].subject;
}

/** Version texte — certaines messageries n'affichent que celle-ci. */
export function buildReviewText(input: ReviewEmailInput): string {
  return [
    salutation(input),
    "",
    SEASONS[input.quarter].hook,
    "",
    ask(input),
    "",
    `${CTA_LABEL}${NBSP}: ${input.reviewUrl}`,
    "",
    ALREADY_DONE,
    "",
    CLOSING,
    "",
    "Merci infiniment,",
    SIGNATURE,
    "",
    OPT_OUT,
  ].join("\n");
}

export function buildReviewHtml(input: ReviewEmailInput): string {
  const url = escape(input.reviewUrl);
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">${escape(salutation(input))}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escape(SEASONS[input.quarter].hook)}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">${escape(ask(input))}</p>

    <p style="margin:0 0 20px;">
      <a href="${url}" style="display:inline-block;padding:13px 22px;background:#111;color:#fff;
         border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">${escape(CTA_LABEL)} ⭐</a>
    </p>
    <p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#8a8a8a;">
      Le bouton ne s’ouvre pas${NBSP}? Copiez ce lien${NBSP}: <a href="${url}" style="color:#8a8a8a;">${url}</a>
    </p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escape(ALREADY_DONE)}</p>
    <p style="margin:0;font-size:15px;line-height:1.6;">${escape(CLOSING)}</p>

    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e4;
       font-size:15px;line-height:1.6;">
      Merci infiniment,<br>
      <strong>${escape(SIGNATURE)}</strong>
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#8a8a8a;">${escape(OPT_OUT)}</p>
  </div>
</body></html>`;
}
