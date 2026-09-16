"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VisualsState } from "@/lib/domain/planning";
import { setVisualsValidation } from "./actions";

function formatShortDay(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })
    .format(new Date(value));
}

/**
 * État des visuels d'une fiche, et le geste qui les valide.
 *
 * Le bouton n'apparaît qu'une fois tous les fichiers déposés : valider des
 * visuels incomplets ne dirait rien. Une fois posée, la validation dit qui et
 * quand — et se retire si l'on s'est trompé.
 */
export function VisualsValidation({
  sheetId,
  state,
  filesMissing,
  validatedAt,
  validatedByName,
  canValidate,
}: {
  sheetId: string;
  state: VisualsState;
  filesMissing: number;
  validatedAt: string | null;
  validatedByName: string | null;
  canValidate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (validate: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setVisualsValidation(sheetId, validate);
        if (result.ok) router.refresh();
        else setError(result.message ?? "Enregistrement impossible.");
      } catch {
        setError("Enregistrement interrompu. Réessayez.");
      }
    });
  };

  if (state === "no_files") return null;

  if (state === "missing") {
    return <span className="badge bg-[#fff7e6] text-[#8a5700]">Fichiers : {filesMissing} à déposer</span>;
  }

  if (state === "validated") {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="badge bg-state-approved/10 text-state-approved">Visuels validés</span>
        <span className="text-[11px] text-ink-faint">
          {validatedAt ? formatShortDay(validatedAt) : ""}{validatedByName ? ` · ${validatedByName}` : ""}
          {canValidate && (
            <button
              type="button"
              className="ml-2 text-state-changes hover:underline disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Retirer la validation des visuels de cette fiche ?")) run(false);
              }}
            >
              Retirer
            </button>
          )}
        </span>
        {error && <span className="text-[11px] text-state-changes" role="alert">{error}</span>}
      </span>
    );
  }

  // Tous les fichiers sont là : reste à les regarder.
  return (
    <span className="flex flex-col items-end gap-0.5">
      {canValidate ? (
        <button type="button" className="btn-primary min-h-8 px-3 text-xs" disabled={pending} onClick={() => run(true)}>
          {pending ? "Validation…" : "Valider les visuels"}
        </button>
      ) : (
        <span className="badge bg-[#e8f2ff] text-[#0b5e9f]">Visuels à valider</span>
      )}
      {error && <span className="text-[11px] text-state-changes" role="alert">{error}</span>}
    </span>
  );
}
