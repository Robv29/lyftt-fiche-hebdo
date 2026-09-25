"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  EMPTY_BOARD_FILTERS,
  matchesBoardFilters,
  type BoardFilters,
  type BoardScope,
} from "@/lib/domain/production-board";
import { UNKNOWN_PERSON_KEY } from "@/lib/domain/production-requests";
import {
  CALENDAR_STATE_LABELS,
  WEEKDAY_HEADS,
  calendarState,
  dayLabel,
  dayNumber,
  dayWorkload,
  inCalendarScope,
  monthAgenda,
  monthGrid,
  monthLabel,
  monthOf,
  monthRange,
  monthWorkload,
  placeTasks,
  shiftMonth,
  type CalendarState,
  type CalendarTask,
} from "@/lib/domain/production-calendar";
import { rescheduleProductionRequest } from "./actions";

/**
 * Le calendrier de la production.
 *
 * La file répond à « qu'est-ce que j'ai à faire ? », le calendrier à « qu'est-ce
 * que porte le 28 ? ». Il n'ajoute aucune donnée : il repose les mêmes commandes
 * et les mêmes corrections sur leur échéance, avec les mêmes pastilles, la même
 * barre de filtres et les mêmes couleurs — la teinte dit l'état, jamais la
 * provenance.
 *
 * Le mois affiché reste dans l'état du composant, et non dans l'URL : l'onglet
 * actif n'y est pas non plus, et une navigation ferait retomber le lecteur sur
 * la vue d'ensemble à chaque changement de mois. Tout est déjà chargé de toute
 * façon — paginer ne demande rien au serveur.
 *
 * Sur téléphone, la grille de sept colonnes est remplacée par un agenda des
 * jours chargés : la même réponse que l'historique de production, deux rendus
 * du même contenu plutôt qu'un défilement horizontal.
 */

const STATE_TONES: Record<CalendarState, string> = {
  // Les tons exacts des cartes de la file : « demain » ne doit pas être le même rouge que « en retard ».
  en_retard: "bg-state-changes/10 text-state-changes",
  demain: "bg-state-progress/10 text-state-progress",
  a_faire: "bg-canvas text-ink-soft",
  livree: "bg-[#fff4e5] text-[#8a5700]",
};

const STATUS_FILTERS: { value: BoardFilters["status"]; label: string }[] = [
  { value: "", label: "Tous les états" },
  { value: "a_faire", label: "À produire" },
  { value: "livree", label: "En attente de validation" },
];

/** Trois pastilles dans une case, puis un « +N » : au-delà, la grille cesse de se lire d'un coup d'œil. */
const PILLS_PER_CELL = 3;

/** Abréviation tenant dans une pastille de case. */
function shortKind(task: CalendarTask): string {
  return task.source === "correction" ? "Corr." : task.kindLabel.slice(0, 3);
}

/** Marqueur lisible sans la couleur : « en retard » et « demain » ne peuvent pas n'être qu'une teinte. */
const STATE_MARKS: Record<CalendarState, string> = {
  en_retard: "!",
  demain: "J-1",
  a_faire: "",
  livree: "✓",
};

function TaskPill({ task }: { task: CalendarTask }) {
  const state = calendarState(task);
  const mark = STATE_MARKS[state];
  return (
    <span
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATE_TONES[state]}`}
      title={`${CALENDAR_STATE_LABELS[state]} · ${task.kindLabel} · ${task.clientName} — ${task.title}`}
    >
      {mark && <span className="shrink-0 font-bold">{mark}</span>}
      <span className="truncate">{task.clientName}</span>
      <span className="ml-auto shrink-0 text-[9px] font-bold uppercase opacity-70">{shortKind(task)}</span>
    </span>
  );
}

/**
 * Déplacer l'échéance d'une commande, sur place.
 *
 * Même forme que la date d'un shooting : un lien, puis un champ et deux
 * boutons. Rien n'est proposé à qui n'a pas le droit d'agir — pas de contrôle
 * grisé —, exactement comme une carte de la file sans pied de page.
 *
 * Pas de glisser-déposer : les cartes de la file portent déjà les évènements
 * de dépôt de fichier, un téléphone ne sait pas le faire, et la moitié de la
 * grille paraîtrait déplaçable sans l'être.
 */
function TaskMove({ task, onMoved }: { task: CalendarTask; onMoved: (date: string, message?: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.dueOn ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!task.canReschedule || task.dueOn === null) return null;
  const dueOn = task.dueOn;

  if (!editing) {
    return (
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-accent hover:underline"
        onClick={() => { setValue(dueOn); setError(null); setEditing(true); }}
      >
        Déplacer
      </button>
    );
  }

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result = await rescheduleProductionRequest(task.id, value);
            if (result.ok) {
              setEditing(false);
              onMoved(value, result.message);
              router.refresh();
            } else {
              setError(result.message ?? "Déplacement impossible.");
            }
          } catch {
            setError("Enregistrement interrompu. Réessayez.");
          }
        });
      }}
    >
      <label className="sr-only" htmlFor={`due-${task.id}`}>Nouvelle échéance</label>
      <input
        id={`due-${task.id}`}
        type="date"
        required
        className="field min-h-9 w-auto bg-white py-1 text-sm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn-primary min-h-9 px-3 text-xs" disabled={pending || !value || value === dueOn}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button type="button" className="text-xs text-ink-faint hover:underline" onClick={() => setEditing(false)}>
        Annuler
      </button>
      {error && <span className="w-full text-xs text-state-changes" role="alert">{error}</span>}
    </form>
  );
}

/** Une tâche en clair : de quoi décider, sans le dépôt de fichier qui reste à la file. */
function TaskRow({ task, onMoved }: { task: CalendarTask; onMoved: (date: string, message?: string) => void }) {
  const state = calendarState(task);
  return (
    <li className="rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-[#f1edff] text-[#6f50c9]">{task.kindLabel}</span>
        <strong className="min-w-0 flex-1 truncate text-sm">{task.clientName}</strong>
        <span className={`badge ${STATE_TONES[state]}`}>{CALENDAR_STATE_LABELS[state]}</span>
      </div>
      <p className="mt-1.5 text-sm leading-snug">{task.title}</p>
      <p className="mt-1 text-xs text-ink-faint">
        {task.assignedToViewer
          ? "Pour vous"
          : task.assigneeLabel
            ? `Confiée à ${task.assigneeLabel}`
            : task.source === "commande" ? "À confier" : "Sans affectataire"}
        {task.isMine && " · votre demande"}
      </p>
      <TaskMove task={task} onMoved={onMoved}/>
    </li>
  );
}

function DayTasks({ date, tasks, onMoved }: { date: string; tasks: CalendarTask[]; onMoved: (date: string, message?: string) => void }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold first-letter:uppercase">{dayLabel(date)}</h3>
        <span className="text-xs text-ink-faint">{tasks.length === 0 ? "Rien ce jour-là" : `${tasks.length} tâche${tasks.length > 1 ? "s" : ""}`}</span>
      </div>
      {tasks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {tasks.map((task) => <TaskRow key={`${task.source}-${task.id}`} task={task} onMoved={onMoved}/>)}
        </ul>
      )}
    </div>
  );
}

export function ProductionCalendar({ tasks, today }: { tasks: CalendarTask[]; today: string }) {
  const [month, setMonth] = useState(() => monthOf(today));
  const [scope, setScope] = useState<BoardScope>("toutes");
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_BOARD_FILTERS);
  const [selected, setSelected] = useState<string | null>(today);
  const [moved, setMoved] = useState<string | null>(null);
  const setFilter = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const filtering = Boolean(filters.query.trim() || filters.clientId || filters.person || filters.status);

  /*
   * Les pastilles comptent ce qu'elles ouvrent : la barre de filtres s'applique
   * avant elles — même règle que la file, sinon « En retard · 4 » ouvrirait une
   * grille vide sans qu'on voie le filtre qui l'a vidée.
   */
  const matching = useMemo(() => tasks.filter((task) => matchesBoardFilters(task, filters)), [tasks, filters]);
  const shown = useMemo(() => matching.filter((task) => inCalendarScope(task, scope)), [matching, scope]);

  const grid = useMemo(() => monthGrid(month, today), [month, today]);
  const placement = useMemo(() => placeTasks(shown), [shown]);
  const agenda = useMemo(() => monthAgenda(grid, placement), [grid, placement]);
  const workload = useMemo(() => monthWorkload(grid, placement), [grid, placement]);
  // Bornes de la pagination : calculées sur tout, pour qu'un filtre ne fasse pas bouger les flèches.
  const range = useMemo(() => monthRange(tasks, today), [tasks, today]);

  /*
   * Ce que les pastilles comptent mais que le mois affiché ne porte pas : la
   * page charge tout ce qui est ouvert, sans borne de date, donc du retard
   * antérieur au mois courant est la règle. Sans cette ligne, « En retard · 3 »
   * ouvrirait une grille vide sans dire où sont les trois tâches.
   */
  const elsewhere = useMemo(() => {
    const inGrid = new Set(grid.weeks.flat().map((day) => day.date));
    const away = shown.filter((task) => task.dueOn !== null && !inGrid.has(task.dueOn));
    if (away.length === 0) return null;
    // Le plus ancien d'abord : c'est le retard qu'on cherche en cliquant.
    const nearest = away.reduce((best, task) => (task.dueOn! < best ? task.dueOn! : best), away[0]!.dueOn!);
    return { count: away.length, month: monthOf(nearest) };
  }, [shown, grid]);

  const clientOptions = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.clientId, task.clientName]));
    return [...byId].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [tasks]);

  const personOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const task of tasks) {
      if (task.assignedToId) byKey.set(task.assignedToId, task.assigneeLabel ?? "Ancien membre");
    }
    const people = [...byKey].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return tasks.some((task) => !task.assignedToId)
      ? [...people, { value: UNKNOWN_PERSON_KEY, label: "Non confiée" }]
      : people;
  }, [tasks]);

  const chipCount = (key: BoardScope) => matching.filter((task) => inCalendarScope(task, key)).length;
  const chips: { key: BoardScope; label: string; count: number; alert?: boolean }[] = [
    { key: "pour_vous", label: "Pour vous", count: chipCount("pour_vous") },
    { key: "mes_demandes", label: "Mes demandes", count: chipCount("mes_demandes") },
    ...(chipCount("a_confier") > 0 || scope === "a_confier"
      ? [{ key: "a_confier" as const, label: "À confier", count: chipCount("a_confier") }]
      : []),
    ...(chipCount("en_retard") > 0 || scope === "en_retard"
      ? [{ key: "en_retard" as const, label: "En retard", count: chipCount("en_retard"), alert: true }]
      : []),
    { key: "toutes", label: "Toutes", count: matching.length },
  ];

  const goToMonth = (next: string) => { setMonth(next); setSelected(null); setMoved(null); };

  /*
   * Une tâche déplacée vers un autre mois quittait sa case sans un mot : on
   * suit le déplacement — le mois affiché rejoint la nouvelle date — et on dit
   * ce qui a été fait.
   */
  const handleMoved = (date: string, message?: string) => {
    setMonth(monthOf(date));
    setSelected(date);
    setMoved(message ?? null);
  };

  /*
   * Un mois vide sous un filtre et un mois réellement sans travail ne se disent
   * pas pareil : le second est une bonne nouvelle, le premier invite à enlever
   * un filtre.
   */
  const emptyLabel = filtering || scope !== "toutes"
    ? "Aucune tâche ne correspond ce mois-ci."
    : "Rien à produire ce mois-ci.";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Calendrier de production</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Commandes internes et corrections graphiques ou vidéo, posées sur leur échéance.
            {" "}Shootings et fiches à préparer restent sur leur écran : ils ne se produisent pas à la journée.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 text-xs"
            disabled={month <= range.first}
            onClick={() => goToMonth(shiftMonth(month, -1))}
            aria-label="Mois précédent"
          >
            <Icon name="arrow" className="h-4 w-4 rotate-180"/>
          </button>
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 text-xs"
            onClick={() => { setMonth(monthOf(today)); setSelected(today); setMoved(null); }}
          >
            Aujourd’hui
          </button>
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 text-xs"
            disabled={month >= range.last}
            onClick={() => goToMonth(shiftMonth(month, 1))}
            aria-label="Mois suivant"
          >
            <Icon name="arrow" className="h-4 w-4"/>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <strong className="text-sm first-letter:uppercase">{monthLabel(month)}</strong>
        <span className="text-xs text-ink-faint">
          {workload.total === 0
            ? emptyLabel
            : `${workload.total} tâche${workload.total > 1 ? "s" : ""}${workload.late > 0 ? ` · ${workload.late} en retard` : ""}`}
        </span>
        {elsewhere && (
          <button
            type="button"
            className="text-xs font-semibold text-[#0b63ad] hover:underline"
            onClick={() => goToMonth(elsewhere.month)}
          >
            {elsewhere.count} en dehors de ce mois — voir {monthLabel(elsewhere.month)}
          </button>
        )}
      </div>

      {moved && (
        <p role="status" className="rounded-xl border border-state-approved/30 bg-state-approved/5 px-4 py-3 text-sm text-state-approved">
          {moved}
        </p>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer le calendrier">
          {chips.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={scope === item.key}
              onClick={() => setScope(item.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                scope === item.key ? "bg-[#1176d3] text-white"
                : item.alert ? "bg-state-changes/10 text-state-changes ring-1 ring-state-changes/20 hover:bg-state-changes/15"
                : "bg-white text-ink-soft ring-1 ring-line hover:bg-canvas"
              }`}
            >
              {item.label} · {item.count}
            </button>
          ))}
        </div>
      )}

      {tasks.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"/>
            <input
              type="search"
              className="field pl-9"
              placeholder="Chercher un client, une tâche…"
              value={filters.query}
              onChange={(event) => setFilter("query", event.target.value)}
              aria-label="Chercher un client ou une tâche"
            />
          </div>
          {clientOptions.length > 1 && (
            <select
              className="field w-auto shrink-0"
              value={filters.clientId}
              onChange={(event) => setFilter("clientId", event.target.value)}
              aria-label="Filtrer par client"
            >
              <option value="">Tous les clients</option>
              {clientOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          {personOptions.length > 1 && (
            <select
              className="field w-auto shrink-0"
              value={filters.person}
              onChange={(event) => setFilter("person", event.target.value)}
              aria-label="Filtrer par personne"
            >
              <option value="">Tout le monde</option>
              {personOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          <select
            className="field w-auto shrink-0"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value as BoardFilters["status"])}
            aria-label="Filtrer par état"
          >
            {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )}

      {/* Grille du mois — à partir de md : sept colonnes ne tiennent pas sur un téléphone. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-1.5 pb-1.5">
          {WEEKDAY_HEADS.map((head) => (
            <span key={head} className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{head}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {grid.weeks.flat().map((day) => {
            const load = dayWorkload(day.date, placement);
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={selected === day.date}
                aria-label={`${dayLabel(day.date)} — ${load.total} tâche${load.total > 1 ? "s" : ""}${load.late > 0 ? `, dont ${load.late} en retard` : ""}`}
                onClick={() => setSelected(day.date)}
                className={`flex min-h-28 flex-col gap-1 rounded-xl border p-2 text-left transition-colors ${
                  selected === day.date ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-[#c9d5e1]"
                } ${day.inMonth ? (day.isWeekend ? "bg-canvas" : "bg-white") : "bg-canvas/60"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold ${
                    day.isToday ? "bg-accent text-white" : day.inMonth ? "text-ink" : "text-ink-faint"
                  }`}>
                    {dayNumber(day.date)}
                  </span>
                  {load.late > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-state-changes" aria-hidden="true"/>
                  )}
                  {load.total > 0 && (
                    <span className="ml-auto text-[10px] font-semibold text-ink-faint">{load.total}</span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  {load.tasks.slice(0, PILLS_PER_CELL).map((task) => (
                    <TaskPill key={`${task.source}-${task.id}`} task={task}/>
                  ))}
                  {load.total > PILLS_PER_CELL && (
                    <span className="px-1.5 text-[11px] font-semibold text-ink-faint">
                      +{load.total - PILLS_PER_CELL} autre{load.total - PILLS_PER_CELL > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {selected && <div className="mt-4"><DayTasks date={selected} tasks={dayWorkload(selected, placement).tasks} onMoved={handleMoved}/></div>}
      </div>

      {/*
        Téléphone : l'agenda des jours chargés, jours vides écartés. Même contenu
        que la grille, rendu une seconde fois — comme l'historique de production.
      */}
      <div className="space-y-3 md:hidden">
        {agenda.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-ink-faint">{emptyLabel}</p>
        ) : agenda.map((day) => <DayTasks key={day.date} date={day.date} tasks={day.tasks} onMoved={handleMoved}/>)}
      </div>

      {/*
        Sans échéance : une correction peut n'en porter aucune. Elle ne tient
        dans aucune case et ne doit pas pour autant disparaître du plan de charge.
      */}
      {placement.undated.length > 0 && (
        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Sans échéance</h3>
            <span className="text-xs text-ink-faint">{placement.undated.length} tâche{placement.undated.length > 1 ? "s" : ""}</span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">Aucune date n’a été fixée : à placer depuis le ticket.</p>
          <ul className="mt-3 space-y-2">
            {placement.undated.map((task) => <TaskRow key={`${task.source}-${task.id}`} task={task} onMoved={handleMoved}/>)}
          </ul>
        </div>
      )}

      <p className="rounded-2xl bg-[#e8f2ff] px-4 py-3 text-xs leading-relaxed text-[#385a78]">
        Tout le plan de charge de l’agence. Vous ne déplacez que les commandes qui vous concernent, et
        l’échéance d’une correction reste celle de la validation client.
      </p>
    </section>
  );
}
