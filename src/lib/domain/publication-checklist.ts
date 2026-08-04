export type PublicationStep = "media" | "content";

export function publicationReadiness(input:{ mediaRequired:boolean; mediaAvailable:boolean; mediaDownloaded:boolean; contentCopied:boolean }, completedStep:PublicationStep) {
  if (completedStep === "media" && input.mediaRequired && !input.mediaAvailable) return { allowed:false, published:false };
  const mediaDone=!input.mediaRequired||input.mediaDownloaded||completedStep==="media";
  const contentDone=input.contentCopied||completedStep==="content";
  return { allowed:true, published:mediaDone&&contentDone };
}
