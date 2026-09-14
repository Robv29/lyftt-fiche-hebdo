"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import {
  SHOOTING_FORFAIT_KEY,
  SHOOTING_LINE_KEYS,
  parseShootingPlan,
  shootingCycle,
  shootingForfaitLineRow,
  type ShootingPlan,
} from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";

export interface ShootingActionResult {
  ok: boolean;
  message?: string;
}

const EDITORIAL_ROLES = ["super_admin", "production_manager", "community_manager"];

/**
 * Planification des shootings du forfait.
 *
 * Caler une date est un acte de production, pas de direction : le community
 * manager qui parle au client doit pouvoir l'inscrire. Le budget, lui, reste
 * réservé à la direction par RLS — d'où l'écriture par la clé service, après
 * avoir vérifié que le client est bien dans le périmètre de la personne.
 */
async function requireClientAccess(clientId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !EDITORIAL_ROLES.includes(profile.role)) return null;

  const scoped = await createSupabaseServerClient();
  const { data: client } = await scoped
    .from("clients")
    .select("id, notes, contract_start_date")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  return {
    profile,
    client: {
      id: client.id as string,
      notes: (client.notes as string | null) ?? null,
      contractStartDate: (client.contract_start_date as string | null) ?? null,
    },
  };
}

/*
 * L'écran a pu vieillir — un shooting passé depuis, un collègue qui a déplacé
 * la date. L'action ne touche qu'à la date que la personne avait sous les yeux.
 */
const STALE_MESSAGE = "La date a changé depuis l'affichage de la page : rechargez-la avant de recommencer.";

const scheduleSchema = z.object({
  clientId: z.string().uuid(),
  /* Date calée affichée au moment du clic ; vide quand rien n'était calé. */
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  shootingOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  note: z.string().trim().max(300, "Précision trop longue (300 caractères maximum).").optional(),
});

/**
 * Date de shooting convenue avec le client.
 *
 * La date est inscrite comme une ligne du budget, à zéro euro : le forfait est
 * déjà payé mois par mois dans la gestion, le compter une seconde fois à sa
 * réalisation doublerait la facture. La ligne sert d'ancre — c'est d'elle que
 * se déduit l'échéance suivante — et de trace de ce qui a réellement été tourné.
 */
export async function scheduleShooting(formData: FormData): Promise<ShootingActionResult> {
  const parsed = scheduleSchema.safeParse({
    clientId: formData.get("clientId"),
    expectedOn: formData.get("expectedOn") ?? "",
    shootingOn: formData.get("shootingOn"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const access = await requireClientAccess(parsed.data.clientId);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const plan = parseShootingPlan(readSettings(access.client.notes as string | null).shootingPlan);
  if (!plan) {
    return { ok: false, message: "Aucun shooting n'est vendu dans la formule de ce client." };
  }

  const admin = createSupabaseAdminClient();

  /*
   * Une date déjà calée est déplacée, jamais doublée : deux lignes pour le
   * même shooting laisseraient l'écran choisir laquelle montrer.
   *
   * Seule celle du cycle en cours se déplace. Les suivantes ont pu être calées
   * d'avance à la création du client : effacer toutes les dates à venir, comme
   * on le faisait, détruisait ce calendrier au premier report.
   */
  const cycle = await currentCycle(admin, access.client, plan);
  if (cycle.error) return { ok: false, message: `Date non enregistrée : ${cycle.error}` };
  if ((cycle.plannedOn ?? "") !== parsed.data.expectedOn) return { ok: false, message: STALE_MESSAGE };

  const target = parsed.data.shootingOn;
  if (cycle.planned && cycle.planned.serviceKey !== SHOOTING_FORFAIT_KEY) {
    return { ok: false, message: "Ce shooting a été inscrit depuis le budget du client : c'est là qu'il se modifie." };
  }
  if (target !== cycle.plannedOn && cycle.dates.includes(target)) {
    return { ok: false, message: "Un shooting est déjà inscrit ce jour-là." };
  }
  // Dépasser la date suivante intervertirait deux shootings sans que personne ne le voie.
  if (cycle.followingOn && target >= cycle.followingOn) {
    return {
      ok: false,
      message: `Le shooting suivant est déjà calé le ${formatDay(cycle.followingOn)} : choisissez une date antérieure.`,
    };
  }

  const note = parsed.data.note ? sanitizeText(parsed.data.note, 300) : null;
  const { error } = cycle.planned
    ? await admin
        .from("client_budget_lines")
        .update({ performed_on: target, ...(note ? { note } : {}) })
        .eq("id", cycle.planned.id)
    : await admin.from("client_budget_lines").insert(shootingForfaitLineRow({
        clientId: parsed.data.clientId,
        plan,
        performedOn: target,
        note: note ?? "Date calée avec le client. Prestation déjà lissée sur la gestion mensuelle.",
        createdBy: access.profile.id,
      }));
  if (error) return { ok: false, message: `Date non enregistrée : ${error.message}` };

  // Le rappel n'a plus lieu d'être : la date est prise.
  await writeSettings(admin, parsed.data.clientId, access.client.notes as string | null, {
    shootingReminderOn: null,
  });

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: `Shooting calé au ${parsed.data.shootingOn}.` };
}

/**
 * Trace du message envoyé au client.
 *
 * Sans elle, personne ne sait si le client a déjà été sollicité : le bouton
 * proposerait indéfiniment le même premier message, et deux personnes de
 * l'équipe pourraient relancer le même jour.
 */
export async function markShootingReminder(clientId: string): Promise<ShootingActionResult> {
  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };

  const access = await requireClientAccess(parsed.data);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();
  const error = await writeSettings(admin, parsed.data, access.client.notes as string | null, {
    shootingReminderOn: todayInParis(),
  });
  if (error) return { ok: false, message: `Suivi non enregistré : ${error}` };

  revalidatePath("/");
  return { ok: true, message: "Message noté comme envoyé." };
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Date calée du cycle en cours, telle que le tableau de bord la montre.
 *
 * Même lecture que `readShootings` : toutes les lignes de shooting, les
 * annulées écartées, puis `shootingCycle`. « Modifier » et « Annuler » doivent
 * agir sur la date affichée, pas sur la plus proche venue.
 *
 * Une erreur de lecture est remontée plutôt que lue comme « aucune date » :
 * on inscrirait sinon un doublon de la date existante.
 */
async function currentCycle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  client: { id: string; contractStartDate: string | null },
  plan: ShootingPlan | null,
): Promise<{
  error: string | null;
  planned: { id: string; serviceKey: string } | null;
  plannedOn: string | null;
  followingOn: string | null;
  dates: string[];
}> {
  const [lines, cancelled] = await Promise.all([
    admin
      .from("client_budget_lines")
      .select("id, service_key, performed_on")
      .eq("client_id", client.id)
      .in("service_key", SHOOTING_LINE_KEYS),
    admin
      .from("shootings")
      .select("budget_line_id")
      .eq("client_id", client.id)
      .eq("cancelled", true),
  ]);
  const error = lines.error?.message ?? cancelled.error?.message ?? null;
  if (error) return { error, planned: null, plannedOn: null, followingOn: null, dates: [] };

  const skipped = new Set((cancelled.data ?? []).map((row) => row.budget_line_id as string));
  const active = (lines.data ?? []).filter((row) => !skipped.has(row.id as string));
  const dates = active.map((row) => row.performed_on as string);
  const cycle = shootingCycle({
    plan,
    dates,
    contractStartDate: client.contractStartDate,
    today: todayInParis(),
  });

  // Deux lignes le même jour : c'est la date du forfait qui se déplace.
  const sameDay = cycle.plannedOn
    ? active.filter((row) => row.performed_on === cycle.plannedOn)
    : [];
  const chosen = sameDay.find((row) => row.service_key === SHOOTING_FORFAIT_KEY) ?? sameDay[0] ?? null;
  return {
    error: null,
    planned: chosen ? { id: chosen.id as string, serviceKey: chosen.service_key as string } : null,
    plannedOn: cycle.plannedOn,
    followingOn: cycle.followingOn,
    dates,
  };
}

function readSettings(notes: string | null): Record<string, unknown> {
  try {
    const parsed = typeof notes === "string" ? JSON.parse(notes) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Écriture d'un réglage sans écraser les autres.
 *
 * Les réglages du client tiennent dans un seul texte JSON : y écrire suppose de
 * relire ce qui s'y trouve déjà, sans quoi une date de shooting effacerait les
 * hashtags et le rythme vendu.
 */
async function writeSettings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  notes: string | null,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const settings = { ...readSettings(notes), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete settings[key];
  }
  const { error } = await admin
    .from("clients")
    .update({ notes: JSON.stringify(settings) })
    .eq("id", clientId);
  return error?.message ?? null;
}

/**
 * Retrait d'une date calée.
 *
 * Un rendez-vous se décale ou s'annule : la date inscrite n'est pas une
 * décision définitive. La retirer rouvre le rappel, et l'échéance se recalcule
 * depuis le dernier shooting réellement réalisé.
 */
export async function cancelShooting(
  clientId: string,
  /** Date calée affichée au moment du clic. */
  expectedOn: string | null,
): Promise<ShootingActionResult> {
  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };
  if (expectedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expectedOn)) {
    return { ok: false, message: "Date invalide." };
  }

  const access = await requireClientAccess(parsed.data);
  if (!access) return { ok: false, message: "Client introuvable ou accès refusé." };

  const admin = createSupabaseAdminClient();
  const plan = parseShootingPlan(readSettings(access.client.notes).shootingPlan);
  // Seule une date à venir s'annule : un shooting déjà réalisé est un fait.
  // Et seulement celle du cycle en cours : les suivantes, calées d'avance, restent.
  const cycle = await currentCycle(admin, access.client, plan);
  if (cycle.error) return { ok: false, message: `Annulation impossible : ${cycle.error}` };
  if (cycle.plannedOn !== expectedOn) return { ok: false, message: STALE_MESSAGE };
  if (!cycle.planned) {
    return { ok: false, message: "Aucune date à venir à annuler pour ce client." };
  }
  if (cycle.planned.serviceKey !== SHOOTING_FORFAIT_KEY) {
    return { ok: false, message: "Ce shooting a été inscrit depuis le budget du client : c'est là qu'il s'annule." };
  }

  const { error } = await admin
    .from("client_budget_lines")
    .delete()
    .eq("id", cycle.planned.id);
  if (error) return { ok: false, message: `Annulation impossible : ${error.message}` };

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data}`);
  return { ok: true, message: "Date annulée. Le rappel est rouvert." };
}
