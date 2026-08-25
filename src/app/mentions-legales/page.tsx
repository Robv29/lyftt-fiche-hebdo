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
 * ⚠️ PAGE INCOMPLÈTE, VOLONTAIREMENT NON LIÉE DEPUIS LE PORTAIL CLIENT.
 *
 * Les mentions marquées `[À COMPLÉTER]` relèvent d'informations d'entreprise
 * qui ne figurent nulle part dans le dépôt : elles ne peuvent pas être
 * déduites du code, et les inventer serait pire que de les omettre. Une fois
 * renseignées, retirer le bandeau `DraftNotice` ci-dessous et ajouter le lien
 * vers cette page dans `PrivacyNotice`.
 */
export default function MentionsLegalesPage() {
  return (
    <LegalPage
      title="Mentions légales"
      updatedAt="25 août 2026"
      intro="Informations légales relatives à l'éditeur et à l'hébergement de cette application."
    >
      <DraftNotice />

      <LegalSection title="Éditeur">
        <ul>
          <li>Dénomination sociale : <Todo>dénomination exacte</Todo></li>
          <li>Forme juridique : <Todo>SAS, SARL, EI…</Todo></li>
          <li>Capital social : <Todo>montant</Todo></li>
          <li>Siège social : <Todo>adresse complète</Todo></li>
          <li>Immatriculation : RCS <Todo>ville et numéro</Todo></li>
          <li>Numéro de TVA intracommunautaire : <Todo>numéro</Todo></li>
          <li>Directeur de la publication : <Todo>nom et prénom</Todo></li>
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
            <a className="underline" href="https://supabase.com" rel="noreferrer noopener" target="_blank">supabase.com</a>
            {" "}— données hébergées dans l&apos;Union européenne (région de Paris).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          Les contenus produits pour le compte des clients de LYFTT restent régis par le contrat
          de prestation conclu avec chaque client, notamment s&apos;agissant de la cession des
          droits d&apos;exploitation. <Todo>préciser le renvoi au contrat type</Todo>
        </p>
      </LegalSection>

      <LegalSection title="Données personnelles">
        <p>
          Le traitement des données personnelles est décrit dans la{" "}
          <a className="underline" href="/politique-de-confidentialite">politique de confidentialité</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

/** Marqueur visible : aucune information inventée ne doit passer pour acquise. */
function Todo({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[#fff4e5] px-1.5 py-0.5 text-[0.8em] font-semibold text-[#8a5700]">
      [À COMPLÉTER : {children}]
    </span>
  );
}

function DraftNotice() {
  return (
    <p className="mt-8 rounded border border-[#f0c987] bg-[#fff8ec] px-4 py-3 text-sm leading-relaxed text-[#8a5700]">
      <strong>Page en cours de rédaction.</strong> Les informations d&apos;identification de
      l&apos;éditeur restent à compléter : cette page n&apos;est pas encore référencée depuis le
      portail client.
    </p>
  );
}
