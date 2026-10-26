"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requalifyTicketType } from "@/lib/internal/actions";
import { groupedTicketTypes, type TicketType } from "@/lib/domain/ticket-types";

/**
 * Le type de la demande, corrigé par l'encadrement.
 *
 * Le client choisit lui-même la nature de sa demande, et il se trompe
 * souvent : une demande de hashtags, de photo ou de montage arrivait sous
 * « modifier le texte ». Comme le routage et l'écran de production lisent la
 * catégorie du type, ces demandes restaient éditoriales — et l'écran du ticket
 * ne proposait alors aucun « Confié à » pour les rattraper à la main.
 *
 * Requalifier rejoue le routage : le bon métier est proposé, et le sélecteur
 * d'affectation apparaît.
 */
export function RequalifyTicketType({
  ticketId,
  currentType,
  /** Sans publication visée, seules les demandes au niveau de la fiche ont un sens. */
  hasItem,
}: {
  ticketId: string;
  currentType: TicketType;
  hasItem: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const groups = groupedTicketTypes()
    .map((group) => ({
      ...group,
      types: group.types.filter((type) => hasItem || type.sheetLevel),
    }))
    .filter((group) => group.types.length > 0);

  const requalify = (nextType: string) => {
    const label = groups
      .flatMap((group) => group.types)
      .find((type) => type.type === nextType)?.label;
    if (!window.confirm(`Requalifier cette demande en « ${label} » ? Le routage sera rejoué et l’historique en gardera la trace.`)) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const result = await requalifyTicketType(ticketId, nextType);
      setFeedback(result.message ?? null);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="mt-4 border-t pt-3">
      <label className="label" htmlFor={`requalify-${ticketId}`}>
        Nature de la demande
      </label>
      <select
        id={`requalify-${ticketId}`}
        className="field mt-1"
        disabled={pending}
        value={currentType}
        onChange={(event) => {
          if (event.target.value !== currentType) requalify(event.target.value);
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.types.map((type) => (
              <option key={type.type} value={type.type}>
                {type.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-ink-faint">
        C’est le client qui a choisi ce type. S’il s’est trompé, corrigez-le ici :
        la demande repartira vers le bon métier.
      </p>
      {feedback && <p className="mt-2 text-xs text-ink-soft">{feedback}</p>}
    </div>
  );
}
