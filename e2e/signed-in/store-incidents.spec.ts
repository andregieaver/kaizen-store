import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN, E2E_STORE, OWNER, READER } from "./accounts";

/**
 * A store owner sees the problems Kaizena Flow saw on their store (D895 IA-18), in plain words and never a message; staff never do. And the
 * platform's owner sets the rule for approving small improvements automatically (IA-19), off until they turn it on.
 */
const fingerprint = "runtime:/s/:store/no/products/:id:typeerror-e2e";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.platform_incidents where fingerprint = ${fingerprint}`;
    const [incident] = await sql`
      insert into commerce.platform_incidents (kind, source, fingerprint, title, status, facts)
      values ('error', 'runtime', ${fingerprint}, 'Runtime error: TypeError on /s/:store/no/products/:id', 'open',
        ${sql.json({ route: "/s/:store/no/products/:id", name: "TypeError", message: "TypeError: Cannot read properties of undefined" })})
      returning id`;
    await sql`insert into commerce.platform_incident_stores (incident_id, store_id, occurrences)
              select ${incident.id}::uuid, id, 3 from commerce.stores where slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.platform_incidents where fingerprint = ${fingerprint}`;
    await sql`update commerce.platform_settings set auto_approve_on = false, auto_approve_by = null`;
  } finally {
    await sql.end();
  }
});

test.describe("the store's owner", () => {
  test.use({ storageState: OWNER.state });

  test("sees what Kaizena Flow noticed on the store and where it stands, with no technical words", async ({ page }, info) => {
    await page.goto(`/admin/${E2E_STORE}`);
    const card = page.getByRole("region", { name: "Problems we noticed" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Your store's pages");
    await expect(card).toContainText("We're fixing it");
    await expect(card).toContainText("3 times");
    await expect(card).not.toContainText("TypeError");
    await card.screenshot({ path: info.outputPath("store-incidents-card.png") });
  });
});

test.describe("a staff member", () => {
  test.use({ storageState: READER.state });

  test("never sees it", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: "Problems we noticed" })).toHaveCount(0);
  });
});

test.describe("the platform's owner", () => {
  test.use({ storageState: ADMIN.state });

  test("turns on approving small improvements automatically, with a wait and a weekly number", async ({ page }, info) => {
    await page.goto("/admin/platform/incidents");
    const card = page.getByRole("region", { name: "Approve small improvements automatically" });
    await expect(card).toContainText("Off: every improvement waits for your Approve.");
    await card.getByLabel("Approve small improvements for me when I haven't answered").check();
    await card.getByLabel("Wait for my answer").selectOption("12");
    await card.getByLabel("At most this many a week").selectOption("1");
    await card.screenshot({ path: info.outputPath("auto-approve-card.png") });
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Saved.");
    const sql = testDb();
    try {
      const [row] = await sql`select auto_approve_on, auto_approve_wait_hours, auto_approve_per_week, auto_approve_by is not null as by from commerce.platform_settings`;
      expect(row).toEqual({ auto_approve_on: true, auto_approve_wait_hours: 12, auto_approve_per_week: 1, by: true });
    } finally {
      await sql.end();
    }
  });
});
