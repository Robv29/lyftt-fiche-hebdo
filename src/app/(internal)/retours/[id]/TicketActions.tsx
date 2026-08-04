"use client";

import { useState, useTransition } from "react";
import {
  addTicketComment,
  generateCorrectedVersion,
  transitionTicket,
  type InternalActionResult,
} from "@/lib/internal/actions";

interface Transition {
  to: string;
  label: string;
  requiresReason: boolean;
}

/** §10 — Actions disponibles selon le statut et le rôle. */
export function TicketActions({
  ticketId,
  sheetId,
  transitions,
}: {
  ticketId: string;
  sheetId: string;
  transitions: Transition[];
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Transition | null>(null);
  const [feedback, setFeedback] = useState<InternalActionResult | null>(null);

  const run = (action: () => Promise<InternalActionResult>) => {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) setSelected(null);
    });
  };

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Actions</h2>

      {feedback?.message && (
        <p
          className={`mt-2 rounded-md border px-3 py-2 text-xs ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {transitions.map((transition) => (
          <button
            key={transition.to}
            type="button"
            className="btn-secondary justify-start"
            disabled={pending}
            onClick={() => {
              setFeedback(null);
              if (transition.requiresReason) {
                setSelected(transition);
                return;
              }
              const formData = new FormData();
              formData.set("ticketId", ticketId);
              formData.set("nextStatus", transition.to);
              run(() => transitionTicket(formData));
            }}
          >
            {transition.label}
          </button>
        ))}
      </div>

      {selected && (
        <form
          action={(formData) => {
            formData.set("ticketId", ticketId);
            formData.set("nextStatus", selected.to);
            run(() => transitionTicket(formData));
          }}
          className="mt-3 space-y-2 border-t border-line pt-3"
        >
          <label className="label" htmlFor="reason">
            Justification — {selected.label}
          </label>
          <textarea id="reason" name="reason" rows={3} required className="field" />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              Confirmer
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelected(null)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <form
        action={(formData) => {
          formData.set("sheetId", sheetId);
          formData.set("ticketId", ticketId);
          run(() => generateCorrectedVersion(formData));
        }}
        className="mt-4 space-y-2 border-t border-line pt-3"
      >
        <label className="label" htmlFor="summary">
          Générer la version corrigée
        </label>
        <input
          id="summary"
          name="summary"
          className="field"
          placeholder="Motif (ex. remplacement de la photo du mardi)"
        />
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          Générer la version corrigée
        </button>
      </form>

      <form
        action={(formData) => {
          formData.set("ticketId", ticketId);
          run(() => addTicketComment(formData));
        }}
        className="mt-4 space-y-2 border-t border-line pt-3"
      >
        <label className="label" htmlFor="body">
          Commentaire interne
        </label>
        <textarea id="body" name="body" rows={3} className="field" />
        <input type="hidden" name="visibility" value="internal" />
        <button type="submit" className="btn-secondary w-full" disabled={pending}>
          Ajouter
        </button>
      </form>
    </section>
  );
}
