import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * A template previewed from the builder's sidebar shows what it would place (D127). The preview page streams its content behind a
 * loading state that Next's inline scripts reveal, so the frame must run scripts; it never shares the admin's origin. In such a frame
 * the browser refuses cookies and the service worker with a `SecurityError`: the admin's own parts must not throw there, or React
 * swaps the drawn template for the error page once its scripts run (`src/lib/browser-access.ts`). The content is in the page's HTML,
 * so it shows for a moment either way: the test waits until the frame's scripts have run before it looks.
 */

test.use({ storageState: OWNER.state });

const NAME = `Preview promise ${Date.now().toString(36)}`;
const WORDS = `Free returns ${Date.now().toString(36)}`;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // One of Kaizena Flow's own templates: on the marketplace and switched on for every store until it switches it off.
    await sql`
      insert into commerce.saved_parts (store_id, kind, name, content, sharing)
      values (null, 'block', ${NAME}, ${sql.json({ id: "e2e-preview-heading", type: "heading", text: WORDS, level: 2 })}, 'marketplace')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.saved_parts where store_id is null and name = ${NAME}`;
  } finally {
    await sql.end();
  }
});

test("a template's preview from the builder's sidebar shows its content, and keeps showing it", async ({ page }) => {
  // What the sandbox refuses, wherever it is asked for: thrown (page errors) or caught and reported by React (console errors).
  const refused: string[] = [];
  page.on("pageerror", (error) => refused.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") refused.push(message.text());
  });

  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Marketplace" }).click();
  const card = page.getByRole("listitem").filter({ hasText: NAME });
  await card.getByRole("button", { name: /^Preview/ }).click();

  const dialog = page.getByRole("dialog", { name: `Preview: ${NAME}` });
  await expect(dialog).toBeVisible();
  // Loaded: the frame's load event has come (the dialog's Loading line goes) and its scripts have run to an idle moment.
  await expect(dialog.getByRole("status").filter({ hasText: "Loading the preview" })).toBeHidden({ timeout: 20_000 });
  const frame = page.frames().find((each) => each.url().endsWith("/preview"));
  expect(frame, "the preview's frame").toBeTruthy();
  await frame!.evaluate(() => new Promise((resolve) => requestIdleCallback(() => resolve(null), { timeout: 5_000 })));

  const preview = dialog.frameLocator(`iframe[title="Preview of ${NAME}"]`);
  await expect(preview.getByRole("heading", { name: WORDS })).toBeVisible();
  await expect(preview.getByText("This page could not be shown.")).toHaveCount(0);
  expect(refused.filter((message) => /SecurityError|sandboxed/.test(message))).toEqual([]);
});
