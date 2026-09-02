import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { EDITORIAL_ROLES } from "@/lib/internal/authorization";
import { PageHeader } from "@/components/ui";
import { TransmissionBoard, type TransmissionRow } from "./TransmissionBoard";

/**
 * Transmission client — ce que le commercial a vendu, avant que la production
 * ne s'en empare.
 *
 * Le CRM pousse la fiche dès que le client a signé et composé son menu. Elle
 * attend ici que le chef de projet en fasse un vrai client : jusqu'à présent
 * l'information circulait par message et arrivait souvent le jour du
 * rendez-vous.
 */
export default async function TransmissionPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  /*
   * Écran de pilotage : il n'a de sens que pour ceux qui créent les clients.
   * Graphistes et vidéastes n'ont rien à y faire, le commercial encore moins —
   * c'est lui qui a rempli la fiche dans le CRM. Ce n'est pas la barrière de
   * sécurité, qui tient à la RLS et aux gardes des actions ; c'est ce qui
   * évite d'afficher un écran vide en guise de refus.
   */
  if (!EDITORIAL_ROLES.includes(profile.role)) {
    redirect(profile.role === "commercial" ? "/implantations" : "/production");
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("client_transmissions")
    .select(
      "id, crm_prospect_id, entreprise, contact_prenom, contact_nom, email, telephone, fiche_mission, montant_ca, menu_compose_le, date_rdv, statut, client_id",
    )
    .in("statut", ["a_traiter", "traite"])
    // Le rendez-vous le plus proche d'abord, puis les fiches les plus fraîches.
    .order("date_rdv", { ascending: true, nullsFirst: false })
    .order("menu_compose_le", { ascending: false, nullsFirst: false })
    .limit(200);

  const rows: TransmissionRow[] = (data ?? []).map((row) => ({
    id: row.id,
    crmProspectId: Number(row.crm_prospect_id),
    entreprise: row.entreprise,
    contactPrenom: row.contact_prenom,
    contactNom: row.contact_nom,
    email: row.email,
    telephone: row.telephone,
    ficheMission: row.fiche_mission,
    montantCa: row.montant_ca === null ? null : Number(row.montant_ca),
    menuComposeLe: row.menu_compose_le,
    dateRdv: row.date_rdv,
    statut: row.statut,
    clientId: row.client_id,
  }));

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Arrivées"
        title="Transmission client"
        description="Les clients qui viennent de signer et d’arrêter leur menu de prestations. Créez le dossier, notez le rendez-vous, puis marquez la fiche traitée."
      />
      <TransmissionBoard rows={rows}/>
    </div>
  );
}
