import { NextResponse, type NextRequest } from "next/server";
import {
  ADVICE_OPEN_HOUR,
  ADVICE_OPEN_MINUTE,
  ADVICE_SCAN_HOUR,
  WEEKLY_ADVICE_AUDIENCE,
  isAdviceScanWindow,
} from "@/lib/domain/weekly-advice";
import { cronAuthorizationError } from "@/lib/internal/cron-auth";
import { scanWeeklyAdvice } from "@/lib/metrics/weekly-advice-scan";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Conseils de la semaine : le scan du lundi 10 h.
 *
 * Lit la production réelle, calcule pourquoi la note n'est pas au maximum, ce
 * que la semaine à venir réclame et ce qu'il faut changer aux textes, puis
 * écrit **une** ligne pour la semaine en cours — le diagnostic complet, celui
 * que toute l'équipe interne lit. La pop-up de 14 h 30 ne fait que lire cette
 * ligne.
 *
 * ## Pourquoi une tâche planifiée, et non un calcul à la première ouverture
 *
 * Trois raisons, la première décisive.
 *
 * 1. **Un calcul paresseux tournerait sous la RLS de celui qui ouvre.**
 *    `readAgencyMetrics` prend le client de l'appelant et tout le score est
 *    borné par `can_access_client` — un community manager ne voit déjà sur
 *    /indicateurs que ses propres clients. Calculer le diagnostic à sa première
 *    ouverture, c'était stocker *sa tranche* comme diagnostic de l'agence, et
 *    laisser le premier arrivé décider de ce que tout le monde lirait la
 *    semaine entière. Un diagnostic d'agence doit tourner avec la clé service,
 *    et une route gardée par `CRON_SECRET` est le seul endroit de cette
 *    application où c'est légitime sans contrôle d'accès.
 * 2. **Le coût n'a pas à tomber sur un rendu de page.** Le scan, c'est deux
 *    lectures complètes du score plus une dizaine de requêtes. Accroché à un
 *    rendu, il ferait payer plusieurs secondes à une personne au hasard le
 *    lundi matin, et deux ouvertures simultanées paieraient toutes les deux.
 *    Ici, un échec part dans les journaux Vercel : aucun écran n'est concerné,
 *    ce qui satisfait gratuitement « ne jamais bloquer un rendu ».
 * 3. C'est la forme que ce dépôt a déjà éprouvée deux fois — l'alerte du
 *    vendredi et les campagnes quotidiennes.
 *
 * ## L'heure
 *
 * Vercel déclenche ses tâches en **GET** et ses horaires sont en UTC, sans
 * heure d'été : 10 h à Paris vaut 8 h UTC en été et 9 h UTC en hiver. Deux
 * entrées quotidiennes distinctes dans `vercel.json`, et c'est
 * `isAdviceScanWindow` qui tranche — un horaire qui part deux fois par jour est
 * refusé au déploiement.
 *
 *   | déclenchement | été (CEST)            | hiver (CET)           |
 *   |---------------|-----------------------|-----------------------|
 *   | 8 h UTC       | 10 h Paris → agit     | 9 h Paris → hors créneau |
 *   | 9 h UTC       | 11 h Paris → sans effet (déjà calculé) | 10 h Paris → agit |
 *
 * Exactement 10 h à Paris dans les deux saisons, avec une heure de rattrapage
 * intégrée, et la ligne est toujours écrite avant 14 h 30.
 *
 * ## Les drapeaux
 *
 * `?apercu` calcule et rend le diagnostic sans rien écrire, n'importe quel jour
 * et à n'importe quelle heure : c'est ainsi qu'on relit les phrases avant que
 * l'équipe ne les voie. `?recalcul` refait et **remplace** la ligne de la
 * semaine — à n'utiliser que délibérément, voir plus bas.
 *
 * `?maintenant` écrit la ligne de la semaine en cours **hors créneau**, sans
 * rien remplacer. C'est le drapeau de la mise en service : la semaine a
 * commencé, 10 h est passé, et personne ne veut attendre le lundi suivant pour
 * voir si la pop-up s'ouvre. Il ne desserre que le garde horaire — l'unicité de
 * `(iso_year, iso_week, audience)` tient toujours, donc deux appels de suite
 * n'écrasent rien et le second répond « déjà calculé ». C'est ce qui le
 * distingue de `?recalcul` : on peut le rejouer sans risque pendant un essai,
 * quand on ne sait plus trop si le premier appel est parti.
 *
 * La pop-up, elle, n'a besoin d'aucun drapeau : son instant d'ouverture est le
 * lundi 14 h 30 de la semaine en cours. Écrite après cette heure, la ligne
 * s'ouvre au premier écran interne chargé, ce qui est exactement ce qu'on veut
 * d'un essai. Pour la revoir s'ouvrir d'elle-même, il faut retirer sa propre
 * ligne de `weekly_advice_views` — aucune route ne le fait, parce qu'une route
 * qui efface l'état de lecture des autres n'a pas sa place en production.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel déclenche ses tâches planifiées en GET : une route POST seule a déjà
// répondu 405 chaque nuit en silence (`purge-media`).
export const GET = handle;
export const POST = handle;

/** Valeurs acceptées pour un drapeau : le drapeau seul, ou `=oui`. */
const FLAG_VALUES = ["", "oui"] as const;

/**
 * Lecture d'un drapeau d'URL.
 *
 * Une valeur non reconnue est **refusée** plutôt qu'ignorée : `?apercu=1` qui
 * ne ferait rien et répondrait « calculé » laisserait croire qu'on a relu les
 * phrases alors qu'on vient de les publier.
 */
function flag(request: NextRequest, name: string): { on: boolean; error?: string } {
  const value = request.nextUrl.searchParams.get(name);
  if (value === null) return { on: false };
  if (!(FLAG_VALUES as readonly string[]).includes(value)) {
    return { on: false, error: `${name} s'utilise seul, ou avec la valeur « oui ».` };
  }
  return { on: true };
}

async function handle(request: NextRequest) {
  const denied = cronAuthorizationError(request);
  if (denied) return denied;

  const preview = flag(request, "apercu");
  const recompute = flag(request, "recalcul");
  const atOnce = flag(request, "maintenant");
  const invalid = preview.error ?? recompute.error ?? atOnce.error;
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const now = new Date();
  /*
   * Le garde répond à « cette exécution peut-elle agir ? », et il protège d'une
   * exécution *planifiée* à la mauvaise heure UTC. Les trois drapeaux s'en
   * affranchissent parce qu'aucun n'est une exécution planifiée : l'aperçu
   * n'écrit rien, le recalcul et la mise en service sont des décisions prises à
   * la main, et tous trois passent par le même secret.
   */
  if (!preview.on && !recompute.on && !atOnce.on && !isAdviceScanWindow(now)) {
    return NextResponse.json(
      {
        skipped: `Hors créneau : le diagnostic se calcule le lundi entre ${ADVICE_SCAN_HOUR} h et `
          + `${ADVICE_OPEN_HOUR} h ${ADVICE_OPEN_MINUTE}, heure de Paris.`,
        // Dit ici plutôt que dans une note ailleurs : c'est le moment où l'on
        // cherche pourquoi rien ne s'est passé.
        indice: "Ajoutez ?maintenant pour écrire quand même la semaine en cours, ou ?apercu pour relire sans écrire.",
      },
      { status: 200 },
    );
  }

  /*
   * Client à privilèges : une tâche planifiée n'a pas de session, `auth.uid()`
   * est nul, et toutes les politiques de lecture passent par
   * `can_access_client` — sous RLS, la lecture ne ramènerait aucune ligne et le
   * diagnostic conclurait que tout va bien. Le scan est en lecture seule.
   */
  const admin = createSupabaseAdminClient();

  let scan;
  try {
    scan = await scanWeeklyAdvice(admin, now);
  } catch (error) {
    /*
     * Une lecture partielle produirait un diagnostic faux — « rien à signaler »
     * un lundi où tout est en retard —, et il serait lu par toute l'équipe. On
     * préfère ne rien écrire : l'écran restera muet, ce qui est réparable.
     */
    const message = error instanceof Error ? error.message : String(error);
    console.error("[conseils hebdo] calcul impossible", message);
    return NextResponse.json({ error: `Calcul impossible : ${message}` }, { status: 500 });
  }

  const rendered = {
    semaine: `${scan.isoYear}-S${scan.isoWeek}`,
    lundi: scan.weekStart,
    ouverture: scan.opensAt,
    fenetre_depuis: scan.windowSince,
    note: scan.advice.score,
    objectif: scan.advice.target,
    rien_a_signaler: scan.advice.nothingToSay,
    conseils: scan.advice.advices,
    mesures: scan.advice.sample,
  };

  if (preview.on) return NextResponse.json({ apercu: true, ...rendered });

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
    computed_at: now.toISOString(),
  };

  /*
   * Réservation par l'unicité, et surtout : **pas d'écrasement**.
   *
   * `ignoreDuplicates` fait qu'une seconde exécution — l'autre heure UTC, un
   * rejeu, un appel à la main — n'obtient aucune ligne en retour et n'écrit
   * rien. C'est volontaire et non une précaution : les lignes « déjà vu » sont
   * clés par semaine, donc remplacer en silence un texte que quelqu'un vient de
   * lire serait pire qu'un instantané un peu vieux. Il n'y aurait d'ailleurs
   * aucun moyen de lui redire « ce n'est plus ce que tu as lu ».
   *
   * Contrairement à l'alerte du vendredi, la réservation vient **après** le
   * calcul : le calcul n'a aucun effet au dehors, donc réserver d'abord
   * n'achèterait rien et laisserait une ligne vide derrière une panne.
   */
  const { data: written, error } = recompute.on
    ? await admin.from("weekly_advice").upsert([row], { onConflict: "iso_year,iso_week,audience" }).select("iso_week")
    : await admin.from("weekly_advice")
        .upsert([row], { onConflict: "iso_year,iso_week,audience", ignoreDuplicates: true })
        .select("iso_week");

  if (error) {
    console.error("[conseils hebdo] écriture impossible", error.message);
    return NextResponse.json({ error: `Écriture impossible : ${error.message}` }, { status: 500 });
  }

  if ((written?.length ?? 0) === 0) {
    return NextResponse.json(
      { skipped: "Diagnostic déjà calculé cette semaine.", semaine: rendered.semaine },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ...rendered,
    ecrit: true,
    /*
     * Quand la pop-up s'ouvrira, dit dans la réponse.
     *
     * C'est la seule question de celui qui vient de lancer le scan à la main, et
     * la réponse n'est pas évidente : écrite avant 14 h 30, la ligne attend ;
     * écrite après, elle s'ouvre au premier écran chargé, parce que l'île
     * compare `Date.now()` à un instant déjà passé.
     */
    ouverture_note: new Date(scan.opensAt).getTime() <= now.getTime()
      ? "14 h 30 est passé : la pop-up s'ouvre au premier écran interne chargé, une fois par personne."
      : "La pop-up s'ouvrira d'elle-même à l'instant indiqué par « ouverture » (lundi 14 h 30, heure de Paris).",
    /*
     * Un recalcul ne réinitialise pas les « déjà vu » : celui qui a lu le
     * diagnostic de ce matin ne doit pas voir la pop-up se rouvrir parce qu'on
     * a corrigé une règle. Le nouveau texte attend simplement ceux qui n'ont pas
     * encore ouvert l'application.
     */
    ...(recompute.on ? { recalcul: "Texte remplacé ; les « déjà vu » sont conservés." } : {}),
  });
}
