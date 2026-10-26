import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_FORMULA_COLUMNS } from "@/lib/domain/client-formula";
import { planningWeekRange } from "@/lib/domain/planning";
import { planningHrefForBucket } from "@/app/(internal)/fiches/planning-tab";
import {
  ALERT_HOUR,
  MISSING_REASON_LABELS,
  alertDate,
  isAlertWindow,
  missingWeeklySheets,
  type WeeklySheetAlertClient,
} from "@/lib/domain/weekly-sheet-alert";
import type { SheetStatus } from "@/lib/domain/types";
import { leadRecipients } from "@/lib/notifications/leads";
import {
  buildSheetSendAlertHtml,
  buildSheetSendAlertSubject,
  buildSheetSendAlertText,
} from "@/lib/notifications/sheet-send-alert";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/supabase/env";
import { cronAuthorizationError } from "@/lib/internal/cron-auth";

/**
 * Alerte du vendredi 16 h : les fiches de la semaine prochaine qui ne sont pas
 * marquées comme envoyées.
 *
 * La fiche se prépare le vendredi pour la semaine suivante et le client valide
 * avant le mardi 10 h : une fiche encore chez nous le vendredi à 16 h ne partira
 * plus avant lundi. Un seul e-mail à l'encadrement, avec les noms et le motif ;
 * rien du tout quand tout est parti.
 *
 * Vercel déclenche ses tâches planifiées en **GET** et ses horaires sont en UTC,
 * sans heure d'été : deux entrées distinctes, 14 h et 15 h UTC le vendredi —
 * 16 h à Paris, l'une en été, l'autre en hiver —, et c'est `isAlertWindow` qui
 * tranche. Deux entrées plutôt qu'un seul horaire à deux heures : l'offre Hobby
 * refuse au déploiement tout horaire qui part plus d'une fois par jour. L'heure
 * hors saison tombe à 15 h ou 17 h à Paris : dans le créneau pour la seconde,
 * elle sert alors de rattrapage. Un seul envoi malgré les deux déclenchements :
 * la ligne de trace est posée avant l'envoi et son unicité fait foi.
 *
 * `?apercu` liste ce qui manque et rend l'objet et le corps du message sans
 * rien écrire ni envoyer, n'importe quel jour de la semaine.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle;
export const POST = handle;

/** Valeurs acceptées pour l'aperçu : le drapeau seul, ou `?apercu=oui`. */
const PREVIEW_VALUES = ["", "oui"] as const;

async function handle(request: NextRequest) {
  const denied = cronAuthorizationError(request);
  if (denied) return denied;

  /*
   * Un aperçu mal nommé ne lancerait rien et répondrait « rien à signaler » :
   * mieux vaut le dire que laisser croire que tout est envoyé.
   */
  const requested = request.nextUrl.searchParams.get("apercu");
  if (requested !== null && !(PREVIEW_VALUES as readonly string[]).includes(requested)) {
    return NextResponse.json({ error: "apercu s'utilise seul, ou avec la valeur « oui »." }, { status: 400 });
  }
  const preview = requested !== null;

  const now = new Date();
  if (!preview && !isAlertWindow(now)) {
    return NextResponse.json(
      { skipped: `Hors créneau : l'alerte part le vendredi à ${ALERT_HOUR} h, heure de Paris.` },
      { status: 200 },
    );
  }
  if (!preview && !isEmailConfigured()) {
    console.error("[fiches non envoyées] messagerie non configurée");
    return NextResponse.json(
      { error: "Messagerie non configurée (RESEND_API_KEY et MAIL_FROM)." },
      { status: 503 },
    );
  }

  /*
   * Client à privilèges : une tâche planifiée n'a pas de session, `auth.uid()`
   * est nul, et toutes les politiques de lecture passent par
   * `can_access_client` — une lecture sous RLS ne ramènerait aucune ligne et
   * l'alerte conclurait que tout est envoyé. Les deux requêtes ci-dessous sont
   * en lecture seule et bornées à la semaine visée.
   */
  const admin = createSupabaseAdminClient();
  const range = planningWeekRange(now);

  const [{ data: clientRows, error: clientsError }, { data: sheetRows, error: sheetsError }] = await Promise.all([
    admin
      .from("clients")
      .select(`id, name, is_active, weekly_sheet_alert, ${CLIENT_FORMULA_COLUMNS}`)
      .eq("is_active", true),
    /*
     * `(iso_year, iso_week)` plutôt que les dates de période : c'est la clé
     * unique de `weekly_sheets`, donc au plus une fiche par client et aucune
     * question d'alignement de lundi.
     */
    admin
      .from("weekly_sheets")
      .select("client_id, status")
      .eq("iso_year", range.nextIsoYear)
      .eq("iso_week", range.nextIsoWeek),
  ]);

  // Une liste partielle ferait une alerte fausse : on préfère ne rien dire.
  if (clientsError || sheetsError) {
    const message = clientsError?.message ?? sheetsError?.message;
    console.error("[fiches non envoyées] lecture impossible", message);
    return NextResponse.json({ error: `Lecture impossible : ${message}` }, { status: 500 });
  }

  const clients: WeeklySheetAlertClient[] = (clientRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    is_active: Boolean(row.is_active),
    client_kind: (row.client_kind as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    contract_start_date: (row.contract_start_date as string | null) ?? null,
    contract_end_date: (row.contract_end_date as string | null) ?? null,
    pause_start_date: (row.pause_start_date as string | null) ?? null,
    pause_end_date: (row.pause_end_date as string | null) ?? null,
    // Une valeur absente vaut « activé » : c'est le réglage par défaut en base.
    alertEnabled: row.weekly_sheet_alert !== false,
  }));

  const missing = missingWeeklySheets({
    clients,
    sheets: (sheetRows ?? []).map((row) => ({
      clientId: row.client_id as string,
      status: row.status as SheetStatus,
    })),
    weekStart: range.nextStart,
  });

  const email = {
    missing,
    weekStart: range.nextStart,
    planningUrl: `${env.appUrl}${planningHrefForBucket("next")}`,
  };
  const listed = missing.map((sheet) => ({
    client: sheet.clientName,
    motif: MISSING_REASON_LABELS[sheet.reason],
  }));

  if (preview) {
    const { emails, role } = await leadRecipients(admin, "fiches non envoyées");
    return NextResponse.json({
      apercu: true,
      semaine: range.nextStart,
      manquantes: listed,
      destinataires: emails,
      role,
      ...(missing.length > 0
        ? { objet: buildSheetSendAlertSubject(email), texte: buildSheetSendAlertText(email) }
        : {}),
    });
  }

  // Tout est parti : ni e-mail, ni ligne en base. La table ne garde que de vraies alertes.
  if (missing.length === 0) {
    return NextResponse.json({ semaine: range.nextStart, manquantes: 0 }, { status: 200 });
  }

  const { emails, role } = await leadRecipients(admin, "fiches non envoyées");
  if (emails.length === 0) {
    return NextResponse.json(
      { error: "Aucun dirigeant actif à alerter.", semaine: range.nextStart, manquantes: missing.length },
      { status: 500 },
    );
  }

  /*
   * Réservation avant l'envoi, une ligne par vendredi. Une deuxième exécution —
   * l'autre heure UTC, un rejeu, un appel à la main — n'obtient aucune ligne en
   * retour et n'envoie rien. L'unicité en base est la garantie, pas l'horloge.
   */
  const { data: reserved, error: reserveError } = await admin
    .from("weekly_sheet_send_alerts")
    .upsert(
      {
        alert_date: alertDate(now),
        week_start: range.nextStart,
        missing_count: missing.length,
        missing: missing.map((sheet) => ({
          client_id: sheet.clientId,
          client_name: sheet.clientName,
          reason: sheet.reason,
        })),
        recipients: emails,
      },
      { onConflict: "alert_date", ignoreDuplicates: true },
    )
    .select("id");

  if (reserveError) {
    console.error("[fiches non envoyées] réservation impossible", reserveError.message);
    return NextResponse.json({ error: `Réservation impossible : ${reserveError.message}` }, { status: 500 });
  }

  const alertId = reserved?.[0]?.id as string | undefined;
  if (!alertId) {
    return NextResponse.json(
      { skipped: "Alerte déjà envoyée ce vendredi.", semaine: range.nextStart },
      { status: 200 },
    );
  }

  const outcome = await sendEmail({
    to: emails,
    subject: buildSheetSendAlertSubject(email),
    html: buildSheetSendAlertHtml(email),
    text: buildSheetSendAlertText(email),
    /*
     * Ni `replyTo` ni `displayName` : ce message va à l'agence, pas à un client.
     * `AGENCY_REPLY_TO` est l'adresse de Théo — la poser ici lui ferait se
     * répondre à lui-même. Même choix que l'alerte des tickets.
     */
  });

  if (!outcome.sent) {
    /*
     * Refus net : rien n'est parti, la réservation est libérée pour que la
     * seconde heure du vendredi rattrape. Issue inconnue (coupure, erreur
     * serveur) : elle reste — mieux vaut une alerte manquée qu'un doublon.
     */
    if (outcome.reason === "rejected" || outcome.reason === "no_recipient" || outcome.reason === "not_configured") {
      const { error: releaseError } = await admin
        .from("weekly_sheet_send_alerts")
        .delete()
        .eq("id", alertId);
      if (releaseError) console.error("[fiches non envoyées] libération impossible", releaseError.message);
    }
    console.error("[fiches non envoyées] envoi impossible", outcome.reason, outcome.detail ?? "");
    return NextResponse.json(
      { error: `Envoi impossible : ${outcome.reason}`, semaine: range.nextStart, manquantes: missing.length },
      { status: 502 },
    );
  }

  await admin
    .from("weekly_sheet_send_alerts")
    .update({ sent_at: new Date().toISOString(), resend_id: outcome.id || null })
    .eq("id", alertId);

  return NextResponse.json({
    semaine: range.nextStart,
    manquantes: listed,
    destinataires: emails,
    role,
  });
}
