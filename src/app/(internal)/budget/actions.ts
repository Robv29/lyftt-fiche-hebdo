"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";
import { checkAttachment, safeFileName } from "@/lib/security/attachments";
import { logRibAccess } from "@/lib/internal/rib-audit";
import { invoiceMonthFor } from "@/lib/domain/invoicing";
import { parseClientKind, todayInParis } from "@/lib/domain/client-lifecycle";
import { oneShotConversionCheck, type OneShotConversionCheck } from "@/lib/domain/one-shot-conversion";
import { clientFormula } from "@/lib/domain/client-formula";
import { syncManagementMonths } from "@/lib/budget/management-months";
import {
  findService,
  isCustomService,
  formatEuros,
  isShootingLine,
  parseShootingPlan,
  shootingLinePriceCents,
  MANAGEMENT_MONTH_KEY,
  SHOOTING_FORFAIT_KEY,
  billableLines,
  type BudgetLine,
} from "@/lib/domain/budget";

/**
 * Un mois pas encore commencé ne se facture pas.
 *
 * Marquer « faite » un mois à venir le verrouille : sa gestion mensuelle, qui
 * s'inscrit au début du mois, n'y serait alors jamais ajoutée.
 */
function futureMonthRefusal(periodMonth: string, status: string): string | null {
  if (status === "a_faire") return null;
  const currentMonth = `${todayInParis().slice(0, 7)}-01`;
  return periodMonth > currentMonth
    ? "Ce mois n'est pas encore commencé : sa facture ne peut pas être établie."
    : null;
}

export interface BudgetActionResult {
  ok: boolean;
  message?: string;
  /**
   * Passage en prestation ponctuelle en attente : nombre de mois de gestion
   * qui quitteraient l'addition, à faire confirmer avant de renvoyer.
   */
  confirmRemovedMonths?: number;
}

/*
 * Le budget est une donnée de direction. La vérification du rôle est doublée
 * par une politique RLS : ces actions passent par le client utilisateur, pas
 * par la clé service, pour que la base reste le dernier mot.
 */
async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "super_admin" ? profile : null;
}

const ACCESS_DENIED = "Écran réservé aux administrateurs.";

const settingsSchema = z.object({
  clientId: z.string().uuid(),
  billingMode: z.enum(["comptant", "financement", "hybride"]),
  // Saisi en euros, stocké en centimes.
  budgetEuros: z.coerce.number().min(0, "Le budget ne peut pas être négatif.").max(1_000_000),
  note: z.string().trim().max(500, "Note trop longue (500 caractères maximum).").optional(),
});

export async function saveBudgetSettings(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = settingsSchema.safeParse({
    clientId: formData.get("clientId"),
    billingMode: formData.get("billingMode"),
    budgetEuros: formData.get("budgetEuros") || 0,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_budgets").upsert({
    client_id: parsed.data.clientId,
    billing_mode: parsed.data.billingMode,
    budget_cents: Math.round(parsed.data.budgetEuros * 100),
    note: parsed.data.note ? sanitizeText(parsed.data.note, 500) : null,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: "Budget enregistré." };
}

const lineSchema = z.object({
  clientId: z.string().uuid(),
  serviceKey: z.string().min(1, "Choisissez une prestation."),
  quantity: z.coerce.number().positive("La quantité doit être supérieure à zéro.").max(999),
  months: z.coerce.number().int().positive().max(120).optional(),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  note: z.string().trim().max(300, "Note trop longue (300 caractères maximum).").optional(),
  billedDirectly: z.boolean(),
  /** Shooting compris dans le forfait, vendu en plus, ou sans objet. */
  forfaitIncluded: z.enum(["oui", "non"]).optional(),
  /*
   * Prestation libre : le libellé et le prix viennent de la saisie, non du
   * catalogue. Optionnels ici, exigés plus bas pour la seule ligne sur mesure —
   * les rendre obligatoires dans le schéma casserait toutes les autres.
   */
  customLabel: z.string().trim().max(120, "Description trop longue (120 caractères maximum).").optional(),
  customPriceEuros: z.coerce.number().min(0, "Le prix ne peut pas être négatif.").max(1_000_000).optional(),
  /*
   * Prestation ponctuelle d'un client enregistré à tort en gestion : cochée,
   * elle le fait passer en prestation ponctuelle.
   */
  withoutManagement: z.boolean(),
  /** Nombre de mois de gestion retirés, tel que la personne l'a confirmé. */
  confirmRemovedMonths: z.coerce.number().int().min(0).max(1_000).optional(),
});

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Ce que le passage en prestation ponctuelle retirerait, et s'il est permis. */
async function oneShotCheck(
  supabase: ServerSupabase,
  clientId: string,
  confirmedMonths: number | null,
): Promise<OneShotConversionCheck> {
  const [client, sheets, invoices, months] = await Promise.all([
    supabase.from("clients").select("client_kind, first_sheet_at").eq("id", clientId).maybeSingle(),
    supabase.from("weekly_sheets").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    supabase
      .from("client_invoices")
      .select("period_month", { count: "exact", head: true })
      .eq("client_id", clientId)
      .in("status", ["faite", "prelevement_programme"]),
    supabase
      .from("client_budget_lines")
      .select("unit_price_cents, quantity")
      .eq("client_id", clientId)
      .eq("service_key", MANAGEMENT_MONTH_KEY),
  ]);

  // Sans ces lectures, on ne sait pas ce qu'on retirerait : on ne touche à rien.
  if (client.error || sheets.error || sheets.count === null || invoices.error || invoices.count === null || months.error) {
    return { status: "refused", message: "Vérification impossible : le client reste en gestion. Réessayez." };
  }
  if (!client.data) return { status: "refused", message: "Client introuvable ou accès refusé." };

  const monthRows = months.data ?? [];
  return oneShotConversionCheck({
    kind: parseClientKind(client.data.client_kind),
    hadSheets: Boolean(client.data.first_sheet_at) || sheets.count > 0,
    issuedInvoices: invoices.count,
    managementMonths: monthRows.length,
    managementTotalCents: monthRows.reduce(
      (total, row) => total + Math.round((row.unit_price_cents as number) * Number(row.quantity ?? 1)),
      0,
    ),
    confirmedMonths,
  });
}

/**
 * Passage en prestation ponctuelle.
 *
 * Le type change, puis les mois de gestion sont réconciliés avec une formule
 * qui n'en doit plus aucun : ils quittent l'addition (un client déjà facturé
 * pour sa gestion n'arrive pas jusqu'ici).
 *
 * Les dates de gestion sont effacées. Laissées en place, elles referaient
 * inscrire tous les mois retirés au premier retour en gestion — facturant des
 * mois jamais produits.
 */
async function convertToOneShot(
  supabase: ServerSupabase,
  clientId: string,
): Promise<{ ok: true; removed: number } | { ok: false; message: string }> {
  const { data: rows, error } = await supabase
    .from("clients")
    .update({
      client_kind: "ponctuel",
      contract_start_date: null,
      contract_end_date: null,
      pause_start_date: null,
      pause_end_date: null,
    })
    .eq("id", clientId)
    .select("id, client_kind, notes, contract_start_date, contract_end_date, pause_start_date, pause_end_date");
  if (error) return { ok: false, message: error.message };
  const row = rows?.[0];
  if (!row) return { ok: false, message: "Client introuvable ou accès refusé." };

  const removed = await syncManagementMonths(supabase, { id: row.id as string, ...clientFormula(row) });
  return { ok: true, removed };
}

export async function addBudgetLine(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const rawMonths = formData.get("months");
  const parsed = lineSchema.safeParse({
    clientId: formData.get("clientId"),
    serviceKey: formData.get("serviceKey"),
    quantity: formData.get("quantity") || 1,
    months: rawMonths ? rawMonths : undefined,
    performedOn: formData.get("performedOn"),
    note: formData.get("note") ?? undefined,
    billedDirectly: formData.get("billedDirectly") === "on",
    forfaitIncluded: formData.get("forfaitIncluded") ?? undefined,
    customLabel: formData.get("customLabel") ?? undefined,
    customPriceEuros: formData.get("customPriceEuros") || undefined,
    withoutManagement: formData.get("withoutManagement") === "on",
    confirmRemovedMonths: formData.get("confirmRemovedMonths") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const service = findService(parsed.data.serviceKey);
  if (!service) return { ok: false, message: "Prestation inconnue." };

  /*
   * Prestation libre : description et prix sont saisis, et rien ne les
   * remplace. Une ligne sans description arriverait sur l'addition du client
   * sous le nom générique du catalogue, illisible dans six mois.
   */
  const custom = isCustomService(service.key);
  const customLabel = parsed.data.customLabel ? sanitizeText(parsed.data.customLabel, 120) : "";
  if (custom && !customLabel) {
    return { ok: false, message: "Décrivez la prestation sur mesure." };
  }
  if (custom && parsed.data.customPriceEuros === undefined) {
    return { ok: false, message: "Indiquez le prix de la prestation sur mesure." };
  }
  const customPriceCents = Math.round((parsed.data.customPriceEuros ?? 0) * 100);

  // Seule une prestation sur mesure ponctuelle ouvre ce choix à l'écran.
  if (parsed.data.withoutManagement && !custom) {
    return { ok: false, message: "Seule une prestation sur mesure peut passer un client en prestation ponctuelle." };
  }

  /*
   * Un shooting compris dans le forfait ne se facture pas une seconde fois :
   * il est déjà payé par le lissage mensuel de la gestion. La ligne existe
   * quand même, à zéro euro, pour dater le cycle.
   */
  const included = isShootingLine(service.key) && parsed.data.forfaitIncluded === "oui";
  const forfaitIncluded = isShootingLine(service.key) && parsed.data.forfaitIncluded
    ? included
    : null;

  const supabase = await createSupabaseServerClient();

  // Vérifié avant d'écrire : un refus ne doit pas laisser une ligne ajoutée à moitié du geste.
  if (parsed.data.withoutManagement) {
    const check = await oneShotCheck(supabase, parsed.data.clientId, parsed.data.confirmRemovedMonths ?? null);
    if (check.status === "refused") return { ok: false, message: check.message };
    // Des mois de gestion partiraient : rien n'est écrit tant que leur nombre exact n'est pas confirmé.
    if (check.status === "confirm") {
      return { ok: false, message: check.message, confirmRemovedMonths: check.months };
    }
  }

  const { error } = await supabase.from("client_budget_lines").insert({
    client_id: parsed.data.clientId,
    service_key: service.key,
    /*
     * Libellé et prix figés à l'ajout : une révision tarifaire ne doit pas
     * réécrire une addition déjà établie avec le client.
     */
    label: custom ? customLabel : service.label,
    billing: service.billing,
    unit_price_cents: custom ? customPriceCents : included ? 0 : service.unitPriceCents,
    quantity: parsed.data.quantity,
    forfait_included: forfaitIncluded,
    months: service.billing === "mensuel" ? parsed.data.months ?? 1 : null,
    performed_on: parsed.data.performedOn,
    note: parsed.data.note ? sanitizeText(parsed.data.note, 300) : null,
    billed_directly: parsed.data.billedDirectly,
    created_by: profile.id,
  });

  if (error) return { ok: false, message: `Ajout impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);

  let conversion = "";
  if (parsed.data.withoutManagement) {
    const converted = await convertToOneShot(supabase, parsed.data.clientId);
    if (!converted.ok) {
      return {
        ok: false,
        message: `${customLabel} a bien été ajouté, mais le client n'a pas pu passer en prestation ponctuelle : ${converted.message}`,
      };
    }
    conversion = converted.removed > 0
      ? ` Client passé en prestation ponctuelle : ${converted.removed} mois de gestion non facturé${converted.removed > 1 ? "s" : ""} retiré${converted.removed > 1 ? "s" : ""} de l’addition.`
      : " Client passé en prestation ponctuelle.";
    // Le type du client change la fiche, le planning, la carte et la facturation.
    revalidatePath("/budget/facturation");
    revalidatePath("/clients");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/fiches");
    revalidatePath("/implantations");
    revalidatePath("/");
  }

  return {
    ok: true,
    message: (included
      ? `${service.label} inscrit à 0 € : compris dans le forfait.`
      : parsed.data.billedDirectly
        ? `${custom ? customLabel : service.label} ajouté et à facturer au client.`
        : `${custom ? customLabel : service.label} ajouté à l’enveloppe.`) + conversion,
  };
}

export async function removeBudgetLine(lineId: string, clientId: string): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const ids = z.object({ lineId: z.string().uuid(), clientId: z.string().uuid() })
    .safeParse({ lineId, clientId });
  if (!ids.success) return { ok: false, message: "Ligne invalide." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("client_budget_lines")
    .delete()
    .eq("id", ids.data.lineId)
    .eq("client_id", ids.data.clientId);

  if (error) return { ok: false, message: `Suppression impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${ids.data.clientId}`);
  return { ok: true, message: "Prestation retirée." };
}

const invoiceSchema = z.object({
  clientId: z.string().uuid(),
  // Premier jour du mois facturé.
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, "Mois invalide."),
  status: z.enum(["a_faire", "faite", "prelevement_programme"]),
});

/**
 * Avancement d'un dossier de facturation.
 *
 * Les horodatages ne sont posés qu'au franchissement, et conservés en cas de
 * retour en arrière : savoir quand une facture a été établie reste utile même
 * si son état est corrigé ensuite.
 */
export async function setInvoiceStatus(
  clientId: string,
  periodMonth: string,
  status: string,
): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = invoiceSchema.safeParse({ clientId, periodMonth, status });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }
  const refusal = futureMonthRefusal(parsed.data.periodMonth, parsed.data.status);
  if (refusal) return { ok: false, message: refusal };

  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_invoices").upsert({
    client_id: parsed.data.clientId,
    period_month: parsed.data.periodMonth,
    status: parsed.data.status,
    invoiced_at: parsed.data.status === "faite" ? now : undefined,
    scheduled_at: parsed.data.status === "prelevement_programme" ? now : undefined,
    updated_at: now,
    updated_by: profile.id,
  }, { onConflict: "client_id,period_month" });

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return { ok: true, message: "Facturation mise à jour." };
}

const bulkSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, "Mois invalide."),
  status: z.enum(["a_faire", "faite", "prelevement_programme"]),
  clientIds: z.array(z.string().uuid()).min(1, "Aucun client à traiter."),
});

/**
 * Avancement groupé d'un mois entier de facturation.
 *
 * Établir trente factures se fait d'une traite, pas client par client : le
 * mois se marque en un geste, et chaque dossier reste corrigeable ensuite
 * depuis la fiche du client.
 */
export async function setMonthInvoiceStatus(
  periodMonth: string,
  status: string,
  clientIds: string[],
): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = bulkSchema.safeParse({ periodMonth, status, clientIds });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }
  const refusal = futureMonthRefusal(parsed.data.periodMonth, parsed.data.status);
  if (refusal) return { ok: false, message: refusal };

  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_invoices").upsert(
    parsed.data.clientIds.map((clientId) => ({
      client_id: clientId,
      period_month: parsed.data.periodMonth,
      status: parsed.data.status,
      invoiced_at: parsed.data.status === "faite" ? now : undefined,
      scheduled_at: parsed.data.status === "prelevement_programme" ? now : undefined,
      updated_at: now,
      updated_by: profile.id,
    })),
    { onConflict: "client_id,period_month" },
  );

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath("/budget/facturation");
  return {
    ok: true,
    message: `${parsed.data.clientIds.length} facture${parsed.data.clientIds.length > 1 ? "s" : ""} mise${parsed.data.clientIds.length > 1 ? "s" : ""} à jour.`,
  };
}

/**
 * Suppression d'une facture avant son établissement.
 *
 * Supprimer la facture, c'est supprimer ce qui la compose : les prestations
 * notées ce mois-là pour ce client. Sans cela le mois se reformerait au
 * prochain affichage, puisque le récapitulatif se déduit des prestations.
 *
 * L'opération n'est ouverte que tant que la facture reste à faire : une fois
 * établie, elle existe hors de l'application et ne peut plus être effacée
 * d'un clic.
 */
export async function deleteMonthInvoice(
  clientId: string,
  periodMonth: string,
): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = z.object({
    clientId: z.string().uuid(),
    periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, "Mois invalide."),
  }).safeParse({ clientId, periodMonth });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("status")
    .eq("client_id", parsed.data.clientId)
    .eq("period_month", parsed.data.periodMonth)
    .maybeSingle();

  if (invoice && invoice.status !== "a_faire") {
    return {
      ok: false,
      message: "Cette facture est déjà établie : elle ne peut plus être supprimée ici.",
    };
  }

  /*
   * On retire exactement ce que la facture contient — ni plus, ni moins.
   *
   * La suppression bornait sur `performed_on`, alors que la facture se compose
   * avec `invoiceMonthFor` : une prestation notée avant le début de gestion est
   * reportée sur le mois de démarrage. Les deux règles divergeaient dans les
   * deux sens. Une prestation reportée AILLEURS était effacée avec ce mois-ci
   * alors qu'elle n'y figurait pas ; une prestation reportée ICI y survivait,
   * et la facture « supprimée » se reformait à l'identique au rechargement.
   *
   * Une seule règle décide donc de la composition d'une facture, à l'écran
   * comme à la suppression.
   */
  const [{ data: candidates }, { data: client }, { data: invoices }, { data: budget }] = await Promise.all([
    supabase
      .from("client_budget_lines")
      .select("id, service_key, label, billing, unit_price_cents, quantity, months, performed_on, billed_directly")
      .eq("client_id", parsed.data.clientId)
      .not("service_key", "in", `(${MANAGEMENT_MONTH_KEY},${SHOOTING_FORFAIT_KEY})`),
    supabase
      .from("clients")
      .select("contract_start_date")
      .eq("id", parsed.data.clientId)
      .maybeSingle(),
    supabase
      .from("client_invoices")
      .select("period_month, status")
      .eq("client_id", parsed.data.clientId),
    supabase
      .from("client_budgets")
      .select("billing_mode")
      .eq("client_id", parsed.data.clientId)
      .maybeSingle(),
  ]);

  /*
   * Mois au format complet (« 2026-08-01 »), celui de `invoiceMonthFor` et de
   * l'écran de facturation. La comparaison se faisait avec « 2026-08 » et ne
   * correspondait jamais : rien n'était retiré, et la facture « supprimée » se
   * reformait au rechargement.
   */
  const statuses = Object.fromEntries(
    (invoices ?? []).map((row) => [
      String(row.period_month).slice(0, 10),
      row.status as "a_faire" | "faite" | "prelevement_programme",
    ]),
  );
  const mode = ((budget?.billing_mode as string | null) ?? "comptant") as Parameters<typeof billableLines>[1];

  const targets = (candidates ?? [])
    /*
     * Ce que l'écran montre sur la facture, et rien d'autre : en financement,
     * une prestation prise sur l'enveloppe n'y figure pas et ne doit pas
     * disparaître avec elle.
     */
    .filter((row) => billableLines([{
      id: row.id as string,
      serviceKey: row.service_key as string,
      label: row.label as string,
      billing: row.billing as BudgetLine["billing"],
      unitPriceCents: row.unit_price_cents as number,
      quantity: Number(row.quantity),
      months: row.months as number | null,
      performedOn: row.performed_on as string,
      billedDirectly: Boolean(row.billed_directly),
    }], mode).length > 0)
    .filter((row) => invoiceMonthFor(
      { performedOn: row.performed_on as string },
      (client?.contract_start_date as string | null) ?? null,
      statuses,
    ) === parsed.data.periodMonth)
    .map((row) => row.id as string);

  let count = 0;
  if (targets.length > 0) {
    const { error, count: removed } = await supabase
      .from("client_budget_lines")
      .delete({ count: "exact" })
      .in("id", targets);
    if (error) return { ok: false, message: `Suppression impossible : ${error.message}` };
    count = removed ?? 0;
  }

  await supabase
    .from("client_invoices")
    .delete()
    .eq("client_id", parsed.data.clientId)
    .eq("period_month", parsed.data.periodMonth);

  revalidatePath("/budget");
  revalidatePath("/budget/facturation");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return {
    ok: true,
    message: `Facture supprimée : ${count ?? 0} prestation${(count ?? 0) > 1 ? "s" : ""} retirée${(count ?? 0) > 1 ? "s" : ""}.`,
  };
}

/*
 * Dépôt du RIB.
 *
 * Le fichier va dans le bucket privé, hors de `media_assets` : ce n'est pas un
 * média de production, il ne suit ni le cycle de purge ni les partages avec le
 * client. Seul le chemin est conservé, et l'affichage passe par une URL signée.
 *
 * Les coordonnées bancaires ne se remplacent pas en silence : l'ancien fichier
 * est effacé une fois le nouveau écrit, jamais avant.
 */
const RIB_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

export async function uploadClientRib(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const clientId = z.string().uuid().safeParse(formData.get("clientId"));
  if (!clientId.success) return { ok: false, message: "Client invalide." };

  const file = formData.get("rib");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choisissez le fichier du RIB." };
  }
  if (!RIB_TYPES.includes(file.type)) {
    return { ok: false, message: "Le RIB doit être un PDF ou une photo (JPEG, PNG, WEBP, HEIC)." };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const check = checkAttachment({ size: file.size, type: file.type, name: file.name }, head);
  if (!check.valid) return { ok: false, message: check.message ?? "Fichier refusé." };

  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from("client_budgets")
    .select("rib_storage_path")
    .eq("client_id", clientId.data)
    .maybeSingle();

  const fileName = safeFileName(file.name);
  const storagePath = `clients/${clientId.data}/rib/${crypto.randomUUID()}-${fileName}`;
  const { error: storageError } = await admin.storage.from("media").upload(
    storagePath,
    await file.arrayBuffer(),
    { contentType: file.type, upsert: false },
  );
  if (storageError) return { ok: false, message: `Dépôt impossible : ${storageError.message}` };

  const { error } = await admin.from("client_budgets").upsert({
    client_id: clientId.data,
    rib_storage_path: storagePath,
    rib_file_name: fileName,
    rib_uploaded_at: new Date().toISOString(),
    rib_uploaded_by: profile.id,
  });
  if (error) {
    await admin.storage.from("media").remove([storagePath]);
    return { ok: false, message: `RIB non enregistré : ${error.message}` };
  }

  const previous = current?.rib_storage_path as string | null | undefined;
  if (previous && previous !== storagePath) {
    await admin.storage.from("media").remove([previous]);
  }

  await logRibAccess({
    clientId: clientId.data,
    eventType: previous ? "replaced" : "uploaded",
    profile,
    metadata: { fileName },
  });

  revalidatePath("/budget");
  revalidatePath(`/budget/${clientId.data}`);
  return { ok: true, message: "RIB déposé." };
}

export async function removeClientRib(clientId: string): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) return { ok: false, message: "Client invalide." };

  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from("client_budgets")
    .select("rib_storage_path")
    .eq("client_id", parsed.data)
    .maybeSingle();

  const { error } = await admin.from("client_budgets").update({
    rib_storage_path: null,
    rib_file_name: null,
    rib_uploaded_at: null,
    rib_uploaded_by: null,
  }).eq("client_id", parsed.data);
  if (error) return { ok: false, message: `Retrait impossible : ${error.message}` };

  const path = current?.rib_storage_path as string | null | undefined;
  if (path) await admin.storage.from("media").remove([path]);

  await logRibAccess({ clientId: parsed.data, eventType: "removed", profile });

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data}`);
  return { ok: true, message: "RIB retiré." };
}

const datesSchema = z.object({
  clientId: z.string().uuid(),
  contractStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/**
 * Dates de gestion, modifiables depuis l'écran budget.
 *
 * C'est là qu'on s'aperçoit qu'elles manquent — un consommé à zéro, aucune
 * facture mensuelle. Obliger à rouvrir la fiche client pour les saisir garantit
 * qu'on remet à plus tard.
 */
export async function saveContractDates(formData: FormData): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const read = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };

  const parsed = datesSchema.safeParse({
    clientId: formData.get("clientId"),
    contractStartDate: read("contractStartDate"),
    contractEndDate: read("contractEndDate"),
  });
  if (!parsed.success) return { ok: false, message: "Dates invalides." };

  if (parsed.data.contractStartDate && parsed.data.contractEndDate
    && parsed.data.contractEndDate < parsed.data.contractStartDate) {
    return { ok: false, message: "La fin de gestion précède son début." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update({
      contract_start_date: parsed.data.contractStartDate,
      contract_end_date: parsed.data.contractEndDate,
    })
    .eq("id", parsed.data.clientId);

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  revalidatePath("/clients");
  /*
   * Ces dates décident aussi de la présence du client sur la carte des
   * implantations : une gestion terminée l'en retire, une gestion à venir
   * l'en écarte encore.
   */
  revalidatePath("/implantations");
  return { ok: true, message: "Dates de gestion enregistrées." };
}

/*
 * Catégorisation des shootings.
 *
 * Un forfait donne droit à un shooting par période, déjà réglé par le lissage
 * mensuel. Le suivant, dans la même période, a été vendu en plus : il se
 * facture. Tant que personne n'a tranché, la ligne reste « à catégoriser » —
 * c'est le seul état qui garantit qu'un supplémentaire ne part pas gratuit.
 */
const shootingBillingSchema = z.object({
  lineId: z.string().uuid(),
  clientId: z.string().uuid(),
  included: z.boolean(),
});

export async function setShootingBilling(
  lineId: string,
  clientId: string,
  included: boolean,
): Promise<BudgetActionResult> {
  const profile = await requireAdmin();
  if (!profile) return { ok: false, message: ACCESS_DENIED };

  const parsed = shootingBillingSchema.safeParse({ lineId, clientId, included });
  if (!parsed.success) return { ok: false, message: "Demande invalide." };

  const supabase = await createSupabaseServerClient();
  const { data: line } = await supabase
    .from("client_budget_lines")
    .select("id, service_key, label")
    .eq("id", parsed.data.lineId)
    .eq("client_id", parsed.data.clientId)
    .maybeSingle();
  if (!line) return { ok: false, message: "Prestation introuvable ou accès refusé." };
  if (!isShootingLine(line.service_key as string)) {
    return { ok: false, message: "Cette prestation n'est pas un shooting." };
  }

  /*
   * Le prix suit la décision : compris dans le forfait, la ligne ne consomme
   * rien ; vendue en plus, elle reprend le tarif du catalogue. Sans cela, la
   * case cochée et le montant facturé pourraient se contredire.
   *
   * Le tarif ne se lit pas sur la clé de la ligne. Une date calée porte
   * `shooting_forfait`, qui n'est pas une prestation du catalogue : la chercher
   * renvoyait zéro, et requalifier le shooting en « vendu en plus » l'inscrivait
   * à 0 € — en affichant « 0 € à facturer », donc en offrant 225, 450 ou 850 €
   * selon le forfait. C'est celui du client qui donne le prix.
   */
  const { data: owner } = await supabase
    .from("clients")
    .select("notes")
    .eq("id", parsed.data.clientId)
    .maybeSingle();

  const catalogPrice = shootingLinePriceCents(
    line.service_key as string,
    parseShootingPlan(readShootingPlan(owner?.notes as string | null)),
  );

  /*
   * Sans tarif établi, on refuse : écrire zéro se lirait comme une décision
   * de ne rien facturer, alors que c'est une information manquante.
   */
  if (!parsed.data.included && (catalogPrice === null || catalogPrice <= 0)) {
    return {
      ok: false,
      message: "Tarif du shooting introuvable : renseignez le forfait shooting dans la fiche client.",
    };
  }
  const { error } = await supabase
    .from("client_budget_lines")
    .update({
      forfait_included: parsed.data.included,
      unit_price_cents: parsed.data.included ? 0 : catalogPrice!,
    })
    .eq("id", parsed.data.lineId);

  if (error) return { ok: false, message: `Enregistrement impossible : ${error.message}` };

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${parsed.data.clientId}`);
  return {
    ok: true,
    message: parsed.data.included
      ? "Shooting compris dans le forfait : inscrit à 0 €."
      : `Shooting supplémentaire : ${formatEuros(catalogPrice!)} à facturer.`,
  };
}


/** Forfait shooting brut, tel qu'il est rangé dans les réglages du client. */
function readShootingPlan(notes: string | null): unknown {
  try {
    const settings = typeof notes === "string" ? JSON.parse(notes) : {};
    return settings?.shootingPlan;
  } catch {
    return null;
  }
}
