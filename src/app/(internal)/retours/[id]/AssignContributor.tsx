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
  awaitingAssignment = false,
  locked = false,
  candidates,
}: {
  ticketId: string;
  currentProfileId: string | null;
  /** Le ticket n'est pas encore en production : désigner quelqu'un l'y fait passer. */
  awaitingAssignment?: boolean;
  /** Ticket terminé : l'affectation ne se change plus. */
  locked?: boolean;
  candidates: { id: string; name: string; roleLabel: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  const assign = (profileId: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await assignTicketContributor(ticketId, profileId);
      setFeedback(result.message ?? null);
      if (result.ok) router.refresh();
    });
  };
  /*
   * Personne déjà désignée — proposée à l'arrivée du ticket — mais ticket pas
   * encore confié : la resélectionner dans la liste ne déclenche rien, d'où ce
   * bouton pour confirmer d'un geste.
   */
  const proposed = awaitingAssignment && currentProfileId
    ? candidates.find((candidate) => candidate.id === currentProfileId) ?? null
    : null;

  return (
    <div className="mt-4 border-t pt-3">
      <label className="label" htmlFor={`contributor-${ticketId}`}>Confié à</label>
      <select
        id={`contributor-${ticketId}`}
        className="field mt-1"
        disabled={pending || locked}
        value={currentProfileId ?? ""}
        onChange={(event) => {
          const profileId = event.target.value;
          if (profileId) assign(profileId);
        }}
      >
        <option value="" disabled>Personne pour l’instant</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} — {candidate.roleLabel}
          </option>
        ))}
      </select>
      {proposed && !locked && (
        <button
          type="button"
          className="btn-primary mt-2"
          disabled={pending}
          onClick={() => assign(proposed.id)}
        >
          {pending ? "Affectation…" : `Confier à ${proposed.name}`}
        </button>
      )}
      <p className="mt-1 text-[11px] text-ink-faint">
        {awaitingAssignment
          ? "Choisir la personne passe le ticket en « Affecté » : elle peut alors déposer la correction depuis son écran Production."
          : "Cette personne verra la correction dans son écran Production."}
      </p>
      {feedback && <p className="mt-2 text-xs text-ink-soft">{feedback}</p>}
    </div>
  );
}
