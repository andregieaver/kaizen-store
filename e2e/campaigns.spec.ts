import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A store's campaigns (D114): offers without a code, for a time. A shopper
 * sees what they give in the cart, and a free product added to it.
 */

async function storeWithCampaigns(campaigns: (storeId: string, sql: ReturnType<typeof testDb>) => Promise<void>): Promise<string> {
  const slug = `camp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Kampanjebutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Kampanjebutikk', null) as id`;
    await campaigns(String(id), sql);
  } finally {
    await sql.end();
  }
  return slug;
}

test("3 for 2 takes the cheapest free, and a free product is added over an amount", async ({ page }) => {
  const slug = await storeWithCampaigns(async (id, sql) => {
    await sql`insert into commerce.campaigns (store_id, name, kind, buy_quantity, pay_quantity) values (${id}, 'Tre for to', 'multi_buy', 3, 2)`;
    const [gift] = await sql`select v.id from commerce.product_variants v where v.store_id = ${id} and v.sku = 'DEMO-NOTEBOOK-LINED'`;
    await sql`
      insert into commerce.campaigns (store_id, name, kind, gift_variant_id, thresholds)
      values (${id}, 'Gratis notatbok', 'gift', ${gift.id}, '{"NO": 30000}'::jsonb)`;
  });

  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
  await page.goto(`/s/${slug}/no/cart`);
  const summary = page.getByRole("complementary");

  // One bag at 199,00: nothing free, and under the amount for the notebook.
  await expect(summary).not.toContainText("Rabatt (");
  await expect(page.getByText("Gave: Gratis notatbok")).toHaveCount(0);

  // Three bags: one free (−199,00), 398,00 left, over 300,00: a free notebook.
  await page.getByLabel("Antall").fill("3");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(summary).toContainText("Rabatt (Tre for to)");
  await expect(summary).toContainText("−199,00");
  await expect(page.getByText("Gave: Gratis notatbok")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Gratis notatbok" }).getByText("Gratis", { exact: true })).toBeVisible();
  // 3 × 199,00 − 199,00 + 99,00 shipping.
  await expect(summary).toContainText("497,00");
});

test("a campaign that has not started, has ended or is switched off gives nothing", async ({ page }) => {
  const slug = await storeWithCampaigns(async (id, sql) => {
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, starts_at) values (${id}, 'Senere', 'percent', 50, now() + interval '1 day')`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, ends_at) values (${id}, 'Over', 'percent', 50, now() - interval '1 day')`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, active) values (${id}, 'Av', 'percent', 50, false)`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, starts_at, ends_at) values (${id}, 'Nå', 'percent', 10, now() - interval '1 day', now() + interval '1 day')`;
  });
  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
  await page.goto(`/s/${slug}/no/cart`);
  const summary = page.getByRole("complementary");
  // Only the running 10 %: 19,90 off 199,00.
  await expect(summary).toContainText("Rabatt (Nå)");
  await expect(summary).toContainText("−19,90");
  await expect(summary).not.toContainText("Senere");
});
