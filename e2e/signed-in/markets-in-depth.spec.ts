import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Markets in depth as the owner meets them (wave 7 unit A, D335; rows international.market-specific-catalogs and
 * international.fixed-per-market-prices-and-adjustment-rules): Sweden's prices worked out from Norway's on the Countries page; a product's
 * Swedish price emptied in the editor and so worked out by the rule; the product taken out of Denmark in the editor (its price kept) and out of
 * that country's listing; and sold there again from the products list's bulk bar. The rules are held by market-prices.test.ts,
 * market-prices.int.test.ts, market-availability.int.test.ts and bulk-edit.int.test.ts; this holds the screens.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

let storeId = "";
let product = { id: "", title: "", handle: "", variant: "" };
let severalWasOn = false;
/** The rates this test gave the store (a new store has none), taken away again after. */
let addedRates: string[] = [];

/** The Features page's switch for Several countries, pressed until it says `on` (switching off asks for a confirmation first). */
async function severalCountries(page: Page, on: boolean) {
  await page.goto(`/admin/${E2E_STORE}/settings/features`);
  const toggle = page.getByRole("switch", { name: "Several countries", exact: true });
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  await toggle.click();
  if (!on) await page.getByRole("region", { name: "Switch off Several countries" }).getByRole("button", { name: "Switch off", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    const [store] = await sql`select id, 'countries' = any(features) as several from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    severalWasOn = Boolean(store.several);
    await sql`delete from commerce.market_availability where store_id = ${storeId}`;
    await sql`delete from commerce.market_price_rules where store_id = ${storeId}`;
    // Norwegian and Swedish kroner need rates for one's prices to be worked out from the other's; Danish kroner have none, as in a new store.
    const added = await sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${storeId}, 'NOK', 11.6, 1, 90), (${storeId}, 'SEK', 11.0, 1, 91)
      on conflict (store_id, currency) do nothing returning currency`;
    addedRates = added.map((r) => String(r.currency).trim());
    // A product with one variant, a picture and a price in Norway, Sweden and Denmark.
    const [found] = await sql<{ id: string; title: string; handle: string; variant: string }[]>`
      select p.id, t.title, p.handle, v.id as variant from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
        join commerce.product_variants v on v.product_id = p.id
       where p.store_id = ${storeId} and p.status = 'active' and p.kind = 'goods'
         and (select count(*) from commerce.product_variants x where x.product_id = p.id) = 1
         and exists (select 1 from commerce.product_media m where m.product_id = p.id)
         and (select count(*) from commerce.current_prices cp where cp.variant_id = v.id and cp.market_code in ('NO', 'SE', 'DK')) = 3
       order by p.created_at, p.handle limit 1`;
    expect(found).toBeTruthy();
    product = found;
  } finally {
    await sql.end();
  }
});

test.afterAll(async ({ browser }) => {
  const sql = testDb();
  try {
    await sql`delete from commerce.market_availability where store_id = ${storeId}`;
    await sql`delete from commerce.market_price_rules where store_id = ${storeId}`;
    await sql`update commerce.prices set derived = false where store_id = ${storeId} and valid_to is null and derived`;
    if (addedRates.length > 0) await sql`delete from commerce.store_currencies where store_id = ${storeId} and currency = any(${addedRates})`;
  } finally {
    await sql.end();
  }
  if (!severalWasOn) {
    const context = await browser.newContext({ storageState: OWNER.state });
    await severalCountries(await context.newPage(), false);
    await context.close();
  }
});

test("works Sweden's prices out from Norway's on the Countries page", async ({ page }) => {
  await severalCountries(page, true);
  await page.goto(`/admin/${E2E_STORE}/settings/countries`);
  const card = page.getByRole("region", { name: "Prices in each country" }).or(page.locator("section", { hasText: "Prices in each country" })).first();
  // Danish kroner have no rate: the preview says so, and nothing is kept.
  const denmark = card.getByTestId("price-rule-DK");
  await denmark.getByRole("combobox").first().selectOption({ index: 1 });
  await denmark.getByRole("button", { name: "Show five prices" }).click();
  await expect(denmark.getByRole("status")).toContainText("DKK has no rate", { timeout: 30_000 });

  const sweden = card.getByTestId("price-rule-SE");
  await sweden.getByRole("combobox").first().selectOption({ index: 1 });
  await sweden.getByRole("textbox", { name: /^Change, in %/ }).fill("10");
  // With VAT as it is, so the figure below depends on the two currencies' rates alone.
  await sweden.getByRole("combobox", { name: /^VAT/ }).selectOption("gross");
  await sweden.getByRole("button", { name: "Show five prices" }).click();
  await expect(sweden.getByRole("table")).toBeVisible({ timeout: 30_000 });
  await sweden.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sweden.getByRole("status")).toContainText("Saved.", { timeout: 30_000 });

  const sql = testDb();
  try {
    const [rule] = await sql`select market_code, base_market, percent_bps from commerce.market_price_rules where store_id = ${storeId}`;
    expect(rule).toEqual({ market_code: "SE", base_market: "NO", percent_bps: 1000 });
    const [basis] = await sql`select basis from commerce.market_price_rules where store_id = ${storeId}`;
    expect(basis.basis).toBe("gross");
  } finally {
    await sql.end();
  }
});

test("a Swedish price emptied in the editor follows the rule, and a product taken out of Denmark keeps its price there", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/${product.id}`);
  await page.getByRole("textbox", { name: /^Price in .* SEK$/ }).fill("");
  const soldIn = page.getByRole("group", { name: "Sold in" });
  await soldIn.getByRole("checkbox", { name: /Danmark|Denmark/ }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved.").first()).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const [no] = await sql`select amount_minor::int as a from commerce.current_prices where variant_id = ${product.variant} and market_code = 'NO'`;
    const [se] = await sql`select amount_minor::int as a, derived from commerce.kept_prices where variant_id = ${product.variant} and market_code = 'SE'`;
    // +10 %, converted at the store's rates and rounded half up to the smallest unit: within one öre of the exact figure.
    const rates = await sql`select currency, rate::float8 as rate from commerce.store_currencies where store_id = ${storeId} and currency in ('NOK', 'SEK')`;
    const rate = (c: string) => Number(rates.find((r) => String(r.currency).trim() === c)?.rate);
    expect(se.derived).toBe(true);
    expect(Math.abs(Number(se.a) - (Number(no.a) * 1.1 * rate("SEK")) / rate("NOK"))).toBeLessThanOrEqual(1);
    const off = await sql`select market_code, variant_id from commerce.market_availability where store_id = ${storeId} and product_id = ${product.id}`;
    expect(off.map((r) => [r.market_code, r.variant_id])).toEqual([["DK", null]]);
    const [dk] = await sql`select count(*)::int as n from commerce.kept_prices where variant_id = ${product.variant} and market_code = 'DK'`;
    expect(dk.n).toBe(1);
  } finally {
    await sql.end();
  }
  // Read again, the price is marked as the rule's.
  await page.reload();
  await expect(page.getByText("By the country's price rule").first()).toBeVisible();

  // Denmark's listing loads (another product is in it) without this one; Norway's has it.
  await expect(async () => {
    const dk = await page.goto(`/s/${E2E_STORE}/dk/products`);
    expect(dk?.ok()).toBe(true);
    await expect(page.locator(".product-card").first()).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(product.title, { exact: true })).toHaveCount(0);
  }).toPass({ timeout: 30_000 });
  await expect(async () => {
    const no = await page.goto(`/s/${E2E_STORE}/no/products`);
    expect(no?.ok()).toBe(true);
    await expect(page.getByText(product.title, { exact: true }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

test("sells the product in Denmark again from the products list's bulk bar", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products`);
  await page.getByRole("checkbox", { name: `Choose ${product.title}`, exact: true }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await bar.getByRole("button", { name: "Sell in", exact: true }).click();
  await bar.getByRole("checkbox", { name: /Danmark|Denmark/ }).check();
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await bar.getByRole("button", { name: "Apply to 1 product" }).click();
  await expect(bar.getByText("Sell in: done")).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const [n] = await sql`select count(*)::int as n from commerce.market_availability where store_id = ${storeId} and product_id = ${product.id}`;
    expect(n.n).toBe(0);
  } finally {
    await sql.end();
  }
});
