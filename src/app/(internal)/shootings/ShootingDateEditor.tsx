"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeShootingDate } from "./actions";

/**
 * Modification de la date d'un shooting, sur place.
 *
 * Le même composant sert la liste et la fiche du shooting : une seule action
 * derrière, qui refuse de déplacer un shooting déjà facturé.
 */
export function ShootingDateEditor({ lineId, date, canEdit }: { lineId: string; date: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(date);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  if (!editing) {
    return (
      <button
        type="button"
        className="shrink-0 text-xs font-semibold text-accent hover:underline"
        onClick={() => { setValue(date); setError(null); setEditing(true); }}
      >
        Modifier la date
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData();
        formData.set("budgetLineId", lineId);
        formData.set("date", value);
        setError(null);
        startTransition(async () => {
          try {
            const result = await changeShootingDate(formData);
            if (result.ok) {
              setEditing(false);
              router.refresh();
            } else {
              setError(result.message);
            }
          } catch {
            setError("Enregistrement interrompu. Réessayez.");
          }
        });
      }}
    >
      <label className="sr-only" htmlFor={`shooting-date-${lineId}`}>Nouvelle date du shooting</label>
      <input
        id={`shooting-date-${lineId}`}
        type="date"
        required
        className="field min-h-9 w-auto bg-white py-1 text-sm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn-primary min-h-9 px-3 text-xs" disabled={pending || !value || value === date}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button type="button" className="text-xs text-ink-faint hover:underline" onClick={() => setEditing(false)}>
        Annuler
      </button>
      {error && <span className="w-full text-xs text-state-changes" role="alert">{error}</span>}
    </form>
  );
}
