"use client";

import { Icon } from "@/components/Icon";

export default function InternalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="empty-state" role="alert"><span className="empty-state-icon !bg-[#ffedef] !text-state-changes"><Icon name="warning" className="h-6 w-6"/></span><h1 className="mt-4 text-lg font-semibold">Impossible d’afficher cette page</h1><p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-faint">Une erreur temporaire a interrompu le chargement. Vos données n’ont pas été modifiées.</p><button type="button" className="btn-primary mt-5 w-auto" onClick={reset}>Réessayer</button></div>;
}
