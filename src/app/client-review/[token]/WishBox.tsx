"use client";

import { useState } from "react";
import { WISH_MAX_LENGTH, WISH_MIN_LENGTH } from "@/lib/domain/weekly-wish";

/**
 * « Vos envies » — recueilli à côté de la validation finale.
 *
 * Le client vient de regarder ses publications : c'est le seul moment de la
 * semaine où il a la semaine suivante en tête et où répondre ne lui coûte
 * rien. Le bloc est facultatif, et le dit ; valider sans le remplir reste un
 * clic.
 *
 * Il n'est pas placé dans la modale de note : celle-ci est déjà un sondage, et
 * en empiler un second la ferait fermer sans la lire.
 */

interface Props {
  pending: boolean;
  /** Référence de l'envie déjà déposée pour cette fiche, s'il y en a une. */
  existingWish: { ticketNumber: string; isOpen: boolean } | null;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}

export function WishBox({ pending, existingWish, onSubmit, onCancel }: Props) {
  /*
   * Champ tenu par l'état : React vide un formulaire à action-fonction dès la
   * soumission, avant de savoir si elle aboutit. Un envoi refusé effaçait donc
   * les quelques lignes que le client venait d'écrire.
   */
  const [wish, setWish] = useState("");

  if (existingWish) {
    return (
      <section className="reveal-panel mt-4 rounded-[18px] border border-[#cbdff1] bg-[#f7fafe] p-4 sm:p-5">
        <h2 className="font-semibold">Votre envie est déjà notée</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          {existingWish.isOpen
            ? `Elle porte la référence ${existingWish.ticketNumber}. Votre community manager la traite et revient vers vous.`
            : `Elle portait la référence ${existingWish.ticketNumber} et a été prise en compte. Pour un nouveau besoin, parlez-en à votre community manager.`}
        </p>
        <button type="button" className="btn-secondary mt-4" onClick={onCancel}>
          Fermer
        </button>
      </section>
    );
  }

  return (
    <form
      action={(formData) => onSubmit(formData)}
      className="reveal-panel mt-4 space-y-4 rounded-[18px] border border-[#cbdff1] bg-[#f7fafe] p-4 sm:p-5"
    >
      <div>
        <h2 className="font-semibold">
          Vos envies pour la semaine prochaine{" "}
          <span className="font-normal text-ink-faint">(facultatif)</span>
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Un produit à mettre en avant, un événement, un sujet qui vous tient à
          cœur&nbsp;? Dites-le ici&nbsp;: nous en tenons compte en préparant la
          semaine suivante. Rien à remplir si vous n&apos;avez rien à signaler.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="wish">
          Ce que vous aimeriez voir
        </label>
        <textarea
          id="wish"
          name="wish"
          rows={4}
          required
          minLength={WISH_MIN_LENGTH}
          maxLength={WISH_MAX_LENGTH}
          value={wish}
          onChange={(event) => setWish(event.target.value)}
          className="field"
          placeholder="Par exemple : mettre en avant la nouvelle gamme, parler des horaires d'hiver, montrer l'équipe."
        />
        <p className="mt-1 text-xs text-ink-faint">
          {WISH_MAX_LENGTH} caractères au maximum.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="wishClientName">
            Votre nom <span className="font-normal text-ink-faint">(facultatif)</span>
          </label>
          <input
            id="wishClientName"
            name="clientName"
            maxLength={120}
            className="field"
            autoComplete="name"
          />
        </div>
        <div>
          <label className="label" htmlFor="wishClientEmail">
            Votre e-mail <span className="font-normal text-ink-faint">(facultatif)</span>
          </label>
          <input
            id="wishClientEmail"
            name="clientEmail"
            type="email"
            maxLength={200}
            className="field"
            autoComplete="email"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer mes envies"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
