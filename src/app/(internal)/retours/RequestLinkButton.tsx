"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { clientRequestLink } from "@/lib/internal/actions";

/**
 * Lien à donner au client pour toute demande.
 *
 * Un seul lien, permanent, qu'il garde dans ses contacts : correction,
 * shooting, devis, question — tout arrive au même endroit et se range tout
 * seul, en production ou en éditorial, selon ce qu'il a choisi.
 */
export function RequestLinkButton({ clients }: { clients: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (clients.length === 0) return null;

  const fetchLink = (id: string) => {
    setClientId(id);
    setUrl("");
    setCopied(false);
    setError(null);
    if (!id) return;
    startTransition(async () => {
      const result = await clientRequestLink(id);
      if (result.ok && result.reviewUrl) setUrl(result.reviewUrl);
      else setError(result.message ?? "Lien indisponible.");
    });
  };

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Lien client</p>
          <h2 className="mt-1 font-semibold">Donner un lien de demande</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            Le client y dépose tout ce qu’il veut — correction, shooting, devis —
            et chaque demande se range d’elle-même en production ou en éditorial.
            Le lien ne périme pas : il peut le garder.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          className="field"
          aria-label="Client concerné"
          value={clientId}
          onChange={(event) => fetchLink(event.target.value)}
        >
          <option value="">Choisir un client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !url}
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          <Icon name="message" className="h-4 w-4"/>
          {pending ? "Préparation…" : copied ? "Lien copié" : "Copier le lien"}
        </button>
      </div>

      {url && <p className="mt-2 break-all rounded-xl bg-canvas px-3 py-2 text-[11px] text-ink-soft">{url}</p>}
      {error && <p className="mt-2 text-xs text-state-changes">{error}</p>}
    </section>
  );
}
