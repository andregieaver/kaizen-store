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
    // A rival in Norway (D900 M2) and offers read of its own product pages yesterday: a fifth cheaper than the store's dearest product there,
    // half as dear again as the next, and the third sold out.
    const [rival] = await sql`
      insert into commerce.market_rivals (store_id, market_code, name, host) values (${store.id}, 'NO', 'Linnet', 'linnet.example') returning id`;
    const [tote, second, third] = await sql`
      select p.id, min(cp.amount_minor) as price from commerce.products p
      join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id
      join commerce.current_prices cp on cp.store_id = v.store_id and cp.variant_id = v.id and cp.market_code = 'NO'
      where p.store_id = ${store.id} and p.status = 'active' group by p.id order by min(cp.amount_minor) desc, p.id limit 3`;
    await sql`
      insert into commerce.rival_offers (store_id, rival_id, product_id, address, name, price_minor, currency, availability, read_at)
      values (${store.id}, ${rival.id}, ${tote.id}, 'https://linnet.example/p/tote', 'Canvas tote', ${Math.round(Number(tote.price) * 0.8)}, 'NOK', 'in_stock', now() - interval '1 day'),
        (${store.id}, ${rival.id}, ${second.id}, 'https://linnet.example/p/two', 'Linen two', ${Math.round(Number(second.price) * 1.5)}, 'NOK', 'in_stock', now() - interval '1 day'),
        (${store.id}, ${rival.id}, ${third.id}, 'https://linnet.example/p/three', 'Linen three', ${Number(third.price)}, 'NOK', 'out_of_stock', now() - interval '1 day')`;
    // The watcher found the second one's price cut yesterday (D900 M3): it asked twice the store's price when its page was read before.
    await sql`
      update commerce.rival_offers set changed_at = read_at,
        previous = jsonb_build_object('priceMinor', ${Number(second.price) * 2}::bigint, 'currency', 'NOK', 'availability', 'in_stock',
          'shippingMinor', null, 'shippingCurrency', null, 'returnDays', null, 'readAt', now() - interval '31 days')
      where store_id = ${store.id} and address = 'https://linnet.example/p/two'`;
    await rivalSite(sql, store.id, rival.id);
  } finally {
    await sql.end();
  }
});

/**
 * What the watcher found on a rival's site (D905): first listed 20 days ago with 40 pages, read yesterday with eight new posts under
 * `/blogg` and two pages gone.
 */
async function rivalSite(sql: ReturnType<typeof testDb>, storeId: string, rivalId: string) {
  // The store's starter pages were published over a month ago: it published none in the 30 days.
  await sql`update commerce.pages set first_published_at = now() - interval '40 days' where store_id = ${storeId}`;
  // One moment for the first listing and the pages it found: they are where the rival started, never added.
  const since = new Date(Date.now() - 20 * 86_400_000).toISOString();
  await sql`
    update commerce.market_rivals set site_since = ${since}, site_read_at = now() - interval '1 day', site_pages = 46, site_cut = false
    where store_id = ${storeId} and id = ${rivalId}`;
  await sql`
    insert into commerce.rival_pages (store_id, rival_id, path, section, first_seen_at, gone_at)
    select ${storeId}, ${rivalId}, '/tjenester/side-' || n, '/tjenester', ${since}::timestamptz, case when n <= 2 then now() - interval '2 days' end
    from generate_series(1, 40) n`;
  await sql`
    insert into commerce.rival_pages (store_id, rival_id, path, section, first_seen_at)
    select ${storeId}, ${rivalId}, '/blogg/' || (array['linpleie', 'vask-av-ull', 'r%C3%B8de-puter', 'h%C3%B8st', 'gaver', 'nye-farger', 'om-lin', 'sommer'])[n], '/blogg',
      now() - make_interval(days => n)
    from generate_series(1, 8) n`;
}

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
    // Every finding drawn as a SWOT: the store cheaper than Linnet a strength, Linnet sold out an opportunity, its price cut a threat (M3).
    const swot = (part: string) => page.locator(`[data-swot="${part}"]`);
    await expect(swot("strengths").locator('[data-finding="strong_market"]')).toContainText("Visitors in Norway buy more");
    await expect(swot("strengths").locator('[data-finding="rival_dearer"]')).toContainText("Linnet asks");
    await expect(swot("weaknesses").locator('[data-finding="rival_cheaper"]')).toContainText("Linnet sells");
    await expect(swot("opportunities").locator('[data-finding="rival_out"]')).toContainText("cannot be bought now in Norway");
    await expect(swot("threats").locator('[data-finding="rival_move"]')).toContainText("Linnet cut its price");
    // Its site grew faster than the store's (D905): eight pages in 30 days, most under /blogg, against none of the store's.
    await expect(swot("threats").locator('[data-finding="rival_site"]')).toContainText("Linnet added 8 pages to its site in 30 days, most under /blogg; you published 0.");
    await expect(page.locator('[data-rival="linnet.example"] [data-rival-site]')).toContainText("46 pages · 8 added in 30 days · 2 gone · most under /blogg");
    await expect(page.getByRole("table", { name: "Rivals' offers" })).toContainText("Was ");
    if (shots) await page.locator('section[aria-labelledby="market-swot"]').screenshot({ path: `${shots}/markets-swot.png` });
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

test.describe("as a store's owner, keeping rivals", () => {
  test.use({ storageState: OWNER.state, viewport: { width: 1280, height: 900 } });

  test("adds a rival through the form and removes it again, both through the page's one server function", async ({ page }) => {
    await page.goto(`/admin/${slug}/analytics/markets?period=30d`);
    // Once the page has woken up (as the a11y spec's first key): a click on the fold while it hydrates can be undone, and the forms
    // answer only once they have hydrated.
    await expect(page.getByRole("region", { name: "What to do in your markets" }).locator("[data-finding]")).toHaveCount(3);
    await page.waitForLoadState("networkidle");
    await page.getByText("See every country and every finding").click();
    await expect(page.locator("[data-every-country]")).toHaveAttribute("open", "");
    const rivals = page.locator('section[aria-labelledby="market-rivals"]');
    await rivals.getByLabel("Rival's name").fill("Vev");
    await rivals.getByLabel("Web address").fill("https://www.vev.example/om");
    await rivals.getByRole("button", { name: "Add rival" }).click();
    await expect(rivals).toContainText("Vev is added.");
    const vev = rivals.locator('[data-rival="vev.example"]');
    await expect(vev).toContainText("Vev");
    await vev.getByRole("button", { name: "Remove Vev" }).click();
    await expect(vev).toHaveCount(0);
  });
});

test.describe("as the owner of a store without a shop (D905)", () => {
  test.use({ storageState: OWNER.state, viewport: { width: 1280, height: 900 } });
  let site = "";

  test.beforeAll(async () => {
    const store = await testStore("markets-site", ["countries"]);
    site = store.slug;
    const sql = testDb();
    try {
      const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
      await sql`insert into commerce.store_members (store_id, account_id, role) values (${store.id}, ${owner.id}, 'owner')`;
      await sql`update commerce.stores set features = array_remove(features, 'shop') where id = ${store.id}`;
      const [rival] = await sql`
        insert into commerce.market_rivals (store_id, market_code, name, host) values (${store.id}, 'NO', 'Linnet', 'linnet.example') returning id`;
      await rivalSite(sql, store.id, rival.id);
      await sql`insert into commerce.market_rivals (store_id, market_code, name, host) values (${store.id}, 'NO', 'Furu', 'furu.example')`;
      // A price Linnet shows for a course, kept two days ago and found on its page by code (D905 M5d): the store asks a third more.
      await sql`
        insert into commerce.rival_service_prices (store_id, rival_id, service, price_minor, currency, per, own_minor, source, checked_on, on_page)
        values (${store.id}, ${rival.id}, 'Linkurs, 3 timer', 90000, 'NOK', 'once', 120000, 'https://linnet.example/kurs', current_date - 2, true)`;
      // Words it follows in search (D905 M5b), searched two days ago: behind Linnet for one, first for another, one not searched yet.
      await sql`
        insert into commerce.search_terms (store_id, market_code, term, checked_at, own_position, positions, previous_position, previous_at, tried_at)
        values (${store.id}, 'NO', 'linkurs oslo', now() - interval '2 days', 6, '{"linnet.example": 2}', 8, now() - interval '32 days', now() - interval '2 days'),
          (${store.id}, 'NO', 'ullkurs', now() - interval '2 days', 1, '{}', null, null, now() - interval '2 days'),
          (${store.id}, 'NO', 'strikkekurs', null, null, '{}', null, null, null)`;
      // Speed by Chrome's measure (D905 M5c), read two days ago: the store's own slow to show its content, Linnet fast, Furu too small.
      await sql`
        insert into commerce.site_speeds (store_id, site, own, lcp_ms, inp_ms, cls_milli, period_end, checked_at, tried_at, problem)
        values (${store.id}, ${`kaizenaflow.com/s/${store.slug}`}, true, 4800, 180, 120, current_date - 4, now() - interval '2 days', now() - interval '2 days', null),
          (${store.id}, 'linnet.example', false, 1900, 150, 20, current_date - 4, now() - interval '2 days', now() - interval '2 days', null),
          (${store.id}, 'furu.example', false, null, null, null, null, null, now() - interval '2 days', 'none')`;
    } finally {
      await sql.end();
    }
  });

  test("keeps rivals and sees what changed on their sites, without offers to read", async ({ page }) => {
    await page.goto(`/admin/${site}/analytics/markets?period=30d`);
    await expect(page.getByRole("heading", { name: "Markets", level: 1 })).toBeVisible();
    const findings = page.getByRole("region", { name: "What to do in your markets" });
    await expect(findings.locator('[data-finding="rival_site"]')).toContainText("Linnet added 8 pages to its site in 30 days");
    // The rivals are in Lisa's fold, a step away: opened once the page has woken up.
    await page.waitForLoadState("networkidle");
    await page.getByText("See every country and every finding").click();
    await expect(page.locator("[data-every-country]")).toHaveAttribute("open", "");
    const rivals = page.locator('section[aria-labelledby="market-rivals"]');
    await expect(rivals.locator('[data-rival="linnet.example"] [data-rival-site]')).toContainText("46 pages · 8 added in 30 days · 2 gone");
    await expect(rivals.locator('[data-rival="linnet.example"]').getByRole("link", { name: "/blogg/linpleie" })).toHaveAttribute("href", "https://linnet.example/blogg/linpleie");
    // A rival just added is read by the watcher within minutes.
    await expect(rivals.locator('[data-rival="furu.example"]')).toContainText("Its site is read within a few minutes.");
    await expect(rivals.getByRole("button", { name: "Add rival" })).toBeVisible();
    await expect(rivals.getByRole("button", { name: "Read the page" })).toHaveCount(0);
    // Their published prices (D905 M5d): the course against the store's own, a weakness found by code.
    await expect(findings.locator('[data-finding="service_cheaper"]')).toContainText("Linnet asks");
    const prices = rivals.locator("[data-service-prices]");
    await expect(prices.locator('[data-service-price="Linnet: Linkurs, 3 timer"]')).toContainText("you are 33 % dearer");
    await expect(prices.locator('[data-service-price="Linnet: Linkurs, 3 timer"]')).toContainText("On its page");
    // Keeping one through the form: the page cannot be read from here, so it is kept unconfirmed.
    await prices.getByText("Keep a price").click();
    await prices.locator('select[name="rival"]').selectOption({ label: "Linnet" });
    await prices.getByLabel("Their service").fill("Ullkurs");
    await prices.getByLabel("Their price").fill("400");
    await prices.getByLabel("The page it is on").fill("https://linnet.example/ull");
    await prices.getByLabel("Your price for it").fill("450");
    await prices.getByRole("button", { name: "Keep the price" }).click();
    await expect(prices).toContainText("Kept: Ullkurs at");
    await expect(prices.locator('[data-service-price="Linnet: Ullkurs"]')).toContainText("Page not read");
    // Where it comes up in search (D905 M5b): each place counted by code, behind a rival a weakness.
    const words = page.locator('section[aria-labelledby="market-search"]');
    await expect(words.locator('[data-search-term="linkurs oslo"]')).toContainText("You: number 6 (up 2) · Linnet: number 2 · Furu: not on the first page");
    await expect(words.locator('[data-search-term="strikkekurs"]')).toContainText("Searched within a few minutes.");
    await expect(page.locator('[data-finding="search_behind"]').first()).toContainText("Linnet is number 2 in a search for “linkurs oslo” in Norway; you are number 6.");
    await words.getByLabel("Word").fill("Lin Workshop");
    await words.getByRole("button", { name: "Follow the word" }).click();
    await expect(words).toContainText("“lin workshop” is followed");
    await expect(words.locator('[data-search-term="lin workshop"]')).toContainText("Searched within a few minutes.");
    // How fast its site is (D905 M5c): each figure rated by Google's thresholds, a rival good where the store is poor a weakness.
    const speed = page.locator('section[aria-labelledby="market-speed"]');
    await expect(speed.getByRole("row", { name: /Linnet/ })).toContainText("1.9 s · Good");
    await expect(speed.getByRole("row", { name: /Your site/ })).toContainText("4.8 s · Poor");
    await expect(speed.getByRole("row", { name: /Furu/ })).toContainText("Too few Chrome visitors to measure");
    await expect(page.locator('[data-finding="speed_behind"]').first()).toContainText("Linnet's pages show their main content in 1.9 s");
    if (shots) {
      await speed.screenshot({ path: `${shots}/markets-speed.png` });
      await words.screenshot({ path: `${shots}/markets-search.png` });
      await page.screenshot({ path: `${shots}/markets-site-computer.png` });
      await rivals.screenshot({ path: `${shots}/markets-site-rivals.png` });
      await prices.screenshot({ path: `${shots}/markets-service-prices.png` });
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
    // Its rivals are other store platforms (D900 M4), kept beside its plans.
    await expect(page.getByRole("link", { name: "Open other platforms' prices" })).toHaveAttribute("href", "/admin/platform/plans#platform-rivals");
  });

  test("keeps the platform's Chrome UX Report key on Platform → AI, shown by its hint only (D905 M5c)", async ({ page }) => {
    await page.goto("/admin/platform/ai");
    const card = page.locator('section[aria-labelledby="site-speed"]');
    await expect(card).toContainText("Not set up: no site's speed is measured.");
    await page.waitForLoadState("networkidle");
    await card.getByLabel("Chrome UX Report API key").fill("AIzaE2eSpeedKey9876");
    await card.getByRole("button", { name: "Save site speed" }).click();
    await expect(card).toContainText("Saved key: …9876");
    await expect(card.getByLabel("Chrome UX Report API key")).toHaveValue("");
    if (shots) await card.screenshot({ path: `${shots}/platform-speed-key.png` });
    await card.getByRole("button", { name: "Remove the key" }).click();
    await expect(card).toContainText("Not set up: no site's speed is measured.");
  });

  test("sees other platforms' prices beside Kaizena Flow's plans, each against a plan of its own (D900 M4)", async ({ page }) => {
    const sql = testDb();
    try {
      const [plan] = await sql`insert into commerce.plans (name, position) values (${`Starter ${run}`}, 98) returning id`;
      await sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${plan.id}, 'EUR', 'month', 3900)`;
      await sql`
        insert into commerce.platform_rival_prices (platform, plan, price_minor, currency, interval, fee_bps, plan_id, source, checked_on, on_page)
        values (${`Shopify ${run}`}, 'Basic', 2900, 'EUR', 'month', 200, ${plan.id}, 'https://www.shop.example/pricing', current_date, true),
          (${`Wix ${run}`}, 'Core', 3600, 'EUR', 'month', null, ${plan.id}, 'https://wix.example/plans', current_date - 30, false)`;
      await sql`update commerce.platform_rival_prices set gone_at = now() where platform = ${`Wix ${run}`}`;
    } finally {
      await sql.end();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/platform/plans");
    const card = page.locator('section[aria-labelledby="platform-rivals"]');
    await expect(card.getByRole("heading", { name: "Other platforms' prices" })).toBeVisible();
    const shopify = card.locator(`[data-platform-price="Shopify ${run} Basic"]`);
    await expect(shopify).toContainText(`against your Starter ${run}`);
    await expect(shopify).toContainText("you are 34 % dearer");
    await expect(shopify).toContainText("On its page");
    await expect(card.locator(`[data-platform-price="Wix ${run} Core"]`)).toContainText("Gone from its page: check it");
    await expect(card.getByText("Add another platform's price")).toBeVisible();
    if (shots) await card.screenshot({ path: `${shots}/platform-rivals.png` });
  });
});
