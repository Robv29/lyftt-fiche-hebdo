"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { deleteClient } from "../actions";

export interface DeletionScope {
  sheets: number;
  publications: number;
  tickets: number;
  budgetLines: number;
  media: number;
}

/**
 * Suppression définitive d'un client.
 *
 * Repliée par défaut : c'est une action rare et sans retour, elle n'a pas à
 * s'offrir au clic. Le décompte de ce qui sera emporté est affiché avant, et
 * le nom du client doit être saisi — deux barrières contre le geste réflexe.
 *
 * Archiver reste préférable dans presque tous les cas, et c'est dit ici.
 */
export function DeleteClient({
  clientId,
  clientName,
  scope,
}: {
  clientId: string;
  clientName: string;
  scope: DeletionScope;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = confirmation.trim().toLocaleLowerCase("fr") === clientName.trim().toLocaleLowerCase("fr");

  const emporte = [
    scope.sheets > 0 && `${scope.sheets} fiche${scope.sheets > 1 ? "s" : ""} hebdomadaire${scope.sheets > 1 ? "s" : ""}`,
    scope.publications > 0 && `${scope.publications} publication${scope.publications > 1 ? "s" : ""}`,
    scope.tickets > 0 && `${scope.tickets} ticket${scope.tickets > 1 ? "s" : ""}`,
    scope.budgetLines > 0 && `${scope.budgetLines} ligne${scope.budgetLines > 1 ? "s" : ""} de budget`,
    scope.media > 0 && `${scope.media} média${scope.media > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];

  if (!open) {
    return (
      <section className="card border-state-changes/30 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-state-changes">Supprimer ce client</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Définitif et sans corbeille. Pour retirer un client de la production
              en gardant son historique, archivez-le plutôt.
            </p>
          </div>
          <button type="button" className="btn-secondary border-state-changes/40 text-state-changes" onClick={() => setOpen(true)}>
            Supprimer…
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card border-2 border-state-changes bg-state-changes/5 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-state-changes text-white">
          <Icon name="warning" className="h-5 w-5"/>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-state-changes">Supprimer {clientName} définitivement</h2>

          {emporte.length > 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Seront effacés avec lui : {emporte.join(", ")}. Les validations déjà
              données par le client disparaissent avec les fiches.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Ce client n&apos;a encore aucune fiche ni aucun contenu : sa suppression
              n&apos;emporte que son dossier.
            </p>
          )}

          <label className="label mt-4 block" htmlFor="confirmation">
            Saisissez « {clientName} » pour confirmer
          </label>
          <input
            id="confirmation"
            className="field bg-white"
            value={confirmation}
            autoComplete="off"
            onChange={(event) => { setConfirmation(event.target.value); setError(null); }}
          />
          {error && <p className="mt-2 text-xs text-state-changes" role="alert">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary bg-state-changes"
              disabled={pending || !matches}
              onClick={() => startTransition(async () => {
                const result = await deleteClient(clientId, confirmation);
                if (result.ok) router.push("/clients");
                else setError(result.message ?? "Suppression impossible.");
              })}
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </button>
            <button
              type="button"
              className="text-sm text-ink-soft hover:underline"
              disabled={pending}
              onClick={() => { setOpen(false); setConfirmation(""); setError(null); }}
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
