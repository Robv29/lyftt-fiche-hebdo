"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createClient, setClientActive, type ClientActionResult } from "./actions";
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";
import { Icon } from "@/components/Icon";
import { recommendHashtags } from "@/lib/domain/hashtags";

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
  const [brandProfile, setBrandProfile] = useState({ brand:"", activity:"", city:"", audience:"", keywords:"" });
  const recommendedHashtags = useMemo(() => recommendHashtags(brandProfile), [brandProfile]);
  const setProfile = (field: keyof typeof brandProfile, value: string) => setBrandProfile((current) => ({ ...current, [field]:value }));

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
        <button type="button" className={`${showForm ? "btn-secondary" : "btn-primary"} sm:w-auto`} aria-expanded={showForm} onClick={() => { setShowForm(!showForm); setFeedback(null); }}>
          <Icon name={showForm ? "check" : "plus"} className="h-4 w-4"/>{showForm ? "Fermer" : "Nouveau client"}
        </button>
      </div>

      {showForm && (
        <form
          action={(formData) => run(() => createClient(formData))}
          className="card reveal-panel space-y-7 p-5 sm:p-7"
        >
          <div><p className="eyebrow">Nouveau dossier</p><h2 className="mt-1 text-lg font-semibold">Onboarding éditorial complet</h2><p className="mt-1 text-sm text-ink-faint">Tous les champs sont nécessaires : ils alimentent le planning, les messages clients et les recommandations automatiques.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Nom du client
              </label>
              <input id="name" name="name" required className="field" placeholder="Un été à la campagne" value={brandProfile.brand} onChange={(event)=>setProfile("brand",event.target.value)}/>
            </div>
            <div>
              <label className="label" htmlFor="communityManagerId">
                Community manager référent
              </label>
              <select id="communityManagerId" name="communityManagerId" className="field" required>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="rounded-2xl bg-canvas p-4 sm:p-5">
            <legend className="label px-1">Contact principal</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="contactFirstName">Prénom</label><input id="contactFirstName" name="contactFirstName" required className="field" autoComplete="given-name"/></div>
              <div><label className="label" htmlFor="contactLastName">Nom</label><input id="contactLastName" name="contactLastName" required className="field" autoComplete="family-name"/></div>
              <div><label className="label" htmlFor="contactPhone">Téléphone</label><input id="contactPhone" name="contactPhone" type="tel" required className="field" placeholder="+33 6 12 34 56 78" autoComplete="tel"/></div>
              <div><label className="label" htmlFor="contactEmail">E-mail</label><input id="contactEmail" name="contactEmail" type="email" required className="field" autoComplete="email"/></div>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl bg-canvas p-4 sm:p-5">
            <legend className="label px-1">Profil de marque</legend>
            <p className="mb-4 text-xs text-ink-faint">Ce contexte sert à préparer les sujets, le ton et la bibliothèque de hashtags.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="activity">Activité principale</label><input id="activity" name="activity" required className="field" placeholder="Restaurant bistronomique" value={brandProfile.activity} onChange={(event)=>setProfile("activity",event.target.value)}/></div>
              <div><label className="label" htmlFor="website">Site internet</label><input id="website" name="website" type="url" required className="field" placeholder="https://exemple.fr"/></div>
              <div><label className="label" htmlFor="city">Ville ou zone principale</label><input id="city" name="city" required className="field" placeholder="Toulouse" value={brandProfile.city} onChange={(event)=>setProfile("city",event.target.value)}/></div>
              <div><label className="label" htmlFor="postalCode">Code postal</label><input id="postalCode" name="postalCode" required className="field" inputMode="numeric" pattern="[0-9]{5}" placeholder="31000"/></div>
              <div><label className="label" htmlFor="audience">Clientèle cible</label><input id="audience" name="audience" required className="field" placeholder="Familles, actifs de 30 à 55 ans" value={brandProfile.audience} onChange={(event)=>setProfile("audience",event.target.value)}/></div>
              <div><label className="label" htmlFor="brandTone">Ton de communication</label><select id="brandTone" name="brandTone" required className="field" defaultValue="chaleureux"><option value="chaleureux">Chaleureux et proche</option><option value="premium">Premium et élégant</option><option value="expert">Expert et pédagogique</option><option value="dynamique">Dynamique et direct</option><option value="institutionnel">Institutionnel et rassurant</option></select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="keywords">Produits, services et mots-clés prioritaires</label><textarea id="keywords" name="keywords" required rows={3} className="field" placeholder="terrasse, cuisine maison, privatisation, produits locaux" value={brandProfile.keywords} onChange={(event)=>setProfile("keywords",event.target.value)}/><p className="mt-1 text-xs text-ink-faint">Séparez les thèmes par des virgules. Ils deviennent des pistes éditoriales et des hashtags.</p></div>
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
              <div><label className="label" htmlFor="photoPerMonth">Photos</label><input id="photoPerMonth" name="photoPerMonth" type="number" min="0" max="31" defaultValue="4" required className="field"/></div>
              <div><label className="label" htmlFor="videoPerMonth">Vidéos / Reels</label><input id="videoPerMonth" name="videoPerMonth" type="number" min="0" max="31" defaultValue="2" required className="field"/></div>
              <div><label className="label" htmlFor="visualPerMonth">Visuels / carrousels</label><input id="visualPerMonth" name="visualPerMonth" type="number" min="0" max="31" defaultValue="2" required className="field"/></div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Échéance de validation</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <select name="deadlineWeekday" className="field" defaultValue={2} required aria-label="Jour limite de validation">
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input name="deadlineTime" type="time" className="field" defaultValue="10:00" required aria-label="Heure limite de validation"/>
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
              required
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
                  required
                  defaultValue="Sans retour avant cette échéance, les contenus seront considérés comme validés, selon les modalités prévues ensemble."
                />
                <p className="mt-1 text-xs text-state-progress">
                  La validation tacite ne s&apos;applique que si un message a bien été
                  envoyé et qu&apos;aucune demande n&apos;est en cours.
                </p>
              </div>
            )}
          </fieldset>

          <div className="rounded-2xl border border-[#cfe0ff] bg-[#f4f8ff] p-4 sm:p-5">
            <label className="label" htmlFor="whatsappGroup">
              Nom exact du groupe WhatsApp
            </label>
            <input id="whatsappGroup" name="whatsappGroup" required className="field bg-white" placeholder="Ex. LYFTT × Canal du Midi" />
            <p className="mt-2 text-xs leading-relaxed text-ink-soft"><strong>Information attendue :</strong> recopiez le nom du groupe tel qu’il apparaît dans WhatsApp — pas un numéro ni un lien d’invitation. LYFTT l’affichera au moment de copier le message de validation pour éviter de l’envoyer au mauvais groupe.</p>
          </div>

          <section className="rounded-2xl bg-[#111827] p-5 text-white sm:p-6">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#8fbbff]"><Icon name="spark" className="h-5 w-5"/></span><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-white/60">Recherche automatique</p><h3 className="mt-1 font-semibold">Hashtags recommandés</h3><p className="mt-1 text-xs leading-relaxed text-white/70">Calculés à partir de la marque, de l’activité, de la ville, de la cible et des mots-clés. Ils seront ajoutés automatiquement aux nouvelles fiches.</p></div></div>
            <input type="hidden" name="recommendedHashtags" value={recommendedHashtags.join(" ")}/>
            {recommendedHashtags.length ? <div className="mt-5 flex flex-wrap gap-2">{recommendedHashtags.map((hashtag)=><span key={hashtag} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/90">{hashtag}</span>)}</div> : <p className="mt-5 rounded-xl border border-dashed border-white/20 p-4 text-center text-xs text-white/50">Renseignez le profil de marque pour lancer la recommandation.</p>}
          </section>

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

                <div className="mt-auto grid grid-cols-[1fr_44px] gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_44px]">
                  <Link href={`/clients/${client.id}`} className="btn-secondary order-2 text-xs sm:order-1">Voir le dossier</Link>
                  <Link href={`/fiches/nouvelle?client=${client.id}`} className="btn-primary col-span-2 order-1 text-xs sm:col-span-1 sm:order-2">
                    <Icon name="plus" className="h-3.5 w-3.5"/>Créer la fiche
                  </Link>
                  <button
                    type="button"
                    className="order-3 grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-surface text-ink-faint transition-colors hover:text-state-changes"
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
