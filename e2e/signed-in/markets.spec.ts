import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";

import { ADMIN, OWNER } from "./accounts";

/**
 * The market check's first step (D900 M1) as an owner meets it: a store of its own selling in Norway, Sweden, Denmark and Germany, with a
 * month of visits, orders and searches. Analytics → Markets opens on three findings of three kinds, each with the page that fixes it, and
 * every country's figures one step away. Kaizena Flow's own store says what does not apply to it. With `MARKET_SHOTS` set to a folder it also
 * keeps screenshots of the screens.
 */

const shots = process.env.MARKET_SHOTS;
// Screenshots for people are taken sharp; the checks themselves run as every other spec does.
test.use({ deviceScaleFactor: shots ? 2 : 1 });
const run = Date.now().toString(36);
let slug = "";

test.beforeAll(async () => {
  // Germany is added before anything of the store is cached, and visits are counted from the start.
  const store = await testStore("markets", ["countries"]);
  slug = store.slug;
  const sql = testDb();
  try {
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${store.id}, ${owner.id}, 'owner')`;
    await sql`update commerce.stores set visit_counting = true where id = ${store.id}`;
    await sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.id}, 'DE', 'EUR', 'de-DE', '{de-DE}', true)
      on conflict (store_id, code) do update set active = true`;
    // The demo catalogue becomes the store's own: priced in the Nordic countries it came with, never in Germany, and not named in German.
    await sql`update commerce.products set handle = replace(handle, 'demo-', 'own-') where store_id = ${store.id}`;
    await sql`delete from commerce.store_demo_items where store_id = ${store.id}`;
    // Visits over ten days, and paid orders from shoppers' checkouts: Germany buys far less than the rest, Norway far more.
    const countries = [
      { code: "NO", visits: 1200, orders: 48 },
      { code: "SE", visits: 600, orders: 21 },
      { code: "DK", visits: 400, orders: 12 },
      { code: "DE", visits: 900, orders: 4 },
    ];
    for (const c of countries) {
      await sql`
        insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path)
        select ${store.id}, (current_date - (g % 10)), substr(md5(${`${run}-${c.code}-`} || g), 1, 24), ${c.code}, 'mobile', 'direct', '/'
        from generate_series(1, ${c.visits}) g`;
      const orders = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
          tax_minor, total_minor, billing_address, shipping_address, placed_at)
        select ${store.id}, ${`MK-${run}-${c.code}-`} || g, ${c.code}, 'NOK', 'nb-NO', 'kari@example.com', 'paid', 49900, 0, 0, 9980, 49900,
          '{}'::jsonb, '{}'::jsonb, now() - (g % 9) * interval '1 day'
        from generate_series(1, ${c.orders}) g
        returning id`;
      for (const o of orders) {
        await sql`
          insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
          values (${store.id}, ${o.id}, 'stripe', ${`pi_${run}_${String(o.id).slice(0, 8)}`}, 49900, 'NOK', 'captured')`;
      }
    }
    // Searches that found nothing: "leinen" in Germany most of all.
    const misses = [
      { code: "DE", query: "leinen", n: 23 },
      { code: "DE", query: "bettwäsche", n: 9 },
      { code: "SE", query: "linne", n: 7 },
      { code: "NO", query: "ullpledd", n: 4 },
      { code: "NO", query: "leinen", n: 2 },
    ];
    for (const m of misses) {
      await sql`
        insert into commerce.search_queries (store_id, market_code, query, results, meaning_results, created_at)
        select ${store.id}, ${m.code}, ${m.query}, 0, 0, now() - (g % 7) * interval '1 day' from generate_series(1, ${m.n}) g`;
    }
    await sql`
      insert into commerce.search_queries (store_id, market_code, query, results, meaning_results, created_at)
      select ${store.id}, 'NO', 'kopp', 4, 0, now() - interval '1 day' from generate_series(1, 30)`;
    // A rival in Norway (D900 M2) and an offer read of its own product page yesterday: a fifth cheaper than the store's tote bag there.
    const [rival] = await sql`
      insert into commerce.market_rivals (store_id, market_code, name, host) values (${store.id}, 'NO', 'Linnet', 'linnet.example') returning id`;
    const [tote] = await sql`
      select p.id, min(cp.amount_minor) as price from commerce.products p
      join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id
      join commerce.current_prices cp on cp.store_id = v.store_id and cp.variant_id = v.id and cp.market_code = 'NO'
      where p.store_id = ${store.id} and p.status = 'active' group by p.id order by min(cp.amount_minor) desc limit 1`;
    await sql`
      insert into commerce.rival_offers (store_id, rival_id, product_id, address, name, price_minor, currency, availability, read_at)
      values (${store.id}, ${rival.id}, ${tote.id}, 'https://linnet.example/p/tote', 'Canvas tote', ${Math.round(Number(tote.price) * 0.8)}, 'NOK', 'in_stock', now() - interval '1 day')`;
  } finally {
    await sql.end();
  }
});

test.describe("as a store's owner", () => {
  test.use({ storageState: OWNER.state, viewport: { width: 1280, height: 900 } });

  test("opens on three things to do in three kinds, and every country's figures are one step away", async ({ page }) => {
    await page.goto(`/admin/${slug}/analytics/markets?period=30d`);
    await expect(page.getByRole("heading", { name: "Markets", level: 1 })).toBeVisible();
    const todo = page.getByRole("region", { name: "What to do in your markets" });
    const cards = todo.locator("[data-finding]");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute("data-finding", "weak_market");
    await expect(cards.nth(0)).toContainText("Visitors in Germany buy less: 0.4 % of visits end in an order, against 3.7 % in your other countries.");
    await expect(cards.nth(1)).toContainText("Shoppers searched for “leinen” 25 times and found nothing, most of them in Germany.");
    // A rival a fifth cheaper (D900 M2) comes before the missing German names, which wait past the three.
    await expect(cards.nth(2)).toHaveAttribute("data-finding", "rival_cheaper");
    await expect(cards.nth(2)).toContainText("Linnet sells");
    // Each finding links to the page that fixes it.
    await expect(cards.nth(1).getByRole("link", { name: "See searches" })).toHaveAttribute("href", `/admin/${slug}/search`);
    if (shots) await page.screenshot({ path: `${shots}/markets-computer.png` });

    // Lisa's step: the countries side by side, the findings past the three and the searches that found nothing in each country.
    await page.getByText("See every country and every finding").click();
    const table = page.getByRole("table", { name: "Your countries side by side" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row", { name: /Germany/ })).toContainText("900");
    await expect(page.locator('[data-every-country] [data-finding="unpriced"]')).toContainText("have no price in Germany");
    await expect(page.locator('[data-every-country] [data-finding="strong_market"]')).toContainText("Visitors in Norway buy more");
    await expect(page.locator('[data-market-terms="DE"]')).toContainText("leinen");
    // The rival and its offer, a fifth cheaper: the store 25 % dearer, worked out by code.
    await expect(page.locator('[data-rival="linnet.example"]')).toContainText("Linnet");
    await expect(page.getByRole("table", { name: "Rivals' offers" })).toContainText("+25 %");
    await expect(page.locator('[data-every-country] [data-finding="untranslated"]')).toContainText("have no name in German");
    if (shots) await page.locator('section[aria-labelledby="market-rivals"]').screenshot({ path: `${shots}/markets-rivals.png` });
    if (shots) {
      await page.screenshot({ path: `${shots}/markets-every-country.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/${slug}/analytics/markets?period=30d`);
      await expect(page.getByRole("heading", { name: "Markets", level: 1 })).toBeVisible();
      await page.screenshot({ path: `${shots}/markets-phone.png`, fullPage: true });
    }
  });
});

test.describe("as Kaizena Flow's platform admin", () => {
  test.use({ storageState: ADMIN.state });

  test("reads Kaizena Flow's own store's markets without orders or prices, and is told why", async ({ page }) => {
    await page.goto("/admin/kaizenaflow/analytics/markets");
    await expect(page.getByRole("heading", { name: "Markets", level: 1 })).toBeVisible();
    await expect(page.getByText("Kaizena Flow sells plans, not goods", { exact: false })).toBeVisible();
    await page.getByText("See every country and every finding").click();
    await expect(page.getByRole("columnheader", { name: "Average order" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "No price" })).toHaveCount(0);
  });
});
