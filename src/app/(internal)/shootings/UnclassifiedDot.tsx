/**
 * Le point rouge d'un shooting non classé.
 *
 * Pas de directive « use client » : le même composant s'affiche dans la liste,
 * qui est cliente, et sur la fiche, qui est servie. Il ne porte ni état ni
 * évènement — il n'a rien à faire du côté client.
 *
 * La couleur ne dit rien toute seule : un point rouge sans texte se lit
 * « problème » sans dire lequel, et ne se lit pas du tout au lecteur d'écran.
 * D'où le libellé, comme le « ! » du calendrier de production. Là où la place
 * le permet, on montre en plus le mot : `label` l'écrit à côté du point.
 */
export function UnclassifiedDot({ label = false }: { label?: boolean }) {
  const title = "Non classé : décision de facturation en attente";
  if (label) {
    return (
      <span className="inline-flex items-center gap-1.5 text-state-changes" title={title}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-state-changes" aria-hidden="true" />
        <span className="text-xs font-semibold">Non classé</span>
      </span>
    );
  }
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-state-changes"
      role="img"
      aria-label={title}
      title={title}
    />
  );
}
