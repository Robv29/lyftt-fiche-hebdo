"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertToManagement } from "../actions";

/*
 * Un client ponctuel n'a pas d'éditeur de gestion : il exigerait des hashtags,
 * des réseaux, un groupe WhatsApp. Le passer en gestion est un geste explicite,
 * après lequel l'éditeur habituel apparaît.
 */
export function ConvertToManagement({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
        Passer en gestion des réseaux
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">Le client aura des fiches hebdomadaires et des mois facturés.</span>
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await convertToManagement(clientId);
          setMessage(result.message ?? null);
          if (result.ok) router.refresh();
        })}
      >
        {pending ? "Conversion…" : "Confirmer"}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>Annuler</button>
      {message && <p className="w-full text-xs text-ink-soft">{message}</p>}
    </div>
  );
}
