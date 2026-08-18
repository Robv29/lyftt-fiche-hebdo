"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cancelShooting, markShootingReminder, scheduleShooting } from "./shooting-actions";

export interface ShootingReminderRow {
  clientId: string;
  clientName: string;
  /** Prénom du contact principal, pour le message prérempli. */
  contactFirstName: string | null;
  /** Formulation du forfait vendu : « Shooting ½ journée tous les 4 mois ». */
  planLabel: string;
  /** Échéance du prochain shooting. */
  dueOn: string;
  /** L'échéance est-elle déjà passée sans date calée ? */
  overdue: boolean;
  /** Date convenue avec le client, si elle l'est déjà. */
  plannedOn: string | null;
  /** Jour où le message a été envoyé au client, s'il l'a été. */
  reminderSentOn: string | null;
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatShortDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Lundi de la semaine de l'échéance : ce qu'on propose au client. */
function weekOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const isoDay = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (isoDay - 1));
  return day.toISOString().slice(0, 10);
}

/**
 * Message prêt à coller dans WhatsApp.
 *
 * Écrit pour être envoyé tel quel : le client n'a qu'à répondre par un jour.
 * Proposer une semaine plutôt qu'une date évite l'aller-retour où l'on découvre
 * que le seul créneau proposé ne convient pas.
 */
export function shootingMessage(row: ShootingReminderRow): string {
  const greeting = row.contactFirstName ? `Bonjour ${row.contactFirstName},` : "Bonjour,";
  return `${greeting}

Il est temps de caler votre prochain shooting, prévu dans votre formule autour du ${formatDay(row.dueOn)}.

Quelles sont vos disponibilités sur la semaine du ${formatDay(weekOf(row.dueOn))} ? Dites-moi le jour et le créneau qui vous arrangent, je bloque le rendez-vous.

Belle journée,
L’équipe LYFTT`;
}

/**
 * Encart des shootings à planifier.
 *
 * Le rappel s'ouvre un mois avant l'échéance : c'est le délai qu'il faut pour
 * trouver une date avec un client qui travaille. Tant que rien n'est calé, la
 * ligne reste là ; une fois la date inscrite, elle alimente le budget et
 * l'échéance suivante se recalcule à partir d'elle.
 */
export function ShootingReminders({ rows }: { rows: ShootingReminderRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="section-card">
      <div className="section-card-header">
        <div>
          <p className="eyebrow">Forfait shooting</p>
          <h2 className="mt-1 font-semibold">Vos prochains shootings à planifier</h2>
        </div>
        <span className="badge bg-[#fff4e5] text-[#8a5700]">{rows.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => <ShootingRow key={row.clientId} row={row}/>)}
      </ul>
    </section>
  );
}

function ShootingRow({ row }: { row: ShootingReminderRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const message = shootingMessage(row);
  const alreadyAsked = Boolean(row.reminderSentOn) || copied;

  const copy = () => {
    setError(null);
    void navigator.clipboard?.writeText(message).then(
      () => {
        setCopied(true);
        setFallback(null);
        startTransition(async () => {
          const result = await markShootingReminder(row.clientId);
          if (!result.ok) setError(result.message ?? null);
          router.refresh();
        });
      },
      // Presse-papiers refusé (permission, contexte non sécurisé) : on montre le texte.
      () => setFallback(message),
    );
  };

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">{row.clientName}</strong>
          <p className="mt-0.5 text-xs text-ink-faint">{row.planLabel}</p>
        </div>
        {row.plannedOn ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-[#e8f8f1] text-state-approved">
              Calé le {formatShortDay(row.plannedOn)}
            </span>
            <button type="button" className="text-[11px] font-semibold text-[#0b63ad] hover:underline" onClick={() => setOpen((value) => !value)}>
              {open ? "Fermer" : "Modifier"}
            </button>
            <button
              type="button"
              className="text-[11px] text-state-changes hover:underline"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Annuler la date calée ? Le rappel se rouvrira.")) return;
                setError(null);
                startTransition(async () => {
                  const result = await cancelShooting(row.clientId);
                  if (result.ok) router.refresh();
                  else setError(result.message ?? "Annulation impossible.");
                });
              }}
            >
              Annuler
            </button>
          </div>
        ) : (
          <span className={`badge ${row.overdue ? "bg-state-changes/10 text-state-changes" : "bg-[#fff4e5] text-[#8a5700]"}`}>
            {row.overdue ? "En retard" : "À caler"} · {formatShortDay(row.dueOn)}
          </span>
        )}
      </div>

      {!row.plannedOn && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={alreadyAsked ? "btn-secondary" : "btn-primary"}
              disabled={pending}
              onClick={copy}
            >
              <Icon name="message" className="h-4 w-4"/>
              {alreadyAsked ? "Relancer" : "Copier le message client"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOpen((value) => !value)}
            >
              <Icon name="calendar" className="h-4 w-4"/>Date calée
            </button>
            {row.reminderSentOn && !copied && (
              <span className="text-[11px] text-ink-faint">
                Message envoyé le {formatShortDay(row.reminderSentOn)}
              </span>
            )}
            {copied && <span className="text-[11px] font-semibold text-state-approved">Copié</span>}
          </div>

          {fallback && (
            <textarea
              readOnly
              rows={6}
              className="field mt-3 text-xs"
              value={fallback}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}

        </>
      )}

      {/* Une date calée se corrige : le même formulaire sert à l'inscrire et à la déplacer. */}
      {open && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-canvas p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await scheduleShooting(formData);
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else {
                setError(result.message ?? "Enregistrement impossible.");
              }
            });
          }}
        >
          <input type="hidden" name="clientId" value={row.clientId}/>
          <div>
            <label className="label" htmlFor={`shooting-date-${row.clientId}`}>
              Date convenue
            </label>
            <input
              id={`shooting-date-${row.clientId}`}
              name="shootingOn"
              type="date"
              required
              className="field bg-white"
              defaultValue={row.plannedOn ?? row.dueOn}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Enregistrement…" : row.plannedOn ? "Déplacer le shooting" : "Inscrire au budget"}
          </button>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-state-changes">{error}</p>}
    </li>
  );
}
