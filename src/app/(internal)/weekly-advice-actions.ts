"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scanWeeklyAdvice } from "@/lib/metrics/weekly-advice-scan";
import { WEEKLY_ADVICE_AUDIENCE } from "@/lib/domain/weekly-advice";

/**
 * « J'ai vu les conseils de cette semaine. »
 *
 * Écriture sous RLS, avec le client de la personne — et non le client à
 * privilèges. C'est l'exception qui confirme la règle du dépôt : les actions
 * internes passent par la clé service parce qu'elles écrivent sur des tables
 * fermées après avoir vérifié le périmètre. Ici, la table ne porte aucun
 * montant, aucune donnée client, et la politique `profile_id = auth.uid()`
 * **est** la vérification : personne ne peut poser ni lire la ligne d'un autre.
 * Un client à privilèges n'apporterait rien et retirerait cette garantie.
 *
 * L'état vit côté serveur et non dans le navigateur : « une fois par personne
 * et par semaine » doit survivre à un changement d'appareil, à une navigation
 * privée et à un vidage de cache. L'horloge du navigateur ne décide que du
 * *moment dans la journée*, jamais du *si*.
 */

const schema = z.object({
  isoYear: z.number().int().min(2020).max(2100),
  isoWeek: z.number().int().min(1).max(53),
  /** Fermée explicitement, par opposition à seulement ouverte. */
  dismissed: z.boolean(),
});

export interface WeeklyAdviceSeenResult {
  ok: boolean;
  message?: string;
}

export async function markWeeklyAdviceSeen(input: unknown): Promise<WeeklyAdviceSeenResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Semaine invalide." };

  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Session expirée." };

  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("weekly_advice_views")
    .upsert(
      {
        iso_year: parsed.data.isoYear,
        iso_week: parsed.data.isoWeek,
        profile_id: profile.id,
        seen_at: now,
        ...(parsed.data.dismissed ? { dismissed_at: now } : {}),
      },
      { onConflict: "iso_year,iso_week,profile_id" },
    );

  if (error) {
    /*
     * Un échec ne doit pas retenir la personne : la pop-up se referme quoi
     * qu'il arrive côté client. Au pire elle se rouvrira au prochain
     * chargement complet, ce qui est moins grave qu'une fenêtre qu'on ne peut
     * pas fermer.
     */
    console.error("[conseils hebdo] enregistrement de la lecture impossible", error.message);
    return { ok: false, message: "Lecture non enregistrée." };
  }

  return { ok: true };
}

/**
 * Calculer les conseils de la semaine, à la main.
 *
 * La tâche du lundi 10 h fait ce travail toute seule. Ce bouton sert aux deux
 * cas où elle n'a rien écrit : la mise en service un lundi après-midi, et la
 * semaine où elle est tombée. Réservé à la direction, et **sans écrasement** —
 * une ligne déjà écrite est laissée telle quelle, parce que les « déjà vu »
 * sont clés par semaine et que remplacer en silence un texte que quelqu'un
 * vient de lire serait pire qu'un instantané un peu vieux.
 */
export async function computeWeeklyAdviceNow(): Promise<{ ok: boolean; message: string }> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "super_admin") {
    return { ok: false, message: "Action réservée à la direction." };
  }

  const admin = createSupabaseAdminClient();
  let scan;
  try {
    scan = await scanWeeklyAdvice(admin);
  } catch (error) {
    console.error("[conseils hebdo] calcul impossible", error);
    return { ok: false, message: "Calcul impossible : une lecture a échoué. Réessayez dans un instant." };
  }

  const row = {
    iso_year: scan.isoYear,
    iso_week: scan.isoWeek,
    week_start: scan.weekStart,
    audience: WEEKLY_ADVICE_AUDIENCE,
    opens_at: scan.opensAt,
    window_since: scan.windowSince,
    score: scan.advice.score,
    target: scan.advice.target,
    advices: scan.advice.advices,
    sample: scan.advice.sample,
  };

  const { data: written, error } = await admin
    .from("weekly_advice")
    .upsert([row], { onConflict: "iso_year,iso_week,audience", ignoreDuplicates: true })
    .select("iso_week");

  if (error) {
    console.error("[conseils hebdo] écriture impossible", error.message);
    return { ok: false, message: `Écriture impossible : ${error.message}` };
  }

  revalidatePath("/");
  revalidatePath("/indicateurs");
  return (written ?? []).length === 0
    ? { ok: true, message: "Les conseils de cette semaine étaient déjà calculés." }
    : { ok: true, message: "Conseils calculés. La fenêtre s'ouvrira au prochain écran chargé." };
}
