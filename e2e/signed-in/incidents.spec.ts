import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * The incident log (D895) as the platform's owner meets it: a suggested improvement waits under Needs you and is approved there, a problem
 * the autopilot handed over shows its note, an idea added is approved as it is saved, and an entry's page shows its facts and history.
 */

test.use({ storageState: ADMIN.state });

const run = Date.now().toString(36);

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`
      insert into commerce.platform_incidents (kind, source, fingerprint, title, status, facts)
      values ('enhancement', 'platform_ai', ${`e2e:proposal:${run}`}, ${`Show the shipping step sooner (${run})`}, 'proposed', ${sql.json({ screen: "settings.shipping", rageShare: 0.18 })})`;
    await sql`
      insert into commerce.platform_incidents (kind, source, fingerprint, title, status, fix_note, facts)
      values ('error', 'cron', ${`e2e:handed:${run}`}, ${`Scheduled job route.e2e is failing (${run})`}, 'needs_owner', 'Needs a new API key from the carrier; nothing else to do.', ${sql.json({ job: "route.e2e" })})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.platform_incidents where fingerprint like ${`e2e:%:${run}`} or title like ${`%(${run})`}`;
  } finally {
    await sql.end();
  }
});

test("approves a suggested improvement, reads a hand-over and adds an idea", async ({ page }, info) => {
  await page.goto("/admin/platform/incidents");
  await expect(page.getByRole("heading", { name: "Incidents", level: 1 })).toBeVisible();
  const needs = page.getByRole("region", { name: "Needs you" });
  await expect(needs.getByText(`Show the shipping step sooner (${run})`)).toBeVisible();
  await expect(needs.getByText("Needs a new API key from the carrier; nothing else to do.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("incidents.png"), fullPage: true });

  const row = needs.getByRole("listitem").filter({ hasText: `Show the shipping step sooner (${run})` });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("region", { name: "Being fixed" }).getByText(`Show the shipping step sooner (${run})`)).toBeVisible();

  const idea = page.getByRole("region", { name: "Add an idea" });
  await idea.getByLabel("What should be better").fill(`A darker admin at night (${run})`);
  await idea.getByRole("button", { name: "Add idea" }).click();
  await expect(idea.getByText("Added. The autopilot will build it.")).toBeVisible();

  await page.getByRole("link", { name: `Scheduled job route.e2e is failing (${run})` }).click();
  await expect(page.getByRole("heading", { name: `Scheduled job route.e2e is failing (${run})`, level: 1 })).toBeVisible();
  await expect(page.getByText("route.e2e").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("incident.png"), fullPage: true });
  await page.getByRole("button", { name: "Send back" }).click();
  await expect(page.getByRole("heading", { name: "Waiting", level: 2 })).toBeVisible();
});
