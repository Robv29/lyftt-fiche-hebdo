import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

/**
 * Utilitaires partagés par les tests end-to-end.
 *
 * Ils s'appuient sur le jeu de données de supabase/seed.sql.
 */

export const DEMO_CLIENT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
export const DEMO_SHEET_ID = "bbbbbbbb-0000-0000-0000-000000000001";
export const CM_EMAIL = "elena@lyftt.fr";
export const CM_PASSWORD = "demo1234";

export function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Crée un lien de consultation et renvoie le token en clair. */
export async function createReviewLink(options: {
  sheetId?: string;
  expiresAt?: Date;
  revoked?: boolean;
} = {}): Promise<string> {
  const supabase = admin();
  const sheetId = options.sheetId ?? DEMO_SHEET_ID;

  const { data: version } = await supabase
    .from("weekly_sheet_versions")
    .select("id")
    .eq("weekly_sheet_id", sheetId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let versionId = version?.id;
  if (!versionId) {
    const { data } = await supabase.rpc("create_sheet_version", {
      target_sheet_id: sheetId,
      summary: "Version de test",
    });
    versionId = data as string;
  }

  await supabase
    .from("client_review_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("weekly_sheet_id", sheetId)
    .is("revoked_at", null);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000);

  await supabase.from("client_review_links").insert({
    weekly_sheet_id: sheetId,
    sheet_version_id: versionId,
    token_hash: createHash("sha256").update(token).digest("hex"),
    token_prefix: token.slice(0, 8),
    expires_at: expiresAt.toISOString(),
    revoked_at: options.revoked ? new Date().toISOString() : null,
  });

  return token;
}

/** Remet les contenus et les tickets de la fiche de démonstration à zéro. */
export async function resetDemoSheet(): Promise<void> {
  const supabase = admin();

  await supabase.from("client_tickets").delete().eq("weekly_sheet_id", DEMO_SHEET_ID);
  await supabase
    .from("client_content_approvals")
    .delete()
    .eq("weekly_sheet_id", DEMO_SHEET_ID);
  await supabase
    .from("weekly_sheet_items")
    .update({ approval_status: "pending" })
    .eq("weekly_sheet_id", DEMO_SHEET_ID);
  await supabase
    .from("weekly_sheets")
    .update({ status: "sent_to_client" })
    .eq("id", DEMO_SHEET_ID);
}

export async function sheetStatus(): Promise<string> {
  const { data } = await admin()
    .from("weekly_sheets")
    .select("status")
    .eq("id", DEMO_SHEET_ID)
    .single();
  return data?.status as string;
}

export async function ticketsForSheet() {
  const { data } = await admin()
    .from("client_tickets")
    .select("id, ticket_type, category, status, client_ticket_assignments ( profile_id, assignment_role, profiles ( role ) )")
    .eq("weekly_sheet_id", DEMO_SHEET_ID);
  return data ?? [];
}
