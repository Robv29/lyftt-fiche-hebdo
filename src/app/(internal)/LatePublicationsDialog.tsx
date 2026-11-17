"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Icon } from "@/components/Icon";
import { Portal } from "@/components/Portal";
import { MEDIA_FORMAT_LABELS } from "@/lib/domain/types";
import { setPublicationPublished } from "./publications/actions";
import type { LatePublicationEntry, LatePublicationsView } from "@/lib/domain/late-publications";

/**
 * La fenêtre des publications en retard : on y coche, on n'y lit pas.
 *
 * ## Ce que la première version faisait faire
 *
 * Elle annonçait « 5 publications non publiées », ajoutait deux autres comptes
 * en gris (8 en attente de validation, 2 pour aujourd'hui), puis proposait
 * « Ouvrir Publications » — un lien qui tombait sur le jour **par défaut** de
 * l'écran, c'est-à-dire aujourd'hui, le seul jour qui par construction ne
 * contient aucun retard. Le geste demandé coûtait donc deux navigations et une
 * recherche à l'œil dans la checklist, et le seul texte qui disait quoi faire
 * était une note de bas de page renvoyant ailleurs. Une fenêtre qui revient à
 * chaque chargement et qu'on ne peut éteindre qu'en allant travailler autre
 * part s'apprend à fermer.
 *
 * Trois décisions en découlent :
 *
 * 1. **l'action principale est la correction**. Chaque ligne porte son propre
 *    bouton, qui appelle `setPublicationPublished` — l'action de l'écran
 *    Publications, avec ses gardes de rôle, sa vérification de périmètre sous
 *    RLS et son refus de confirmer une collaboration non invitée. Aucune
 *    seconde règle, aucune seconde route d'écriture ;
 * 2. **un seul compte en gros**, celui des lignes cochables. L'attente de
 *    validation client reste une ligne grise sous la liste : le geste n'est pas
 *    le même, et un compteur qu'on ne peut pas faire baisser d'ici dilue celui
 *    qu'on peut. Le rappel « aujourd'hui » a disparu, jusque dans la règle ;
 * 3. **le lien tombe sur le bon jour**. Chaque groupe porte son
 *    `?date=` — le jour de ses propres lignes, jamais le jour par défaut.
 *
 * La liste rétrécit à chaque coche et la fenêtre se ferme d'elle-même quand il
 * ne reste rien : c'est la seule « mémoire » qu'elle ait, et elle ne survit pas
 * au chargement suivant — qui, lui, lira la base.
 *
 * ## Le motif de modale, inchangé
 *
 * `Portal`, fond cliquable, `role="dialog"`, `aria-modal`, Échap, piège de
 * tabulation, à l'identique de `WeeklyAdviceDialog`. Le `Portal` n'est pas
 * décoratif : les blocs de page portent `animation:rise-in … both`, et une
 * animation d'opacité maintenue crée un contexte d'empilement permanent — une
 * modale rendue dans un bloc de page passe derrière les blocs suivants quel que
 * soit son `z-index`.
 *
 * Deux écarts assumés avec le précédent :
 *
 * - **pas de zone `tabIndex={0}`** : le corps des conseils ne portait aucun
 *   lien, donc rien n'y attrapait le focus et les touches de défilement
 *   n'agissaient pas. Ici chaque ligne porte un bouton ou un lien, déjà pris
 *   dans le cycle de tabulation ;
 * - **pas de `returnFocusTo`** : la fenêtre s'ouvre d'elle-même, il n'y a aucun
 *   déclencheur où renvoyer le curseur.
 *
 * Le piège de tabulation ne regarde que l'intérieur du `<section>` : le fond
 * cliquable en est un frère, il n'y entre pas. Le premier élément focalisé est
 * donc la croix de fermeture, et c'est voulu — une fenêtre qui s'ouvre seule ne
 * doit pas poser le curseur sur un bouton qui écrit, où une frappe d'Entrée
 * confirmerait une publication que personne n'a regardée.
 *
 * Tous les liens ferment la fenêtre avant de naviguer : la coquille n'est pas
 * re-rendue lors d'une navigation côté client, donc une fenêtre laissée ouverte
 * resterait posée sur l'écran d'arrivée.
 */

/** Le temps de lire « C'est à jour » avant que la fenêtre se retire. */
const DONE_DELAY_MS = 1400;

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function dayLabel(day: string): string {
  return format(new Date(`${day}T12:00:00`), "EEEE d MMMM", { locale: fr });
}

function groupByDay(entries: readonly LatePublicationEntry[]): [string, LatePublicationEntry[]][] {
  const groups = new Map<string, LatePublicationEntry[]>();
  for (const item of entries) {
    const bucket = groups.get(item.scheduledDate);
    if (bucket) bucket.push(item);
    else groups.set(item.scheduledDate, [item]);
  }
  // `late` arrive déjà trié du plus ancien au plus récent : l'ordre d'insertion
  // d'une Map le conserve, inutile de retrier.
  return [...groups.entries()];
}

export function LatePublicationsDialog({
  view,
  onClose,
}: {
  view: LatePublicationsView;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  /*
   * `onClose` change à chaque rendu du parent : le garder dans une référence
   * évite de reposer l'écouteur de clavier et de re-déclencher le premier
   * focus — ce qui ramènerait le curseur au fond en pleine lecture si la
   * coquille se rafraîchissait, ce qu'une coche provoque justement.
   */
  const close = useRef(onClose);
  close.current = onClose;

  /*
   * La liste de travail est locale, semée une seule fois.
   *
   * Confirmer une publication appelle `revalidatePath("/publications")`, ce qui
   * fait re-rendre la route courante et donc la coquille : la fenêtre reçoit
   * alors une nouvelle `view`. L'état local est ce qui garantit qu'une ligne
   * cochée ne réapparaît pas le temps d'un aller-retour, et qu'une ligne
   * devenue en retard entre-temps n'arrive pas par surprise sous le curseur.
   */
  const [items, setItems] = useState<LatePublicationEntry[]>(view.late);
  const [confirmed, setConfirmed] = useState(0);
  /*
   * Le message porte la ligne qui l'a produit : un refus se lit sous cette
   * ligne-là, là où le doigt vient de cliquer, et non en bas d'une liste qu'il
   * faudrait avoir sous les yeux. La confirmation, elle, se lit en tête — sa
   * ligne, elle, a disparu.
   */
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; itemId: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  /*
   * Une ligne cochée disparaît, et avec elle le bouton qui portait le focus :
   * celui-ci retombe alors sur `<body>`, hors du piège de tabulation, et la
   * touche Tab repartirait dans la page restée derrière. On le ramène sur la
   * croix de fermeture — prévisible, et sans effet.
   */
  useEffect(() => {
    const root = dialogRef.current;
    if (!root || root.contains(document.activeElement)) return;
    closeButtonRef.current?.focus();
  }, [items.length]);

  /*
   * Plus rien à cocher : la fenêtre se retire seule, le temps de lire la
   * confirmation. Sans ce délai, la dernière coche ferait disparaître la
   * fenêtre d'un coup, et personne ne saurait si elle a enregistré.
   */
  useEffect(() => {
    if (items.length > 0 || confirmed === 0) return;
    const timer = window.setTimeout(() => close.current(), DONE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [items.length, confirmed]);

  const count = items.length;
  const groups = groupByDay(items);

  /*
   * Ce qu'entend un lecteur d'écran. Le texte est dérivé des compteurs, et non
   * du message du serveur : trois coches de suite donnaient trois fois la même
   * phrase, qu'une région vive ne réannonce pas. Et la région reste montée
   * jusqu'au bout — démontée, le mot de fin n'était jamais lu, la fenêtre se
   * refermant une seconde et demie plus tard.
   */
  const liveMessage = confirmed === 0
    ? ""
    : count > 0
      ? `Publication confirmée. ${count} publication${count > 1 ? "s" : ""} à confirmer.`
      : `C’est à jour. ${confirmed} publication${confirmed > 1 ? "s" : ""} confirmée${confirmed > 1 ? "s" : ""}.`;

  /*
   * Une seule écriture à la fois, comme sur l'écran Publications. Les autres
   * boutons se désactivent pendant la transition ; **celui qu'on vient de
   * cliquer reste actif**, et c'est ce qui garde le focus dans la fenêtre : un
   * élément désactivé perd le focus au profit de `<body>`, hors du piège de
   * tabulation — et c'est précisément sous cette ligne que s'affiche un refus,
   * qu'il faudrait alors aller chercher dans une page qu'on ne peut plus
   * parcourir. Le garde de réentrance ci-dessous tient le rôle que tenait la
   * désactivation.
   *
   * Le message vient du serveur et n'est pas réécrit : c'est lui qui connaît le
   * refus (« Invitez d'abord … ») et le périmètre.
   */
  const confirmOnline = (item: LatePublicationEntry) => {
    if (pending) return;
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await setPublicationPublished(item.id, true);
        setPendingId(null);
        setFeedback({
          ok: result.ok,
          text: result.message ?? (result.ok ? "Publication confirmée." : "Enregistrement impossible."),
          itemId: item.id,
        });
        if (!result.ok) return;
        setConfirmed((done) => done + 1);
        setItems((current) => current.filter((row) => row.id !== item.id));
      } catch {
        /*
         * Réseau coupé, 5xx, action invalidée par un déploiement : l'appel
         * rejette au lieu de répondre. Sans ce rattrapage la ligne restait sur
         * « … » pour toujours, sans un mot. La ligne reste dans la liste : une
         * réponse perdue ne dit pas si l'écriture a eu lieu.
         */
        setPendingId(null);
        setFeedback({ ok: false, text: "Enregistrement interrompu. Réessayez.", itemId: item.id });
      }
    });
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-[#123f73]/45 backdrop-blur-[2px]"
          aria-label="Fermer"
          onClick={onClose}
        />
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="late-publications-title"
          className="reveal-panel relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_24px_70px_rgba(17,63,115,.28)]"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Icon name={count === 0 ? "check" : "warning"} className="h-3.5 w-3.5"/>
                Checklist de publication
              </p>
              <h2 id="late-publications-title" className="mt-1 text-lg font-semibold">
                {count === 0
                  ? "C’est à jour"
                  : `${count} publication${count > 1 ? "s" : ""} à confirmer`}
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft transition-transform active:scale-95"
              onClick={onClose}
              aria-label="Fermer"
            >×</button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {count > 0 ? (
              <p className="text-sm text-ink-soft">
                Programmées avant aujourd’hui et validées par le client. Si le post est
                en ligne, cochez-le ici.
              </p>
            ) : (
              <p className="text-sm text-ink-soft">
                {confirmed} publication{confirmed > 1 ? "s" : ""} confirmée{confirmed > 1 ? "s" : ""}.
                Plus rien n’attend de confirmation.
              </p>
            )}

            {/*
              Une seule région vive, montée tant que la fenêtre vit : à l'œil
              elle n'apparaît qu'entre deux coches, au lecteur d'écran elle dit
              aussi le compte restant puis le mot de fin.
            */}
            <p
              role="status"
              className={confirmed > 0 && count > 0 && feedback?.ok
                ? "rounded-xl bg-[#f6fdf9] px-4 py-2.5 text-center text-xs text-state-approved"
                : "sr-only"}
            >
              {liveMessage}
            </p>

            {groups.map(([day, dayItems]) => (
              <section key={day} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h3 className="min-w-0 truncate text-sm font-semibold capitalize">{dayLabel(day)}</h3>
                  {/* Le jour de ces lignes, et non le jour par défaut de l'écran. */}
                  <Link
                    href={`/publications?date=${day}`}
                    onClick={onClose}
                    aria-label={`Ouvrir la checklist du ${dayLabel(day)}`}
                    className="shrink-0 text-xs font-semibold text-accent hover:underline"
                  >
                    Ouvrir la checklist
                  </Link>
                </div>
                <ul className="space-y-2">
                  {dayItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{item.clientName}</strong>
                        <span className="mt-0.5 block truncate text-xs text-ink-faint">
                          {MEDIA_FORMAT_LABELS[item.format]}
                          {item.scheduledTime ? ` · ${item.scheduledTime.slice(0, 5)}` : ""}
                        </span>
                        {item.pendingCollaboration && (
                          <span className="mt-1 block text-xs leading-relaxed text-[#8a5700]">
                            Invitez {item.pendingCollaboration} en collaboration avant de confirmer.
                          </span>
                        )}
                        {feedback && !feedback.ok && feedback.itemId === item.id && (
                          <span role="alert" className="mt-1 block text-xs leading-relaxed text-state-changes">
                            {feedback.text}
                          </span>
                        )}
                      </span>
                      {/*
                        Chaque nom accessible s'ouvre par le libellé visible :
                        une commande vocale « En ligne » doit atteindre le bouton
                        qui porte ce mot (WCAG 2.5.3). Et ce nom ne bouge pas
                        pendant l'écriture, où le contenu du bouton tombe à
                        « … ». Il dit en plus le jour et le dossier : trois
                        boutons identiques dans une liste de liens ne se
                        distinguent, au lecteur d'écran, que par là.
                      */}
                      {item.pendingCollaboration ? (
                        <Link
                          href={`/publications?date=${item.scheduledDate}`}
                          onClick={onClose}
                          aria-label={`Ouvrir la checklist du ${dayLabel(item.scheduledDate)} pour ${item.clientName}`}
                          className="mobile-inline-btn btn-secondary shrink-0"
                        >
                          Ouvrir
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="mobile-inline-btn btn-primary shrink-0"
                          disabled={pending && pendingId !== item.id}
                          onClick={() => confirmOnline(item)}
                          aria-label={`En ligne — confirmer la publication de ${item.clientName}, ${dayLabel(item.scheduledDate)}`}
                        >
                          {pendingId === item.id
                            ? "…"
                            : <><Icon name="check" className="h-4 w-4"/>En ligne</>}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {/*
              Le retard dont la case est grisée : compté, jamais nommé. Le geste
              est d'aller chercher la validation du client, pas de cocher — et un
              compteur qu'on ne peut pas faire baisser d'ici affaiblirait celui
              qu'on peut.
            */}
            {count > 0 && view.awaitingApproval > 0 && (
              <p className="border-t border-line pt-3 text-xs text-ink-faint">
                {view.awaitingApproval} autre{view.awaitingApproval > 1 ? "s" : ""} publication
                {view.awaitingApproval > 1 ? "s" : ""} en retard attend
                {view.awaitingApproval > 1 ? "ent" : ""} la validation du client : elle
                {view.awaitingApproval > 1 ? "s ne se cochent" : " ne se coche"} pas tant
                qu’il n’a pas répondu.
              </p>
            )}
          </div>

          <footer className="shrink-0 space-y-2 border-t border-line px-5 py-3">
            <button type="button" className="btn-secondary w-full" onClick={onClose}>
              Fermer
            </button>
            {/* L'issue de secours n'apparaît qu'une fois qu'elle peut servir. */}
            {confirmed > 0 && (
              <p className="text-center text-[11px] text-ink-faint">
                Coché par erreur ? La case se décoche depuis la checklist du jour.
              </p>
            )}
          </footer>
        </section>
      </div>
    </Portal>
  );
}
