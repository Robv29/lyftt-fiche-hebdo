"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createClient, setClientActive, type ClientActionResult } from "./actions";
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";

const WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
];

interface ClientRow {
  id: string;
  name: string;
  isActive: boolean;
  deadlineWeekday: number;
  deadlineTime: string;
  approvalPolicy: string;
  contactName: string | null;
}

export function ClientAdmin({
  clients,
  managers,
}: {
  clients: ClientRow[];
  managers: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ClientActionResult | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tacit, setTacit] = useState(false);

  const run = (action: () => Promise<ClientActionResult>) => {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) setShowForm(false);
    });
  };

  return (
    <div className="space-y-5">
      {feedback?.message && (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <button
        type="button"
        className="btn-primary"
        onClick={() => {
          setShowForm(!showForm);
          setFeedback(null);
        }}
      >
        {showForm ? "Annuler" : "Ajouter un client"}
      </button>

      {showForm && (
        <form
          action={(formData) => run(() => createClient(formData))}
          className="card space-y-5 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Nom du client
              </label>
              <input id="name" name="name" required className="field" placeholder="Un été à la campagne" />
            </div>
            <div>
              <label className="label" htmlFor="communityManagerId">
                Community manager référent
              </label>
              <select id="communityManagerId" name="communityManagerId" className="field">
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="label">Contact client</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <input name="contactFirstName" required className="field" placeholder="Prénom" />
              <input name="contactLastName" className="field" placeholder="Nom" />
              <input name="contactPhone" className="field" placeholder="+33 6 12 34 56 78" />
              <input name="contactEmail" type="email" className="field" placeholder="E-mail (facultatif)" />
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Réseaux</legend>
            <div className="flex flex-wrap gap-3">
              {SOCIAL_NETWORKS.map((network) => (
                <label key={network} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="networks"
                    value={network}
                    defaultChecked={network === "instagram" || network === "facebook"}
                  />
                  {SOCIAL_NETWORK_LABELS[network]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Échéance de validation</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <select name="deadlineWeekday" className="field" defaultValue={2}>
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input name="deadlineTime" type="time" className="field" defaultValue="10:00" />
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              La date exacte est recalculée à chaque semaine de publication.
            </p>
          </fieldset>

          <fieldset>
            <legend className="label">Règle de validation</legend>
            <select
              name="approvalPolicy"
              className="field"
              defaultValue="explicit_required"
              onChange={(event) => setTacit(event.target.value === "tacit_allowed")}
            >
              <option value="explicit_required">Validation explicite obligatoire</option>
              <option value="tacit_allowed">Validation tacite autorisée</option>
            </select>

            {tacit && (
              <div className="mt-3">
                <label className="label" htmlFor="tacitNotice">
                  Mention contractuelle affichée au client
                </label>
                <textarea
                  id="tacitNotice"
                  name="tacitNotice"
                  rows={2}
                  className="field"
                  defaultValue="Sans retour avant cette échéance, les contenus seront considérés comme validés, selon les modalités prévues ensemble."
                />
                <p className="mt-1 text-xs text-state-progress">
                  La validation tacite ne s&apos;applique que si un message a bien été
                  envoyé et qu&apos;aucune demande n&apos;est en cours.
                </p>
              </div>
            )}
          </fieldset>

          <div>
            <label className="label" htmlFor="whatsappGroup">
              Groupe WhatsApp <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <input id="whatsappGroup" name="whatsappGroup" className="field" />
          </div>

          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Création…" : "Créer le client"}
          </button>
        </form>
      )}

      {clients.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucun client. Commencez par en ajouter un.
        </p>
      ) : (
        <ul className="space-y-2">
          {clients.map((client) => (
            <li key={client.id} className="card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {client.name}
                    {!client.isActive && (
                      <span className="ml-2 badge bg-canvas text-ink-faint">Archivé</span>
                    )}
                    {client.approvalPolicy === "tacit_allowed" && (
                      <span className="ml-2 badge bg-state-progress/10 text-state-progress">
                        Validation tacite
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {client.contactName ?? "Aucun contact"} · échéance{" "}
                    {WEEKDAYS.find((d) => d.value === client.deadlineWeekday)?.label.toLowerCase()}{" "}
                    {client.deadlineTime.slice(0, 5).replace(":", " h ")}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/fiches/nouvelle?client=${client.id}`} className="btn-secondary py-1 text-xs">
                    Nouvelle fiche
                  </Link>
                  <button
                    type="button"
                    className="btn-secondary py-1 text-xs"
                    disabled={pending}
                    onClick={() => run(() => setClientActive(client.id, !client.isActive))}
                  >
                    {client.isActive ? "Archiver" : "Réactiver"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
