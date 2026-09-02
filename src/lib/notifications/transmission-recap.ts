import { escape } from "./ticket-email";

/**
 * Récapitulatif d'accompagnement envoyé au client, juste après sa signature.
 *
 * Deuxième étape du parcours de « Transmission client ». Le message confirme
 * noir sur blanc ce que le client a commandé — jusqu'ici, entre la signature
 * et le premier rendez-vous, il n'avait plus aucune trace écrite de son menu.
 *
 * Logique pure, sans réseau, sur le modèle de `ticket-email` : c'est ce qui
 * rend le contenu testable sans envoyer quoi que ce soit. L'échappement est
 * emprunté au même module plutôt que recopié — deux fonctions d'échappement
 * finissent toujours par diverger, et c'est l'oubliée qui laisse passer.
 *
 * Le ton reprend le vocabulaire du menu que le client vient de composer dans
 * le CRM (« Passez en cuisine », « la brigade ») sans en faire un numéro : le
 * client attend une confirmation, pas une carte de restaurant.
 */

export interface RecapEmailInput {
  entreprise: string;
  /** Prénom du contact, quand le CRM le connaît. */
  contactPrenom: string | null;
  /** Menu retenu — la version validée à l'étape 1. */
  menu: string | null;
  /** Rendez-vous déjà mis en forme à l'heure de Paris, ou null. */
  rendezVousLabel: string | null;
  /** Nom du chef de projet qui signe le message. */
  chefDeProjet: string;
}

const SIGNATURE_ROLE = "Chef de projet — Lyftt";

/** Objet : lisible dans une liste de messagerie, sur téléphone, sans ouvrir. */
export function buildRecapSubject(input: RecapEmailInput): string {
  return `Votre menu est bien noté — ${input.entreprise}`;
}

function salutation(input: RecapEmailInput): string {
  const prenom = (input.contactPrenom ?? "").trim();
  return prenom.length > 0 ? `Bonjour ${prenom},` : "Bonjour,";
}

/**
 * Ce qui se passe ensuite.
 *
 * Le rendez-vous n'est pas mentionné : le client l'a déjà pris lui-même en
 * composant son menu, le lui reproposer donnerait l'impression qu'on ne l'a
 * pas vu passer.
 */
function suite(): string {
  return "La brigade se met au travail. Nous revenons vers vous à chaque étape,"
    + " et vous n'avez plus rien à faire de votre côté.";
}

const MENU_ABSENT = "Votre menu n’a pas encore été arrêté : nous le fixerons ensemble.";

/** Version texte — certaines messageries n'affichent que celle-ci. */
export function buildRecapText(input: RecapEmailInput): string {
  return [
    salutation(input),
    "",
    "Merci pour votre confiance. Votre menu nous est bien parvenu, la brigade s’en empare.",
    "",
    "Voici ce que nous avons retenu pour votre accompagnement :",
    "",
    input.menu ?? MENU_ABSENT,
    "",
    suite(),
    "",
    "Un oubli, un plat en trop, une envie de dernière minute ? Répondez simplement à ce"
      + " message, on rectifie avant le premier coup de feu.",
    "",
    "À très vite,",
    "",
    input.chefDeProjet,
    SIGNATURE_ROLE,
  ].join("\n");
}

export function buildRecapHtml(input: RecapEmailInput): string {
  const menu = input.menu
    ? `<p style="margin:4px 0 0;padding:14px 16px;background:#fafaf9;border-radius:6px;
         font-size:15px;line-height:1.7;white-space:pre-wrap;">${escape(input.menu)}</p>`
    : `<p style="margin:4px 0 0;padding:14px 16px;background:#fafaf9;border-radius:6px;
         font-size:15px;line-height:1.7;font-style:italic;color:#8a8a8a;">${escape(MENU_ABSENT)}</p>`;


  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">${escape(salutation(input))}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
      Merci pour votre confiance. Votre menu nous est bien parvenu, la brigade s’en empare.
    </p>

    <p style="margin:0;font-size:13px;color:#8a8a8a;">Votre accompagnement</p>
    ${menu}
    

    <p style="margin:20px 0 0;font-size:15px;line-height:1.6;">${escape(suite())}</p>
    <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">
      Un oubli, un plat en trop, une envie de dernière minute ? Répondez simplement à ce
      message, on rectifie avant le premier coup de feu.
    </p>

    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e4;
       font-size:15px;line-height:1.6;">
      À très vite,<br>
      <strong>${escape(input.chefDeProjet)}</strong><br>
      <span style="font-size:13px;color:#8a8a8a;">${escape(SIGNATURE_ROLE)}</span>
    </p>
  </div>
</body></html>`;
}
