import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { EDITORIAL_ROLES } from "@/lib/internal/authorization";
import { PageHeader } from "@/components/ui";
import { compareTransmissions } from "@/lib/domain/crm-transmission";
import { TransmissionBoard, type TransmissionRow } from "./TransmissionBoard";

/**
 * Transmission client — ce que le commercial a vendu, avant que la production
 * ne s'en empare.
 *
 * Le CRM pousse la fiche dès que le client a signé et composé son menu. Elle
 * attend ici que le chef de projet en fasse un vrai client : jusqu'à présent
 * l'information circulait par message et arrivait souvent le jour du
 * rendez-vous.
 *
 * Chaque fiche suit trois étapes datées — relire le menu, l'envoyer au client,
 * créer le dossier — dont l'état commande l'ordre d'affichage.
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
    /*
     * Une seule chaîne littérale, sans concaténation : supabase-js déduit le
     * type des lignes en analysant ce texte, et une expression calculée le
     * laisserait sans rien à lire.
     *
     * `clients ( created_at )` donne la date de l'étape 3 depuis le dossier
     * lui-même — la recopier sur la fiche créerait une seconde vérité, vouée
     * à diverger.
     */
    .select("id, crm_prospect_id, entreprise, contact_prenom, contact_nom, email, telephone, fiche_mission, menu_corrige, fiche_mission_maj_le, montant_ca, menu_compose_le, date_rdv, statut, client_id, menu_valide_le, recap_envoye_le, recap_envoye_a, clients ( created_at )")
    .in("statut", ["a_traiter", "traite"])
    .limit(200);

  const rows: TransmissionRow[] = (data ?? []).map((row) => {
    // PostgREST rend l'objet lié seul ou en tableau selon la relation ; on
    // ramène les deux formes au même cas plutôt que d'en supposer une.
    const client = row.clients as { created_at?: string } | { created_at?: string }[] | null;
    const clientCreeLe = Array.isArray(client)
      ? (client[0]?.created_at ?? null)
      : (client?.created_at ?? null);

    return {
      id: row.id,
      crmProspectId: Number(row.crm_prospect_id),
      entreprise: row.entreprise,
      contactPrenom: row.contact_prenom,
      contactNom: row.contact_nom,
      email: row.email,
      telephone: row.telephone,
      ficheMission: row.fiche_mission,
      menuCorrige: row.menu_corrige,
      ficheMissionMajLe: row.fiche_mission_maj_le,
      montantCa: row.montant_ca === null ? null : Number(row.montant_ca),
      menuComposeLe: row.menu_compose_le,
      dateRdv: row.date_rdv,
      statut: row.statut,
      clientId: row.client_id,
      clientCreeLe,
      menuValideLe: row.menu_valide_le,
      recapEnvoyeLe: row.recap_envoye_le,
      recapEnvoyeA: row.recap_envoye_a,
    };
  });

  /*
   * Le tri se fait ici, et non en SQL : « avancement » se lit sur trois
   * colonnes dont l'une, la création du dossier, vit dans une autre table.
   * Sur les deux cents lignes que l'écran charge, le coût est nul, et la règle
   * reste une fonction pure — donc testable.
   */
  rows.sort(compareTransmissions);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Arrivées"
        title="Transmission client"
        description="Les clients qui viennent de signer et d’arrêter leur menu de prestations. Relisez le menu, envoyez-leur le récapitulatif, puis créez le dossier."
      />
      <TransmissionBoard rows={rows}/>
    </div>
  );
}
