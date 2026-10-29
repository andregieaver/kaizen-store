import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Email automations (wave 5 unit D, D298; rows customers.email-marketing-broadcasts-and-lifecycle-automations and
 * customers.back-in-stock-notifications). Who gets which email and how often is held by automations.int.test.ts; this holds the screens: the
 * welcome email set up from its starting words, saved, tested and switched on, and back in stock switched on.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-automations";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Automations') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Automations', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where slug = ${STORE}`;
    // Every run starts with nothing set up.
    await sql`delete from commerce.automations where store_id = (select id from commerce.stores where slug = ${STORE})`;
  } finally {
    await sql.end();
  }
});

test("the welcome email is set up from its starting words, saved, tested and switched on", async ({ page }) => {
  await page.goto(`/admin/${STORE}/automations`);
  await expect(page.getByRole("heading", { level: 1, name: "Email automations" })).toBeVisible();
  const welcome = page.getByRole("region", { name: "Welcome" });
  await expect(welcome.getByText("Off")).toBeVisible();
  await welcome.getByRole("link", { name: "Set it up" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Welcome" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("Velkommen");
  await page.getByLabel("Days after they join").fill("2");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.getByRole("button", { name: "Send a test to yourself" }).click();
  await expect(page.getByRole("status").filter({ hasText: "A test went to" })).toContainText(OWNER.email);

  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByRole("button", { name: "Switch off" })).toBeVisible();
  await page.goto(`/admin/${STORE}/automations`);
  await expect(page.getByRole("region", { name: "Welcome" }).getByText("On", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Welcome" }).getByText("Sent 2 days after they join.")).toBeVisible();
});

test("back in stock is switched on and says how many wait", async ({ page }) => {
  await page.goto(`/admin/${STORE}/automations`);
  const card = page.getByRole("region", { name: "Back in stock" });
  await expect(card.getByText("Nobody is waiting.")).toBeVisible();
  await card.getByRole("button", { name: "Switch on" }).click();
  await expect(card.getByRole("button", { name: "Switch off" })).toBeVisible();
  await expect(card.getByText("On", { exact: true })).toBeVisible();
});
