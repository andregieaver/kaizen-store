import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * How often people hear from the store (email plan M1.5, D764): the Marketing page says the policy in one sentence, and the owner changes it
 * under Change. What the policy holds back is held by contact-policy.int.test.ts.
 */

test.use({ storageState: OWNER.state });

const STORE = "e2e-contact-policy";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Contact policy') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Contact policy', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where slug = ${STORE}`;
    await sql`delete from commerce.contact_policies where store_id = (select id from commerce.stores where slug = ${STORE})`;
  } finally {
    await sql.end();
  }
});

test("the Marketing page says how often people hear from the store, and the owner changes it", async ({ page }) => {
  await page.goto(`/admin/${STORE}/marketing`);
  const card = page.locator("[data-contact-policy]");
  await expect(card).toContainText("Each person gets at most 3 marketing messages a week, at least 20 hours apart, and automation emails only in their daytime.");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: "test-results/contact-policy.png" });

  await card.getByText("Change").click();
  await card.getByLabel("At most this many a week").fill("2");
  await card.getByLabel("At least this many hours apart").fill("48");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("Each person gets at most 2 marketing messages a week, at least 48 hours apart");
  await card.screenshot({ path: "test-results/contact-policy-changed.png" });
});
