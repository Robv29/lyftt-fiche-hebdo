"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createServiceRequest } from "../actions";

const REQUEST_TYPES = [
  {
    value: "quote_request",
    label: "Demande de devis",
    hint: "Un nouveau besoin, une prestation à chiffrer.",
  },
  {
    value: "shooting_request",
    label: "Date de shooting",
    hint: "Proposer ou décaler une séance photo ou vidéo.",
  },
  {
    value: "side_service",
    label: "Service annexe",
    hint: "Site web, Google, e-mailing — tout ce qui sort des réseaux.",
  },
] as const;

/**
 * Second point d'entrée du client.
 *
 * Le premier lien sert à valider les publications de la semaine ; celui-ci
 * recueille tout le reste, qui arrivait jusqu'ici par message et se perdait.
 * Le formulaire est volontairement court : un motif, une explication, et la
 * demande part en ticket suivi.
 */
export function RequestForm({ token, clientName }: { token: string; clientName: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [type, setType] = useState<string>(REQUEST_TYPES[0].value);

  const selected = REQUEST_TYPES.find((entry) => entry.value === type)!;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const form = event.currentTarget;
        startTransition(async () => {
          const result = await createServiceRequest(token, formData);
          setFeedback({ ok: result.ok, message: result.message ?? "" });
          if (result.ok) form.reset();
        });
      }}
      className="card space-y-5 p-5 sm:p-6"
    >
      {feedback && (
        <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>
          {feedback.message}
        </p>
      )}

      <fieldset>
        <legend className="label">Votre demande concerne</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {REQUEST_TYPES.map((entry) => (
            <label key={entry.value} className={`choice-chip ${type === entry.value ? "border-[#1468ff] bg-[#f0f6ff]" : ""}`}>
              <input
                type="radio"
                name="requestType"
                value={entry.value}
                checked={type === entry.value}
                onChange={() => setType(entry.value)}
              />
              {entry.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-faint">{selected.hint}</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="description">Expliquez ce que vous souhaitez</label>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          minLength={10}
          maxLength={3000}
          className="field"
          placeholder="Décrivez votre besoin le plus simplement possible : ce que vous voulez, pour quand, et pourquoi si c'est utile."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="clientName">Votre nom <span className="font-normal text-ink-faint">(facultatif)</span></label>
          <input id="clientName" name="clientName" maxLength={120} className="field" autoComplete="name"/>
        </div>
        <div>
          <label className="label" htmlFor="clientEmail">Votre e-mail <span className="font-normal text-ink-faint">(facultatif)</span></label>
          <input id="clientEmail" name="clientEmail" type="email" maxLength={200} className="field" autoComplete="email"/>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer ma demande"}
        </button>
        <Link href={`/client-review/${token}`} className="text-sm text-ink-soft hover:underline">
          ← Revenir au planning de {clientName}
        </Link>
      </div>
    </form>
  );
}
