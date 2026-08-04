import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { UserAdmin } from "./UserAdmin";

export default async function UsersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") {
    return (
      <p className="card px-4 py-8 text-center text-sm text-ink-faint">
        Cet écran est réservé aux administrateurs.
      </p>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active, created_at")
    .order("full_name", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p><h1 className="page-title mt-1">Équipe</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Les comptes de l&apos;équipe LYFTT et leurs droits.
        </p>
      </div>

      <UserAdmin
        currentProfileId={profile.id}
        members={(members ?? []).map((m) => ({
          id: m.id,
          fullName: m.full_name,
          email: m.email,
          role: m.role,
          isActive: m.is_active,
        }))}
      />
    </div>
  );
}
