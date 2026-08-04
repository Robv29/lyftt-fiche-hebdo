"use client";

import { useState, useTransition } from "react";
import {
  changeMemberRole,
  createTeamMember,
  deleteTeamMember,
  setMemberActive,
  type UserActionResult,
} from "./actions";
import { APP_ROLES, APP_ROLE_LABELS, type AppRole } from "@/lib/domain/types";

interface Member {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  isActive: boolean;
}

export function UserAdmin({
  members,
  currentProfileId,
}: {
  members: Member[];
  currentProfileId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<UserActionResult | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const run = (action: () => Promise<UserActionResult>) => {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) {
        setShowForm(false);
        setConfirmingDelete(null);
      }
    });
  };

  return (
    <div className="space-y-5">
      {feedback?.message && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          <p>{feedback.message}</p>
          {feedback.temporaryPassword && (
            <p className="mt-2 text-ink">
              Mot de passe provisoire, à transmettre maintenant — il ne sera plus
              affiché :{" "}
              <code className="rounded bg-canvas px-2 py-0.5 font-mono">
                {feedback.temporaryPassword}
              </code>
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn-primary"
        onClick={() => {
          setShowForm(!showForm);
          setFeedback(null);
        }}
      >
        {showForm ? "Annuler" : "Ajouter un utilisateur"}
      </button>

      {showForm && (
        <form
          action={(formData) => run(() => createTeamMember(formData))}
          className="card space-y-4 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="fullName">
                Nom complet
              </label>
              <input id="fullName" name="fullName" required className="field" />
            </div>
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input id="email" name="email" type="email" required className="field" />
            </div>
            <div>
              <label className="label" htmlFor="role">
                Rôle
              </label>
              <select id="role" name="role" className="field" defaultValue="community_manager">
                {APP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {APP_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Création…" : "Créer le compte"}
          </button>
        </form>
      )}

      <ul className="space-y-2">
        {members.map((member) => (
          <li key={member.id} className="card px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {member.fullName}
                  {member.id === currentProfileId && (
                    <span className="ml-2 text-xs text-ink-faint">(vous)</span>
                  )}
                  {!member.isActive && (
                    <span className="ml-2 badge bg-canvas text-ink-faint">Désactivé</span>
                  )}
                </p>
                <p className="break-all text-xs text-ink-faint">{member.email}</p>
              </div>

              <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
                <select
                  className="field w-full py-1 text-xs sm:w-auto"
                  value={member.role}
                  disabled={pending}
                  onChange={(event) =>
                    run(() => changeMemberRole(member.id, event.target.value as AppRole))
                  }
                >
                  {APP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {APP_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="btn-secondary py-1 text-xs"
                  disabled={pending || member.id === currentProfileId}
                  onClick={() => run(() => setMemberActive(member.id, !member.isActive))}
                >
                  {member.isActive ? "Désactiver" : "Réactiver"}
                </button>

                {confirmingDelete === member.id ? (
                  <>
                    <button
                      type="button"
                      className="btn py-1 text-xs bg-state-changes text-white"
                      disabled={pending}
                      onClick={() => run(() => deleteTeamMember(member.id))}
                    >
                      Confirmer la suppression
                    </button>
                    <button
                      type="button"
                      className="btn-secondary py-1 text-xs"
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary py-1 text-xs text-state-changes"
                    disabled={pending || member.id === currentProfileId}
                    onClick={() => {
                      setFeedback(null);
                      setConfirmingDelete(member.id);
                    }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-faint">
        La désactivation est réversible et conserve l&apos;historique. La suppression
        est définitive : le compte disparaît, mais les fiches et tickets créés restent
        en place.
      </p>
    </div>
  );
}
