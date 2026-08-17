import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { appRoleLabel } from "@/lib/domain/types";
import { InternalShell } from "@/components/InternalShell";

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

  /*
   * Pastille de la production interne.
   *
   * Elle ne dit pas la même chose selon qui regarde : au studio, ce qui reste à
   * produire ; à la personne qui a passé la commande, ce qui est livré et attend
   * sa validation. Sans ce signal, un fichier déposé pouvait rester des jours
   * sans que le demandeur sache qu'il était prêt.
   */
  const { count: productionBadge } = isProduction
    ? await supabase
        .from("production_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "a_faire")
    : await supabase
        .from("production_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "livree")
        .eq("requested_by", profile.id);

  const links = isProduction
    ? [{ href: "/production", label: "Corrections clients", icon: "layers", badge: productionBadge ?? 0 }]
    : [
        { href: "/", label: "Vue d’ensemble", icon: "dashboard", badge: null },
        { href: "/publications", label: "Publications", icon: "send", badge: null },
        { href: "/fiches", label: "Planning", icon: "calendar", badge: null },
        { href: "/clients", label: "Clients", icon: "users", badge: null },
        { href: "/retours", label: "Tickets clients", icon: "message", badge: openTickets ?? 0 },
        { href: "/production", label: "Production", icon: "layers", badge: productionBadge ?? 0 },
        { href: "/indicateurs", label: "Indicateurs", icon: "chart", badge: null },
        ...(profile.role === "super_admin"
          ? [
              { href: "/budget", label: "Budget", icon: "euro", badge: null },
              { href: "/utilisateurs", label: "Équipe", icon: "settings", badge: null },
            ]
          : []),
      ];

  return <InternalShell profile={{ name: profile.full_name, role: appRoleLabel(profile.role) }} links={links}>{children}</InternalShell>;
}
