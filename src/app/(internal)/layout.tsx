import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { appRoleLabel } from "@/lib/domain/types";
import { nextDay, todayInParis } from "@/lib/domain/client-lifecycle";
import { InternalShell } from "@/components/InternalShell";
import { EDITORIAL_ROLES } from "@/lib/internal/authorization";
import { PRODUCTION_LEAD_ROLES } from "@/lib/domain/production-board";

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
  const managesProduction = EDITORIAL_ROLES.includes(profile.role);

  /*
   * Pastille de la transmission : les fiches que le CRM a poussées et que
   * personne n'a encore prises en charge. C'est le seul endroit où un client
   * fraîchement signé se signale — sans ce compteur, l'onglet reste muet et on
   * découvre le client la veille de son rendez-vous.
   */
  const { count: pendingTransmissions } = managesProduction
    ? await supabase
        .from("client_transmissions")
        .select("id", { count: "exact", head: true })
        .eq("statut", "a_traiter")
    : { count: 0 };

  /*
   * Pastille de la production : ce qui attend un geste de la personne qui
   * regarde, et rien d'autre.
   *
   * Au studio, ce qu'il y a à produire — les commandes internes à faire et les
   * corrections clients qui lui sont affectées, jusqu'ici muettes. Au community
   * manager, ce qui lui revient : ses commandes livrées, les corrections
   * déposées qu'il doit contrôler, et les versions corrigées qui restent à
   * envoyer au client.
   *
   * Le périmètre des tickets est tenu par la RLS : un graphiste ne compte que
   * ceux qui lui sont affectés, sans que cette requête ait à le redire. Les
   * commandes de production, elles, se lisent en entier depuis que l'équipe
   * voit le plan de charge de l'agence : chaque compte dit donc explicitement
   * ce qui revient à la personne qui regarde. Sans cela, la pastille porterait
   * le travail et le retard de tout le monde.
   */
  // Confiée à moi, ou commandée par moi : le reste est le travail des autres.
  const mineOrAssigned = `assigned_to.eq.${profile.id},requested_by.eq.${profile.id}`;
  /*
   * L'encadrement voyait déjà le retard de toute l'agence — la RLS ne le
   * bornait pas. Seuls les rôles qui gagnent la lecture ont besoin d'être
   * ramenés à leurs propres commandes, sinon la pastille compterait le travail
   * des autres.
   */
  const scopeToMe = !(PRODUCTION_LEAD_ROLES as readonly string[]).includes(profile.role);
  const productionCounts = await Promise.all(
    isProduction
      ? [
          supabase
            .from("production_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "a_faire")
            .eq("assigned_to", profile.id),
          supabase
            .from("client_tickets")
            .select("id", { count: "exact", head: true })
            .in("category", ["graphic", "video"])
            .in("status", ["assigned", "in_progress", "reopened"]),
        ]
      : [
          supabase
            .from("production_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "livree")
            .eq("requested_by", profile.id),
          supabase
            .from("client_tickets")
            .select("id", { count: "exact", head: true })
            .in("category", ["graphic", "video"])
            .in("status", ["ready_for_review", "new_version_generated"]),
          /*
           * Commandes qui lui sont confiées. Le responsable de production
           * commande aussi : sans ce compte, ce qu'on lui confie restait muet.
           * Celles déjà en retard sont comptées juste en dessous, pas deux fois.
           */
          supabase
            .from("production_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "a_faire")
            .eq("assigned_to", profile.id)
            .gte("due_on", todayInParis()),
          // En retard : sans ça, un community manager ou un admin qui ne produit
          // pas lui-même ne voit jamais que la production a pris du retard.
          (() => {
            const overdue = supabase
              .from("production_requests")
              .select("id", { count: "exact", head: true })
              .eq("status", "a_faire")
              .lt("due_on", todayInParis());
            return scopeToMe ? overdue.or(mineOrAssigned) : overdue;
          })(),
          supabase
            .from("client_tickets")
            .select("id", { count: "exact", head: true })
            .in("category", ["graphic", "video"])
            .not("status", "in", "(closed,cancelled,rejected,approved_by_client)")
            .lt("due_at", new Date().toISOString()),
          // Corrections confiées à la personne qui regarde — un responsable de
          // production peut être désigné : sans ça, l'affectation ne se signale nulle part.
          supabase
            .from("client_tickets")
            .select("id, client_ticket_assignments!inner(profile_id, assignment_role)", { count: "exact", head: true })
            .in("category", ["graphic", "video"])
            .in("status", ["assigned", "in_progress", "reopened"])
            .eq("client_ticket_assignments.profile_id", profile.id)
            .eq("client_ticket_assignments.assignment_role", "contributor"),
        ],
  );
  /*
   * Échéance de production qui tombe demain.
   *
   * Le compteur dit combien il reste à faire ; il ne dit pas quand. Une
   * commande découverte le jour de son terme est une commande livrée en
   * retard : la pastille prévient la veille, tant qu'il reste une journée
   * pour s'y mettre.
   */
  const dueTomorrowQuery = supabase
    .from("production_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "a_faire")
    .eq("due_on", nextDay(todayInParis()));
  const { count: dueTomorrow } = await (scopeToMe ? dueTomorrowQuery.or(mineOrAssigned) : dueTomorrowQuery);

  const productionAlert = (dueTomorrow ?? 0) > 0
    ? {
        label: `${dueTomorrow} commande${dueTomorrow! > 1 ? "s" : ""} de production à rendre demain`,
      }
    : null;

  // Les requêtes n'ont pas toutes la même forme : seul le compte nous intéresse.
  const productionBadge = (productionCounts as { count: number | null }[]).reduce(
    (total, result) => total + (result.count ?? 0),
    0,
  );

  /*
   * Le commercial ne produit rien : il prépare des rendez-vous. Sa navigation
   * se limite donc à la carte et aux fiches clients — lui proposer Planning ou
   * Production l'enverrait sur des écrans que la RLS lui laisse vides.
   */
  const links = profile.role === "commercial"
    ? [
        { href: "/implantations", label: "Nos implantations", icon: "map", badge: null },
        { href: "/clients", label: "Clients", icon: "users", badge: null },
      ]
    : isProduction
    ? [{ href: "/production", label: "Corrections clients", icon: "layers", badge: productionBadge, alert: productionAlert }]
    : [
        { href: "/", label: "Vue d’ensemble", icon: "dashboard", badge: null },
        { href: "/publications", label: "Publications", icon: "send", badge: null },
        { href: "/fiches", label: "Planning", icon: "calendar", badge: null },
        { href: "/clients", label: "Clients", icon: "users", badge: null },
        ...(managesProduction
          ? [{ href: "/transmission", label: "Transmission client", icon: "send", badge: pendingTransmissions ?? 0 }]
          : []),
        { href: "/retours", label: "Tickets clients", icon: "message", badge: openTickets ?? 0 },
        { href: "/production", label: "Production", icon: "layers", badge: productionBadge, alert: productionAlert },
        { href: "/shootings", label: "Shootings", icon: "camera", badge: null },
        { href: "/indicateurs", label: "Indicateurs", icon: "chart", badge: null },
        { href: "/historique", label: "Historique", icon: "clock", badge: null },
        { href: "/implantations", label: "Nos implantations", icon: "map", badge: null },
        ...(profile.role === "super_admin"
          ? [
              { href: "/budget", label: "Budget", icon: "euro", badge: null },
              { href: "/utilisateurs", label: "Équipe", icon: "settings", badge: null },
            ]
          : []),
      ];

  return <InternalShell profile={{ name: profile.full_name, role: appRoleLabel(profile.role) }} links={links}>{children}</InternalShell>;
}
