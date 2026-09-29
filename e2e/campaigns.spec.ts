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

test("product pages and cards announce running campaigns, and only what is the same for every shopper", async ({ page }) => {
  const slug = await storeWithCampaigns(async (id, sql) => {
    const [bag] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, ends_at) values (${id}, 'Sommersalg', 'percent', 20, now() + interval '3 days')`;
    await sql`insert into commerce.campaigns (store_id, name, kind, buy_quantity, pay_quantity, product_ids) values (${id}, 'Tre for to', 'multi_buy', 3, 2, ${sql.json([bag.id])})`;
    const [gift] = await sql`select v.id from commerce.product_variants v where v.store_id = ${id} and v.sku = 'DEMO-NOTEBOOK-LINED'`;
    await sql`insert into commerce.campaigns (store_id, name, kind, gift_variant_id, thresholds) values (${id}, 'Gratis notatbok', 'gift', ${gift.id}, '{"NO": 50000}'::jsonb)`;
    // Not announced: over, not started, for a customer group, and used up.
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, ends_at) values (${id}, 'Ferdig', 'percent', 50, now() - interval '1 day')`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, starts_at) values (${id}, 'Senere', 'percent', 50, now() + interval '2 days')`;
    const [tier] = await sql`insert into commerce.customer_tiers (store_id, name, percent) values (${id}, 'Grossist', 10) returning id`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, tier_ids) values (${id}, 'Kun grossist', 'percent', 60, ${sql.json([tier.id])})`;
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, usage_limit) values (${id}, 'Oppbrukt', 'percent', 70, 1)`;
    const [used] = await sql`select id from commerce.campaigns where store_id = ${id} and name = 'Oppbrukt'`;
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, campaign_discount_minor, billing_address, shipping_address)
      values (${id}, ${`K-${Date.now()}`}, 'NO', 'NOK', 'nb-NO', 'a@example.com', 'paid', 10000, 0, 7000, 600, 3000, 7000, '{}'::jsonb, '{}'::jsonb) returning id`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, title, sku, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, campaign_discount_minor, campaign_parts)
      values (${id}, ${order.id}, 'Vare', 'X', 1, 10000, 7000, 3000, 600, 0.25, 'txcd_99999999', 7000, ${sql.json([{ id: used.id, name: "Oppbrukt", minor: 7000 }])})`;
  });

  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  await expect(page.getByText("Sommersalg: 20 % rabatt")).toBeVisible();
  await expect(page.getByText("Tre for to: 3 for 2")).toBeVisible();
  await expect(page.getByText("Gratis notatbok: Gratis Demo: Notatbok A5 når du handler for 500,00 kr")).toBeVisible();
  await expect(page.getByText("Tilbudet trekkes fra i handlekurven.").first()).toBeVisible();
  await expect(page.getByText(/Til og med/)).toBeVisible();
  for (const name of ["Ferdig", "Senere", "Kun grossist", "Oppbrukt"]) await expect(page.getByText(name)).toHaveCount(0);

  // The bag is in the 3 for 2 too; the others only in the store-wide one.
  await page.goto(`/s/${slug}/no/products`);
  const bag = page.locator("li.product-card").filter({ hasText: "Handlenett" });
  await expect(bag.getByText("20 % rabatt").first()).toBeVisible();
  await expect(bag.getByText("3 for 2").first()).toBeVisible();
  const notebook = page.locator("li.product-card").filter({ hasText: "Notatbok" });
  await expect(notebook.getByText("20 % rabatt").first()).toBeVisible();
  await expect(notebook.getByText("3 for 2")).toHaveCount(0);
  // A gift is told on the product's page, not on every card.
  await expect(page.getByText("Gratis Demo: Notatbok")).toHaveCount(0);
});

test("an announcement stops when its campaign ends, without waiting for the page to refresh", async ({ page }) => {
  const slug = await storeWithCampaigns(async (id, sql) => {
    await sql`insert into commerce.campaigns (store_id, name, kind, percent, starts_at, ends_at) values (${id}, 'Kort', 'percent', 10, now() - interval '1 hour', now() + interval '4 seconds')`;
  });
  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  await expect(page.getByText("Kort: 10 % rabatt")).toBeVisible();
  await expect(page.getByText("Kort: 10 % rabatt")).toHaveCount(0, { timeout: 8000 });
});
