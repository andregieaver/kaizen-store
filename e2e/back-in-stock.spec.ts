import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Back in stock (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.4). A store of its own (the template store is no real store and never asks)
 * whose demo lamp is sold out and does not keep selling: with back in stock on, its page asks for an address, and a typed one is told to confirm
 * by email. Who is told when stock returns is held by automations.int.test.ts.
 */

const STORE = "e2e-back-in-stock";
const RUN = Date.now().toString(36);
// The store sells in one country, so its addresses carry none (D181).
const LAMP = `/s/${STORE}/p/demo-bordlampe`;

test.describe.configure({ mode: "serial" });

async function arrange(on: boolean) {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`bis-${RUN}@example.com`}, 'E2E', 'E2E Back in stock') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Back in stock', null)`;
    }
    const [store] = await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where slug = ${STORE} returning id`;
    await sql`
      update commerce.inventory_levels l set on_hand = 0 from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where l.store_id = ${store.id} and v.store_id = l.store_id and v.id = l.variant_id and p.handle = 'demo-bordlampe'`;
    await sql`
      insert into commerce.automations (store_id, kind, enabled, enabled_at) values (${store.id}, 'back_in_stock', ${on}, case when ${on} then now() end)
      on conflict (store_id, kind) do update set enabled = excluded.enabled, enabled_at = excluded.enabled_at`;
  } finally {
    await sql.end();
  }
}

test("a sold-out variant offers nothing while the store has it off", async ({ page }) => {
  await arrange(false);
  await page.goto(LAMP);
  await expect(page.getByText("Utsolgt").filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("[data-back-in-stock]")).toHaveCount(0);
});

test("with it on, a shopper asks for a sold-out variant and is told to confirm by email", async ({ page }) => {
  await arrange(true);
  await page.goto(LAMP);
  const form = page.locator("form[data-back-in-stock]").filter({ visible: true }).first();
  await expect(form.getByText("Få en e-post når den er tilbake")).toBeVisible();
  await form.getByRole("textbox", { name: "E-postadressen din" }).fill("ikke-en-adresse");
  await form.getByRole("button", { name: "Send meg en e-post når den er tilbake" }).click();
  await expect(form.getByRole("alert")).toHaveText("Skriv en hel e-postadresse.");
  await form.getByRole("textbox", { name: "E-postadressen din" }).fill(`lampe-${RUN}@example.com`);
  await form.getByRole("button", { name: "Send meg en e-post når den er tilbake" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vi har sendt deg en e-post" }).first()).toBeVisible();
  // The add button stays as it was.
  await expect(page.getByRole("button", { name: "Legg i handlekurven" }).first()).toBeDisabled();
});
