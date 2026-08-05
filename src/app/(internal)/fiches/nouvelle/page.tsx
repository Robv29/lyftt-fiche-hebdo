import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { SheetBuilder } from "./SheetBuilder";

export default async function NewSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; isoYear?: string; isoWeek?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { client, isoYear, isoWeek } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, notes, post_signature")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (!clients || clients.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Nouvelle fiche</h1>
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Créez d&apos;abord un client.{" "}
          <Link href="/clients" className="underline">
            Aller aux clients
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fiches" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-ink">
          ← Fiches
        </Link>
        <p className="eyebrow mt-2">Assistant de production</p><h1 className="page-title mt-1">Nouvelle fiche</h1>
        <p className="mt-1 text-sm text-ink-soft">
          La période et l&apos;échéance de validation sont déduites de la semaine choisie.
        </p>
      </div>

      <SheetBuilder
        clients={clients.map((c) => {
          let settings: { defaultNetworks?: string[]; monthlyCadence?: { photo?: number; video?: number; visual?: number }; recommendedHashtags?: string[] } = {};
          try { settings = typeof c.notes === "string" ? JSON.parse(c.notes) : {}; } catch { settings = {}; }
          return {
            id: c.id,
            name: c.name,
            defaultNetworks: settings.defaultNetworks ?? ["instagram", "facebook"],
            defaultHashtags: settings.recommendedHashtags ?? [],
            monthlyCadence: settings.monthlyCadence ?? {},
            postSignature: c.post_signature ?? "",
          };
        })}
        preselectedClientId={client ?? null}
        preselectedIsoYear={isoYear ? Number(isoYear) : undefined}
        preselectedIsoWeek=