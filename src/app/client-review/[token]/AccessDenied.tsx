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
    <main className="mx-auto flex min-h-screen max-w-readable flex-col justify-center px-6 py-16">
      <span className="mb-8 text-2xl font-bold tracking-tight">lyftt.</span>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{body}</p>
    </main>
  );
}
