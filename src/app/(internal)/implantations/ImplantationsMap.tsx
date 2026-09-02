"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FRANCE_DEPARTMENTS, MAP_VIEWBOX } from "@/lib/geo/france-map";
import {
  countBySector,
  groupByDepartment,
  placeImplantations,
  type ImplantationInput,
  type ImplantationState,
} from "@/lib/domain/implantations";
import { LYFTT_CLIENT_TYPES, type LyfttClientType } from "@/lib/domain/hashtags";

const STATES: ReadonlyArray<{ id: ImplantationState; label: string; color: string }> = [
  { id: "active", label: "En gestion", color: "#16a36a" },
  { id: "paused", label: "En pause", color: "#b76200" },
  { id: "ended", label: "Gestion terminée", color: "#667085" },
];

const COLOR_OF = new Map(STATES.map((s) => [s.id, s.color]));
const LABEL_OF = new Map(STATES.map((s) => [s.id, s.label]));
const SECTOR_LABEL = new Map(LYFTT_CLIENT_TYPES.map((t) => [t.id, t.label]));

export function ImplantationsMap({
  clients,
  setAside,
  year,
}: {
  clients: ImplantationInput[];
  setAside: number;
  year: number;
}) {
  const [sector, setSector] = useState<LyfttClientType | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef(new Map<string, HTMLLIElement>());

  const sectors = useMemo(
    () => countBySector(clients, LYFTT_CLIENT_TYPES.map((t) => t.id)).filter((s) => s.count > 0),
    [clients],
  );

  const shown = useMemo(
    () => (sector ? clients.filter((c) => c.clientType === sector) : clients),
    [clients, sector],
  );

  /*
   * Le placement se fait sur les clients affichés, pas sur tous : filtrer un
   * secteur doit desserrer les grappes, sinon les points restants gardent des
   * trous là où se tenaient les autres.
   */
  const placed = useMemo(() => placeImplantations(shown), [shown]);
  const groups = useMemo(() => groupByDepartment(placed, FRANCE_DEPARTMENTS), [placed]);
  const unlocated = shown.filter((c) => c.latitude === null || c.longitude === null);

  /** Départements qui portent au moins un client : les seuls à cliquer. */
  const populated = useMemo(() => new Set(groups.map((g) => g.code)), [groups]);

  /*
   * Amener la liste sur le département choisi.
   *
   * `scrollIntoView` emporterait la page entière avec lui ; on ne déplace donc
   * que le conteneur, en visant le haut du groupe.
   */
  useEffect(() => {
    if (!selectedDept) return;
    const container = listRef.current;
    const group = groupRefs.current.get(selectedDept);
    if (!container || !group) return;
    container.scrollTo({ top: group.offsetTop - container.offsetTop, behavior: "smooth" });
  }, [selectedDept, groups]);

  const selectDepartment = (code: string) => {
    setSelectedDept((current) => (current === code ? null : code));
  };

  // Le point survolé passe au-dessus des autres : dessiné en dernier.
  const ordered = [...placed].sort((a, b) => Number(a.id === focused) - Number(b.id === focused));
  const selectedName = groups.find((g) => g.code === selectedDept)?.name;

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-line bg-white shadow-sm">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="eyebrow">Implantations · France métropolitaine</p>
            <h1 className="mt-1 text-lg font-semibold">Où nous travaillons</h1>
          </div>
          <p className="text-xs text-ink-faint">
            {shown.length} client{shown.length > 1 ? "s" : ""}
            {sector ? ` · ${SECTOR_LABEL.get(sector) ?? sector}` : ""}
            {" · "}
            {groups.length} département{groups.length > 1 ? "s" : ""}
          </p>
        </header>

        <div className="border-b border-line px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSector(null)}
              aria-pressed={sector === null}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                sector === null ? "bg-accent text-white" : "bg-[#eef3f9] text-ink-faint hover:bg-[#e2eaf3]"
              }`}
            >
              Tous les secteurs · {clients.length}
            </button>
            {sectors.map(({ type, count }) => (
              <button
                key={type}
                type="button"
                onClick={() => setSector(type === sector ? null : type)}
                aria-pressed={sector === type}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  sector === type ? "bg-accent text-white" : "bg-[#eef3f9] text-ink-faint hover:bg-[#e2eaf3]"
                }`}
              >
                {SECTOR_LABEL.get(type) ?? type} · {count}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <svg
              viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
              className="h-auto w-full"
              role="img"
              aria-label={`Carte de France des ${shown.length} implantations LYFTT`}
            >
              {FRANCE_DEPARTMENTS.map((dep) => {
                const hasClients = populated.has(dep.code);
                const isSelected = dep.code === selectedDept;
                return (
                  <path
                    key={dep.code}
                    d={dep.path}
                    fill={isSelected ? "#cfe3f7" : hasClients ? "#e2ebf5" : "#eef2f7"}
                    stroke={isSelected ? "#1176d3" : "#d7dfea"}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeLinejoin="round"
                    className={hasClients ? "cursor-pointer outline-none" : undefined}
                    /*
                      Seuls les départements où nous sommes présents réagissent :
                      cliquer sur un département vide n'aurait aucune liste à
                      montrer, et le curseur ne doit pas le laisser croire.
                    */
                    tabIndex={hasClients ? 0 : undefined}
                    role={hasClients ? "button" : undefined}
                    aria-label={hasClients ? `${dep.name} — voir les clients` : undefined}
                    aria-pressed={hasClients ? isSelected : undefined}
                    onClick={hasClients ? () => selectDepartment(dep.code) : undefined}
                    onKeyDown={hasClients ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectDepartment(dep.code);
                      }
                    } : undefined}
                  >
                    {hasClients && <title>{`${dep.name} (${dep.code})`}</title>}
                  </path>
                );
              })}

              {ordered.map((point) => {
                const active = point.id === focused;
                return (
                  <g key={point.id}>
                    {/*
                      Halo au survol : il désigne le point sans le grossir au
                      point de recouvrir ses voisins de la même commune.
                    */}
                    {active && (
                      <circle cx={point.x} cy={point.y} r={13} fill={COLOR_OF.get(point.state)} fillOpacity={0.18} />
                    )}
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={active ? 7 : 5.5}
                      fill={COLOR_OF.get(point.state)}
                      stroke="#fff"
                      strokeWidth={1.8}
                      className="pointer-events-none"
                    >
                      <title>{`${point.name} — ${point.city} — ${LABEL_OF.get(point.state)}`}</title>
                    </circle>
                  </g>
                );
              })}
            </svg>

            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {STATES.map((state) => (
                <li key={state.id} className="flex items-center gap-2 text-xs text-ink-faint">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: state.color }} aria-hidden="true" />
                  {state.label} · {shown.filter((c) => c.state === state.id).length}
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="eyebrow">Par département</p>
              {selectedDept && (
                <button
                  type="button"
                  onClick={() => setSelectedDept(null)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Tout voir
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {selectedName ? selectedName : "Cliquez un département sur la carte."}
            </p>

            <div ref={listRef} className="mt-2 max-h-[560px] overflow-y-auto pr-1">
              <ul className="space-y-3">
                {groups.map((group) => {
                  const isSelected = group.code === selectedDept;
                  const byCommune = new Map<string, typeof group.clients>();
                  for (const client of group.clients) {
                    byCommune.set(client.city, [...(byCommune.get(client.city) ?? []), client]);
                  }
                  return (
                    <li
                      key={group.code || "hors-carte"}
                      ref={(element) => {
                        if (element) groupRefs.current.set(group.code, element);
                        else groupRefs.current.delete(group.code);
                      }}
                      className={`rounded-xl border p-2 transition-colors ${
                        isSelected ? "border-accent bg-[#f2f8ff]" : "border-transparent"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectDepartment(group.code)}
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="text-xs font-bold uppercase tracking-wide text-ink">
                          {group.code ? `${group.code} · ` : ""}{group.name}
                        </span>
                        <span className="shrink-0 text-xs text-ink-faint">{group.clients.length}</span>
                      </button>

                      {[...byCommune.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([city, list]) => (
                        <div key={city} className="mt-1.5">
                          <p className="px-2 text-[11px] font-semibold text-ink-faint">{city}</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {list.map((client) => (
                              <li key={client.id}>
                                <Link
                                  href={`/clients/${client.id}`}
                                  onMouseEnter={() => setFocused(client.id)}
                                  onMouseLeave={() => setFocused(null)}
                                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors ${
                                    focused === client.id ? "bg-[#e2eaf3]" : "hover:bg-[#f7fafe]"
                                  }`}
                                >
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ background: COLOR_OF.get(client.state) }}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{client.name}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </li>
                  );
                })}
                {groups.length === 0 && (
                  <li className="text-sm text-ink-faint">Aucun client dans ce secteur.</li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {(unlocated.length > 0 || setAside > 0) && (
          <footer className="border-t border-line px-5 py-3 text-xs text-ink-faint">
            {unlocated.length > 0 && (
              <p>
                {/*
                  Un client sans position doit se voir : absent de la carte et
                  absent de la page, il passerait pour un client qu'on n'a pas.
                */}
                Position inconnue, absent de la carte : {unlocated.map((c) => c.name).join(", ")}.
                Renseignez la ville et le code postal dans la fiche client.
              </p>
            )}
            {setAside > 0 && (
              <p className={unlocated.length > 0 ? "mt-1" : undefined}>
                {setAside} client{setAside > 1 ? "s" : ""} hors carte : gestion terminée avant {year},
                archivé{setAside > 1 ? "s" : ""}, ou pas encore commencé{setAside > 1 ? "s" : ""}.
              </p>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
