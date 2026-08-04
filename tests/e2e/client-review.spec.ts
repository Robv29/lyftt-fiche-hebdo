import { expect, test } from "@playwright/test";
import {
  createReviewLink,
  resetDemoSheet,
  sheetStatus,
  ticketsForSheet,
} from "./fixtures";

/** §25 — Scénarios 2, 3, 4, 7 et 8 rejoués dans un navigateur. */

test.beforeEach(async () => {
  await resetDemoSheet();
});

test("scénario 2 — le client ouvre le lien et valide toute la fiche", async ({ page }) => {
  const token = await createReviewLink();
  await page.goto(`/client-review/${token}`);

  await expect(page.getByRole("heading", { name: /Vos publications de la semaine/i })).toBeVisible();
  await expect(page.getByText("Un été à la campagne")).toBeVisible();
  // L'échéance est calculée, pas écrite en dur.
  await expect(page.getByText(/Merci de valider .* avant le/)).toBeVisible();

  await page.getByRole("button", { name: "Tout valider" }).click();

  await expect(page.getByRole("status")).toContainText("validé");
  expect(await sheetStatus()).toBe("approved_by_client");
});

test("scénario 3 — demande de modification de texte", async ({ page }) => {
  const token = await createReviewLink();
  await page.goto(`/client-review/${token}`);

  // On valide d'abord un contenu pour obtenir une validation partielle.
  await page.getByRole("button", { name: "Valider" }).first().click();
  await expect(page.getByRole("status")).toContainText("validé");

  const secondCard = page.getByRole("listitem").nth(1);
  await secondCard.getByRole("button", { name: "Demander une modification" }).click();
  await secondCard.getByLabel("Que souhaitez-vous modifier ?").selectOption("text_typo");
  await secondCard
    .getByLabel("Votre demande")
    .fill("« guingette » s'écrit « guinguette », merci de corriger.");
  await secondCard.getByRole("button", { name: "Envoyer ma demande" }).click();

  await expect(page.getByRole("status")).toContainText("enregistrée");

  const tickets = await ticketsForSheet();
  expect(tickets).toHaveLength(1);
  expect(tickets[0].ticket_type).toBe("text_typo");
  expect(tickets[0].category).toBe("editorial");

  // Scénario 9 : aucune affectation à la production.
  const roles = (tickets[0].client_ticket_assignments ?? []).map(
    (a: { profiles: { role: string } | null }) => a.profiles?.role,
  );
  expect(roles).toContain("community_manager");
  expect(roles).not.toContain("graphic_designer");

  // La fiche est marquée comme ayant des modifications demandées.
  expect(await sheetStatus()).toBe("changes_requested");

  // La validation globale n'est plus proposée.
  await expect(page.getByRole("button", { name: "Tout valider" })).toHaveCount(0);
});

test("scénario 4 et 10 — demande de remplacement de photo", async ({ page }) => {
  const token = await createReviewLink();
  await page.goto(`/client-review/${token}`);

  const card = page.getByRole("listitem").nth(1);
  await card.getByRole("button", { name: "Demander une modification" }).click();
  await card.getByLabel("Que souhaitez-vous modifier ?").selectOption("photo_replace");
  await card
    .getByLabel("Votre demande")
    .fill("La photo est trop sombre, préférez celle de la terrasse.");
  await card.getByRole("button", { name: "Envoyer ma demande" }).click();

  await expect(page.getByRole("status")).toContainText("enregistrée");

  const tickets = await ticketsForSheet();
  const roles = (tickets[0].client_ticket_assignments ?? []).map(
    (a: { profiles: { role: string } | null }) => a.profiles?.role,
  );

  expect(tickets[0].category).toBe("graphic");
  expect(roles).toContain("community_manager");
  expect(roles).toContain("graphic_designer");
  expect(roles).not.toContain("video_editor");
});

test("scénario 7 — un lien révoqué ne donne plus accès", async ({ page }) => {
  const token = await createReviewLink({ revoked: true });
  await page.goto(`/client-review/${token}`);

  await expect(page.getByRole("heading", { name: "Lien désactivé" })).toBeVisible();
  await expect(page.getByText("Un été à la campagne")).toHaveCount(0);
});

test("scénario 7 — un lien expiré ne donne plus accès", async ({ page }) => {
  const token = await createReviewLink({ expiresAt: new Date(Date.now() - 3600_000) });
  await page.goto(`/client-review/${token}`);

  await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible();
});

test("un token inexistant ne révèle rien", async ({ page }) => {
  await page.goto(`/client-review/${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Lien invalide" })).toBeVisible();
});

test("scénario 8 — les notes internes ne sont jamais servies au client", async ({ page }) => {
  const token = await createReviewLink();
  const response = await page.goto(`/client-review/${token}`);
  const html = (await response?.text()) ?? "";

  expect(html).not.toContain("Note interne");
  expect(html).not.toContain("relancer Brigitte");
});

test("le portail reste utilisable sur mobile", async ({ page }) => {
  const token = await createReviewLink();
  await page.goto(`/client-review/${token}`);

  // Aucun débordement horizontal : le client consulte depuis WhatsApp.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
