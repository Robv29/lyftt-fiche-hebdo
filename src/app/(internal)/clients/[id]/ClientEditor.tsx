"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClient, type ClientActionResult } from "../actions";
import { Icon } from "@/components/Icon";
import { ClientLogoField } from "@/components/ClientLogoField";
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/domain/types";
import { WEEKDAY_LABELS } from "@/lib/domain/planning";
import {
  SHOOTING_PLAN_SERVICES,
  findService,
  formatEuros,
  shootingMonthlyCostCents,
  shootingsPerYear,
  type ShootingPlan, type CustomMonthlyService } from "@/lib/domain/budget";
import {
  hashtagsForClientType,
  LYFTT_CLIENT_TYPES,
  normalizeHashtag,
  type LyfttClientType,
} from "@/lib/domain/hashtags";
import { Portal } from "@/components/Portal";

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export interface EditableClient {
  id: string;
  name: string;
  logoUrl: string | null;
  communityManagerId: string;
  contacts: { firstName: string; lastName: string; phone: string; email: string }[];
  brand: {
    activity: string;
    website: string;
    city: string;
    postalCode: string;
    audience: string;
    tone: "chaleureux" | "premium" | "expert" | "dynamique" | "institutionnel";
    keywords: string;
    clientType: LyfttClientType;
  };
  networks: SocialNetwork[];
  cadence: { photo: number; video: number; story: number; visual: number };
  /** Forfait shooting vendu dans la formule, s'il y en a un. */
  shooting: ShootingPlan | null;
  /** Prestation hors carte vendue dans la formule mensuelle. */
  customMonthly: CustomMonthlyService | null;
  publicationWeekdays: number[];
  validation: {
    deadlineWeekday: number;
    deadlineTime: string;
    approvalPolicy: "explicit_required" | "tacit_allowed";
    tacitNotice: string;
    whatsappGroup: string;
    postSignature: string;
  };
  customHashtags: string[];
}

function fiveHashtags(values: string[]): string[] {
  return Array.from({ length: 5 }, (_, index) => values[index]?.replace(/^#+/, "") ?? "");
}

export function ClientEditor({ initial, managers }: { initial: EditableClient; managers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Liste éditable : ajouts et retraits sont appliqués en une seule sauvegarde.
  const [editedContacts, setEditedContacts] = useState(() =>
    initial.contacts.map((contact, index) => ({ ...contact, key: `c${index}` })),
  );
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ClientActionResult | null>(null);
  const [tacit, setTacit] = useState(initial.validation.approvalPolicy === "tacit_allowed");
  const [clientType, setClientType] = useState<LyfttClientType>(initial.brand.clientType);
  const [customHashtags, setCustomHashtags] = useState(() => fiveHashtags(initial.customHashtags));
  // Forfait shooting : la périodicité n'a de sens qu'une fois la prestation choisie.
  const [shootingService, setShootingService] = useState<string>(initial.shooting?.serviceKey ?? "");
  const [shootingEveryMonths, setShootingEveryMonths] = useState<string>(
    initial.shooting ? String(initial.shooting.everyMonths) : "3",
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  const baseHashtags = hashtagsForClientType(clientType);
  const normalizedCustom = customHashtags.map(normalizeHashtag);
  const baseKeys = new Set(baseHashtags.map((hashtag) => hashtag.toLocaleLowerCase("fr")));
  const customKeys = normalizedCustom.map((hashtag) => hashtag.toLocaleLowerCase("fr"));
  const hashtagError = customKeys.some((key, index) => Boolean(key) && (baseKeys.has(key) || customKeys.indexOf(key) !== index));
  const hashtagsReady = normalizedCustom.filter(Boolean).length === 5 && !hashtagError;

  const resetAndClose = () => {
    setOpen(false);
    setFeedback(null);
    setTacit(initial.validation.approvalPolicy === "tacit_allowed");
    setClientType(initial.brand.clientType);
    setCustomHashtags(fiveHashtags(initial.customHashtags));
    setShootingService(initial.shooting?.serviceKey ?? "");
    setShootingEveryMonths(initial.shooting ? String(initial.shooting.everyMonths) : "3");
  };

  /*
   * Le shooting vendu dans la formule est lissé sur sa période : un shooting à
   * 450 € tous les quatre mois se paie 112,50 € par mois. Le montre ici évite
   * de découvrir l'impact sur la facture depuis l'écran budget seulement.
   */
  const everyMonths = Number(shootingEveryMonths);
  const shootingPlan: ShootingPlan | null = shootingService && Number.isInteger(everyMonths) && everyMonths >= 1
    ? { serviceKey: shootingService as ShootingPlan["serviceKey"], everyMonths }
    : null;

  return (
    <>
      <button ref={triggerRef} type="button" className="btn-secondary sm:w-auto" onClick={() => { setOpen(true); setFeedback(null); }}>
        <Icon name="settings" className="h-4 w-4"/>Modifier le client
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
            <button type="button" className="absolute inset-0 cursor-default bg-[#123f73]/45 backdrop-blur-[2px]" aria-label="Fermer la modification" onClick={resetAndClose}/>
            <section ref={dialogRef} className="side-sheet relative flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-[-24px_0_70px_rgba(17,63,115,.22)] sm:rounded-l-[28px]" role="dialog" aria-modal="true" aria-labelledby="edit-client-title">
              <header className="flex shrink-0 items-center justify-between gap-4 border-b bg-white/90 px-4 py-4 backdrop-blur-xl sm:px-7">
                <div className="min-w-0"><div className="flex items-center gap-2"><p className="eyebrow">Dossier client</p><span className="badge bg-[#e8f2ff] text-[#0b5e9f]">8 sections</span></div><h2 id="edit-client-title" className="mt-1 truncate text-lg font-semibold">Modifier {initial.name}</h2></div>
                <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft transition-transform active:scale-95" onClick={resetAndClose} aria-label="Fermer">×</button>
              </header>

              <form
                action={(formData) => {
                  startTransition(async () => {
                    const result = await updateClient(formData);
                    setFeedback(result);
                    if (result.ok) {
                      setOpen(false);
                      router.refresh();
                    }
                  });
                }}
                className="flex-1 space-y-7 overflow-y-auto p-4 pb-28 sm:p-7 sm:pb-32"
              >
                <input type="hidden" name="clientId" value={initial.id}/>
                {feedback?.message && <p className={`rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>{feedback.message}</p>}

                <section>
                  <p className="eyebrow">Informations principales</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div><label className="label" htmlFor="edit-name">Nom du client</label><input id="edit-name" name="name" required className="field" defaultValue={initial.name}/></div>
                    <div><label className="label" htmlFor="edit-manager">Community manager référent</label><select id="edit-manager" name="communityManagerId" required className="field" defaultValue={initial.communityManagerId}>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></div>
                  </div>
                </section>

                <ClientLogoField
                  id="edit-client-logo"
                  initialUrl={initial.logoUrl}
                  required={!initial.logoUrl}
                />

                <fieldset className="rounded-2xl bg-canvas p-4 sm:p-5">
                  <legend className="label px-1">Contacts destinataires</legend>
                  <p className="mb-3 text-xs text-ink-faint">
                    Chacun reçoit le planning et le lien de validation.
                  </p>
                  <div className="space-y-4">
                    {editedContacts.map((contact, index) => (
                      <div key={contact.key} className="rounded-xl border border-line bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold text-ink-soft">
                            {index === 0 ? "Contact principal" : `Contact ${index + 1}`}
                          </span>
                          {editedContacts.length > 1 && (
                            <button
                              type="button"
                              className="text-xs text-state-changes hover:underline"
                              onClick={() => setEditedContacts((rows) => rows.filter((row) => row.key !== contact.key))}
                            >
                              Retirer
                            </button>
                          )}
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div><label className="label" htmlFor={`edit-first-${contact.key}`}>Prénom</label><input id={`edit-first-${contact.key}`} name="contactFirstName" required className="field" defaultValue={contact.firstName}/></div>
                          <div><label className="label" htmlFor={`edit-last-${contact.key}`}>Nom</label><input id={`edit-last-${contact.key}`} name="contactLastName" required className="field" defaultValue={contact.lastName}/></div>
                          <div><label className="label" htmlFor={`edit-phone-${contact.key}`}>Téléphone</label><input id={`edit-phone-${contact.key}`} name="contactPhone" type="tel" required className="field" defaultValue={contact.phone}/></div>
                          <div><label className="label" htmlFor={`edit-email-${contact.key}`}>E-mail</label><input id={`edit-email-${contact.key}`} name="contactEmail" type="email" required className="field" defaultValue={contact.email}/></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary mt-4"
                    onClick={() => setEditedContacts((rows) => [...rows, { key: `c-${Date.now()}`, firstName: "", lastName: "", phone: "", email: "" }])}
                  >
                    Ajouter un contact
                  </button>
                </fieldset>

                <section>
                  <p className="eyebrow">Profil de marque</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div><label className="label" htmlFor="edit-activity">Activité principale</label><input id="edit-activity" name="activity" required className="field" defaultValue={initial.brand.activity}/></div>
                    <div><label className="label" htmlFor="edit-website">Site internet</label><input id="edit-website" name="website" type="text" inputMode="url" required className="field" defaultValue={initial.brand.website}/></div>
                    <div><label className="label" htmlFor="edit-city">Ville ou zone</label><input id="edit-city" name="city" required className="field" defaultValue={initial.brand.city}/></div>
                    <div><label className="label" htmlFor="edit-postal">Code postal</label><input id="edit-postal" name="postalCode" required pattern="[0-9]{5}" inputMode="numeric" className="field" defaultValue={initial.brand.postalCode}/></div>
                    <div><label className="label" htmlFor="edit-audience">Clientèle cible</label><input id="edit-audience" name="audience" required className="field" defaultValue={initial.brand.audience}/></div>
                    <div><label className="label" htmlFor="edit-tone">Ton de communication</label><select id="edit-tone" name="brandTone" required className="field" defaultValue={initial.brand.tone}><option value="chaleureux">Chaleureux et proche</option><option value="premium">Premium et élégant</option><option value="expert">Expert et pédagogique</option><option value="dynamique">Dynamique et direct</option><option value="institutionnel">Institutionnel et rassurant</option></select></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor="edit-keywords">Produits, services et mots-clés</label><textarea id="edit-keywords" name="keywords" required rows={3} className="field" defaultValue={initial.brand.keywords}/></div>
                  </div>
                </section>

                <fieldset>
                  <legend className="eyebrow">Réseaux diffusés</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{SOCIAL_NETWORKS.map((network) => <label key={network} className="choice-chip"><input type="checkbox" name="networks" value={network} defaultChecked={initial.networks.includes(network)}/>{SOCIAL_NETWORK_LABELS[network]}</label>)}</div>
                </fieldset>

                <fieldset>
                  <legend className="eyebrow">Jours de publication</legend>
                  <p className="mt-1 text-xs text-ink-faint">Les prochaines fiches seront préprogrammées sur ces jours.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <label key={day} className="choice-chip">
                        <input type="checkbox" name="publicationWeekdays" value={day} defaultChecked={initial.publicationWeekdays.includes(day)}/>
                        {WEEKDAY_LABELS[day]}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="eyebrow">Rythme mensuel vendu</legend>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><label className="label" htmlFor="edit-photo">Photos</label><input id="edit-photo" name="photoPerMonth" type="number" min="0" max="31" required className="field" defaultValue={initial.cadence.photo}/></div>
                    <div><label className="label" htmlFor="edit-video">Vidéos / Reels</label><input id="edit-video" name="videoPerMonth" type="number" min="0" max="31" required className="field" defaultValue={initial.cadence.video}/></div>
                    <div><label className="label" htmlFor="edit-story">Stories</label><input id="edit-story" name="storyPerMonth" type="number" min="0" max="31" required className="field" defaultValue={initial.cadence.story}/></div>
                    <div><label className="label" htmlFor="edit-visual">Visuels / carrousels</label><input id="edit-visual" name="visualPerMonth" type="number" min="0" max="31" required className="field" defaultValue={initial.cadence.visual}/></div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#d8e4f8] bg-[#f7faff] p-4">
                    <p className="label">Shooting vendu dans la formule</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      Un shooting qui revient à intervalle régulier. Son prix est étalé
                      sur la période : il entre dans la facture mensuelle et dans le
                      budget, sans qu&apos;on ait à le ressaisir à chaque fois.
                    </p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="edit-shooting-service">Prestation</label>
                        <select
                          id="edit-shooting-service"
                          name="shootingService"
                          className="field bg-white"
                          value={shootingService}
                          onChange={(event) => setShootingService(event.target.value)}
                        >
                          <option value="">Aucun shooting vendu</option>
                          {SHOOTING_PLAN_SERVICES.map((key) => (
                            <option key={key} value={key}>
                              {findService(key)?.label} — {formatEuros(findService(key)?.unitPriceCents ?? 0)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor="edit-shooting-months">Tous les combien de mois</label>
                        <input
                          id="edit-shooting-months"
                          name="shootingEveryMonths"
                          type="number"
                          min="1"
                          max="24"
                          className="field bg-white"
                          value={shootingService ? shootingEveryMonths : ""}
                          disabled={!shootingService}
                          required={Boolean(shootingService)}
                          onChange={(event) => setShootingEveryMonths(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-4 border-t border-[#d8e4f8] pt-4">
                      <p className="label">Prestation sur mesure dans la formule</p>
                      <p className="mt-1 text-xs text-ink-faint">Ce qui est vendu chaque mois hors carte. Laissez vide s&apos;il n&apos;y en a pas.</p>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label" htmlFor="edit-custom-label">Description</label>
                          <input
                            id="edit-custom-label"
                            name="customServiceLabel"
                            maxLength={120}
                            className="field bg-white"
                            placeholder="Post vidéo 1 semaine sur deux // LinkedIn"
                            defaultValue={initial.customMonthly?.label ?? ""}
                          />
                        </div>
                        <div>
                          <label className="label" htmlFor="edit-custom-price">Prix mensuel (€ HT)</label>
                          <input
                            id="edit-custom-price"
                            name="customServicePriceEuros"
                            type="number"
                            min="0"
                            step="0.01"
                            className="field bg-white"
                            placeholder="110"
                            defaultValue={initial.customMonthly ? initial.customMonthly.priceCents / 100 : ""}
                          />
                        </div>
                      </div>
                    </div>
                    {shootingPlan && (
                      <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-ink-soft">
                        Soit <strong>{formatEuros(shootingMonthlyCostCents(shootingPlan))} par mois</strong>{" "}
                        ajoutés au rythme vendu, et {shootingsPerYear(shootingPlan)} shooting
                        {shootingsPerYear(shootingPlan) > 1 ? "s" : ""} par an. Le rappel de
                        planification s&apos;ouvre un mois avant chaque échéance.
                      </p>
                    )}
                  </div>
                </fieldset>

                <section className="rounded-2xl border border-[#d8e4f8] bg-[#f7faff] p-4 sm:p-5">
                  <p className="eyebrow">Validation et WhatsApp</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div><label className="label" htmlFor="edit-day">Jour limite</label><select id="edit-day" name="deadlineWeekday" required className="field bg-white" defaultValue={initial.validation.deadlineWeekday}>{WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></div>
                    <div><label className="label" htmlFor="edit-time">Heure limite</label><input id="edit-time" name="deadlineTime" type="time" required className="field bg-white" defaultValue={initial.validation.deadlineTime.slice(0, 5)}/></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor="edit-policy">Règle de validation</label><select id="edit-policy" name="approvalPolicy" required className="field bg-white" defaultValue={initial.validation.approvalPolicy} onChange={(event) => setTacit(event.target.value === "tacit_allowed")}><option value="explicit_required">Validation explicite obligatoire</option><option value="tacit_allowed">Validation tacite autorisée</option></select></div>
                    {tacit && <div className="sm:col-span-2"><label className="label" htmlFor="edit-tacit">Mention contractuelle</label><textarea id="edit-tacit" name="tacitNotice" required rows={2} className="field bg-white" defaultValue={initial.validation.tacitNotice}/></div>}
                    <div className="sm:col-span-2"><label className="label" htmlFor="edit-whatsapp">Nom exact du groupe WhatsApp</label><input id="edit-whatsapp" name="whatsappGroup" required className="field bg-white" defaultValue={initial.validation.whatsappGroup}/><p className="mt-1 text-xs text-ink-faint">Recopiez le nom affiché dans WhatsApp, sans numéro ni lien d’invitation.</p></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor="edit-signature">Signature des publications</label><textarea id="edit-signature" name="postSignature" rows={2} maxLength={300} className="field bg-white" defaultValue={initial.validation.postSignature}/><p className="mt-1 text-xs text-ink-faint">Préremplie en bas du texte de chaque publication des prochaines fiches.</p></div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl bg-[#123f73] text-white">
                  <div className="border-b border-white/10 p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[.12em] text-white/60">Bibliothèque LYFTT · sans IA</p><h3 className="mt-1 font-semibold">Modifier les 20 hashtags</h3><p className="mt-1 text-xs text-white/65">Le type fournit 15 hashtags fixes ; les 5 derniers restent propres au client.</p></div>
                  <div className="grid lg:grid-cols-2">
                    <div className="border-b border-white/10 p-4 sm:p-5 lg:border-b-0 lg:border-r">
                      <label className="label text-white/80" htmlFor="edit-client-type">Type de client</label>
                      <select id="edit-client-type" name="clientType" required className="field bg-white text-ink" value={clientType} onChange={(event) => setClientType(event.target.value as LyfttClientType)}>{LYFTT_CLIENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
                      <div key={clientType} className="reveal-panel mt-4 flex flex-wrap gap-1.5">{baseHashtags.map((hashtag) => <span key={hashtag} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/85">{hashtag}</span>)}</div>
                    </div>
                    <div className="bg-white/[.05] p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-3"><p className="label text-white/80">5 hashtags client</p><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${hashtagsReady ? "bg-state-approved/20 text-[#a7f3d0]" : "bg-white/10 text-white/60"}`}>{normalizedCustom.filter(Boolean).length}/5</span></div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{customHashtags.map((value, index) => {
                        const key = customKeys[index];
                        const duplicate = Boolean(key) && (baseKeys.has(key) || customKeys.indexOf(key) !== index);
                        return <div key={index}><label className="sr-only" htmlFor={`edit-hashtag-${index}`}>Hashtag client {index + 1}</label><div className="relative"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-semibold text-ink-faint">#</span><input id={`edit-hashtag-${index}`} name={`customHashtag${index + 1}`} required minLength={2} maxLength={60} className={`field bg-white pl-7 text-ink ${duplicate ? "border-state-changes ring-2 ring-state-changes/20" : ""}`} value={value.replace(/^#+/, "")} onChange={(event) => setCustomHashtags((current) => current.map((hashtag, currentIndex) => currentIndex === index ? event.target.value : hashtag))} aria-invalid={duplicate || undefined}/></div>{duplicate && <p className="mt-1 text-[11px] text-[#fda4af]">Déjà utilisé : choisissez-en un autre.</p>}</div>;
                      })}</div>
                    </div>
                  </div>
                </section>

                <div className="fixed inset-x-0 bottom-0 z-10 flex justify-end gap-2 border-t bg-white/90 p-4 backdrop-blur-xl sm:left-auto sm:w-full sm:max-w-3xl sm:px-7">
                  <button type="button" className="btn-secondary sm:w-auto" onClick={resetAndClose}>Annuler</button>
                  <button type="submit" className="btn-primary sm:w-auto" disabled={pending || !hashtagsReady}>{pending ? "Enregistrement…" : "Enregistrer les modifications"}</button>
                </div>
              </form>
            </section>
          </div>
        </Portal>
      )}
    </>
  );
}
