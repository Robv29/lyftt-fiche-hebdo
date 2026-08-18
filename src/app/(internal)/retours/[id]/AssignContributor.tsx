"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignTicketContributor } from "@/lib/internal/actions";

/**
 * Qui produit la correction.
 *
 * L'application classe la demande à son arrivée — visuel et vidéo partent en
 * production — puis retient le premier graphiste ou vidéaste actif qu'elle
 * trouve. Ce choix se corrige ici : c'est la personne désignée, et elle seule,
 * qui voit le ticket dans son écran de production.
 */
export function AssignContributor({
  ticketId,
  currentProfileId,
  candidates,
}: {
  ticketId: string;
  currentProfileId: string | null;
  candidates: { id: string; name: string; roleLabel: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  return (
    <div className="mt-4 border-t pt-3">
      <label className="label" htmlFor={`contributor-${ticketId}`}>Confié à</label>
      <select
        id={`contributor-${ticketId}`}
        className="field mt-1"
        disabled={pending}
        value={currentProfileId ?? ""}
        onChange={(event) => {
          const profileId = event.target.value;
          if (!profileId) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await assignTicketContributor(ticketId, profileId);
            setFeedback(result.message ?? null);
            if (result.ok) router.refresh();
          });
        }}
      >
        <option value="" disabled>Personne pour l’instant</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} — {candidate.roleLabel}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-ink-faint">
        Cette personne verra la correction dans son écran Production.
      </p>
      {feedback && <p className="mt-2 text-xs text-ink-soft">{feedback}</p>}
    </div>
  );
}
