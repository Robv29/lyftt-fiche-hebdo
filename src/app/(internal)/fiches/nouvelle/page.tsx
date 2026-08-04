import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { SheetBuilder } from "./SheetBuilder";

export default async function NewSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { client } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
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
        <Link href="/fiches" className="text-sm text-ink-soft hover:text-ink">
          ← Fiches
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Nouvelle fiche hebdomadaire</h1>
        <p className="mt-1 text-sm text-ink-soft">
          La période et l&apos;échéance de validation sont déduites de la semaine choisie.
        </p>
      </div>

      <SheetBuilder
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        preselectedClientId={client ?? null}
      />
    </div>
  );
}
