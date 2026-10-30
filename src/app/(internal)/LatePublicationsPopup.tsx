"use client";

import { useEffect, useState } from "react";
import type { LatePublicationsView } from "@/lib/domain/late-publications";
import { LatePublicationsDialog } from "./LatePublicationsDialog";

/**
 * L'alerte de retard, qui s'ouvre à chaque chargement.
 *
 * ## Aucune mémoire, et c'est la demande
 *
 * Pas de ligne « déjà vu » en base, pas de `localStorage`, rien. Tant qu'une
 * publication validée reste non cochée, la fenêtre s'ouvre à chaque
 * chargement — on ne l'éteint pas d'un clic, on l'éteint en cochant. C'est
 * l'inverse exact des conseils du lundi, qui s'éteignent par une ligne
 * `weekly_advice_views` une fois lus.
 *
 * `useState(true)` et non `false` + effet : il n'y a aucun instant à attendre,
 * et la route par l'effet ferait clignoter l'écran avant l'ouverture.
 *
 * ## Pourquoi elle ne peut pas boucler
 *
 * Trois propriétés, et non une précaution :
 *
 * 1. `close()` ne fait que `setOpen(false)` — aucune action serveur, aucun
 *    `router.refresh()`. `WeeklyAdvicePopup` a dû ajouter un drapeau `closed`
 *    précisément parce qu'il rafraîchit après avoir enregistré ; ici il n'y a
 *    rien à enregistrer, donc rien à rafraîchir ;
 * 2. l'île garde sa place dans l'arbre, donc React conserve `open === false` à
 *    travers les re-rendus du parent — y compris celui que provoque
 *    `revalidatePath("/publications")` quand quelqu'un coche une publication
 *    en dessous ;
 * 3. elle ne reçoit **aucune `key` dérivée des données** — l'inverse de
 *    `<PublicationChecklist key={date}>`, où le remontage est l'intention.
 *
 * Elle ne se rouvre donc que sur un vrai montage : un chargement complet, F5,
 * une entrée dans l'application. Ce qui est la demande.
 */
/** Marge : les deux modales prennent la main sur le défilement, elles ne doivent jamais se croiser. */
const YIELD_MARGIN_MS = 1000;

export function LatePublicationsPopup(
  { view, yieldAt = null }: { view: LatePublicationsView; yieldAt?: string | null },
) {
  /*
   * L'état d'ouverture se déduit des données au montage : une île montée sans
   * retard garde `open === false` et ne peut plus s'ouvrir sans un vrai
   * chargement, même si le compte revient pendant qu'on coche.
   */
  const [open, setOpen] = useState(view.late.length > 0);
  const yieldsAtMs = yieldAt ? new Date(yieldAt).getTime() - YIELD_MARGIN_MS : null;
  const [yielded, setYielded] = useState(() => yieldsAtMs !== null && Date.now() >= yieldsAtMs);

  /*
   * Les conseils du lundi passent devant à leur heure : l'alerte se retire une
   * seconde avant, et reviendra au prochain chargement si le retard demeure.
   */
  useEffect(() => {
    if (yieldsAtMs === null) {
      setYielded(false);
      return;
    }
    const delay = yieldsAtMs - Date.now();
    if (delay <= 0) {
      setYielded(true);
      return;
    }
    setYielded(false);
    const timer = window.setTimeout(() => setYielded(true), delay);
    return () => window.clearTimeout(timer);
  }, [yieldsAtMs]);

  if (view.late.length === 0) return null;
  if (!open || yielded) return null;

  return <LatePublicationsDialog view={view} onClose={() => setOpen(false)}/>;
}
