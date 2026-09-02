"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FRANCE_DEPARTMENTS, MAP_VIEWBOX } from "@/lib/geo/france-map";
import {
  countBySector,
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
  const unlocated = shown.filter((c) => c.latitude === null || c.longitude === null);

  const communes = useMemo(() => {
    const map = new Map<string, ImplantationInput[]>();
    for (const client of shown) {
      const list = map.get(client.city) ?? [];
      list.push(client);
      map.set(client.city, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "fr"));
  }, [shown]);

  // Le point survolé passe au-dessus des autres : dessiné en dernier.
  const ordered = [...placed].sort((a, b) => Number(a.id === focused) - Number(b.id === focused));

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
            {communes.length} commune{communes.length > 1 ? "s" : ""}
          </p>
        </header>

        <div className="border-b border-line px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSector(null)}
              aria-pressed={sector === null}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                sector === null
                  ? "bg-accent text-white"
                  : "bg-[#eef3f9] text-ink-faint hover:bg-[#e2eaf3]"
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
                  sector === type
                    ? "bg-accent text-white"
                    : "bg-[#eef3f9] text-ink-faint hover:bg-[#e2eaf3]"
                }`}
              >
                {SECTOR_LABEL.get(type) ?? type} · {count}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <svg
              viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
              className="h-auto w-full"
              role="img"
              aria-label={`Carte de France des ${shown.length} implantations LYFTT`}
            >
              {FRANCE_DEPARTMENTS.map((dep) => (
                <path
                  key={dep.code}
                  d={dep.path}
                  fill="#eef2f7"
                  stroke="#d7dfea"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              ))}

              {ordered.map((point) => {
                const active = point.id === focused;
                return (
                  <g key={point.id}>
                    {/*
                      Halo au survol : il désigne le point sans le grossir au
                      point de recouvrir ses voisins de la même commune.
                    */}
                    {active && (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={13}
                        fill={COLOR_OF.get(point.state)}
                        fillOpacity={0.18}
                      />
                    )}
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={active ? 7 : 5.5}
                      fill={COLOR_OF.get(point.state)}
                      stroke="#fff"
                      strokeWidth={1.8}
                      className="cursor-pointer"
                      onMouseEnter={() => setFocused(point.id)}
                      onMouseLeave={() => setFocused(null)}
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
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: state.color }}
                    aria-hidden="true"
                  />
                  {state.label} · {shown.filter((c) => c.state === state.id).length}
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <p className="eyebrow">Par commune</p>
            <ul className="mt-2 max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {communes.map(([city, list]) => (
                <li key={city}>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                    {city} · {list.length}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {list.map((client) => (
                      <li key={client.id}>
                        <Link
                          href={`/clients/${client.id}`}
                          onMouseEnter={() => setFocused(client.id)}
                          onMouseLeave={() => setFocused(null)}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors ${
                            focused === client.id ? "bg-[#eef3f9]" : "hover:bg-[#f7fafe]"
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
                </li>
              ))}
              {communes.length === 0 && (
                <li className="text-sm text-ink-faint">Aucun client dans ce secteur.</li>
              )}
            </ul>
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
