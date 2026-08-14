import type { Metadata } from "next";
import { loadReviewSheet, logReviewEvent, resolveReviewLink } from "@/lib/review/access";
import { AccessDenied } from "../AccessDenied";
import { PrivacyNotice } from "../PrivacyNotice";
import { BrandLogo } from "@/components/BrandLogo";
import { RequestForm } from "./RequestForm";

export const metadata: Metadata = {
  title: "Une autre demande — LYFTT",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Second lien du message hebdomadaire.
 *
 * Le premier sert à valider les publications ; celui-ci recueille tout ce qui
 * n'en relève pas — devis, dates de shooting, services annexes. Ces demandes
 * arrivaient par message et se perdaient : rien ne les suivait, personne ne
 * savait si elles avaient été traitées.
 *
 * Il emprunte le même jeton : le client n'a qu'une adresse à garder, et
 * l'accès obéit aux mêmes règles d'expiration et de révocation.
 */
export default async function ServiceRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveReviewLink(token);
  if (!resolved.ok) return <AccessDenied reason={resolved.reason} />;

  const sheet = await loadReviewSheet(resolved.context);
  if (!sheet) return <AccessDenied reason="not_found" />;

  await logReviewEvent(resolved.context.linkId, "link_opened", { serviceRequest: true });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-7">
        <BrandLogo className="h-8 w-auto"/>
        <p className="eyebrow mt-6">{sheet.clientName}</p>
        <h1 className="page-title mt-1">Une autre demande</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Ce formulaire est là pour tout ce qui ne concerne pas les publications
          de la semaine : un devis, une date de shooting, une modification sur
          votre site ou un autre service. Votre demande arrive directement chez
          nous et vous recevez une réponse.
        </p>
      </header>

      <RequestForm token={token} clientName={sheet.clientName}/>

      <PrivacyNotice/>
    </main>
  );
}
