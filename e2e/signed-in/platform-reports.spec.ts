import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * Notices of illegal content (DSA art. 16, D411) as Kaizena Flow's platform admin decides them: a waiting notice shows what it says, and a
 * decision with its reason moves it to the decided ones. The emails and the statement of reasons are held by content-reports.int.test.ts.
 */

test.use({ storageState: ADMIN.state });

test("a platform admin decides a notice of illegal content with its reason", async ({ page }) => {
  const marker = `E2E notice ${Date.now()}`;
  const sql = testDb();
  try {
    await sql`
      insert into commerce.content_reports (url, category, explanation, reporter_name, reporter_email, good_faith)
      values ('https://example.com/p/e2e', 'consumer_fraud', ${marker}, 'Kari Nordmann', 'kari-e2e@example.com', true)`;
  } finally {
    await sql.end();
  }

  await page.goto("/admin/platform/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Illegal content notices" })).toBeVisible();
  const notice = page.getByRole("listitem").filter({ hasText: marker });
  await expect(notice).toContainText("Scam or misleading");
  await expect(notice).toContainText("Kari Nordmann");
  await notice.getByLabel("Reason").fill("The offer is a genuine discount, not misleading.");
  await notice.getByRole("button", { name: "Decide" }).click();
  // Decided, it moves to the decided notices with its outcome and reason.
  const decided = page.getByRole("listitem").filter({ hasText: marker }).filter({ hasText: "No action" });
  await expect(decided).toContainText("No action");
  await expect(decided).toContainText("The offer is a genuine discount, not misleading.");
});
