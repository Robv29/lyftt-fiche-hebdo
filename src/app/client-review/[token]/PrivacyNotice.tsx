/** §20 — information courte et lisible sur le traitement des données. */
export function PrivacyNotice() {
  return (
    <footer className="mt-12 border-t border-line pt-6 text-xs leading-relaxed text-ink-faint">
      <p>
        Les informations saisies sur cette page sont traitées par <strong>LYFTT</strong>,
        responsable du traitement, dans le seul but de recueillir votre validation et vos
        demandes de modification sur les contenus qui vous sont destinés.
      </p>
      <p className="mt-2">
        Nous conservons ces éléments le temps de la prestation, puis pendant la durée
        prévue à votre contrat. Vous disposez d'un droit d'accès, de rectification et de
        suppression, que vous pouvez exercer auprès de votre community manager ou à
        l'adresse <a className="underline" href="mailto:contact@lyftt.fr">contact@lyftt.fr</a>.
      </p>
      <p className="mt-2">
        <a className="underline" href="https://lyftt.fr/politique-de-confidentialite">
          Politique de confidentialité
        </a>
      </p>
    </footer>
  );
}
