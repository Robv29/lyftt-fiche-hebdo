"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createClient, setClientActive, type ClientActionResult } from "./actions";
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";
import { Icon } from "@/components/Icon";

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-faint">{clients.filter((client) => client.isActive).length} client{clients.length > 1 ? "s" : ""} actif{clients.length > 1 ? "s" : ""}</p>
        <button type="button" className={showForm ? "btn-secondary" : "btn-primary"} aria-expanded={showForm} onClick={() => { setShowForm(!showForm); setFeedback(null); }}>
          <Icon name={showForm ? "check" : "plus"} className="h-4 w-4"/>{showForm ? "Fermer" : "Nouveau client"}
        </button>
      </div>

      {showForm && (
        <form
          action={(formData) => run(() => createClient(formData))}
          className="card reveal-panel space-y-7 p-5 sm:p-7"
        >
          <div><p className="eyebrow">Nouveau dossier</p><h2 className="mt-1 text-lg font-semibold">Informations essentielles</h2><p className="mt-1 text-sm text-ink-faint">Tout pourra être complété ensuite. Commencez par ce qui règle le planning.</p></div>
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
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SOCIAL_NETWORKS.map((network) => (
                <label key={network} className="choice-chip">
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
            <legend className="label">Rythme mensuel vendu</legend>
            <p className="mb-3 text-xs text-ink-faint">Ces volumes prépareront automatiquement les futures fiches. Indiquez 0 pour une prestation non incluse.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><label className="label" htmlFor="photoPerMonth">Photos</label><input id="photoPerMonth" name="photoPerMonth" type="number" min="0" max="31" defaultValue="4" className="field"/></div>
              <div><label className="label" htmlFor="videoPerMonth">Vidéos / Reels</label><input id="videoPerMonth" name="videoPerMonth" type="number" min="0" max="31" defaultValue="2" className="field"/></div>
              <div><label className="label" htmlFor="visualPerMonth">Visuels / carrousels</label><input id="visualPerMonth" name="visualPerMonth" type="number" min="0" max="31" defaultValue="2" className="field"/></div>
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
        <ul className="grid gap-3 lg:grid-cols-2">
          {clients.map((client) => (
            <li key={client.id} className="card lift-card p-5">
              <div className="flex h-full flex-col gap-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#edf2f8] text-sm font-bold text-[#46546a]">{client.name.slice(0,2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                  <p className="font-semibold tracking-[-.015em]">
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
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                    {client.contactName ?? "Aucun contact"} · échéance{" "}
                    {WEEKDAYS.find((d) => d.value === client.deadlineWeekday)?.label.toLowerCase()}{" "}
                    {client.deadlineTime.slice(0, 5).replace(":", " h ")}
                  </p>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2 border-t pt-4">
                  <Link href={`/clients/${client.id}`} className="btn-secondary flex-1 text-xs">Voir le dossier</Link>
                  <Link href={`/fiches/nouvelle?client=${client.id}`} className="btn-primary flex-1 text-xs">
                    <Icon name="plus" className="h-3.5 w-3.5"/>Créer la fiche
                  </Link>
                  <button
                    type="button"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-surface text-ink-faint transition-colors hover:text-state-changes"
                    disabled={pending}
                    onClick={() => run(() => setClientActive(client.id, !client.isActive))}
                    aria-label={client.isActive ? `Archiver ${client.name}` : `Réactiver ${client.name}`}
                  >
                    <Icon name={client.isActive ? "layers" : "check"} className="h-4 w-4"/>
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
