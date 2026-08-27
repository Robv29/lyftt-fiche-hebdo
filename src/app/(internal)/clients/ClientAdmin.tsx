"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createClient, setClientActive, updateClientLifecycle, type ClientActionResult } from "./actions";
import { clientLifecycle } from "@/lib/domain/client-lifecycle";

function lifecycleOf(client:{isActive:boolean;contractEndDate:string|null;pauseStartDate:string|null;pauseEndDate:string|null}) {
  return clientLifecycle({
    isActive: client.isActive,
    contractEndDate: client.contractEndDate,
    pauseStartDate: client.pauseStartDate,
    pauseEndDate: client.pauseEndDate,
  });
}
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS } from "@/lib/domain/types";
import { Icon } from "@/components/Icon";
import { ClientLogoField } from "@/components/ClientLogoField";
import {
  hashtagsForClientType,
  LYFTT_CLIENT_TYPES,
  normalizeHashtag,
  type LyfttClientType,
} from "@/lib/domain/hashtags";
import { WEEKDAY_LABELS } from "@/lib/domain/planning";
import { SHOOTING_PLAN_SERVICES, findService, formatEuros } from "@/lib/domain/budget";

type FieldErrors = Record<string, string> | undefined;

/**
 * Signale visuellement un champ refusé par la validation serveur, sans rien
 * effacer de ce qui a déjà été saisi.
 */
function fieldProps(errors: FieldErrors, name: string, base = "field") {
  const invalid = Boolean(errors?.[name]);
  return {
    className: invalid ? `${base} border-state-changes ring-2 ring-state-changes/20` : base,
    "aria-invalid": invalid || undefined,
  };
}

function FieldError({ errors, name, tone = "text-state-changes" }: { errors: FieldErrors; name: string; tone?: string }) {
  const message = errors?.[name];
  if (!message) return null;
  return <p className={`mt-1 text-xs ${tone}`} role="alert">{message}</p>;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7];

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
  managerName: string;
  logoUrl: string | null;
  cadenceLabel: string;
  /** Montant mensuel de la formule, en centimes. Nul hors direction. */
  monthlyCostCents: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  pauseStartDate: string | null;
  pauseEndDate: string | null;
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
  const [query, setQuery] = useState("");
  const [tacit, setTacit] = useState(false);
  const [clientType, setClientType] = useState<LyfttClientType>("restaurant");
  const [customHashtags, setCustomHashtags] = useState(["", "", "", "", ""]);
  // Un client a souvent plusieurs interlocuteurs à qui adresser le planning.
  const [contactRows, setContactRows] = useState<string[]>(["principal"]);
  const baseHashtags = hashtagsForClientType(clientType);
  const normalizedCustomHashtags = customHashtags.map(normalizeHashtag);
  const baseHashtagKeys = new Set(baseHashtags.map((hashtag) => hashtag.toLocaleLowerCase("fr")));
  const customKeys = normalizedCustomHashtags.map((hashtag) => hashtag.toLocaleLowerCase("fr"));
  const filledCustomHashtags = normalizedCustomHashtags.filter(Boolean).length;
  const hasDuplicateCustomHashtag = customKeys.some((key, index) =>
    Boolean(key) && (baseHashtagKeys.has(key) || customKeys.indexOf(key) !== index),
  );
  const hashtagSelectionIsValid = filledCustomHashtags === 5 && !hasDuplicateCustomHashtag;
  const filteredClients = clients.filter((client) => `${client.name} ${client.contactName ?? ""} ${client.managerName}`.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr")));

  /*
   * Un client archivé, en pause ou dont le contrat est arrivé à terme ne se
   * travaille plus. Le laisser mêlé aux autres oblige à lire chaque badge pour
   * savoir sur qui on peut produire ; il part donc dans sa propre section, en
   * bas, sans disparaître pour autant.
   */
  const sections = [
    { key: "gestion", title: "En gestion", hint: "Clients pour lesquels on produit.", list: filteredClients.filter((client) => lifecycleOf(client).canProduce) },
    { key: "hors", title: "Hors gestion", hint: "Archivés, en pause, ou gestion terminée.", list: filteredClients.filter((client) => !lifecycleOf(client).canProduce) },
  ].filter((section) => section.list.length > 0);

  const updateCustomHashtag = (index: number, value: string) => {
    setCustomHashtags((current) => current.map((hashtag, currentIndex) =>
      currentIndex === index ? value : hashtag,
    ));
  };

  const fieldErrors = feedback?.ok === false ? feedback.fieldErrors : undefined;

  const run = (action: () => Promise<ClientActionResult>) => {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) setShowForm(false);
      } catch {
        setFeedback({
          ok: false,
          message: "L’enregistrement a été interrompu. Rechargez la page puis réessayez : vos informations sont restées dans le formulaire.",
        });
      }
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

      {!showForm && clients.length > 0 && <div className="relative max-w-lg"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"/><label className="sr-only" htmlFor="client-search">Rechercher un client</label><input id="client-search" type="search" className="field bg-white pl-10" placeholder="Rechercher un client, un contact ou un responsable…" value={query} onChange={(event)=>setQuery(event.target.value)}/></div>}

      {showForm && (
        <form
          /*
            `onSubmit` plutôt que `action` : React réinitialise automatiquement
            un formulaire dont l'action est une fonction, y compris quand elle
            échoue. Un champ mal rempli effaçait donc tout l'onboarding, qui
            devait être ressaisi de zéro.
          */
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => createClient(formData));
          }}
          className="card reveal-panel space-y-7 p-5 sm:p-7"
        >
          <div><p className="eyebrow">Nouveau dossier</p><h2 className="mt-1 text-lg font-semibold">Onboarding éditorial complet</h2><p className="mt-1 text-sm text-ink-faint">Tous les champs sont nécessaires : ils alimentent le planning, les messages clients et la bibliothèque éditoriale.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Nom du client
              </label>
              <input id="name" name="name" required maxLength={120} {...fieldProps(fieldErrors,"name")} placeholder="Un été à la campagne"/>
              <FieldError errors={fieldErrors} name="name"/>
            </div>
            <div>
              <label className="label" htmlFor="communityManagerId">
                Community manager référent
              </label>
              <select id="communityManagerId" name="communityManagerId" required {...fieldProps(fieldErrors,"communityManagerId")}>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <FieldError errors={fieldErrors} name="communityManagerId"/>
            </div>
          </div>

          <ClientLogoField id="client-logo" required />

          <fieldset className="form-section">
            <legend className="label px-1">Contacts destinataires</legend>
            <p className="mb-4 text-xs text-ink-faint">
              Chaque contact reçoit le planning et le lien de validation. Ajoutez-en
              autant que nécessaire : gérant, responsable communication, associé.
            </p>

            <div className="space-y-4">
              {contactRows.map((rowId, index) => (
                <div key={rowId} className="rounded-2xl border border-line bg-canvas p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-soft">
                      {index === 0 ? "Contact principal" : `Contact ${index + 1}`}
                    </span>
                    {index > 0 && (
                      <button
                        type="button"
                        className="text-xs text-state-changes hover:underline"
                        onClick={() =>
                          setContactRows((rows) => rows.filter((id) => id !== rowId))
                        }
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><label className="label" htmlFor={`contactFirstName-${rowId}`}>Prénom</label><input id={`contactFirstName-${rowId}`} name="contactFirstName" required autoComplete="given-name" {...fieldProps(fieldErrors,`contacts.${index}.firstName`,"field bg-white")}/><FieldError errors={fieldErrors} name={`contacts.${index}.firstName`}/></div>
                    <div><label className="label" htmlFor={`contactLastName-${rowId}`}>Nom</label><input id={`contactLastName-${rowId}`} name="contactLastName" required autoComplete="family-name" {...fieldProps(fieldErrors,`contacts.${index}.lastName`,"field bg-white")}/><FieldError errors={fieldErrors} name={`contacts.${index}.lastName`}/></div>
                    <div><label className="label" htmlFor={`contactPhone-${rowId}`}>Téléphone</label><input id={`contactPhone-${rowId}`} name="contactPhone" type="tel" required maxLength={30} placeholder="+33 6 12 34 56 78" autoComplete="tel" {...fieldProps(fieldErrors,`contacts.${index}.phone`,"field bg-white")}/><FieldError errors={fieldErrors} name={`contacts.${index}.phone`}/></div>
                    <div><label className="label" htmlFor={`contactEmail-${rowId}`}>E-mail</label><input id={`contactEmail-${rowId}`} name="contactEmail" type="email" required autoComplete="email" {...fieldProps(fieldErrors,`contacts.${index}.email`,"field bg-white")}/><FieldError errors={fieldErrors} name={`contacts.${index}.email`}/></div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn-secondary mt-4"
              onClick={() => setContactRows((rows) => [...rows, `c-${Date.now()}`])}
            >
              Ajouter un contact
            </button>
          </fieldset>

          <fieldset className="form-section">
            <legend className="label px-1">Profil de marque</legend>
            <p className="mb-4 text-xs text-ink-faint">Ce contexte sert à préparer les sujets et le ton de chaque publication.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="activity">Activité principale</label><input id="activity" name="activity" required maxLength={120} {...fieldProps(fieldErrors,"activity")} placeholder="Restaurant bistronomique"/><FieldError errors={fieldErrors} name="activity"/></div>
              <div><label className="label" htmlFor="website">Site internet</label><input id="website" name="website" type="text" inputMode="url" required {...fieldProps(fieldErrors,"website")} placeholder="exemple.fr ou https://exemple.fr"/><FieldError errors={fieldErrors} name="website"/><p className="mt-1 text-xs text-ink-faint">Vous pouvez saisir simplement le domaine : https:// sera ajouté automatiquement.</p></div>
              <div><label className="label" htmlFor="city">Ville ou zone principale</label><input id="city" name="city" required maxLength={100} {...fieldProps(fieldErrors,"city")} placeholder="Toulouse"/><FieldError errors={fieldErrors} name="city"/></div>
              <div><label className="label" htmlFor="postalCode">Code postal</label><input id="postalCode" name="postalCode" required inputMode="numeric" pattern="[0-9]{5}" placeholder="31000" {...fieldProps(fieldErrors,"postalCode")}/><FieldError errors={fieldErrors} name="postalCode"/></div>
              <div><label className="label" htmlFor="audience">Clientèle cible</label><input id="audience" name="audience" required maxLength={300} {...fieldProps(fieldErrors,"audience")} placeholder="Familles, actifs de 30 à 55 ans"/><FieldError errors={fieldErrors} name="audience"/></div>
              <div><label className="label" htmlFor="brandTone">Ton de communication</label><select id="brandTone" name="brandTone" required className="field" defaultValue="chaleureux"><option value="chaleureux">Chaleureux et proche</option><option value="premium">Premium et élégant</option><option value="expert">Expert et pédagogique</option><option value="dynamique">Dynamique et direct</option><option value="institutionnel">Institutionnel et rassurant</option></select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="keywords">Produits, services et mots-clés prioritaires</label><textarea id="keywords" name="keywords" required rows={3} maxLength={1000} {...fieldProps(fieldErrors,"keywords")} placeholder="terrasse, cuisine maison, privatisation, produits locaux"/><FieldError errors={fieldErrors} name="keywords"/><p className="mt-1 text-xs text-ink-faint">Séparez les thèmes par des virgules. Ils serviront de pistes lors de la rédaction des publications.</p></div>
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
            <FieldError errors={fieldErrors} name="networks"/>
          </fieldset>

          <fieldset>
            <legend className="label">Jours de publication</legend>
            <p className="mb-3 text-xs text-ink-faint">
              Les publications de chaque semaine seront préprogrammées sur ces jours.
              S&apos;il y a plus de contenus que de jours, ils se répartissent en repassant
              sur les mêmes.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {WEEKDAY_ORDER.map((day) => (
                <label key={day} className="choice-chip">
                  <input type="checkbox" name="publicationWeekdays" value={day} defaultChecked={day === 2 || day === 5}/>
                  {WEEKDAY_LABELS[day]}
                </label>
              ))}
            </div>
            <FieldError errors={fieldErrors} name="publicationWeekdays"/>
          </fieldset>

          <fieldset>
            <legend className="label">Rythme mensuel vendu</legend>
            <p className="mb-3 text-xs text-ink-faint">Ces volumes prépareront automatiquement les futures fiches. Indiquez 0 pour une prestation non incluse.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="photoPerMonth">Photos</label><input id="photoPerMonth" name="photoPerMonth" type="number" min="0" max="31" defaultValue="4" required {...fieldProps(fieldErrors,"photoPerMonth")}/><FieldError errors={fieldErrors} name="photoPerMonth"/></div>
              <div><label className="label" htmlFor="videoPerMonth">Vidéos / Reels</label><input id="videoPerMonth" name="videoPerMonth" type="number" min="0" max="31" defaultValue="2" required {...fieldProps(fieldErrors,"videoPerMonth")}/><FieldError errors={fieldErrors} name="videoPerMonth"/></div>
              <div><label className="label" htmlFor="storyPerMonth">Stories</label><input id="storyPerMonth" name="storyPerMonth" type="number" min="0" max="31" defaultValue="0" required {...fieldProps(fieldErrors,"storyPerMonth")}/><FieldError errors={fieldErrors} name="storyPerMonth"/></div>
              <div><label className="label" htmlFor="visualPerMonth">Visuels / carrousels</label><input id="visualPerMonth" name="visualPerMonth" type="number" min="0" max="31" defaultValue="2" required {...fieldProps(fieldErrors,"visualPerMonth")}/><FieldError errors={fieldErrors} name="visualPerMonth"/></div>
            </div>

            {/*
              Shooting du forfait : son prix est étalé sur la période et entre
              dans la facture mensuelle. Renseigné dès la création, il évite
              d'avoir à rouvrir la fiche juste après l'avoir remplie.
            */}
            <div className="mt-4 rounded-2xl border border-[#d8e4f8] bg-[#f7faff] p-4">
              <p className="label">Shooting vendu dans la formule</p>
              <p className="mt-1 text-xs text-ink-faint">Facultatif. Un shooting qui revient à intervalle régulier, dont le prix est lissé sur la période.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="shootingService">Prestation</label>
                  <select id="shootingService" name="shootingService" className="field bg-white" defaultValue="">
                    <option value="">Aucun shooting vendu</option>
                    {SHOOTING_PLAN_SERVICES.map((key) => (
                      <option key={key} value={key}>
                        {findService(key)?.label} — {formatEuros(findService(key)?.unitPriceCents ?? 0)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="shootingEveryMonths">Tous les combien de mois</label>
                  <input id="shootingEveryMonths" name="shootingEveryMonths" type="number" min="1" max="24" placeholder="4" {...fieldProps(fieldErrors,"shootingEveryMonths")}/>
                  <FieldError errors={fieldErrors} name="shootingEveryMonths"/>
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Échéance de validation</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <select name="deadlineWeekday" defaultValue={2} required aria-label="Jour limite de validation" {...fieldProps(fieldErrors,"deadlineWeekday")}>
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input name="deadlineTime" type="time" defaultValue="10:00" required aria-label="Heure limite de validation" {...fieldProps(fieldErrors,"deadlineTime")}/>
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
                  maxLength={500}
                  required
                  {...fieldProps(fieldErrors,"tacitNotice")}
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
            <input id="whatsappGroup" name="whatsappGroup" required maxLength={120} placeholder="Ex. LYFTT × Canal du Midi" {...fieldProps(fieldErrors,"whatsappGroup","field bg-white")} />
            <FieldError errors={fieldErrors} name="whatsappGroup"/>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft"><strong>Information attendue :</strong> recopiez le nom du groupe tel qu’il apparaît dans WhatsApp — pas un numéro ni un lien d’invitation. LYFTT l’affichera au moment de copier le message de validation pour éviter de l’envoyer au mauvais groupe.</p>
          </div>

          <div className="rounded-2xl border border-line bg-canvas p-4 sm:p-5">
            <label className="label" htmlFor="postSignature">
              Signature des publications{" "}
              <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <textarea
              id="postSignature"
              name="postSignature"
              rows={2}
              maxLength={300}
              placeholder={"Ex. \u{1F4CD} 1987 Rte d'Auch, 82000 Montauban"}
              {...fieldProps(fieldErrors,"postSignature","field bg-white")}
            />
            <FieldError errors={fieldErrors} name="postSignature"/>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Phrase répétée à la fin de chaque publication : adresse, horaires,
              accroche de marque. Elle sera <strong>préremplie automatiquement</strong> en
              bas du texte de chaque contenu, et reste modifiable publication par
              publication.
            </p>
          </div>

          <section className="overflow-hidden rounded-[20px] bg-[#123f73] text-white">
            <div className="border-b border-white/10 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#8fbbff]"><Icon name="layers" className="h-5 w-5"/></span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.12em] text-white/60">Bibliothèque LYFTT · sans IA</p>
                  <h3 className="mt-1 font-semibold">Les 20 hashtags du client</h3>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/70">Choisissez son métier pour charger 15 hashtags issus des typologies de clients LYFTT, puis renseignez 5 hashtags propres à sa marque. Cette bibliothèque sera reprise automatiquement dans ses nouvelles fiches.</p>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
              <div className="border-b border-white/10 p-5 sm:p-6 lg:border-b-0 lg:border-r">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="label text-white/80" htmlFor="clientType">1. Type de client</label>
                    <select
                      id="clientType"
                      name="clientType"
                      required
                      className="field bg-white text-ink"
                      value={clientType}
                      onChange={(event) => setClientType(event.target.value as LyfttClientType)}
                    >
                      {LYFTT_CLIENT_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>{type.label} — {type.examples}</option>
                      ))}
                    </select>
                  </div>
                  <span className="mb-3 rounded-full bg-[#1176d3] px-2.5 py-1 text-[11px] font-semibold text-white">15 inclus</span>
                </div>

                <div key={clientType} className="reveal-panel mt-5 flex flex-wrap gap-2" aria-live="polite">
                  {baseHashtags.map((hashtag) => (
                    <span key={hashtag} className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs text-white/90">{hashtag}</span>
                  ))}
                </div>
              </div>

              <div className="bg-white/[.06] p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="label text-white/80">2. Hashtags propres au client</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/60">Nom de marque, produit signature, quartier ou expression distinctive.</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${hashtagSelectionIsValid ? "bg-[#d1fae5] text-[#065f46]" : "bg-white/10 text-white/70"}`} aria-live="polite">
                    {filledCustomHashtags}/5
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {customHashtags.map((value, index) => {
                    const normalized = normalizedCustomHashtags[index];
                    const key = customKeys[index];
                    const isDuplicate = Boolean(key) && (baseHashtagKeys.has(key) || customKeys.indexOf(key) !== index);
                    const serverError = fieldErrors?.[`customHashtags.${index}`];
                    return (
                      <div key={index}>
                        <label className="sr-only" htmlFor={`customHashtag${index + 1}`}>Hashtag client {index + 1} sur 5</label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-[#667085]">#</span>
                          <input
                            id={`customHashtag${index + 1}`}
                            name={`customHashtag${index + 1}`}
                            required
                            minLength={2}
                            maxLength={60}
                            className={`field bg-white pl-7 text-ink ${isDuplicate || serverError ? "border-state-changes ring-2 ring-state-changes/20" : ""}`}
                            placeholder={["NomDuClient", "ProduitSignature", "Quartier", "Slogan", "RendezVous"][index]}
                            value={value.replace(/^#+/, "")}
                            onChange={(event) => updateCustomHashtag(index, event.target.value)}
                            aria-invalid={isDuplicate || Boolean(serverError) || undefined}
                          />
                        </div>
                        {normalized && !isDuplicate && <p className="mt-1 truncate text-[11px] text-white/55">Sera enregistré : {normalized}</p>}
                        {isDuplicate && <p className="mt-1 text-[11px] text-[#fda4af]">Choisissez un hashtag différent.</p>}
                        {!isDuplicate && serverError && <p className="mt-1 text-[11px] text-[#fda4af]" role="alert">{serverError}</p>}
                      </div>
                    );
                  })}
                </div>

                <p className={`mt-4 rounded-xl border px-3 py-2 text-xs leading-relaxed ${hashtagSelectionIsValid ? "border-[#6ee7b7]/30 bg-[#064e3b]/30 text-[#a7f3d0]" : "border-white/10 bg-black/10 text-white/60"}`}>
                  {hashtagSelectionIsValid ? "Bibliothèque complète : 15 hashtags métier + 5 hashtags client." : "Les 5 hashtags doivent être renseignés et tous différents des 15 hashtags métier."}
                </p>
              </div>
            </div>
          </section>

          <button type="submit" className="btn-primary" disabled={pending || !hashtagSelectionIsValid}>
            {pending ? "Création…" : "Créer le client"}
          </button>
        </form>
      )}

      {clients.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucun client. Commencez par en ajouter un.
        </p>
      ) : (
        <div className="space-y-7">
          {sections.map((section) => (
          <section key={section.key} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{section.title}<span className="ml-2 font-normal text-ink-faint">{section.list.length}</span></h2>
              <p className="text-xs text-ink-faint">{section.hint}</p>
            </div>
            <ul className="grid gap-4 lg:grid-cols-2">
          {section.list.map((client) => (
            <li key={client.id} className={`card lift-card p-5 ${lifecycleOf(client).canProduce ? "" : "border-line/60 bg-canvas/60"}`}>
              {(() => { const lifecycle = lifecycleOf(client); return (
              <div className="flex h-full flex-col gap-5">
                <div className="flex items-start gap-3">
                  {client.logoUrl
                    // Le logo prime sur les initiales : c'est ce qui permet de
                    // repérer un client d'un coup d'œil dans un portefeuille.
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={client.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-line bg-white object-contain"/>
                    : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e8f2ff] text-sm font-bold text-[#0b5e9f]">{client.name.slice(0,2).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                  <p className="font-semibold tracking-[-.015em]">
                    {client.name}
                    {lifecycle.state !== "active" && (
                      <span className={`ml-2 badge ${lifecycle.state === "paused" ? "bg-state-progress/10 text-state-progress" : "bg-canvas text-ink-faint"}`}>
                        {lifecycle.label}
                      </span>
                    )}
                    {client.approvalPolicy === "tacit_allowed" && (
                      <span className="ml-2 badge bg-state-progress/10 text-state-progress">
                        Validation tacite
                      </span>
                    )}
                  </p>
                  {lifecycle.detail && (
                    <p className={`mt-1 text-xs ${lifecycle.canProduce ? "text-ink-faint" : "text-state-progress"}`}>{lifecycle.detail}</p>
                  )}
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                    {client.contactName ?? "Aucun contact"} · échéance{" "}
                    {WEEKDAYS.find((d) => d.value === client.deadlineWeekday)?.label.toLowerCase()}{" "}
                    {client.deadlineTime.slice(0, 5).replace(":", " h ")}
                  </p>
                  <p className="mt-2 text-xs text-ink-soft">{client.managerName} · {client.cadenceLabel}</p>
                  {/*
                    Montant mensuel de l'abonnement : le rythme vendu ne disait
                    pas ce qu'il rapporte, et c'est la question qui vient juste
                    après en regardant une carte client.
                  */}
                  {client.monthlyCostCents !== null && (
                    <p className="mt-1.5 text-xs font-semibold text-[#0b5e9f]">
                      {formatEuros(client.monthlyCostCents)} par mois
                    </p>
                  )}
                  </div>
                </div>

                <div className="mt-auto grid grid-cols-[1fr_44px] gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_44px]">
                  <Link href={`/clients/${client.id}`} className="btn-secondary order-2 text-xs sm:order-1">Voir le dossier</Link>
                  {/* Aucune fiche pour un client en pause ou dont la gestion est terminée. */}
                  {lifecycle.canProduce ? (
                    <Link href={`/fiches/nouvelle?client=${client.id}`} className="btn-primary col-span-2 order-1 text-xs sm:col-span-1 sm:order-2">
                      <Icon name="plus" className="h-3.5 w-3.5"/>Créer la fiche
                    </Link>
                  ) : (
                    <span className="btn-secondary col-span-2 order-1 cursor-not-allowed text-xs opacity-60 sm:col-span-1 sm:order-2" aria-disabled="true" title={lifecycle.detail ?? lifecycle.label}>
                      Production suspendue
                    </span>
                  )}
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

                {/*
                  Fin de gestion et pause. Les dates pilotent l'état : inutile de
                  penser à réactiver le client, il redevient actif tout seul au
                  lendemain de la fin de pause.
                */}
                <details className="border-t pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Gestion et pause</summary>
                  <form
                    action={(formData) => { formData.set("clientId", client.id); run(() => updateClientLifecycle(formData)); }}
                    className="mt-3 space-y-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label text-xs" htmlFor={`debut-${client.id}`}>Début de gestion</label>
                        <input id={`debut-${client.id}`} name="contractStartDate" type="date" className="field" defaultValue={client.contractStartDate ?? ""}/>
                        <p className="mt-1 text-[11px] text-ink-faint">Sert au décompte du budget consommé.</p>
                      </div>
                      <div>
                        <label className="label text-xs" htmlFor={`fin-${client.id}`}>Fin de gestion</label>
                        <input id={`fin-${client.id}`} name="contractEndDate" type="date" className="field" defaultValue={client.contractEndDate ?? ""}/>
                        <p className="mt-1 text-[11px] text-ink-faint">Le client est archivé le lendemain.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label text-xs" htmlFor={`pause-debut-${client.id}`}>Début de pause</label>
                        <input id={`pause-debut-${client.id}`} name="pauseStartDate" type="date" className="field" defaultValue={client.pauseStartDate ?? ""}/>
                      </div>
                      <div>
                        <label className="label text-xs" htmlFor={`pause-fin-${client.id}`}>Fin de pause</label>
                        <input id={`pause-fin-${client.id}`} name="pauseEndDate" type="date" className="field" defaultValue={client.pauseEndDate ?? ""}/>
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-faint">Pendant la pause le client est archivé ; il se réactive seul au lendemain de la fin.</p>
                    <button type="submit" className="btn-secondary w-full text-xs" disabled={pending}>Enregistrer la gestion</button>
                  </form>
                </details>
              </div>
              ); })()}
            </li>
          ))}
            </ul>
          </section>
          ))}
          {filteredClients.length === 0 && <p className="card px-5 py-10 text-center text-sm text-ink-faint">Aucun client ne correspond à « {query} ».</p>}
        </div>
      )}
    </div>
  );
}
