import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { denyCommercial } from "@/lib/internal/authorization";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import { deliveryDueOn } from "@/lib/domain/shootings";
import { ShootingForm } from "./ShootingForm";

export const dynamic = "force-dynamic";

/**
 * Fiche d'un shooting — un écran de production, pas de facturation.
 *
 * La date et le prix vivent dans le budget, réservé à la direction ; ils sont
 * repris ici en lecture, sans lien vers l'écran budget. Ce qui se remplit ici,
 * c'est ce que seule la personne qui a tourné peut savoir : la durée réelle,
 * le lieu, qui tenait la caméra, ce qui a été livré et quand.
 */
export default async function ShootingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  await denyCommercial();

  const { id } = await params;

  /*
   * La ligne se lit avec la clé service — le budget est fermé à la production
   * par RLS — puis le périmètre est vérifié par une lecture soumise à RLS.
   */
  const { data: line } = await createSupabaseAdminClient()
    .from("client_budget_lines")
    .select("id, client_id, performed_on, label, service_key")
    .eq("id", id)
    .maybeSingle();
  if (!line) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", line.client_id as string)
    .maybeSingle();
  if (!client) notFound();

  const { data: details } = await supabase
    .from("shootings")
    .select("name, kind, place, lead_name, duration_minutes, delivery_days, delivered_on, assets_count, cancelled")
    .eq("budget_line_id", id)
    .maybeSingle();

  const date = line.performed_on as string;
  const today = todayInParis();
  const status = details?.cancelled ? "Annulé" : date <= today ? "Réalisé" : "À venir";
  const promised = typeof details?.delivery_days === "number"
    ? deliveryDueOn(date, details.delivery_days)
    : null;

  return (
    <div className="space-y-6">
      <header>
        <Link href="/shootings" className="mb-5 inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-ink">
          ← Shootings
        </Link>
        <p className="eyebrow">Fiche shooting · {status}</p>
        <h1 className="page-title mt-1 break-words">
          {details?.name || (line.label as string) || "Shooting"}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          <Link href={`/clients/${client.id}`} className="font-semibold hover:text-ink">{client.name}</Link>
          {" · "}
          {new Intl.DateTimeFormat("fr-FR", {
            weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
          }).format(new Date(`${date}T00:00:00Z`))}
        </p>
        {/*
          La date ne se modifie pas ici : elle appartient au cycle du forfait,
          et se cale depuis l'accueil ou l'onglet Shootings. Deux endroits pour
          la changer, c'est une divergence garantie.
        */}
        <p className="mt-1 text-xs text-ink-faint">
          La date se cale depuis la liste des shootings ou le tableau de bord.
        </p>
      </header>

      <ShootingForm
        budgetLineId={id}
        initial={{
          name: details?.name ?? "",
          kind: (details?.kind as string) ?? "",
          place: details?.place ?? "",
          leadName: details?.lead_name ?? "",
          durationMinutes: details?.duration_minutes ?? null,
          deliveryDays: details?.delivery_days ?? null,
          deliveredOn: details?.delivered_on ?? "",
          assetsCount: details?.assets_count ?? null,
          cancelled: Boolean(details?.cancelled),
        }}
        promisedOn={promised}
      />
    </div>
  );
}
