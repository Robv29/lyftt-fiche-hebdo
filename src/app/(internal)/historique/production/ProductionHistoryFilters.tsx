"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export interface FilterOption {
  value: string;
  label: string;
}

export interface ProductionHistoryFilterState {
  client: string;
  periode: string;
  statut: string;
  personne: string;
}

/**
 * Filtres de l'historique de production.
 *
 * Tout passe par l'adresse : un filtre se partage par lien, survit au
 * rechargement, et la page reste rendue côté serveur, sous RLS. L'export PDF
 * est l'impression du navigateur, comme pour l'historique des fiches.
 */
export function ProductionHistoryFilters({
  state,
  clients,
  periods,
  statuses,
  people,
}: {
  state: ProductionHistoryFilterState;
  clients: FilterOption[];
  periods: FilterOption[];
  statuses: FilterOption[];
  people: FilterOption[];
}) {
  const router = useRouter();

  const update = (key: keyof ProductionHistoryFilterState, value: string) => {
    const next = { ...state, [key]: value };
    const params = new URLSearchParams();
    for (const [name, current] of Object.entries(next)) if (current) params.set(name, current);
    const query = params.toString();
    router.push(`/historique/production${query ? `?${query}` : ""}`);
  };

  const field = (
    key: keyof ProductionHistoryFilterState,
    label: string,
    options: FilterOption[],
    allLabel: string | null,
  ) => (
    <div className="min-w-0">
      <label className="label" htmlFor={`production-history-${key}`}>{label}</label>
      <select
        id={`production-history-${key}`}
        className="field"
        value={state[key]}
        onChange={(event) => update(key, event.target.value)}
      >
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="no-print flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("client", "Client", clients, "Tous les clients")}
        {field("periode", "Échéance", periods, null)}
        {field("statut", "Verdict", statuses, "Tous")}
        {field("personne", "Personne", people, "Tout le monde")}
      </div>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => window.print()}
        aria-label="Exporter l’historique de production en PDF"
      >
        <Icon name="download" className="h-4 w-4"/>
        Exporter en PDF
      </button>
    </div>
  );
}
