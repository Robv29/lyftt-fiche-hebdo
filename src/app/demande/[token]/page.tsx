import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";
import { resolveRequestLink } from "@/lib/review/request-link";
import { RequestBox } from "./RequestBox";

export const metadata: Metadata = {
  title: "Votre demande — LYFTT",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Page publique de demande, ouverte par le lien permanent du client.
 *
 * Elle n'expose rien : ni les publications, ni le budget, ni l'historique —
 * seulement le nom du client, pour qu'il sache qu'il est au bon endroit, et un
 * formulaire. C'est ce qui permet de laisser ce lien circuler.
 */
export default async function ClientRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await resolveRequestLink(token);

  if (!context) {
    return (
      <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-4">
        <div className="text-center">
          <BrandLogo className="mx-auto w-[110px]"/>
          <h1 className="mt-6 text-lg font-semibold">Ce lien n’est plus valable</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Contactez votre interlocuteur LYFTT, il vous en enverra un nouveau.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="text-center">
        <BrandLogo className="mx-auto w-[110px]"/>
        <p className="eyebrow mt-6">{context.clientName}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Une demande ?</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          Correction, shooting, devis, question : tout passe par ici. Votre demande
          arrive directement chez l’équipe, et vous recevez une réponse.
        </p>
      </header>

      <section className="card mt-8 p-5 sm:p-7">
        <RequestBox token={token} clientName={context.clientName}/>
      </section>

      <p className="mt-6 text-center text-xs text-ink-faint">
        Ce lien vous est réservé. Conservez-le, il reste valable.
      </p>
    </main>
  );
}
