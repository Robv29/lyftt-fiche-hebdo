"use client";

import { useEffect, useState } from "react";
import { hasLatePublications, type LatePublicationsView } from "@/lib/domain/late-publications";
import { LatePublicationsDialog } from "./LatePublicationsDialog";

/**
 * L'alerte de retard, qui s'ouvre à chaque chargement.
 *
 * ## Aucune mémoire, et c'est la demande
 *
 * Pas de ligne « déjà vu » en base, pas de `localStorage`, rien. Tant qu'une
 * publication validée reste non cochée, la fenêtre s'ouvre à chaque
 * chargement — on ne l'éteint pas d'un clic, on l'éteint en cochant, et depuis
 * la refonte on la coche sans quitter la fenêtre. C'est l'inverse exact des
 * conseils du lundi, qui s'éteignent par une ligne `weekly_advice_views` une
 * fois lus.
 *
 * `useState(true)` et non `false` + effet : il n'y a aucun instant à attendre,
 * et la route par l'effet ferait clignoter l'écran avant l'ouverture.
 *
 * ## Pourquoi elle ne peut pas boucler
 *
 * Confirmer une publication depuis la fenêtre appelle une action serveur qui
 * revalide `/publications` : la route courante est donc re-rendue, coquille
 * comprise, à chaque coche. Deux propriétés — et non une précaution — font que
 * la fenêtre ne s'en trouve ni rouverte ni remontée :
 *
 * 1. l'état d'ouverture est un **état initial**, lu une seule fois au montage.
 *    Un re-rendu du parent ne le recalcule pas, et React le conserve puisque
 *    l'île garde sa place dans l'arbre ;
 * 2. elle ne reçoit **aucune `key` dérivée des données** — l'inverse de
 *    `<PublicationChecklist key={date}>`, où le remontage est l'intention.
 *
 * C'est aussi pourquoi le compte retombé à zéro ne la démonte pas d'autorité :
 * la fenêtre tient sa propre liste, la voit rétrécir et se retire d'elle-même
 * quand il ne reste rien. L'arracher à mi-chemin lui ferait perdre le mot de
 * confirmation qu'elle vient d'afficher.
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
   * L'état d'ouverture se déduit des données au montage, par la règle partagée :
   * une île montée sans retard garde `open === false` et ne peut plus s'ouvrir
   * sans un vrai chargement, même si du retard apparaît pendant qu'on coche.
   */
  const [open, setOpen] = useState(() => hasLatePublications(view));
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

  if (!open || yielded) return null;

  return <LatePublicationsDialog view={view} onClose={() => setOpen(false)}/>;
}
