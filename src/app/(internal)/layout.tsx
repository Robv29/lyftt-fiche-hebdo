import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { appRoleLabel } from "@/lib/domain/types";

/** §8 — La navigation porte la pastille des retours clients à traiter. */
export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { count: openTickets } = await supabase
    .from("client_tickets")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(closed,cancelled,rejected,approved_by_client)");

  const isProduction = ["graphic_designer", "video_editor"].includes(profile.role);

  const links = isProduction
    ? [{ href: "/production", label: "Corrections clients", badge: null }]
    : [
        { href: "/", label: "Tableau de bord", badge: null },
        { href: "/clients", label: "Clients", badge: null },
        { href: "/fiches", label: "Fiches", badge: null },
        { href: "/retours", label: "Retours clients", badge: openTickets ?? 0 },
        { href: "/production", label: "Production", badge: null },
        { href: "/indicateurs", label: "Indicateurs", badge: null },
        // L'administration des comptes n'est visible que par un administrateur.
        ...(profile.role === "super_admin"
          ? [{ href: "/utilisateurs", label: "Utilisateurs", badge: null }]
          : []),
      ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            lyftt.
          </Link>

          <nav className="flex flex-1 flex-wrap gap-x-5 gap-y-2 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink"
              >
                {link.label}
                {link.badge ? (
                  <span className="badge bg-state-changes text-white">{link.badge}</span>
                ) : null}
              </Link>
            ))}
          </nav>

          <span className="text-xs text-ink-faint">
            {profile.full_name} · {appRoleLabel(profile.role)}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
