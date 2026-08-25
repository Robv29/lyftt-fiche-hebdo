import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Politique de confidentialité — LYFTT",
  description: "Traitement des données personnelles sur le portail de validation LYFTT.",
  robots: { index: false, follow: false },
};

/**
 * §20 — information des personnes (art. 13 RGPD).
 *
 * Le portail client renvoyait jusqu'ici vers `lyftt.fr/politique-de-confidentialite`,
 * qui répond 404 : les contacts clients n'avaient donc accès à aucune
 * information sur le traitement de leurs données. La page est servie par
 * l'application elle-même, au plus près du traitement qu'elle décrit.
 *
 * Tout ce qui est affirmé ici est vérifiable dans le code : les durées citées
 * sont celles réellement appliquées (purge des médias, aperçus), et aucune
 * durée n'est avancée là où l'entreprise ne l'a pas encore arrêtée.
 */
export default function PolitiqueDeConfidentialitePage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      updatedAt="25 août 2026"
      intro="Cette page décrit la manière dont LYFTT traite les données personnelles sur son portail de validation et dans l'outil de production éditoriale qui l'alimente."
    >
      <LegalSection title="Responsable du traitement">
        <p>
          LYFTT est responsable des traitements décrits ci-dessous. Toute question relative à
          vos données peut être adressée à votre community manager, ou à l&apos;adresse{" "}
          <a className="underline" href="mailto:contact@lyftt.fr">contact@lyftt.fr</a>.
        </p>
      </LegalSection>

      <LegalSection title="Données traitées et finalités">
        <p>Selon votre relation avec LYFTT, les traitements suivants vous concernent :</p>
        <ul>
          <li>
            <strong>Validation des contenus.</strong> Vos validations, demandes de modification,
            commentaires, pièces jointes et notes de satisfaction, afin d&apos;établir la preuve
            de la validation contractuelle des contenus qui vous sont destinés.
            Base légale : exécution du contrat.
          </li>
          <li>
            <strong>Gestion de la relation client.</strong> Nom, prénom, adresse e-mail,
            téléphone, fonction et, lorsqu&apos;un prélèvement est mis en place, vos coordonnées
            bancaires, aux fins d&apos;exécution de la prestation et de facturation.
            Base légale : exécution du contrat et obligations comptables.
          </li>
          <li>
            <strong>Contenus éditoriaux.</strong> Les photographies et vidéos produites pour
            votre compte peuvent comporter des personnes identifiables. Base légale :
            exécution du contrat, sous réserve des autorisations de droit à l&apos;image
            recueillies auprès des personnes représentées.
          </li>
          <li>
            <strong>Notifications.</strong> Nom, adresse e-mail et lien de validation, pour vous
            avertir qu&apos;une fiche vous attend. Ces envois sont strictement transactionnels :
            LYFTT n&apos;adresse aucune prospection commerciale depuis cet outil.
          </li>
          <li>
            <strong>Sécurité du portail.</strong> Une empreinte irréversible de votre adresse IP
            et la famille de votre navigateur, uniquement pour détecter les tentatives d&apos;accès
            abusives. L&apos;adresse IP n&apos;est jamais conservée en clair.
            Base légale : intérêt légitime à la sécurité du service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Destinataires et sous-traitants">
        <p>
          Vos données ne sont ni vendues, ni cédées, ni utilisées à des fins publicitaires.
          Elles sont accessibles à l&apos;équipe de LYFTT en charge de votre compte, et hébergées
          chez les prestataires suivants, qui agissent comme sous-traitants :
        </p>
        <ul>
          <li><strong>Supabase</strong> — base de données et stockage des fichiers, hébergés dans l&apos;Union européenne (région de Paris).</li>
          <li><strong>Vercel</strong> — hébergement de l&apos;application.</li>
          <li><strong>Resend</strong> — acheminement des e-mails de notification.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Durées de conservation">
        <ul>
          <li>
            Les <strong>fichiers originaux</strong> des médias sont supprimés automatiquement
            après leur publication, et les aperçus au plus tard trente jours après.
          </li>
          <li>
            Les <strong>liens de validation</strong> expirent à la date fixée lors de leur envoi ;
            un lien expiré ou révoqué ne donne plus accès à aucun contenu.
          </li>
          <li>
            Les <strong>preuves de validation</strong> et les données de facturation sont
            conservées pendant la durée de la relation contractuelle, puis archivées le temps
            des délais légaux de prescription et de conservation comptable qui s&apos;y attachent.
          </li>
          <li>
            Les <strong>coordonnées de contact</strong> sont conservées pendant la durée de la
            relation contractuelle.
          </li>
          <li>
            Les <strong>coordonnées bancaires</strong>, lorsqu&apos;un prélèvement est mis en
            place, sont conservées jusqu&apos;à la fin de la gestion, puis trente jours au-delà
            afin de couvrir le dernier prélèvement et la facture de solde. Elles sont ensuite
            supprimées automatiquement, fichier compris.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Vos droits">
        <p>
          Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de
          limitation et d&apos;opposition, ainsi que d&apos;un droit à la portabilité des données
          que vous nous avez fournies. Vous pouvez les exercer auprès de votre community manager
          ou à l&apos;adresse{" "}
          <a className="underline" href="mailto:contact@lyftt.fr">contact@lyftt.fr</a>.
        </p>
        <p>
          Si une photographie ou une vidéo vous représente et que vous souhaitez en demander le
          retrait, écrivez à cette même adresse : la demande est traitée sans qu&apos;il soit
          nécessaire de la motiver.
        </p>
        <p>
          Vous pouvez également introduire une réclamation auprès de la Commission nationale de
          l&apos;informatique et des libertés (CNIL), 3 place de Fontenoy, 75007 Paris —{" "}
          <a className="underline" href="https://www.cnil.fr" rel="noreferrer noopener" target="_blank">www.cnil.fr</a>.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Le portail de validation ne dépose <strong>aucun cookie publicitaire ni aucun traceur
          de mesure d&apos;audience</strong>. Seul un cookie de session est utilisé dans la partie
          réservée à l&apos;équipe de LYFTT, pour maintenir la connexion de ses membres : il est
          strictement nécessaire au fonctionnement du service et ne requiert donc pas votre
          consentement. Consulter une fiche depuis un lien de validation n&apos;en dépose aucun.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
