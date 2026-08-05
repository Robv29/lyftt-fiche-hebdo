import type { AccessDenial } from "@/lib/review/access";

const MESSAGES: Record<AccessDenial, { title: string; body: string }> = {
  malformed: {
    title: "Lien invalide",
    body: "Ce lien ne correspond à aucun planning. Vérifiez que vous avez copié le lien en entier.",
  },
  not_found: {
    title: "Lien invalide",
    body: "Ce lien ne correspond à aucun planning. Vérifiez que vous avez copié le lien en entier.",
  },
  revoked: {
    title: "Lien désactivé",
    body: "Ce lien a été désactivé, en général parce qu'une version plus récente de votre planning a été envoyée. Votre community manager peut vous en transmettre un nouveau.",
  },
  expired: {
    title: "Lien expiré",
    body: "Ce lien n'est plus valable. Contactez votre community manager pour recevoir un nouvel accès.",
  },
  rate_limited: {
    title: "Trop de tentatives",
    body: "Merci de patienter quelques instants avant de réessayer.",
  },
};

/**
 * Un lien invalide, révoqué ou expiré ne révèle jamais l'existence d'une fiche
 * ni l'identité d'un client (§19, scénario 7).
 */
export function AccessDenied({ reason }: { reason: AccessDenial }) {
  const { title, body } = MESSAGES[reason];

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf3f9] px-5 py-16">
      <section className="card w-full max-w-readable p-7 sm:p-10">
      <span className="text-2xl font-bold tracking-[-.05em] text-[#123f73]">lyftt<span className="text-[#1176d3]">.</span></span>
      <span className="mt-8 grid h-12 w-12 place-items-center rounded-2xl bg-[#fff4e5] text-xl text-[#9a5708]" aria-hidden="true">!</span>
      <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{body}</p>
      </section>
    </main>
  );
}
