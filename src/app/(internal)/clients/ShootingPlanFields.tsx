"use client";

import { useState } from "react";
import {
  MAX_PLANNED_SHOOTINGS,
  SHOOTING_PLAN_SERVICES,
  addMonths,
  findService,
  formatEuros,
  proposeShootingDates,
  type ShootingPlan,
} from "@/lib/domain/budget";

type ShootingService = (typeof SHOOTING_PLAN_SERVICES)[number];

/** Calendrier saisi, et le rythme pour lequel il a été proposé. */
interface PlannedCalendar {
  everyMonths: number;
  firstOn: string;
  dates: string[];
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Shooting vendu dans la formule, et ses dates calées dès la création.
 *
 * Le rythme se choisit, puis le calendrier se propose de lui-même : attendre
 * le rappel du tableau de bord, un mois avant chaque échéance, revenait à
 * chercher une date au dernier moment avec un client déjà engagé ailleurs.
 */
export function ShootingPlanFields({
  today,
  everyMonthsError,
  datesError,
}: {
  today: string;
  everyMonthsError?: string;
  datesError?: string;
}) {
  const [service, setService] = useState<ShootingService | "">("");
  const [everyMonths, setEveryMonths] = useState("");
  /*
   * Le calendrier vit ici, et non dans le bloc des dates : effacer le rythme
   * le temps de retaper le même chiffre ne doit pas perdre les dates saisies.
   * Il ne s'efface que si le rythme change vraiment.
   */
  const [calendar, setCalendar] = useState<PlannedCalendar | null>(null);

  const every = Number(everyMonths);
  const plan: ShootingPlan | null = service && Number.isInteger(every) && every >= 1 && every <= 24
    ? { serviceKey: service, everyMonths: every }
    : null;
  const current = plan && calendar?.everyMonths === plan.everyMonths ? calendar : null;

  return (
    <div className="mt-4 rounded-2xl border border-[#d8e4f8] bg-[#f7faff] p-4">
      <p className="label">Shooting vendu dans la formule</p>
      <p className="mt-1 text-xs text-ink-faint">Facultatif. Un shooting qui revient à intervalle régulier, dont le prix est lissé sur la période.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="shootingService">Prestation</label>
          <select
            id="shootingService"
            name="shootingService"
            className="field bg-white"
            value={service}
            onChange={(event) => setService(event.target.value as ShootingService | "")}
          >
            <option value="">Aucun shooting vendu</option>
            {SHOOTING_PLAN_SERVICES.map((key) => (
              <option key={key} value={key}>
                {findService(key)?.label} — {formatEuros(findService(key)?.unitPriceCents ?? 0)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="shootingEveryMonths">Tous les combien de mois</label>
          <input
            id="shootingEveryMonths"
            name="shootingEveryMonths"
            type="number"
            min="1"
            max="24"
            placeholder="4"
            value={everyMonths}
            onChange={(event) => setEveryMonths(event.target.value)}
            className={everyMonthsError ? "field border-state-changes ring-2 ring-state-changes/20" : "field"}
            aria-invalid={Boolean(everyMonthsError) || undefined}
          />
          {everyMonthsError && <p className="mt-1 text-xs text-state-changes" role="alert">{everyMonthsError}</p>}
        </div>
      </div>

      {plan && (
        <ShootingDatesPlanner
          plan={plan}
          today={today}
          error={datesError}
          firstOn={current?.firstOn ?? ""}
          dates={current?.dates ?? []}
          onChange={(firstOn, dates) => setCalendar({ everyMonths: plan.everyMonths, firstOn, dates })}
        />
      )}
      {!plan && datesError && <p className="mt-2 text-xs text-state-changes" role="alert">{datesError}</p>}
    </div>
  );
}

function ShootingDatesPlanner({
  plan,
  today,
  error,
  firstOn,
  dates,
  onChange,
}: {
  plan: ShootingPlan;
  today: string;
  error?: string;
  firstOn: string;
  dates: string[];
  onChange: (firstOn: string, dates: string[]) => void;
}) {
  const rhythm = plan.everyMonths === 1 ? "chaque mois" : `tous les ${plan.everyMonths} mois`;

  const remove = (index: number) => {
    const next = dates.filter((_, position) => position !== index);
    onChange(next.length > 0 ? firstOn : "", next);
  };

  const add = () => {
    const last = dates.filter(Boolean).sort().at(-1);
    onChange(firstOn, [...dates, last ? addMonths(last, plan.everyMonths) : today]);
  };

  return (
    <div className="mt-4 border-t border-[#d8e4f8] pt-4">
      <p className="label">Caler les dates des shootings</p>
      <p className="mt-1 text-xs text-ink-faint">
        Indiquez le premier shooting : les suivants sont proposés {rhythm} sur un an, et chaque
        date se corrige. Facultatif — sans date, le rappel s&apos;ouvrira sur le tableau de bord
        à l&apos;approche de chaque échéance.
      </p>

      {dates.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="firstShootingOn">Premier shooting</label>
            <input
              id="firstShootingOn"
              type="date"
              min={today}
              className="field bg-white"
              value={firstOn}
              onChange={(event) => onChange(event.target.value, [])}
            />
          </div>
          {/*
            Proposé sur demande, pas à chaque frappe : au clavier, le navigateur
            transmet la date segment par segment, et le calendrier se bâtissait
            sur un jour ou une année à moitié tapés.
          */}
          <button
            type="button"
            className="btn-secondary"
            disabled={!firstOn || firstOn < today}
            onClick={() => onChange(firstOn, proposeShootingDates({ plan, firstOn }))}
          >
            Proposer les dates
          </button>
        </div>
      ) : (
        <>
          <ol className="mt-3 space-y-2">
            {dates.map((date, index) => (
              <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-24 text-xs font-semibold text-ink-soft">Shooting {index + 1}</span>
                <input
                  type="date"
                  name="shootingDates"
                  required
                  min={today}
                  aria-label={`Date du shooting ${index + 1}`}
                  className="field w-auto bg-white"
                  value={date}
                  onChange={(event) => {
                    const value = event.target.value;
                    onChange(firstOn, dates.map((current, position) => (position === index ? value : current)));
                  }}
                />
                {date >= today && (
                  <span className={`text-xs ${isWeekend(date) ? "font-semibold text-[#8a5700]" : "text-ink-faint"}`}>
                    {formatDay(date)}{isWeekend(date) ? " · week-end" : ""}
                  </span>
                )}
                <button type="button" className="text-xs text-state-changes hover:underline" onClick={() => remove(index)}>
                  Retirer
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {dates.length < MAX_PLANNED_SHOOTINGS && (
              <button type="button" className="btn-secondary text-xs" onClick={add}>
                Ajouter une date
              </button>
            )}
            <button type="button" className="text-xs text-ink-faint hover:underline" onClick={() => onChange("", [])}>
              Ne rien caler maintenant
            </button>
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-state-changes" role="alert">{error}</p>}
    </div>
  );
}
