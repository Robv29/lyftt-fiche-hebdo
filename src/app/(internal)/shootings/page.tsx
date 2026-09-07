import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { denyCommercial } from "@/lib/internal/authorization";
import { accessibleShootingClients, readShootings } from "@/lib/shootings/query";
import { ShootingReminders } from "../ShootingReminders";
import { ShootingsView } from "./ShootingsView";

export const dynamic = "force-dynamic";

/**
 * Onglet Shootings.
 *
 * Répond aux trois questions du cahier des charges : ce qu'on a réalisé, ce
 * qui est prévu, et quelle activité de production cela représente.
 *
 * Les données viennent du même module que le tableau de bord. Les « prochaines
 * dates à caler » y sont reprises telles quelles, avec leurs boutons : caler
 * une date ici ou depuis l'accueil est le même geste, et produit la même ligne.
 */
export default async function ShootingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  await denyCommercial();

  const supabase = await createSupabaseServerClient();
  const clients = await accessibleShootingClients(supabase);
  const { entries, due } = await readShootings(clients);

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Production</p>
        <h1 className="page-title mt-1">Shootings</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ce qui a été tourné, ce qui est calé, et ce qu&apos;il reste à caler.
        </p>
      </header>

      {due.length > 0 && (
        <ShootingReminders rows={due} />
      )}

      <ShootingsView
        shootings={entries.map((entry) => ({
          lineId: entry.lineId,
          clientId: entry.clientId,
          clientName: entry.clientName,
          date: entry.date,
          label: entry.details?.name || entry.label,
          status: entry.status,
          kind: entry.details?.kind ?? null,
          place: entry.details?.place ?? null,
          leadName: entry.details?.leadName ?? null,
          durationMinutes: entry.details?.durationMinutes ?? null,
          deliveryDays: entry.details?.deliveryDays ?? null,
        }))}
        clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      />
    </div>
  );
}
