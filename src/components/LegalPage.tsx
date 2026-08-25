import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Mise en page commune aux pages légales publiques.
 *
 * Volontairement autonome : ces pages doivent rester lisibles hors de toute
 * session, y compris par un contact client qui n'a jamais ouvert le portail.
 */
export function LegalPage({
  title,
  updatedAt,
  intro,
  children,
}: {
  title: string;
  updatedAt: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <header className="border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-ink-faint">Dernière mise à jour : {updatedAt}</p>
        {intro && <p className="mt-4 text-sm leading-relaxed text-ink-soft">{intro}</p>}
      </header>

      <div className="legal-prose">{children}</div>

      {/*
        * Les mentions légales ne sont volontairement pas listées ici : elles
        * restent incomplètes et ne doivent pas être présentées aux clients
        * tant que l'identification de l'éditeur n'est pas renseignée.
        */}
      <footer className="mt-12 border-t border-line pt-6 text-xs text-ink-faint">
        <Link className="underline" href="/politique-de-confidentialite">Politique de confidentialité</Link>
      </footer>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
