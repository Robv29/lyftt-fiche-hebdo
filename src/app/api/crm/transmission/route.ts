import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeText } from "@/lib/security/sanitize";

/**
 * Réception d'une fiche client signée, depuis le CRM commercial.
 *
 * Le CRM appelle cette route quand le client a composé son menu de
 * prestations. La fiche atterrit dans « Transmission client », où le chef de
 * projet la prend en charge.
 *
 * L'appelant est une machine : il n'y a pas de session, donc pas de RLS
 * exploitable. L'authentification tient à un secret partagé porté par
 * `Authorization: Bearer`, comme la route d'entretien — et l'écriture se fait
 * ensuite avec la clé service-role.
 */

export const dynamic = "force-dynamic";

/** Champs facultatifs : le CRM ne connaît pas toujours tout. */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((value) => {
    const cleaned = value ? sanitizeText(value, max) : "";
    return cleaned.length > 0 ? cleaned : null;
  });

const transmissionSchema = z.object({
  crm_prospect_id: z.coerce.number().int().positive(),
  entreprise: z.string().trim().min(1, "Le nom de l'entreprise est requis.").max(200),
  contact_prenom: optionalText(120),
  contact_nom: optionalText(120),
  email: z.string().trim().email().max(200).optional().nullable(),
  telephone: optionalText(40),
  /*
   * Le menu composé par le client, en texte libre et multiligne. Il fait
   * parfois plusieurs dizaines de lignes : le tronquer trop tôt priverait la
   * production de la moitié de la commande.
   */
  fiche_mission: optionalText(20_000),
  montant_ca: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  menu_compose_le: z.string().trim().optional().nullable().refine(
    (value) => !value || !Number.isNaN(Date.parse(value)),
    "Date de composition du menu invalide.",
  ),
});

export async function POST(request: NextRequest) {
  const secret = process.env.CRM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRM_WEBHOOK_SECRET non configuré." }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible." }, { status: 422 });
  }

  const parsed = transmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Corps invalide.",
        details: parsed.error.issues.map((issue) => ({
          champ: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  /*
   * Idempotence. Le CRM rejoue volontiers la même fiche : menu modifié,
   * déclencheur relancé, appel réessayé après un incident réseau. Seules les
   * colonnes présentes ici sont réécrites en cas de conflit — `statut`,
   * `date_rdv`, `note` et `client_id` restent tels que la production les a
   * laissés, sinon une simple correction de numéro de téléphone dans le CRM
   * renverrait une fiche déjà traitée dans la pile « à traiter ».
   */
  const { error } = await admin
    .from("client_transmissions")
    .upsert(
      {
        crm_prospect_id: input.crm_prospect_id,
        entreprise: sanitizeText(input.entreprise, 200),
        contact_prenom: input.contact_prenom,
        contact_nom: input.contact_nom,
        email: input.email?.toLowerCase() ?? null,
        telephone: input.telephone,
        fiche_mission: input.fiche_mission,
        montant_ca: input.montant_ca ?? null,
        menu_compose_le: input.menu_compose_le
          ? new Date(input.menu_compose_le).toISOString()
          : null,
      },
      { onConflict: "crm_prospect_id" },
    );

  if (error) {
    console.error("[crm] transmission non enregistrée", input.crm_prospect_id, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
