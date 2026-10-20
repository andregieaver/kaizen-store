import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Back in stock (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.4). The seeded demo store's lamp is sold out and does not keep selling; with
 * back in stock on, its page asks for an address, and a typed one is told to confirm by email. Who is told when stock returns is held by
 * automations.int.test.ts.
 */

const LAMP = "/s/demo/no/p/demo-bordlampe";
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

async function backInStock(on: boolean) {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = 'demo'`;
    await sql`
      insert into commerce.automations (store_id, kind, enabled, enabled_at) values (${store.id}, 'back_in_stock', ${on}, case when ${on} then now() end)
      on conflict (store_id, kind) do update set enabled = excluded.enabled, enabled_at = excluded.enabled_at`;
  } finally {
    await sql.end();
  }
}

test.afterAll(() => backInStock(false));

test("a sold-out variant offers nothing while the store has it off", async ({ page }) => {
  await backInStock(false);
  await page.goto(LAMP);
  await expect(page.getByText("Utsolgt").filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("[data-back-in-stock]")).toHaveCount(0);
});

test("with it on, a shopper asks for a sold-out variant and is told to confirm by email", async ({ page }) => {
  await backInStock(true);
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
