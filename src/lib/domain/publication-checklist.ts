export type PublicationStep = "media" | "content";

export function publicationReadiness(input:{ mediaRequired:boolean; mediaAvailable:boolean; mediaDownloaded:boolean; contentCopied:boolean }, completedStep:PublicationStep) {
  if (completedStep === "media" && input.mediaRequired && !input.mediaAvailable) return { allowed:false, published:false };
  const mediaDone=!input.mediaRequired||input.mediaDownloaded||completedStep==="media";
  const contentDone=input.contentCopied||completedStep==="content";
  return { allowed:true, published:mediaDone&&contentDone };
}

/**
 * La confirmation de publication est un geste distinct de la préparation.
 *
 * Télécharger le média et copier le texte préparent le post ; seul un humain
 * sait s'il est effectivement en ligne. On n'ouvre la confirmation qu'une fois
 * la préparation faite, pour qu'une case cochée signifie vraiment quelque
 * chose.
 */
export function canConfirmPublication(input:{ mediaRequired:boolean; mediaDownloaded:boolean; contentCopied:boolean }):boolean {
  const mediaDone = !input.mediaRequired || input.mediaDownloaded;
  return mediaDone && input.contentCopied;
}

/**
 * Réseaux prévus mais pas encore cochés comme publiés.
 *
 * Générique pour conserver le type exact des réseaux : l'appelant en a besoin
 * pour les libeller.
 */
export function missingNetworks<T extends string>(planned:readonly T[], published:readonly string[]):T[] {
  const done = new Set(published);
  return planned.filter((network) => !done.has(network));
}
