import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adviceWeek,
  type ClientCount,
  type WeeklyAdviceEntry,
  type WeeklyAdviceItem,
  type WeeklyAdviceView,
} from "@/lib/domain/weekly-advice";

export type { WeeklyAdviceEntry, WeeklyAdviceView };

/**
 * Lecture des conseils de la semaine, pour celui qui regarde.
 *
 * Soumise à RLS, et c'est tout le point. La politique de `weekly_advice`
 * partage les lignes par audience : un `super_admin` en voit deux, un
 * responsable de production ou un community manager une seule, un commercial
 * aucune. Il n'y a donc **aucun contrôle de rôle à écrire ici** — la base
 * répond déjà ce que la personne a le droit de lire, et une seconde barrière
 * recopiée dans le code aurait fini par diverger de la première.
 *
 * Les noms de clients sont résolus ici, et nulle part ailleurs : la ligne en
 * base ne porte que des identifiants, parce qu'un community manager ne doit pas
 * apprendre les dossiers hors de son périmètre en lisant un diagnostic
 * d'agence. La résolution passe par la même RLS ; ce qu'elle ne rend pas se
 * replie sur « et n autres dossiers ».
 */

/** Une ligne de `weekly_advice`, telle que la requête la ramène. */
const ADVICE_FIELDS = "iso_year, iso_week, week_start, audience, opens_at, window_since, score, target, advices";

/**
 * Les conseils d'un conseil : objets, et rien de plus.
 *
 * Le contenu vient de notre propre tâche planifiée, mais il traverse une
 * colonne `jsonb` : une ligne écrite par une version antérieure du module de
 * règles ne doit pas casser l'écran. On garde ce qui a la forme attendue, on
 * jette le reste — un conseil manquant est un désagrément, un écran blanc est
 * une panne.
 */
function asAdviceItems(value: unknown): WeeklyAdviceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WeeklyAdviceItem =>
    Boolean(item)
    && typeof item === "object"
    && typeof (item as WeeklyAdviceItem).key === "string"
    && typeof (item as WeeklyAdviceItem).statement === "string"
    && typeof (item as WeeklyAdviceItem).action === "string");
}

function asClientCounts(value: unknown): ClientCount[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ClientCount =>
    Boolean(entry)
    && typeof entry === "object"
    && typeof (entry as ClientCount).clientId === "string"
    && typeof (entry as ClientCount).count === "number");
}

/**
 * Conseils de la semaine et état « déjà vu », pour la pop-up.
 *
 * Quand la personne a déjà vu les conseils, la lecture s'arrête là : la pop-up
 * ne s'ouvrira pas, et résoudre des noms pour un encart qui ne s'affichera pas
 * coûterait une requête sur chaque écran interne, quatre jours sur cinq.
 */
export async function readWeeklyAdviceForPopup(
  supabase: SupabaseClient,
  profileId: string,
  now: Date = new Date(),
): Promise<WeeklyAdviceView | null> {
  return read(supabase, profileId, now, { resolveNamesWhenSeen: false });
}

/**
 * Conseils de la semaine, complets — pour l'encart « Revoir » et l'onglet
 * Conseils, qui s'affichent qu'on les ait lus ou non.
 */
export async function readWeeklyAdvice(
  supabase: SupabaseClient,
  profileId: string,
  now: Date = new Date(),
): Promise<WeeklyAdviceView | null> {
  return read(supabase, profileId, now, { resolveNamesWhenSeen: true });
}

async function read(
  supabase: SupabaseClient,
  profileId: string,
  now: Date,
  options: { resolveNamesWhenSeen: boolean },
): Promise<WeeklyAdviceView | null> {
  const week = adviceWeek(now);

  const [adviceRead, viewRead] = await Promise.all([
    supabase
      .from("weekly_advice")
      .select(ADVICE_FIELDS)
      .eq("iso_year", week.isoYear)
      .eq("iso_week", week.isoWeek),
    supabase
      .from("weekly_advice_views")
      .select("seen_at")
      .eq("iso_year", week.isoYear)
      .eq("iso_week", week.isoWeek)
      .eq("profile_id", profileId)
      .maybeSingle(),
  ]);

  if (adviceRead.error) throw new Error(adviceRead.error.message);
  if (viewRead.error) throw new Error(viewRead.error.message);

  const rows = adviceRead.data ?? [];
  if (rows.length === 0) return null;

  /*
   * Un `super_admin` reçoit les deux lignes de la semaine : la sienne est celle
   * de la direction, qui porte deux conseils de plus. Les autres rôles n'en
   * reçoivent qu'une, et le choix ne se pose pas.
   */
  const row = rows.find((candidate) => candidate.audience === "direction") ?? rows[0];
  const seen = Boolean(viewRead.data);
  const items = asAdviceItems(row.advices);

  const view: WeeklyAdviceView = {
    isoYear: row.iso_year as number,
    isoWeek: row.iso_week as number,
    weekStart: row.week_start as string,
    opensAt: new Date(row.opens_at as string).toISOString(),
    windowSince: row.window_since as string,
    score: (row.score as number | null) ?? null,
    target: row.target as number,
    nothingToSay: items.length === 0,
    seen,
    advices: [],
  };

  if (seen && !options.resolveNamesWhenSeen) return view;

  const clientIds = [...new Set(items.flatMap((item) => asClientCounts(item.clients).map((entry) => entry.clientId)))];
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    // Soumise à RLS : un dossier hors périmètre ne revient tout simplement pas.
    const { data, error } = await supabase.from("clients").select("id, name").in("id", clientIds);
    if (error) throw new Error(error.message);
    for (const client of data ?? []) names.set(client.id as string, client.name as string);
  }

  view.advices = items.map((item) => {
    const counts = asClientCounts(item.clients);
    const resolved = counts.flatMap((entry) => {
      const label = names.get(entry.clientId);
      return label ? [{ label, count: entry.count }] : [];
    });
    /*
     * Les dossiers manquants se comptent sur le total annoncé par la règle, et
     * non sur la liste reçue : la règle n'en nomme que les premiers, et dire
     * « et 2 autres » quand il y en a onze serait faux.
     */
    const total = typeof item.clientCount === "number" ? item.clientCount : counts.length;
    return {
      key: item.key,
      statement: item.statement,
      action: item.action,
      gain: typeof item.gain === "number" ? item.gain : null,
      source: typeof item.source === "string" ? item.source : "",
      clients: resolved,
      hiddenClients: Math.max(0, total - resolved.length),
    };
  });

  return view;
}
