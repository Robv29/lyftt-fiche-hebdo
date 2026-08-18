export type PublicationStep = "media" | "content";

export function publicationReadiness(input:{ mediaRequired:boolean; mediaAvailable:boolean; mediaDownloaded:boolean; contentCopied:boolean }, completedStep:PublicationStep) {
  if (completedStep === "media" && input.mediaRequired && !input.mediaAvailable) return { allowed:false, published:false };
  const mediaDone=!input.mediaRequired||input.mediaDownloaded||completedStep==="media";
  const contentDone=input.contentCopied||completedStep==="content";
  return { allowed:true, published:mediaDone&&contentDone };
}

/*
 * La case « publié » fait foi, et rien d'autre.
 *
 * La confirmation était fermée tant que le média n'était pas téléchargé et le
 * texte copié. Or on publie depuis son téléphone, avec un média déjà en
 * pellicule ou un texte réécrit sur place : la préparation n'est pas la preuve
 * de la publication, et l'exiger obligeait à cliquer deux boutons pour rien.
 * Seul un humain sait si le post est en ligne ; c'est lui qui coche.
 */

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
