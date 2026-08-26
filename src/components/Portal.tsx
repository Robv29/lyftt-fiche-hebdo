"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Rend son contenu directement dans `<body>`.
 *
 * Les blocs de page reçoivent `animation:rise-in … both` (`globals.css`), et
 * une animation d'opacité maintenue en `fill-mode: both` crée un **contexte
 * d'empilement** permanent sur l'élément animé. Une modale `position:fixed`
 * rendue à l'intérieur d'un de ces blocs se retrouve donc plafonnée à
 * l'empilement de son conteneur, quel que soit son `z-index` : elle passe
 * derrière les blocs suivants de la page.
 *
 * Le commentaire de `rise-in` en garde la trace : le transform avait déjà été
 * retiré de cette animation pour la même famille de bugs. Mais transform et
 * opacity ne cassent pas la même chose — le premier crée un *bloc englobant*
 * (la modale est mal positionnée), le second un *contexte d'empilement* (elle
 * est mal superposée). Retirer le transform a donc réglé la position, pas la
 * superposition.
 *
 * Sortir la modale du sous-arbre animé règle les deux d'un coup, et résiste à
 * toute animation qu'on ajouterait plus tard sur les conteneurs de page.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  // `document` n'existe pas au rendu serveur : le portail n'est ouvert
  // qu'après montage côté client.
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
