import { expect, test } from "@playwright/test";
import type postgres from "postgres";

import { storePageWith, testDb, testStore } from "./db";

/**
 * The storefront components of D557 and D558: a product tile's stock left and its quantity chooser with Add to cart (the store's
 * product settings, or the grid's own choice), and the basket's notes on a page chosen for the cart (how far the cart is from free
 * shipping, and what it saves against the lowest price of the last 30 days), with the product page's own *You saved* part.
 */

const grid = (shopTiles?: { stock?: "show" | "hide"; quantity?: "show" | "hide" }) => ({
  id: "grid",
  type: "contentGrid",
  source: { type: "products" },
  categories: [],
  tags: [],
  sort: "title",
  limit: 12,
  columns: { mobile: 2, tablet: 2, desktop: 4 },
  show: { image: false, heading: true, excerpt: false, price: true, button: false },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 2,
  gap: 16,
  ...(shopTiles && { shopTiles }),
});

test("a grid that shows them gives tiles their stock and a quantity chooser that adds to the cart", async ({ page }) => {
  const address = await storePageWith("tiles", [grid({ stock: "show", quantity: "show" })]);
  await page.goto(address);
  // The facts come after the page, from one request for every tile.
  const tote = page.locator("li[data-item-id]").filter({ hasText: "Demo: Handlenett i lerret" });
  await expect(tote.locator("[data-tile-stock]")).toHaveText("På lager");
  // A product with several variants says its stock and keeps its link: nothing to choose on the tile.
  const notebook = page.locator("li[data-item-id]").filter({ hasText: "Demo: Notatbok A5" });
  await expect(notebook.locator("[data-tile-stock]")).toBeVisible();
  await expect(notebook.getByRole("button", { name: "Legg i handlekurven" })).toHaveCount(0);
  // A service has no stock to tell and nothing to add from a tile.
  await expect(page.locator("li[data-item-id]").filter({ hasText: "Demo: Massasje" }).locator("[data-tile-shop]")).toHaveCount(0);

  await tote.getByRole("button", { name: "Øk antall" }).click();
  await expect(tote.getByRole("spinbutton", { name: "Antall" })).toHaveValue("2");
  await tote.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(tote.getByText("Lagt i handlekurven.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Handlekurv (2)" }).first()).toBeAttached();
});

test("a grid that follows the store shows nothing until the store's product settings switch it on", async ({ page }) => {
  const address = await storePageWith("tiles-store", [grid()]);
  const slug = address.split("/")[2];
  await page.goto(address);
  const tote = page.locator("li[data-item-id]").filter({ hasText: "Demo: Handlenett i lerret" });
  await expect(tote).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-tile-shop]")).toHaveCount(0);

  const sql = testDb();
  try {
    // Settings, Products: the stock left only. Read per request with the stock, so no cache is in the way.
    await sql`
      insert into commerce.product_settings (store_id, tile_stock, tile_quantity)
      select id, true, false from commerce.stores where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(tote.locator("[data-tile-stock]")).toHaveText("På lager");
  await expect(tote.getByRole("button", { name: "Legg i handlekurven" })).toHaveCount(0);
});

/** A published page of the store, chosen for `role` when given. Returns nothing: the role's own address shows it. */
async function rolePage(sql: postgres.Sql, storeId: string, slug: string, blocks: postgres.JSONValue[], role: string | null, type = "page") {
  const content: postgres.JSONValue = {
    title: slug,
    slug,
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [{ id: "row", type: "row", layout: "1", columns: [{ id: "column", blocks }] }],
  };
  const [page] = await sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}, ${type}, ${slug}, ${sql.json(content)}, ${sql.json(content)}, now()) returning id`;
  if (role) await sql`insert into commerce.page_roles (store_id, role, page_id) values (${storeId}, ${role}, ${page.id})`;
  return String(page.id);
}

test("the cart's notes say how far it is from free shipping and what it saves, and the product page says its own saving", async ({ page }) => {
  const { slug, id } = await testStore("notes");
  const sql = testDb();
  try {
    // A reduction to show: the tote bag's own variant gives way to one that cost 299 kr until yesterday and 199 kr since.
    const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    await sql`update commerce.product_variants set active = false where product_id = ${product.id}`;
    const [variant] = await sql`
      insert into commerce.product_variants (store_id, product_id, sku, options)
      values (${id}, ${product.id}, 'E2E-TOTE-SALE', '{}'::jsonb) returning id`;
    await sql`select commerce.set_price(${variant.id}, 'NO', 29900, now() - interval '40 days')`;
    await sql`select commerce.set_price(${variant.id}, 'NO', 19900, now() - interval '1 day')`;
    const [location] = await sql`select id from commerce.inventory_locations where store_id = ${id} order by created_at limit 1`;
    await sql`insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${id}, ${variant.id}, ${location.id}, 20)`;

    // The page chosen for the cart: the two notes over the cart's own lines.
    await rolePage(sql, id, "kurv", [
      { id: "free", type: "storePart", part: "free_shipping" },
      { id: "saved", type: "storePart", part: "you_saved" },
      { id: "lines", type: "storePart", part: "cart_lines" },
    ], "cart");
    // The store's product layout with the product's own saving under its price.
    const layout = await rolePage(sql, id, "produkt", [
      { id: "title", type: "product", part: "title" },
      { id: "price", type: "product", part: "price" },
      { id: "you", type: "product", part: "you_saved" },
      { id: "buy", type: "product", part: "buy" },
    ], null, "product_layout");
    await sql`update commerce.stores set product_layout_id = ${layout} where id = ${id}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/p/demo-handlenett`);
  await expect(page.locator('[data-shop-note="you_saved"]')).toContainText("I dag sparer du 100,00 kr");
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();

  await page.goto(`/s/${slug}/cart`);
  // The market's rate is free from 999 kr: 199 kr in the cart leaves 800 kr.
  const free = page.locator('[data-shop-note="free_shipping"]');
  await expect(free).toContainText("Handle for 800,00 kr til for fri frakt");
  await expect(free.getByRole("progressbar", { name: "På vei mot fri frakt" })).toHaveAttribute("aria-valuenow", "19");
  await expect(page.locator('[data-shop-note="you_saved"]')).toContainText("I dag sparer du 100,00 kr");
});
