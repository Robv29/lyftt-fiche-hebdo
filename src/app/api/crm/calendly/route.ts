import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCalendlySignature } from "@/lib/security/calendly-signature";
import { escapeLikePattern } from "@/lib/domain/crm-transmission";

/**
 * Rendez-vous pris par le client sur Calendly.
 *
 * Le client signe, puis choisit lui-même son créneau de lancement. Calendly
 * appelle cette route ; on retrouve la fiche transmise par son adresse e-mail
 * et on y pose la date. Sans ça, le chef de projet devait faire le
 * rapprochement à la main entre deux agendas.
 *
 * Règle de conduite de cette route : **elle ne fait jamais échouer Calendly
 * pour une raison métier.** Un webhook qui répond en erreur est un webhook que
 * Calendly finit par désactiver, et personne ne s'en aperçoit avant plusieurs
 * semaines. Une adresse inconnue, un événement d'un autre type, une fiche déjà
 * traitée : tout cela répond 200. Seuls une signature invalide (l'appelant
 * n'est pas Calendly) et un corps illisible sont refusés.
 */

export const dynamic = "force-dynamic";

const calendlySchema = z.object({
  event: z.string(),
  payload: z.object({
    email: z.string().trim().email().optional().nullable(),
    name: z.string().trim().optional().nullable(),
    scheduled_event: z.object({
      start_time: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Date de début invalide."),
      end_time: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
    }),
  }),
});

export async function POST(request: NextRequest) {
  // Le corps brut, avant tout parsage : la signature porte sur ces octets
  // exactement, et re-sérialiser le JSON suffirait à la faire échouer.
  const raw = await request.text();

  const secret = process.env.CALENDLY_WEBHOOK_SECRET;
  if (secret) {
    const valid = verifyCalendlySignature({
      header: request.headers.get("calendly-webhook-signature"),
      body: raw,
      secret,
    });
    if (!valid) {
      return NextResponse.json({ error: "Signature Calendly invalide." }, { status: 401 });
    }
  } else {
    /*
     * Sans secret configuré, on accepte quand même. Le webhook doit pouvoir
     * être branché avant que la variable ne soit posée dans Vercel : refuser
     * ici obligerait à faire les deux dans le bon ordre, et un webhook refusé
     * dès sa création est un webhook que Calendly désactive aussitôt.
     */
    console.warn(
      "[calendly] CALENDLY_WEBHOOK_SECRET absent : requête acceptée sans vérification de signature.",
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible." }, { status: 422 });
  }

  const parsed = calendlySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 422 });
  }

  const { event, payload } = parsed.data;
  if (event !== "invitee.created") {
    return NextResponse.json({ ok: true, matched: false });
  }

  const email = payload.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: true, matched: false });
  }

  const admin = createSupabaseAdminClient();

  /*
   * Rapprochement par l'adresse, insensible à la casse : le CRM enregistre
   * « Jean.Dupont@… », Calendly renvoie ce que le client a tapé.
   *
   * Un même client peut avoir été transmis deux fois (deuxième contrat) : on
   * prend la fiche la plus récente, celle que le rendez-vous concerne.
   */
  const { data: matches, error: searchError } = await admin
    .from("client_transmissions")
    .select("id")
    .ilike("email", escapeLikePattern(email))
    .order("created_at", { ascending: false })
    .limit(1);

  if (searchError) {
    console.error("[calendly] recherche impossible", searchError.message);
    return NextResponse.json({ ok: true, matched: false });
  }

  const transmission = matches?.[0];
  if (!transmission) {
    console.warn("[calendly] aucune fiche transmise pour cette adresse");
    return NextResponse.json({ ok: true, matched: false });
  }

  const { error: updateError } = await admin
    .from("client_transmissions")
    .update({ date_rdv: new Date(payload.scheduled_event.start_time).toISOString() })
    .eq("id", transmission.id);

  if (updateError) {
    console.error("[calendly] rendez-vous non enregistré", updateError.message);
    return NextResponse.json({ ok: true, matched: false });
  }

  return NextResponse.json({ ok: true, matched: true });
}
