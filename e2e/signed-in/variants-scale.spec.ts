import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Variants at scale as the owner and a shopper use them (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.4 and B.5): the editor draws only the
 * rows on screen of a product of 2,048 variants, filters them by an option's value and sets a price for all shown; the shop offers a product of 12
 * variants as a list per option and marks the values that cannot be bought with the others chosen. The save and the reads at 2,048 variants are
 * held by variants-scale.int.test.ts; this holds the screens.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so no other spec changes these products. */
const STORE = "e2e-variants";
const COLOURS = Array.from({ length: 16 }, (_, i) => `Farge ${i + 1}`);
const SIZES = Array.from({ length: 16 }, (_, i) => `Str ${i + 1}`);
const FITS = Array.from({ length: 8 }, (_, i) => `Passform ${i + 1}`);
let bigId = "";
let market = "";
/** Each run makes its own products (a product is never deleted, D141's orders may name it). */
const RUN = Date.now().toString(36);
const SMALL = `e2e-genser-${RUN}`;

/** A product of every combination of the options given, priced 499 kr in every market, with the stock `stock` says, published when `active`. */
async function makeProduct(handle: string, options: Record<string, string[]>, stock: (combo: Record<string, string>) => number, active: boolean): Promise<string> {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const [maker] = await sql`
      insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
      values (${store.id}, 'E2E Maker', 'Hauptstrasse 1, 10115 Berlin', 'mail@maker.example', 'DE') returning id`;
    const [product] = await sql`
      insert into commerce.products (store_id, handle, status, tax_code, delivery, kind, manufacturer_id)
      values (${store.id}, ${handle}, 'draft', 'txcd_99999999', 'physical', 'goods', ${maker.id}) returning id`;
    await sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${store.id}, ${product.id}, 'nb-NO', ${`Genser ${handle}`})`;
    await sql`insert into commerce.product_media (store_id, product_id, url) values (${store.id}, ${product.id}, '/demo/lamp.svg')`;
    const combos = Object.entries(options).reduce<Record<string, string>[]>((all, [name, values]) => all.flatMap((c) => values.map((v) => ({ ...c, [name]: v }))), [{}]);
    let [location] = await sql`select id from commerce.inventory_locations where store_id = ${store.id} and active order by priority, created_at limit 1`;
    if (!location) [location] = await sql`insert into commerce.inventory_locations (store_id, name, country) values (${store.id}, 'Lager', 'NO') returning id`;
    // Set-based, so 2,048 variants are made in a few statements.
    const rows = combos.map((combo, i) => ({ sku: `${handle.toUpperCase()}-${i + 1}`, options: combo, n: i, stock: stock(combo) }));
    await sql`
      insert into commerce.product_variants (store_id, product_id, sku, options)
      select ${store.id}, ${product.id}, r->>'sku', r->'options'
      from jsonb_array_elements(${sql.json(rows)}) as r order by (r->>'n')::int`;
    await sql`
      select commerce.set_price(v.id, m.code, 49900)
      from commerce.product_variants v join commerce.markets m on m.store_id = v.store_id and m.active
      where v.product_id = ${product.id}`;
    await sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      select ${store.id}, v.id, ${location.id}, (r->>'stock')::int
      from jsonb_array_elements(${sql.json(rows)}) as r join commerce.product_variants v on v.product_id = ${product.id} and v.sku = r->>'sku'`;
    if (active) await sql`update commerce.products set status = 'active' where id = ${product.id}`;
    return String(product.id);
  } finally {
    await sql.end();
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Variants') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Variants', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [row] = await sql`
      select m.code from commerce.markets m join commerce.stores s on s.id = m.store_id where s.slug = ${STORE} and m.active order by m.created_at, m.code limit 1`;
    market = String(row.code).toLowerCase();
  } finally {
    await sql.end();
  }
  bigId = await makeProduct(`e2e-stor-${RUN}`, { Farge: COLOURS, Str: SIZES, Passform: FITS }, () => 3, false);
  // Green cannot be bought in any size; blue is sold out in M.
  await makeProduct(SMALL, { Farge: ["Rød", "Blå", "Grønn"], Str: ["S", "M", "L", "XL"] }, (c) => (c.Farge === "Grønn" || (c.Farge === "Blå" && c.Str === "M") ? 0 : 5), true);
});

test("draws only the rows on screen of 2,048 variants, filters them by a value and sets a price for all shown", async ({ page }) => {
  await page.goto(`/admin/${STORE}/products/${bigId}`);
  const table = page.locator("table[aria-rowcount]");
  await expect(table).toHaveAttribute("aria-rowcount", "2049");
  // Only the rows on screen are drawn, not all 2,048.
  await expect(table.locator("tbody[data-row-key]").first()).toBeVisible();
  const drawn = await table.locator("tbody[data-row-key]").count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(100);

  // The last variant is drawn once the end of the list is on screen.
  await table.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await expect(table.locator('tr[aria-rowindex="2049"]')).toBeVisible();

  // A filter by colour, then a price for the 128 shown.
  await page.getByRole("combobox", { name: "Farge", exact: true }).selectOption("Farge 3");
  await expect(page.getByText("Showing 128 of 2,048 variants")).toBeVisible();
  await page.getByRole("button", { name: "Set for all shown (128)", exact: true }).click();
  const panel = page.getByRole("group", { name: "Set for the 128 variants shown" });
  await panel.getByRole("textbox", { name: /^Price in / }).first().fill("777");
  await panel.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByText("Set for 128 variants. Save the product to keep it.")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved.").first()).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const prices = await sql<{ colour: string; amount: number }[]>`
      select distinct v.options->>'Farge' as colour, cp.amount_minor::int as amount
        from commerce.product_variants v
        join commerce.current_prices cp on cp.variant_id = v.id
        join commerce.markets m on m.store_id = v.store_id and m.code = cp.market_code
       where v.product_id = ${bigId}
         and m.code = (select code from commerce.markets where store_id = v.store_id and active order by created_at, code limit 1)
       order by 1, 2`;
    const third = prices.filter((p) => p.colour === "Farge 3");
    expect(third).toEqual([{ colour: "Farge 3", amount: 77700 }]);
    expect(prices.filter((p) => p.colour !== "Farge 3").every((p) => p.amount === 49900)).toBe(true);
  } finally {
    await sql.end();
  }
});

test("offers 12 variants as a list per option and marks the values that cannot be bought with the others chosen", async ({ page }) => {
  await page.goto(`/s/${STORE}/${market}/p/${SMALL}`);
  const colour = page.getByRole("combobox", { name: "Farge", exact: true });
  const size = page.getByRole("combobox", { name: "Str", exact: true });
  await expect(colour).toBeVisible();
  await expect(size).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Velg variant" })).toHaveCount(0);

  // Green has no size to buy: marked and skipped.
  await colour.click();
  const green = page.getByRole("option", { name: /Grønn/ });
  await expect(green).toHaveAttribute("aria-disabled", "true");
  await expect(green).toContainText("Ikke tilgjengelig");
  await page.getByRole("option", { name: /^Blå/ }).click();
  await expect(colour).toContainText("Blå");

  // Blue's sizes: M is sold out in blue, L can be bought.
  await size.click();
  await expect(page.getByRole("option", { name: /^M/ })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: /^L/ }).click();
  await expect(size).toContainText("L");
  await expect(page.getByRole("button", { name: "Legg i handlekurven" }).first()).toBeEnabled();
});
