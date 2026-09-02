import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientLifecycle } from "@/lib/domain/client-lifecycle";
import { LYFTT_CLIENT_TYPE_IDS, type LyfttClientType } from "@/lib/domain/hashtags";
import type { ImplantationInput, ImplantationState } from "@/lib/domain/implantations";
import { ImplantationsMap } from "./ImplantationsMap";

export const dynamic = "force-dynamic";

/**
 * Carte des implantations : où l'agence travaille, en un coup d'œil.
 *
 * On retient les clients en gestion, ceux en pause, et ceux dont la gestion
 * s'est terminée dans l'année en cours. Les fins plus anciennes sortent : la
 * carte répond à « où sommes-nous aujourd'hui », pas « où sommes-nous passés ».
 */

function isImplantation(state: string, endDate: string | null, year: number): boolean {
  if (state === "active" || state === "paused") return true;
  // Une gestion terminée ne reste sur la carte que le temps de l'année civile.
  if (state === "ended" && endDate) return Number(endDate.slice(0, 4)) === year;
  return false;
}

export default async function ImplantationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, notes, latitude, longitude, geo_label, is_active, contract_start_date, contract_end_date, pause_start_date, pause_end_date")
    .order("name");

  if (error) {
    return (
      <section className="rounded-2xl border border-line bg-white p-6">
        <h1 className="text-lg font-semibold">Nos implantations</h1>
        <p className="mt-2 text-sm text-state-changes">
          Liste des clients illisible : {error.message}
        </p>
      </section>
    );
  }

  const year = new Date().getFullYear();
  const retained: ImplantationInput[] = [];
  let setAside = 0;

  for (const row of data ?? []) {
    const lifecycle = clientLifecycle({
      isActive: row.is_active,
      contractStartDate: row.contract_start_date,
      contractEndDate: row.contract_end_date,
      pauseStartDate: row.pause_start_date,
      pauseEndDate: row.pause_end_date,
    });

    if (!isImplantation(lifecycle.state, row.contract_end_date, year)) {
      setAside += 1;
      continue;
    }

    let profile: Record<string, unknown> = {};
    try {
      const notes = typeof row.notes === "string" ? JSON.parse(row.notes) : {};
      profile = (notes?.brandProfile ?? {}) as Record<string, unknown>;
    } catch { profile = {}; }

    const rawType = String(profile.clientType ?? "");
    retained.push({
      id: row.id,
      name: row.name,
      // La commune retenue par le géocodeur prime : c'est celle du point.
      city: row.geo_label || String(profile.city ?? ""),
      clientType: (LYFTT_CLIENT_TYPE_IDS as readonly string[]).includes(rawType)
        ? (rawType as LyfttClientType)
        : null,
      longitude: row.longitude,
      latitude: row.latitude,
      state: lifecycle.state as ImplantationState,
    });
  }

  return <ImplantationsMap clients={retained} setAside={setAside} year={year} />;
}
