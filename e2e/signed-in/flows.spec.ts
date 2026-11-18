import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Flows as the owner reads them (D767 slice 2, email plan M3.3): the welcome series started with one press, read as a story with its emails
 * drawn, tested on the newest subscriber, and switched on. What a flow sends and when is held by flows.int.test.ts.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-flows";
const RUN = Date.now().toString(36);

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Flows') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Flows', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active', locales = array['en-GB'] where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}, ${`ida-${RUN}@example.com`}, 'en-GB', 'subscribed', 'form', 'Yes please', now(), ${(RUN + "f".repeat(43)).slice(0, 43)})`;
  } finally {
    await sql.end();
  }
});

test("a welcome series is started with one press, read as a story, tested and switched on", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("button", { name: "Start a welcome series" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/flows/[0-9a-f-]{36}$`));

  const story = page.locator("[data-flow-story]");
  await expect(story).toContainText("When someone joins your list:");
  await expect(story).toContainText("The same day:");
  await expect(story.getByLabel("Email: Welcome!")).toBeVisible();
  await expect(story).toContainText("3 days later, if they have ordered");
  await expect(story).toContainText("3 days later, if they have not ordered");
  await expect(page.getByText("Test it before switching it on.")).toBeVisible();
  await page.screenshot({ path: "test-results/flow-story.png", fullPage: true });

  await page.getByRole("button", { name: "Test it" }).click();
  await expect(page.getByText(`Tested on ida-${RUN}@example.com: Welcome!, What others like best. Then it ends.`)).toBeVisible();
  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByText("On. New people go through it from now.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch off" })).toBeVisible();

  await page.goto(`/admin/${STORE}/flows`);
  await expect(page.getByRole("list", { name: "Flows" })).toContainText("Welcome series");
  await page.screenshot({ path: "test-results/flow-list.png", fullPage: true });
});

test("an email's words and its wait are changed where they are, and the flow waits to be tested again", async ({ page }) => {
  await page.goto(`/admin/${STORE}/flows`);
  await page.getByRole("list", { name: "Flows" }).getByRole("link", { name: "Welcome series" }).first().click();
  const best = page.getByLabel("Email: What others like best");
  await best.getByText("Change", { exact: true }).click();
  await best.getByLabel("Subject").fill("Our favourites");
  await best.getByLabel("Words").fill("See what others buy most.");
  await best.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  const changed = page.getByLabel("Email: Our favourites");
  await expect(changed).toContainText("See what others buy most.");
  await changed.getByText("Change", { exact: true }).click();
  await changed.getByLabel("Days later").fill("5");
  await changed.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText("Saved. The flow is off until you test it again.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-flow-story]")).toContainText("5 days later, if they have not ordered");
  await expect(page.getByText("Test it before switching it on.")).toBeVisible();
  await page.getByLabel("Email: Our favourites").getByText("Change", { exact: true }).click();
  await page.screenshot({ path: "test-results/flow-change.png", fullPage: true });
});
