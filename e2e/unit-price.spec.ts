import { expect, test, type Page } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb } from "./db";

/**
 * The price per kg, litre or metre beside the price (D160, docs/wave-1d-unit-price.md; row `international.unit-price-indication`): a signed-out
 * visitor sees it on the product page (and after choosing another variant), on the listing, in the cart and the slide-out cart and on the order
 * page, in Norwegian, Swedish and English, and the euro view works its own figure from the euro price it shows. Each test has a store of its own
 * (a copy of the template), so the measures set here touch no other test. The checkout page is held by its render test: there is no Stripe
 * session to open it with in a test.
 *
 * The template's mug costs 249,00 in Norway with a lower price than 30 days ago (299,00), so its reduced price is the case for "the unit price
 * is of the price charged, the 30-day reference never gets one". Black is 500 g and white 250 g, so the two variants have different figures:
 * black 249,00 / 0,5 kg = 498,00 per kg and white 249,00 / 0,25 kg = 996,00 per kg. The black one is the cheapest by SKU, so it is the headline.
 */

async function storeWithMeasures(): Promise<{ slug: string }> {
  const slug = `unit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Enhetsbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Enhetsbutikk', null) as id`;
    // The mug was dearer 40 days ago (299,00), so 249,00 is a genuine reduction with a 30-day reference (Omnibus), as the demo store's is.
    await sql`
      insert into commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from, valid_to)
      select p.store_id, p.variant_id, p.market_code, p.currency, 29900, p.valid_from - interval '40 days', p.valid_from
        from commerce.prices p join commerce.product_variants v on v.id = p.variant_id
       where p.store_id = ${id} and v.sku in ('DEMO-MUG-BLACK', 'DEMO-MUG-WHITE') and p.valid_to is null and p.market_code = 'NO'`;
    // English and euro views of a krone store (D109), at the seed's rates.
    await sql`update commerce.stores set locales = ARRAY['nb-NO', 'sv-SE', 'da-DK', 'en-GB'] where id = ${id}`;
    await sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${id}, 'NOK', 11.6, 1, 0), (${id}, 'SEK', 11.0, 1, 1), (${id}, 'DKK', 7.46, 1, 2), (${id}, 'EUR', 1, 1, 3)
      on conflict (store_id, currency) do update set rate = excluded.rate, round_to = excluded.round_to, position = excluded.position`;
    await sql`update commerce.product_variants set measure_amount = 500, measure_unit = 'g' where store_id = ${id} and sku = 'DEMO-MUG-BLACK'`;
    await sql`update commerce.product_variants set measure_amount = 250, measure_unit = 'g' where store_id = ${id} and sku = 'DEMO-MUG-WHITE'`;
    return { slug };
  } finally {
    await sql.end();
  }
}

/** A paid order with a measured line, as it was sold: 249,00 for 250 g, then the variant's content is changed (the order keeps what it said). */
async function paidOrder(slug: string): Promise<{ id: string; key: string }> {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    const number = `UP-${Date.now().toString(36)}`.toUpperCase();
    const key = `cs_${number}`;
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
        subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', ${`${number.toLowerCase()}@example.com`}, 'paid', 24900, 0, 4980, 24900, '{}', '{"line1":"Gata 1","postalCode":"0150","city":"Oslo","name":"Kari Nordmann"}')
      returning id`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code,
        measure_amount, measure_unit, measure_base)
      values (${store.id}, ${order.id}, 'DEMO-MUG-WHITE', 'Keramikkopp', 1, 24900, 24900, 4980, 0.25, 'txcd_99999999', 250, 'g', 'kg')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, 24900, 'NOK', 'captured')`;
    // The owner corrects the content afterwards: old orders keep what they were sold with.
    await sql`update commerce.product_variants set measure_amount = 1000 where store_id = ${store.id} and sku = 'DEMO-MUG-WHITE'`;
    return { id: String(order.id), key };
  } finally {
    await sql.end();
  }
}

const unitLines = (page: Page) => page.locator("[data-unit-price]:visible");

test("the product page shows the price per kg under the price, follows the chosen variant, and never gives the 30-day reference one", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);

  // The headline: the cheapest variant's price with its reduction, and the unit price of the price charged (249,00), not of the old 299,00.
  await expect(page.getByText("Laveste pris siste 30 dager").first()).toBeVisible();
  await expect(unitLines(page).first()).toContainText(/498,00\s*kr\/kg/);
  await expect(page.locator("body")).not.toContainText(/598,00|1\s?196,00/);

  // The variants' own block follows the chosen variant: black is 500 g, white 250 g.
  const variants = page.getByRole("region", { name: "Varianter" });
  await expect(variants.locator("[data-unit-price]:visible").first()).toContainText(/498,00\s*kr\/kg/);
  const choose = variants.getByRole("combobox", { name: "Velg variant" });
  await choose.click();
  await variants.getByRole("option", { name: /Farge: Hvit/ }).click();
  await expect(variants.locator("[data-unit-price]:visible").first()).toContainText(/996,00\s*kr\/kg/);

  // A screen reader hears the words, and the figure is not read twice.
  await expect(variants.locator("[data-unit-price]").first().locator(".sr-only")).toHaveText(/Enhetspris: 996,00\s*kr per kg/);
  await expect(variants.locator("[data-unit-price]").first().locator("[aria-hidden='true']")).toContainText(/996,00\s*kr\/kg/);
});

test("the product's structured data says the price per measure the way Google's merchant listing page does", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  await expect(page.locator("body")).toContainText("Demo: Keramikkopp");
  const graphs = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
  const data = JSON.stringify(graphs.map((text) => JSON.parse(text)));
  expect(data).toContain('"@type":"UnitPriceSpecification"');
  expect(data).toContain('"referenceQuantity":{"@type":"QuantitativeValue","value":"500","unitCode":"GRM","valueReference":{"@type":"QuantitativeValue","value":"1","unitCode":"KGM"}}');
  expect(data).toContain('"value":"250","unitCode":"GRM"');
});

test("the listing's card shows the unit price of the variant its price is of", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no/products`);
  const card = page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" });
  await expect(card.locator("[data-unit-price]")).toContainText(/498,00\s*kr\/kg/);
  // The bag has no content, so no line: a product without content looks as it did.
  await expect(page.getByRole("listitem").filter({ hasText: "Demo: Handlenett" }).locator("[data-unit-price]")).toHaveCount(0);
});

test("the cart shows it for one unit whatever the quantity", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  const variants = page.getByRole("region", { name: "Varianter" });
  await variants.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(variants.getByRole("status")).toContainText("Lagt i handlekurven.");

  await page.goto(`/s/${slug}/no/cart`);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  const lines = page.getByRole("list").filter({ hasText: "Demo: Keramikkopp" }).first();
  await expect(lines.locator("[data-unit-price]")).toContainText(/498,00\s*kr\/kg/);
  await page.getByLabel("Antall").fill("2");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(page.getByLabel("Antall")).toHaveValue("2");
  await expect(lines.locator("[data-unit-price]")).toContainText(/498,00\s*kr\/kg/);
  await expect(page.getByRole("complementary")).toContainText("498,00");
});

test.describe("on a phone, in Swedish", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

  test("the slide-out cart shows it too, with Sweden's own word for it", async ({ page }) => {
    const { slug } = await storeWithMeasures();
    await page.goto(`/s/${slug}/se/p/demo-keramikkopp`);
    await page.getByRole("button", { name: "Lägg i varukorgen", disabled: false }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Tillagd i varukorgen." }).first()).toBeVisible();
    await page.locator("header").getByRole("link", { name: /Varukorg/ }).click();
    const drawer = page.getByRole("dialog", { name: "Varukorg" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("[data-unit-price]")).toContainText(/498,00\s*kr\/kg/);
    await expect(drawer.locator("[data-unit-price] .sr-only")).toHaveText(/Jämförpris: 498,00\s*kr per kg/);
  });
});

test("the order page shows what the line was sold with, in Norwegian and English, even after the product's content changed", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  const order = await paidOrder(slug);
  await page.goto(`/s/${slug}/no/order/${order.id}?session_id=${order.key}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-unit-price]")).toContainText(/996,00\s*kr\/kg/);

  await page.goto(`/s/${slug}/no-en/order/${order.id}?session_id=${order.key}`);
  await expect(page.locator("[data-unit-price]")).toContainText(/996\.00\/kg/);
  await expect(page.locator("[data-unit-price] .sr-only")).toHaveText(/Unit price: .*996\.00 per kg/);
});

test("a euro view of a krone store works its own figure from the euro price shown", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no-en-eur/p/demo-keramikkopp`);
  const variants = page.getByRole("region", { name: "Variants" });
  const price = variants.locator("p.font-semibold, div > p.font-semibold").first();
  await expect(price).toContainText("€");
  const shownEuro = Number((await price.innerText()).replace(/[^\d.]/g, "").match(/\d+\.\d{2}/)?.[0]);
  expect(shownEuro).toBeGreaterThan(0);
  // 500 g: twice the price shown, to the cent (never converted from the krone figure).
  const unit = variants.locator("[data-unit-price]:visible").first();
  await expect(unit).toContainText(/€\d[\d,]*\.\d{2}\/kg/);
  const shownUnit = Number((await unit.locator("[aria-hidden='true']").innerText()).replace(/[^\d.]/g, "").match(/\d+\.\d{2}/)?.[0]);
  expect(Math.round(shownUnit * 100)).toBe(Math.round(shownEuro * 100) * 2);
});

test("the product page and the cart of a measured product have no serious accessibility violation", async ({ page }) => {
  const { slug } = await storeWithMeasures();
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  await expect(unitLines(page).first()).toBeVisible();
  expect(describeFindings(await violationsOn(page))).toEqual([]);
  const variants = page.getByRole("region", { name: "Varianter" });
  await variants.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(variants.getByRole("status")).toContainText("Lagt i handlekurven.");
  await page.goto(`/s/${slug}/no/cart`);
  await expect(page.locator("[data-unit-price]")).toBeVisible();
  expect(describeFindings(await violationsOn(page))).toEqual([]);
});
