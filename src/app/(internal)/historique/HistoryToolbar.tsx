"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

/**
 * Choix du client et export.
 *
 * L'export passe par l'impression du navigateur plutôt que par une génération
 * de PDF côté serveur : « Enregistrer en PDF » y est natif, sur toutes les
 * plateformes, et le document imprimé est exactement ce qui est à l'écran —
 * aucune seconde mise en page à maintenir en parallèle. Les styles `@media
 * print` retirent la navigation et déplient la chronologie.
 */
export function HistoryToolbar({
  clients,
  selectedId,
  clientName,
}: {
  clients: { id: string; name: string }[];
  selectedId: string;
  clientName: string;
}) {
  const router = useRouter();

  return (
    <div className="no-print flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <label className="label" htmlFor="history-client">Client</label>
        <select
          id="history-client"
          className="field"
          value={selectedId}
          onChange={(event) => router.push(`/historique?client=${event.target.value}`)}
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={() => window.print()}
        aria-label={`Exporter l’historique de ${clientName} en PDF`}
      >
        <Icon name="download" className="h-4 w-4"/>
        Exporter en PDF
      </button>
    </div>
  );
}
