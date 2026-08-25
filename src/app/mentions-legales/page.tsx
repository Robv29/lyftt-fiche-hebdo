import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Mentions légales — LYFTT",
  description: "Mentions légales de l'application LYFTT.",
  robots: { index: false, follow: false },
};

/**
 * Mentions légales — LCEN n° 2004-575, art. 6 III.
 *
 * Identification issue des registres publics (INSEE, RNE) au 25 août 2026,
 * capital social et numéro de TVA confirmés par l'éditeur le même jour.
 *
 * Aucun médiateur de la consommation n'est désigné (art. L.612-1 du Code de la
 * consommation) : la clientèle est exclusivement professionnelle — sociétés et
 * auto-entrepreneurs — et l'obligation ne vise que les litiges avec un
 * consommateur. À revoir si un client non professionnel venait à être signé.
 */
export default function MentionsLegalesPage() {
  return (
    <LegalPage
      title="Mentions légales"
      updatedAt="25 août 2026"
      intro="Informations légales relatives à l'éditeur et à l'hébergement de cette application."
    >
      <LegalSection title="Éditeur du site">
        <ul>
          <li>Dénomination sociale : <strong>LYFTT</strong></li>
          <li>Forme juridique : société à responsabilité limitée (SARL)</li>
          <li>Capital social : 1 000 euros</li>
          <li>Siège social : 3 chemin de la Côte Blanche, 31290 Montgaillard-Lauragais, France</li>
          <li>Immatriculation : RCS Toulouse 918 727 579</li>
          <li>SIRET du siège : 918 727 579 00016</li>
          <li>Numéro de TVA intracommunautaire : FR 14 918 727 579</li>
          <li>Directeur de la publication : Robin Vergnes, gérant</li>
          <li>
            Contact : <a className="underline" href="mailto:contact@lyftt.fr">contact@lyftt.fr</a>
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Hébergement">
        <p>L&apos;application est hébergée par :</p>
        <ul>
          <li>
            <strong>Vercel Inc.</strong> — 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis —{" "}
            <a className="underline" href="https://vercel.com" rel="noreferrer noopener" target="_blank">vercel.com</a>
          </li>
          <li>
            <strong>Supabase, Inc.</strong> — 970 Toa Payoh North #07-04, Singapour 318992 —{" "}
            <a className="underline" href="https://supabase.com" rel="noreferrer noopener" target="_blank">supabase.com</a>.
            Les données sont hébergées dans l&apos;Union européenne (région de Paris).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Accès à l'application">
        <p>
          Cette application est un outil professionnel réservé à l&apos;équipe de LYFTT et à ses
          clients. L&apos;accès à l&apos;espace de travail requiert un compte nominatif ; la
          consultation des fiches par les clients se fait au moyen d&apos;un lien personnel et
          temporaire, sans création de compte.
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L&apos;application, sa structure, ses composants et ses éléments graphiques sont la
          propriété de LYFTT et sont protégés par le Code de la propriété intellectuelle. Toute
          reproduction ou représentation, totale ou partielle, sans autorisation écrite préalable,
          est interdite.
        </p>
        <p>
          Les contenus produits pour le compte des clients — photographies, vidéos, textes —
          demeurent régis par le contrat de prestation conclu avec chaque client, seul à
          déterminer l&apos;étendue et la durée de la cession des droits d&apos;exploitation
          consentie, conformément à l&apos;article L.131-3 du Code de la propriété intellectuelle.
        </p>
      </LegalSection>

      <LegalSection title="Données personnelles et cookies">
        <p>
          Le traitement des données personnelles, les durées de conservation, les sous-traitants
          et les modalités d&apos;exercice de vos droits sont décrits dans la{" "}
          <a className="underline" href="/politique-de-confidentialite">politique de confidentialité</a>.
          L&apos;application ne dépose aucun cookie publicitaire ni traceur de mesure
          d&apos;audience.
        </p>
      </LegalSection>

      <LegalSection title="Responsabilité">
        <p>
          LYFTT met en œuvre les moyens raisonnables pour assurer la disponibilité et
          l&apos;exactitude des informations présentées dans l&apos;application. Elle ne saurait
          toutefois être tenue responsable des interruptions liées à la maintenance, aux
          opérateurs techniques ou à des causes extérieures, ni des dommages indirects résultant
          de l&apos;utilisation de l&apos;application. Les engagements de LYFTT envers ses clients
          sont ceux définis au contrat de prestation.
        </p>
      </LegalSection>

      <LegalSection title="Droit applicable">
        <p>
          Les présentes mentions sont soumises au droit français. À défaut de résolution amiable,
          tout litige relatif à leur interprétation ou à leur exécution relève de la compétence
          des tribunaux français.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
