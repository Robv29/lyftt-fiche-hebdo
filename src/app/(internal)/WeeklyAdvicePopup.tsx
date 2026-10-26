"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyAdviceView } from "@/lib/domain/weekly-advice";
import { WeeklyAdviceDialog } from "./WeeklyAdviceDialog";
import { markWeeklyAdviceSeen } from "./weekly-advice-actions";

/**
 * La pop-up du lundi 14 h 30, qui s'ouvre d'elle-même.
 *
 * ## Pourquoi la coquille ne regarde pas l'heure
 *
 * Dans l'App Router, une mise en page partagée **n'est pas re-rendue** lors
 * d'une navigation côté client entre écrans voisins : seulement au chargement
 * complet, sur `router.refresh()` ou sur une revalidation. Une décision prise
 * côté serveur dans la coquille serait donc figée au dernier chargement —
 * l'onglet ouvert à 14 h 20 ne verrait jamais 14 h 30 arriver, et c'est
 * exactement ce que le propriétaire a demandé.
 *
 * La coquille ne transmet donc qu'un **instant** (`opensAt`, lundi 14 h 30 à
 * Paris résolu côté serveur dans la base de fuseaux). Cette île compare
 * `Date.now()` à cet instant — une comparaison d'instants, donc indifférente au
 * fuseau de l'appareil et à l'heure d'été — et, si le moment est encore devant,
 * arme un unique minuteur pour le reste du délai. Un onglet laissé ouvert
 * depuis le matin s'ouvre donc tout seul à 14 h 30, sans re-interroger le
 * serveur.
 *
 * ## Ce que l'horloge du navigateur ne décide pas
 *
 * Elle ne décide que du *moment dans la journée*. Le *si* est côté serveur :
 * la ligne « déjà vu » est clé par profil et par semaine, donc elle survit à un
 * changement d'appareil, à une navigation privée et à un vidage de cache. Une
 * horloge d'appareil grossièrement fausse peut avancer ou retarder l'ouverture
 * d'une journée ; elle ne peut pas faire voir deux fois les mêmes conseils.
 */

/**
 * Au-delà de cette avance, aucun minuteur n'est armé.
 *
 * Un `setTimeout` de plusieurs jours ne survit à aucune mise en veille et
 * `setTimeout` déborde au-delà de 24,8 jours — il se déclencherait alors
 * immédiatement, c'est-à-dire au pire moment. Douze heures couvrent largement
 * le seul cas utile : l'onglet ouvert le lundi matin.
 */
const MAX_ARMED_DELAY_MS = 12 * 60 * 60 * 1000;

export function WeeklyAdvicePopup({ advice }: { advice: WeeklyAdviceView }) {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (closed) return;
    const delay = new Date(advice.opensAt).getTime() - Date.now();
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    if (delay > MAX_ARMED_DELAY_MS) return;
    const timer = window.setTimeout(() => setOpen(true), delay);
    return () => window.clearTimeout(timer);
  }, [advice.opensAt, closed]);

  if (!open) return null;

  const close = () => {
    /*
     * Fermée tout de suite, enregistrée ensuite. L'inverse — attendre la
     * réponse du serveur pour refermer — donnerait une fenêtre qui résiste au
     * clic le temps d'un aller-retour, sur un encart purement informatif.
     *
     * `closed` empêche le minuteur de se réarmer pendant le rafraîchissement :
     * sans lui, la fenêtre se rouvrirait entre la fermeture et l'arrivée de la
     * nouvelle mise en page.
     */
    setOpen(false);
    setClosed(true);
    startTransition(async () => {
      await markWeeklyAdviceSeen({ isoYear: advice.isoYear, isoWeek: advice.isoWeek, dismissed: true });
      router.refresh();
    });
  };

  return <WeeklyAdviceDialog advice={advice} onClose={close}/>;
}
