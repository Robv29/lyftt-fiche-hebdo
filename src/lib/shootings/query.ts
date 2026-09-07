import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SHOOTING_LINE_KEYS,
  parseShootingPlan,
  shootingPlanSummary,
  shootingSchedule,
  type ShootingPlan,
} from "@/lib/domain/budget";
import { todayInParis } from "@/lib/domain/client-lifecycle";

/**
 * Lecture des shootings, pour le tableau de bord comme pour l'onglet.
 *
 * Ce module existe pour qu'il n'y ait qu'une seule façon de savoir quand un
 * shooting a eu lieu et quand le prochain est dû. Le tableau de bord portait
 * ce calcul en propre ; le recopier dans le nouvel onglet aurait donné deux
 * réponses au même client dès la première divergence.
 *
 * **La date d'un shooting reste la ligne de budget.** Elle n'est pas recopiée
 * ici : `client_budget_lines.performed_on` est la date, et rien d'autre ne
 * peut la contredire. Ce qu'une date ne sait pas dire — le type, le lieu, le
 * responsable, la durée — vit dans la table `shootings`, greffée sur la ligne.
 *
 * Les dates vivent dans le budget, réservé à la direction par RLS : la lecture
 * passe donc par la clé service, toujours bornée aux clients que la personne
 * connectée a déjà le droit de voir.
 */

export interface ShootingClient {
  id: string;
  name: string;
  notes: string | null;
  contract_start_date: string | null;
  client_contacts?: { first_name: string | null; is_primary: boolean }[] | null;
}

/** Un shooting inscrit : une date, et ce qu'on en sait. */
export interface ShootingEntry {
  /** Identifiant de la ligne de budget : c'est elle, le shooting. */
  lineId: string;
  clientId: string;
  clientName: string;
  /** Date du shooting. Passée = réalisé, à venir = calé. */
  date: string;
  /** Prestation du catalogue, ou la trace d'une date calée. */
  serviceKey: string;
  label: string;
  /** Ce que la date ne dit pas, quand la fiche a été remplie. */
  details: ShootingDetails | null;
  /** État déduit du temps, sauf annulation, qui est un fait à consigner. */
  status: "realise" | "cale" | "annule";
}

export interface ShootingDetails {
  name: string | null;
  kind: "photo" | "video" | "photo_video" | null;
  place: string | null;
  leadName: string | null;
  durationMinutes: number | null;
  deliveryDays: number | null;
  deliveredOn: string | null;
  assetsCount: number | null;
  cancelled: boolean;
}

/** Client dont le forfait attend une date. */
export interface ShootingDue {
  clientId: string;
  clientName: string;
  contactFirstName: string | null;
  planLabel: string;
  dueOn: string;
  overdue: boolean;
  plannedOn: string | null;
  reminderSentOn: string | null;
}

function settingsOf(notes: string | null): Record<string, unknown> {
  try {
    return typeof notes === "string" ? (JSON.parse(notes) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Tout ce qu'il faut savoir des shootings d'un ensemble de clients.
 *
 * Un seul aller-retour pour les dates et un pour les fiches : appelé par le
 * tableau de bord à chaque affichage, ce chemin doit rester court.
 */
export async function readShootings(
  clients: readonly ShootingClient[],
  today: string = todayInParis(),
): Promise<{ entries: ShootingEntry[]; due: ShootingDue[] }> {
  const withPlan = clients
    .map((client) => ({ client, plan: parseShootingPlan(settingsOf(client.notes).shootingPlan) }))
    .filter((entry): entry is { client: ShootingClient; plan: ShootingPlan } => Boolean(entry.plan));

  if (clients.length === 0) return { entries: [], due: [] };

  const admin = createSupabaseAdminClient();
  const ids = clients.map((client) => client.id);

  const [{ data: lines }, { data: sheets }] = await Promise.all([
    admin
      .from("client_budget_lines")
      .select("id, client_id, performed_on, service_key, label")
      .in("service_key", SHOOTING_LINE_KEYS)
      .in("client_id", ids),
    admin
      .from("shootings")
      .select("budget_line_id, name, kind, place, lead_name, duration_minutes, delivery_days, delivered_on, assets_count, cancelled")
      .in("client_id", ids),
  ]);

  const detailsByLine = new Map<string, ShootingDetails>();
  for (const row of sheets ?? []) {
    detailsByLine.set(row.budget_line_id as string, {
      name: (row.name as string | null) ?? null,
      kind: (row.kind as ShootingDetails["kind"]) ?? null,
      place: (row.place as string | null) ?? null,
      leadName: (row.lead_name as string | null) ?? null,
      durationMinutes: (row.duration_minutes as number | null) ?? null,
      deliveryDays: (row.delivery_days as number | null) ?? null,
      deliveredOn: (row.delivered_on as string | null) ?? null,
      assetsCount: (row.assets_count as number | null) ?? null,
      cancelled: Boolean(row.cancelled),
    });
  }

  const nameById = new Map(clients.map((client) => [client.id, client.name]));
  const entries: ShootingEntry[] = (lines ?? []).map((row) => {
    const details = detailsByLine.get(row.id as string) ?? null;
    const date = row.performed_on as string;
    return {
      lineId: row.id as string,
      clientId: row.client_id as string,
      clientName: nameById.get(row.client_id as string) ?? "Client",
      date,
      serviceKey: row.service_key as string,
      label: (row.label as string | null) ?? "Shooting",
      details,
      /*
       * Le statut se déduit du temps — c'est ce que fait déjà le tableau de
       * bord. Seule l'annulation ne se déduit pas : elle est consignée.
       */
      status: (details?.cancelled ? "annule" : date <= today ? "realise" : "cale") as ShootingEntry["status"],
    };
  }).sort((first, second) => second.date.localeCompare(first.date));

  const datesByClient = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.status === "annule") continue;
    const list = datesByClient.get(entry.clientId) ?? [];
    list.push(entry.date);
    datesByClient.set(entry.clientId, list);
  }

  const due: ShootingDue[] = withPlan.flatMap(({ client, plan }) => {
    const dates = (datesByClient.get(client.id) ?? []).sort();
    // Un shooting à venir est une date calée ; le dernier passé sert d'ancre.
    const lastDoneOn = [...dates].reverse().find((date) => date <= today) ?? null;
    const plannedOn = dates.find((date) => date > today) ?? null;
    const schedule = shootingSchedule({
      plan,
      lastDoneOn,
      contractStartDate: client.contract_start_date,
      today,
    });
    if (!schedule) return [];
    if (!schedule.remindNow && !plannedOn) return [];

    const contacts = client.client_contacts ?? [];
    const contact = contacts.find((row) => row.is_primary) ?? contacts[0];
    const reminderSentOn = settingsOf(client.notes).shootingReminderOn;
    return [{
      clientId: client.id,
      clientName: client.name,
      contactFirstName: contact?.first_name ?? null,
      planLabel: shootingPlanSummary(plan),
      dueOn: schedule.dueOn,
      overdue: schedule.overdue,
      plannedOn,
      reminderSentOn: typeof reminderSentOn === "string" ? reminderSentOn : null,
    }];
  }).sort((first, second) => first.dueOn.localeCompare(second.dueOn));

  return { entries, due };
}

/** Clients visibles par la personne connectée, sous RLS. */
export async function accessibleShootingClients(
  supabase: SupabaseClient,
): Promise<ShootingClient[]> {
  const { data } = await supabase
    .from("clients")
    .select("id, name, notes, contract_start_date, client_contacts ( first_name, is_primary )")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as unknown as ShootingClient[];
}
