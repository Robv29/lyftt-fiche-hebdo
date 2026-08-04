import { expect, test } from "@playwright/test";
import {
  CM_EMAIL,
  CM_PASSWORD,
  DEMO_SHEET_ID,
  admin,
  createReviewLink,
  resetDemoSheet,
} from "./fixtures";

/** §25 — Scénarios 1, 5 et 6, côté équipe. */

test.beforeEach(async ({ page }) => {
  await resetDemoSheet();

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(CM_EMAIL);
  await page.getByLabel("Mot de passe").fill(CM_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL("/");
});

test("scénario 1 — génération du lien et message prérempli", async ({ page }) => {
  await page.goto(`/fiches/${DEMO_SHEET_ID}`);

  await page.getByRole("button", { name: /Générer le lien/ }).click();
  await expect(page.getByText(/copiez-le maintenant/)).toBeVisible();

  const link = await page.getByText(/client-review\//).textContent();
  expect(link).toMatch(/\/client-review\/[A-Za-z0-9_-]{43}$/);

  // Le message est complété avec les données de la fiche.
  const message = page.getByLabel("Message");
  await expect(message).toHaveValue(/Bonjour Brigitte,/);
  await expect(message).toHaveValue(/client-review\//);
  await expect(message).toHaveValue(/mardi \d+ \w+ à 10 h/);

  // L'envoi est tracé : sans preuve d'envoi, pas de validation tacite.
  await page.getByRole("button", { name: "Marquer comme envoyé" }).click();
  await expect(page.getByText(/Envoi enregistré/)).toBeVisible();

  const { data } = await admin()
    .from("client_message_dispatches")
    .select("id")
    .eq("weekly_sheet_id", DEMO_SHEET_ID);
  expect(data?.length).toBeGreaterThan(0);
});

test("le lien précédent est révoqué quand on en régénère un", async ({ page }) => {
  const firstToken = await createReviewLink();

  await page.goto(`/fiches/${DEMO_SHEET_ID}`);
  await page.getByRole("button", { name: /Régénérer le lien/ }).click();
  await expect(page.getByText(/copiez-le maintenant/)).toBeVisible();

  await page.goto(`/client-review/${firstToken}`);
  await expect(page.getByRole("heading", { name: "Lien désactivé" })).toBeVisible();
});

test("scénario 6 — la nouvelle version incrémente et rend l'export obsolète", async ({
  page,
}) => {
  const supabase = admin();

  await page.goto(`/fiches/${DEMO_SHEET_ID}`);
  await page.getByRole("button", { name: /Générer le lien/ }).click();
  await expect(page.getByText(/copiez-le maintenant/)).toBeVisible();

  const { data: before } = await supabase
    .from("weekly_sheet_versions")
    .select("version_number")
    .eq("weekly_sheet_id", DEMO_SHEET_ID)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  // Un export rattaché à la version courante.
  const { data: currentVersion } = await supabase
    .from("weekly_sheets")
    .select("current_version_id")
    .eq("id", DEMO_SHEET_ID)
    .single();

  await supabase.from("sheet_exports").insert({
    weekly_sheet_id: DEMO_SHEET_ID,
    sheet_version_id: currentVersion!.current_version_id,
    storage_path: "exports/test.pdf",
    file_name: "test.pdf",
  });

  // Génération d'une version corrigée.
  await supabase.rpc("create_sheet_version", {
    target_sheet_id: DEMO_SHEET_ID,
    summary: "Remplacement de la photo du mardi",
  });

  const { data: after } = await supabase
    .from("weekly_sheet_versions")
    .select("version_number")
    .eq("weekly_sheet_id", DEMO_SHEET_ID)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  expect(after!.version_number).toBe(before!.version_number + 1);

  const { data: exports } = await supabase
    .from("sheet_exports")
    .select("is_obsolete")
    .eq("weekly_sheet_id", DEMO_SHEET_ID);

  expect(exports?.every((e) => e.is_obsolete)).toBe(true);

  // L'ancienne version reste consultable en interne.
  const { data: versions } = await supabase
    .from("weekly_sheet_versions")
    .select("version_number, status")
    .eq("weekly_sheet_id", DEMO_SHEET_ID);

  expect(versions!.length).toBeGreaterThanOrEqual(2);
  expect(versions!.some((v) => v.status === "superseded")).toBe(true);
});

test("scénario 5 — un graphiste ne peut pas renvoyer au client", async ({ page }) => {
  const token = await createReviewLink();

  // Le client demande une correction photo.
  await page.goto(`/client-review/${token}`);
  const card = page.getByRole("listitem").nth(1);
  await card.getByRole("button", { name: "Demander une modification" }).click();
  await card.getByLabel("Que souhaitez-vous modifier ?").selectOption("photo_retouch");
  await card.getByLabel("Votre demande").fill("Merci de recadrer sur la terrasse.");
  await card.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.getByRole("status")).toContainText("enregistrée");

  // Connexion en graphiste.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("graphiste@lyftt.fr");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();

  await page.goto("/production");
  await expect(page.getByText(/Retoucher une photo/)).toBeVisible();
  await page.getByRole("link", { name: /Retoucher une photo/ }).first().click();

  // Il peut avancer jusqu'au contrôle, pas au-delà.
  await expect(page.getByRole("button", { name: "Prendre en charge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Renvoyer au client" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Valider le contrôle interne" }),
  ).toHaveCount(0);
});
