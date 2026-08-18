"use client";

import { useState, useTransition } from "react";
import { submitClientRequest, type RequestResult } from "./actions";

/**
 * Ce que le client peut demander, rangé comme il y pense.
 *
 * Les familles sont celles de l'application — c'est le motif choisi qui envoie
 * la demande en production ou la laisse au community manager — mais le client
 * n'a pas à le savoir : il choisit ce qu'il veut, le tri se fait derrière.
 */
const GROUPS = [
  {
    title: "Une correction sur une publication",
    options: [
      { value: "photo_replace", label: "Remplacer une photo" },
      { value: "photo_retouch", label: "Retoucher une photo" },
      { value: "graphic_edit", label: "Modifier un visuel" },
      { value: "video_edit", label: "Modifier une vidéo" },
      { value: "video_replace", label: "Remplacer une vidéo" },
      { value: "text_edit", label: "Modifier le texte" },
      { value: "hashtags", label: "Modifier les hashtags" },
    ],
  },
  {
    title: "Le planning",
    options: [
      { value: "schedule_change", label: "Changer une date de publication" },
      { value: "network_change", label: "Changer le réseau" },
      { value: "publication_add", label: "Ajouter une publication" },
      { value: "publication_remove", label: "Retirer une publication" },
    ],
  },
  {
    title: "Une nouvelle demande",
    options: [
      { value: "shooting_request", label: "Organiser un shooting" },
      { value: "quote_request", label: "Demander un devis" },
      { value: "side_service", label: "Site web, Google, e-mailing" },
      { value: "other", label: "Autre chose" },
    ],
  },
] as const;

/**
 * Point d'entrée unique du client.
 *
 * Une seule adresse à garder pour tout ce qu'il a à demander. Le formulaire
 * tient en trois champs : ce qu'il veut, ce qu'il en dit, et de qui ça vient.
 */
export function RequestBox({ token, clientName }: { token: string; clientName: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RequestResult | null>(null);
  const [type, setType] = useState<string>("");

  if (result?.ok) {
    return (
      <section className="rounded-[24px] border border-state-approved/30 bg-state-approved/5 p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-state-approved/10 text-2xl text-state-approved" aria-hidden="true">✓</span>
        <h2 className="mt-4 text-lg font-semibold">{result.message}</h2>
        {result.reference && (
          <p className="mt-2 text-sm text-ink-soft">
            Référence de votre demande : <strong>{result.reference}</strong>
          </p>
        )}
        <button
          type="button"
          className="btn-secondary mt-5"
          onClick={() => { setResult(null); setType(""); }}
        >
          Faire une autre demande
        </button>
      </section>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => setResult(await submitClientRequest(token, formData)));
      }}
    >
      <fieldset>
        <legend className="label">Que souhaitez-vous ?</legend>
        <div className="mt-3 space-y-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold text-ink-faint">{group.title}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => (
                  <label key={option.value} className={`choice-chip ${type === option.value ? "border-[#1468ff] bg-[#f0f6ff] font-semibold" : ""}`}>
                    <input
                      type="radio"
                      name="requestType"
                      value={option.value}
                      checked={type === option.value}
                      onChange={() => setType(option.value)}
                      required
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="description">Dites-nous en plus</label>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          maxLength={3000}
          className="field"
          placeholder="Ce que vous souhaitez, pour quand, et tout ce qui peut nous aider."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="contactName">Votre nom <span className="font-normal text-ink-faint">(facultatif)</span></label>
          <input id="contactName" name="contactName" maxLength={120} className="field"/>
        </div>
        <div>
          <label className="label" htmlFor="contactEmail">Votre e-mail <span className="font-normal text-ink-faint">(facultatif)</span></label>
          <input id="contactEmail" name="contactEmail" type="email" className="field"/>
        </div>
      </div>

      {result && !result.ok && (
        <p className="rounded-xl border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">
          {result.message}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={pending || !type}>
        {pending ? "Envoi…" : `Envoyer ma demande${clientName ? "" : ""}`}
      </button>
    </form>
  );
}
