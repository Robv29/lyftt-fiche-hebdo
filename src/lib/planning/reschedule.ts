import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientFormula } from "@/lib/domain/client-formula";
import { draftReconciliation, rescheduleItems } from "@/lib/domain/planning";
import type { MediaFormat } from "@/lib/domain/types";
import { weekExpectation, type WeekExpectation, type WeekExpectationRow } from "@/lib/domain/week-expectation";

/** Formats que la semaine attend : rien en semaine creuse ni hors gestion. */
function expectedFormats(expectation: WeekExpectation): MediaFormat[] {
  return expectation.kind === "publish" ? expectation.formats : [];
}

/**
 * Recale les brouillons d'un client sur ses jours de publication.
 *
 * Appelé après une modification de la fiche client : les dates sont posées à la
 * création d'une fiche, et changer les jours laissait les fiches déjà créées sur
 * l'ancien rythme.
 *
 * **Brouillons seulement.** Une fiche envoyée porte des dates que le client a
 * vues ; une fiche validée porte des dates qu'il a approuvées ; une publication
 * sortie ne se replanifie pas. Déplacer l'une des trois reviendrait à réécrire
 * un engagement sans le dire.
 *
 * Renvoie ce qui a bougé, pour que l'appelant puisse le dire — et aussi ce qui
 * n'a **pas** bougé : les semaines déjà parties chez le client gardent leur
 * compte, et le taire donnait l'impression que changer le rythme ne servait à
 * rien. Même chose pour un brouillon posé sur une semaine creuse du rythme
 * (`offWeekDrafts`) : il est laissé tel quel, et c'est à l'utilisateur de le
 * supprimer si rien ne doit sortir.
 *
 * Ce que chaque semaine attend vient de `weekExpectation`, la règle du
 * planning et de la création de fiche. Un brouillon posé sur une semaine hors
 * gestion (`offContractDrafts`) — après la fin du contrat, jugée sur les jours
 * de publication, avant son début ou pendant une pause — n'est donc ni
 * complété ni vidé : le compléter d'après le rythme réclamait une publication
 * que le contrat ne couvre plus.
 *
 * @param client la ligne du client **telle qu'enregistrée** : jours de
 * publication et rythme sont lus dans ses réglages, les bornes du contrat et
 * de la pause dans ses colonnes.
 */
export async function rescheduleClientDrafts(
  supabase: SupabaseClient,
  client: WeekExpectationRow & { id: string },
): Promise<{ moved: number; added: number; removed: number; keptFilled: number; lockedWeeks: number[]; offWeekDrafts: number[]; offContractDrafts: number[] }> {
  const nothing = { moved: 0, added: 0, removed: 0, keptFilled: 0, lockedWeeks: [] as number[], offWeekDrafts: [] as number[], offContractDrafts: [] as number[] };
  const clientId = client.id;
  const weekdays = clientFormula(client).publicationWeekdays;
  if (weekdays.length === 0) return nothing;

  /*
   * Semaines passées exclues, comme pour `frozenWeeksOffCadence` : une semaine
   * publiée ne se rattrape pas, et y ajouter ou retirer des contenus
   * réécrirait l'historique sans rien changer à ce qui est sorti.
   */
  const today = new Date().toISOString().slice(0, 10);
  const { data: sheets, error } = await supabase
    .from("weekly_sheets")
    .select("id, iso_week, period_start, weekly_sheet_items ( id, format, caption, hashtags, media_asset_id, media_external_url, position, scheduled_date, created_at, is_cancelled )")
    .eq("client_id", clientId)
    .eq("status", "draft")
    .gte("period_end", today);

  if (error) {
    console.error("[replanification] lecture impossible", error.message);
    return nothing;
  }

  let moved = 0;
  let added = 0;
  let removed = 0;
  let keptFilled = 0;
  const offWeekDrafts: number[] = [];
  const offContractDrafts: number[] = [];
  const lockedWeeks = await frozenWeeksOffCadence(supabase, client, today);

  for (const sheet of sheets ?? []) {
    const raw = (sheet.weekly_sheet_items ?? []) as unknown as {
      id: string; format: MediaFormat; caption: string; hashtags: string[] | null;
      media_asset_id: string | null; media_external_url: string | null; position: number;
      scheduled_date: string; created_at: string; is_cancelled: boolean;
    }[];

    /*
     * Nombre de contenus : il suit le rythme vendu, comme à la création.
     * Sans cela, vendre deux vidéos de plus laissait la fiche à l'ancien
     * compte.
     */
    const active = raw.filter((item) => !item.is_cancelled);
    const expectation = weekExpectation(client, sheet.period_start as string);
    /*
     * Semaine hors gestion : rien n'est ajouté ni retiré, pour la même raison
     * qu'en semaine creuse — seul un humain sait si ce brouillon doit sortir.
     * On le signale, et les dates sont recalées comme ailleurs.
     */
    if (expectation.kind === "off_contract") offContractDrafts.push(sheet.iso_week as number);
    const reconciliation = expectation.kind === "off_contract"
      ? null
      : draftReconciliation(
        active.map((item) => ({
          id: item.id,
          format: item.format,
          // Un contenu porte du travail dès qu'il a du texte, des hashtags ou un média.
          filled: Boolean(item.caption?.trim())
            || (item.hashtags?.length ?? 0) > 0
            || Boolean(item.media_asset_id || item.media_external_url),
        })),
        expectedFormats(expectation),
      );

    /*
     * Semaine creuse du rythme : rien n'est ajouté ni retiré. Le brouillon a
     * été créé exprès — on publie quand même — ou par erreur ; seul un humain
     * peut trancher. On le signale, et les dates sont recalées comme ailleurs.
     */
    if (reconciliation?.kind === "off_week" && active.length > 0) {
      offWeekDrafts.push(sheet.iso_week as number);
    }

    if (reconciliation?.kind === "reconcile") {
      const { toAdd, toRemove, keptFilled: kept } = reconciliation;
      keptFilled += kept;

      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from("weekly_sheet_items")
          .delete()
          .in("id", toRemove);
        if (deleteError) console.error("[replanification] retrait impossible", deleteError.message);
        else removed += toRemove.length;
      }

      if (toAdd.length > 0) {
        const nextPosition = Math.max(0, ...active.map((item) => item.position)) + 1;
        const { error: insertError } = await supabase.from("weekly_sheet_items").insert(
          toAdd.map((format, index) => ({
            weekly_sheet_id: sheet.id as string,
            format,
            position: nextPosition + index,
            // Une date provisoire : le recalage ci-dessous la pose sur le bon jour.
            scheduled_date: sheet.period_start as string,
          })),
        );
        if (insertError) console.error("[replanification] ajout impossible", insertError.message);
        else added += toAdd.length;
      }
    }

    /* Relecture : les contenus viennent peut-être de changer. */
    const { data: refreshed } = await supabase
      .from("weekly_sheet_items")
      .select("id, scheduled_date, created_at, is_cancelled")
      .eq("weekly_sheet_id", sheet.id as string);

    const items = ((refreshed ?? raw) as unknown as {
      id: string; scheduled_date: string; created_at: string; is_cancelled: boolean;
    }[])
      // Un contenu annulé ne compte pas dans la répartition : le garder
      // décalerait tous les suivants d'un cran.
      .filter((item) => !item.is_cancelled)
      .map((item) => ({ id: item.id, scheduledDate: item.scheduled_date, createdAt: item.created_at }));

    const changes = rescheduleItems(
      items,
      weekdays,
      new Date(`${sheet.period_start as string}T00:00:00Z`),
    );

    for (const change of changes) {
      const { error: updateError } = await supabase
        .from("weekly_sheet_items")
        .update({ scheduled_date: change.scheduledDate })
        .eq("id", change.id);

      if (updateError) {
        console.error("[replanification] date non enregistrée", change.id, updateError.message);
        continue;
      }
      moved += 1;
    }
  }

  return {
    moved,
    added,
    removed,
    keptFilled,
    lockedWeeks,
    offWeekDrafts: offWeekDrafts.sort((a, b) => a - b),
    offContractDrafts: offContractDrafts.sort((a, b) => a - b),
  };
}

/**
 * Semaines qui devraient changer mais qu'on ne touche pas.
 *
 * Une fiche envoyée ou validée porte un compte que le client a vu. Le rythme
 * vendu peut avoir changé depuis : la fiche reste en l'état, et c'est voulu.
 * Encore faut-il le dire — sans quoi vendre deux vidéos de plus et voir la
 * semaine en cours inchangée ressemble à une panne.
 *
 * Seules les semaines encore à venir sont regardées : une semaine publiée ne
 * se rattrape pas. Une semaine creuse du rythme non plus : une fiche envoyée
 * cette semaine-là est un ajout voulu, pas un compte à corriger — la signaler
 * à chaque enregistrement ne serait que du bruit. Même chose hors gestion.
 */
async function frozenWeeksOffCadence(
  supabase: SupabaseClient,
  client: WeekExpectationRow & { id: string },
  today: string,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("weekly_sheets")
    .select("iso_week, period_start, period_end, weekly_sheet_items ( id, format, is_cancelled )")
    .eq("client_id", client.id)
    .neq("status", "draft")
    .gte("period_end", today);

  if (error) {
    console.error("[replanification] semaines figées illisibles", error.message);
    return [];
  }

  const weeks: number[] = [];
  for (const sheet of data ?? []) {
    const items = ((sheet.weekly_sheet_items ?? []) as unknown as {
      id: string; format: MediaFormat; is_cancelled: boolean;
    }[]).filter((item) => !item.is_cancelled);

    const reconciliation = draftReconciliation(
      // Tout est déclaré rempli : on ne cherche pas à retirer quoi que ce soit
      // ici, seulement à savoir si le compte diverge. Le surplus ressort donc
      // en « conservé » plutôt qu'en « à retirer ».
      items.map((item) => ({ id: item.id, format: item.format, filled: true })),
      expectedFormats(weekExpectation(client, sheet.period_start as string)),
    );
    if (reconciliation.kind !== "reconcile") continue;
    if (reconciliation.toAdd.length > 0 || reconciliation.keptFilled > 0) weeks.push(sheet.iso_week as number);
  }

  return weeks.sort((a, b) => a - b);
}
