import type { ReactNode } from "react";
import { telHref } from "@/lib/domain/crm-transmission";

/**
 * Carte d'un client — ou d'une fiche qui va le devenir.
 *
 * L'écran « Transmission client » présente les mêmes informations que le
 * portefeuille : un logo ou des initiales, un nom, des pastilles d'état, un
 * contact, et des boutons en pied. Les recopier aurait fait vivre deux cartes
 * en parallèle, et la seconde aurait dérivé au premier ajustement de style.
 *
 * Tout ce qui varie d'un écran à l'autre passe donc par des emplacements :
 * `badges`, `detail`, `lines`, `children` et `footer`. La structure, elle, est
 * ici et nulle part ailleurs.
 */
export function ClientCard({
  name,
  logoUrl = null,
  badges,
  detail,
  lines,
  email = null,
  phone = null,
  children,
  footer,
  muted = false,
}: {
  name: string;
  logoUrl?: string | null;
  /** Pastilles affichées à la suite du nom. */
  badges?: ReactNode;
  /** Ligne d'état sous le nom (fin de gestion, rendez-vous à venir…). */
  detail?: ReactNode;
  /** Informations de la carte : contact, rythme, montant… */
  lines?: ReactNode;
  email?: string | null;
  phone?: string | null;
  /** Contenu libre inséré avant le pied — un bloc dépliant, par exemple. */
  children?: ReactNode;
  footer?: ReactNode;
  /** Grise la carte : le client ne se travaille plus. */
  muted?: boolean;
}) {
  return (
    <li className={`card lift-card p-5 ${muted ? "border-line/60 bg-canvas/60" : ""}`}>
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start gap-3">
          {logoUrl
            // Le logo prime sur les initiales : c'est ce qui permet de repérer
            // un client d'un coup d'œil dans un portefeuille.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-line bg-white object-contain"/>
            : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-sm font-bold text-[#0b5e9f]">{name.slice(0, 2).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <p className="font-semibold tracking-[-.015em]">{name}{badges}</p>
            {detail}
            {lines}
            {/*
              Téléphone et e-mail cliquables. Le numéro était déjà chargé par
              l'écran clients, puis jeté : il fallait ouvrir le dossier pour
              appeler quelqu'un.
            */}
            {(email || phone) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {email && (
                  <a href={`mailto:${email}`} className="break-all font-medium text-[#0b5e9f] underline-offset-2 hover:underline">
                    {email}
                  </a>
                )}
                {phone && (
                  <a href={`tel:${telHref(phone)}`} className="font-medium text-[#0b5e9f] underline-offset-2 hover:underline">
                    {phone}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>

        {children}

        {footer && <div className="mt-auto border-t pt-4">{footer}</div>}
      </div>
    </li>
  );
}
