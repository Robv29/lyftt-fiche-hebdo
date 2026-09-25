import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { denyCommercial } from "@/lib/internal/authorization";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import type { InvoiceStatus } from "@/lib/domain/invoicing";
import { isShootingUnclassified } from "@/lib/domain/shooting-decision";
import { deliveryDueOn } from "@/lib/domain/shootings";
import { ShootingForm } from "./ShootingForm";
import { ShootingDateEditor } from "../ShootingDateEditor";
import { UnclassifiedDot } from "../UnclassifiedDot";

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
    .select("id, client_id, performed_on, label, service_key, forfait_included")
    .eq("id", id)
    .maybeSingle();
  if (!line) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, contract_start_date")
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

  /*
   * Shooting non classé, marqué ici comme dans la liste — la même règle, pour
   * que la fiche ouverte depuis un point rouge le porte aussi.
   *
   * Direction seule : classer est une décision de facturation, et les factures
   * du client ne se lisent pas sans elle. Le lecteur n'apprend ici aucun
   * montant, seulement qu'une décision reste à prendre.
   */
  let unclassified = false;
  if (profile.role === "super_admin") {
    const { data: invoices } = await supabase
      .from("client_invoices")
      .select("period_month, status")
      .eq("client_id", client.id as string);
    unclassified = isShootingUnclassified(
      {
        serviceKey: line.service_key as string,
        performedOn: date,
        forfaitIncluded: line.forfait_included as boolean | null,
        cancelled: Boolean(details?.cancelled),
      },
      {
        today,
        contractStartDate: (client.contract_start_date as string | null) ?? null,
        invoiceStatuses: Object.fromEntries(
          (invoices ?? []).map((row) => [String(row.period_month).slice(0, 10), row.status as InvoiceStatus]),
        ),
      },
    );
  }

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
        {unclassified && (
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <UnclassifiedDot label />
            <span className="text-xs text-ink-soft">
              Compris au forfait, vendu en plus, ou pas eu lieu&nbsp;? La décision se prend sur la{" "}
              <Link href="/shootings" className="font-semibold text-accent hover:underline">
                liste des shootings
              </Link>.
            </span>
          </p>
        )}
        {/*
          Même composant et même action que la liste des shootings : une seule
          règle pour déplacer un shooting, qui refuse d'en déplacer un déjà facturé.
        */}
        <div className="mt-2">
          <ShootingDateEditor
            lineId={id}
            date={date}
            canEdit={["super_admin", "production_manager", "community_manager"].includes(profile.role)}
          />
        </div>
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
