"use client";

import { useState } from "react";
import { LYFTT_CLIENT_TYPES } from "@/lib/domain/hashtags";

/**
 * Création d'un client en prestation ponctuelle.
 *
 * Un one-shot — un shooting, un site, une vidéo — n'a pas de gestion des
 * réseaux. Le formulaire complet exigeait pourtant cinq hashtags, des réseaux,
 * un groupe WhatsApp, des jours de publication et une échéance de validation :
 * autant de réponses inventées pour un client qui n'aura jamais de fiche
 * hebdomadaire. On ne demande ici que ce qui sert : qui, où, quoi.
 */
export function OneShotClientForm({
  pending,
  prefillName,
  transmissionId,
  onSubmit,
}: {
  pending: boolean;
  prefillName?: string;
  transmissionId?: string;
  onSubmit: (formData: FormData) => void;
}) {
  const [contacts, setContacts] = useState<string[]>(["principal"]);

  return (
    <form
      /*
        `onSubmit` plutôt que `action`, comme le formulaire de gestion : React
        vide un formulaire dont l'action est une fonction, même en échec.
      */
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
      className="card reveal-panel space-y-6 p-5 sm:p-7"
    >
      {transmissionId && <input type="hidden" name="transmissionId" value={transmissionId}/>}
      <div>
        <p className="eyebrow">Nouveau dossier · prestation ponctuelle</p>
        <h2 className="mt-1 text-lg font-semibold">Client sans gestion des réseaux</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Pas de planning, pas de fiche hebdomadaire, pas de mois facturés. La prestation
          vendue s&apos;inscrit ensuite dans le budget du client.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="os-name">Nom du client</label>
          <input id="os-name" name="name" required maxLength={120} className="field" defaultValue={prefillName}/>
        </div>
        <div>
          <label className="label" htmlFor="os-type">Secteur</label>
          <select id="os-type" name="clientType" required className="field" defaultValue="commerce">
            {LYFTT_CLIENT_TYPES.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="os-prestation">Prestation vendue</label>
          <input id="os-prestation" name="prestation" required maxLength={300} className="field"
            placeholder="Shooting produits ½ journée // Site vitrine // Vidéo de présentation"/>
        </div>
        <div>
          <label className="label" htmlFor="os-activity">Activité</label>
          <input id="os-activity" name="activity" required maxLength={120} className="field"/>
        </div>
        <div>
          <label className="label" htmlFor="os-website">Site internet <span className="font-normal text-ink-faint">(facultatif)</span></label>
          <input id="os-website" name="website" className="field" placeholder="monsite.fr"/>
        </div>
        <div>
          <label className="label" htmlFor="os-city">Ville</label>
          <input id="os-city" name="city" required maxLength={100} className="field"/>
        </div>
        <div>
          <label className="label" htmlFor="os-cp">Code postal</label>
          <input id="os-cp" name="postalCode" required pattern="\d{5}" inputMode="numeric" maxLength={5} className="field"/>
        </div>
      </div>

      <div>
        <p className="label">Contact{contacts.length > 1 ? "s" : ""}</p>
        <div className="space-y-3">
          {contacts.map((key, index) => (
            <div key={key} className="grid gap-3 sm:grid-cols-4">
              <input name="contactFirstName" required placeholder="Prénom" className="field" aria-label={`Prénom du contact ${index + 1}`}/>
              <input name="contactLastName" required placeholder="Nom" className="field" aria-label={`Nom du contact ${index + 1}`}/>
              <input name="contactPhone" required placeholder="Téléphone" className="field" aria-label={`Téléphone du contact ${index + 1}`}/>
              <input name="contactEmail" type="email" required placeholder="E-mail" className="field" aria-label={`E-mail du contact ${index + 1}`}/>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-xs font-semibold text-accent hover:underline"
          onClick={() => setContacts((rows) => [...rows, `c${rows.length}`])}>
          Ajouter un contact
        </button>
      </div>

      <div>
        <label className="label" htmlFor="os-logo">Logo <span className="font-normal text-ink-faint">(facultatif)</span></label>
        <input id="os-logo" name="logo" type="file" accept="image/*" className="field"/>
      </div>

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Création…" : "Créer le client ponctuel"}
      </button>
    </form>
  );
}
