"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/security/sanitize";
import {
  findTrackingProduct,
  missingRequiredStats,
  trackingMonthLabel,
  type TrackingStatValues,
} from "@/lib/domain/monthly-tracking";

/**
 * Remplissage d'un compte rendu de suivi mensuel.
 *
 * Tout passe par le client de l'utilisateur, soumis à la RLS : un compte rendu
 * hors du périmètre du lecteur n'est ni lisible ni modifiable, et c'est la base
 * qui le dit — pas cette fonction. Aucune clé service ici, et pour cause : la
 * table ne porte aucun montant, elle n'a pas besoin d'être contournée.
 *
 * Les améliorations sont exigées : un compte rendu de chiffres sans un mot sur
 * ce qui a été fait ne se relit pas six mois plus tard. Les statistiques dont
 * un ratio dépend le sont aussi — un ratio calculé sur une case vide serait
 * faux, et un chiffre faux est pire qu'un chiffre absent.
 */

export interface ReportActionResult {
  ok: boolean;
  message?: string;
}

const MIN_IMPROVEMENTS = 10;

const schema = z.object({
  reportId: z.string().uuid("Compte rendu invalide."),
  improvements: z
    .string()
    .trim()
    .min(MIN_IMPROVEMENTS, "Décrivez les améliorations faites ce mois-ci.")
    .max(2000, "Texte trop long (2000 caractères maximum)."),
});

export async function fillTrackingReport(formData: FormData): Promise<ReportActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Connexion expirée." };
  if (profile.role === "commercial") return { ok: false, message: "Écran hors de votre périmètre." };

  const parsed = schema.safeParse({
    reportId: formData.get("reportId"),
    improvements: formData.get("improvements") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const supabase = await createSupabaseServerClient();

  // Lecture soumise à la RLS : hors périmètre, la ligne n'existe pas.
  const { data: report } = await supabase
    .from("client_tracking_reports")
    .select("id, service_key, period_month, status")
    .eq("id", parsed.data.reportId)
    .maybeSingle();
  if (!report) return { ok: false, message: "Compte rendu introuvable ou hors de votre périmètre." };

  const product = findTrackingProduct(report.service_key as string);
  if (!product) return { ok: false, message: "Prestation inconnue." };

  /*
   * Les valeurs sont lues par la déclaration du produit, et rien d'autre n'est
   * retenu : un champ inventé dans le formulaire n'entre pas dans le `jsonb`.
   */
  const stats: TrackingStatValues = {};
  for (const field of product.stats) {
    const raw = formData.get(`stat_${field.key}`);
    if (raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${field.label} : indiquez un nombre positif.` };
    }
    // Les montants sont stockés en centimes entiers ; jamais de flottant sur de l'argent.
    stats[field.key] = field.unit === "euros" ? Math.round(value * 100) : Math.round(value);
  }

  const missing = missingRequiredStats(product, stats);
  if (missing.length > 0) {
    return { ok: false, message: `Chiffres manquants : ${missing.join(", ")}.` };
  }

  const { error } = await supabase
    .from("client_tracking_reports")
    .update({
      improvements: sanitizeText(parsed.data.improvements, 2000),
      stats,
      status: "rempli",
      filled_by: profile.id,
      filled_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.reportId);
  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/comptes-rendus");
  revalidatePath("/historique");
  revalidatePath("/production");
  revalidatePath("/");
  return {
    ok: true,
    message: `Compte rendu de ${trackingMonthLabel(String(report.period_month).slice(0, 10))} enregistré : il rejoint l’historique du client.`,
  };
}
