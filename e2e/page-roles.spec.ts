import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A store's own blog, search and 404 pages (D112): published pages built in
 * the page builder, chosen for their places, with the standard pages shown
 * where none is chosen.
 */

const page = (title: string, slug: string, blocks: unknown[]) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: blocks.map((block, i) => ({ id: `row-${i}`, type: "row", layout: "1", columns: [{ id: `col-${i}`, blocks: [block] }] })),
});
const heading = (text: string) => ({ id: "h", type: "heading", text, level: 1 });

async function storeWithRoles(): Promise<string> {
  const slug = `roles-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Rollebutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Rollebutikk', null) as id`;
    const make = async (role: string, content: unknown) => {
      const [row] = await sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${(content as { slug: string }).slug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
      await sql`insert into commerce.page_roles (store_id, role, page_id) values (${id}, ${role}, ${row.id})`;
    };
    await make("blog", page("Vår blogg", "vaar-blogg", [heading("Nyheter fra oss"), { id: "g", type: "contentGrid", source: { type: "articles" }, categories: [], tags: [], sort: "newest", limit: 12, columns: { mobile: 1, tablet: 2, desktop: 3 }, show: { image: true, heading: true, excerpt: true, price: false, button: false }, buttonLabel: "", emptyText: "Ingen artikler ennå.", headingLevel: 2, excerptLines: 3, gap: 24 }]));
    await make("search", page("Finn", "finn", [heading("Finn det du leter etter"), { id: "s", type: "search" }]));
    await make("not_found", page("Ikke her", "ikke-her", [heading("Ups, ikke her"), { id: "b", type: "search", results: false }]));
  } finally {
    await sql.end();
  }
  return slug;
}

test("a store's own blog, search and 404 pages are shown at their places", async ({ page: browser, request }) => {
  const slug = await storeWithRoles();

  await browser.goto(`/s/${slug}/no/blog`);
  await expect(browser.getByRole("heading", { level: 1, name: "Nyheter fra oss" })).toBeVisible();
  // The demo's article, in the grid the page holds.
  await expect(browser.getByText("Nye produkter i høst")).toBeVisible();

  // The search page is a page of the store's with the search in it.
  await browser.goto(`/s/${slug}/no/search?q=notatbok`);
  await expect(browser.getByRole("heading", { level: 1, name: "Finn det du leter etter" })).toBeVisible();
  await expect(browser.getByRole("listitem").filter({ hasText: "Notatbok" }).first()).toBeVisible();
  await expect(browser.getByRole("combobox").first()).toHaveValue("notatbok");

  // An address that does not exist: the store's 404 page, with a 404 status.
  const missing = await request.get(`/s/${slug}/no/finnes-ikke`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("Ups, ikke her");
  await browser.goto(`/s/${slug}/no/finnes-ikke`);
  await expect(browser.getByRole("heading", { level: 1, name: "Ups, ikke her" })).toBeVisible();
  await expect(browser.getByRole("combobox")).toBeVisible();

  // The pages' own addresses lead to their places.
  const moved = await request.get(`/s/${slug}/no/vaar-blogg`, { maxRedirects: 0 });
  expect([301, 308]).toContain(moved.status());
  expect(moved.headers().location).toContain(`/s/${slug}/no/blog`);
  expect((await request.get(`/s/${slug}/no/ikke-her`)).status()).toBe(404);
});

test("a store with none chosen keeps the standard pages", async ({ page, request }) => {
  await page.goto("/s/demo/no/blog");
  await expect(page.getByRole("heading", { level: 1, name: "Blogg" })).toBeVisible();
  await page.goto("/s/demo/no/search?q=notatbok");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Søk");
  const missing = await request.get("/s/demo/no/finnes-ikke");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("Siden finnes ikke");
});

/**
 * The working pages (D113): the cart, sign-in, wishlists and cookies built in
 * the page builder, each holding the component that draws it, which draws
 * only on its own route.
 */
async function storeWithShopPages(roles: string[]): Promise<string> {
  const slug = `shop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Handlebutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Handlebutikk', null) as id`;
    for (const role of roles) {
      const content = page(`${role} egen`, `${role.replace("_", "-")}-egen`, [heading(`Egen ${role}`), { id: "p", type: "storePart", part: role }]);
      const [row] = await sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${content.slug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
      await sql`insert into commerce.page_roles (store_id, role, page_id) values (${id}, ${role}, ${row.id})`;
    }
    // A page that is no one's place holding a component: it draws nothing there.
    const stray = page("Ekstra", "ekstra-side", [heading("Ekstra side"), { id: "p", type: "storePart", part: "cart" }]);
    await sql`insert into commerce.pages (store_id, slug, draft, published, published_at) values (${id}, ${stray.slug}, ${sql.json(stray as never)}, ${sql.json(stray as never)}, now())`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a store's own cart, sign-in, wishlist and cookies pages hold the working components", async ({ page: browser, request }) => {
  const slug = await storeWithShopPages(["cart", "sign_in", "wishlist", "cookies"]);

  await browser.goto(`/s/${slug}/no/cart`);
  await expect(browser.getByRole("heading", { level: 1, name: "Egen cart" })).toBeVisible();
  await expect(browser.getByText("Handlekurven er tom.")).toBeVisible();

  // Signed out, My account is the store's sign-in page.
  await browser.goto(`/s/${slug}/no/account`);
  await expect(browser.getByRole("heading", { level: 1, name: "Egen sign_in" })).toBeVisible();
  await expect(browser.getByLabel("E-post")).toBeVisible();

  await browser.goto(`/s/${slug}/no/wishlist`);
  await expect(browser.getByRole("heading", { name: "Egen wishlist" })).toBeVisible();
  await expect(browser.getByRole("heading", { level: 1, name: "Ønskeliste" })).toBeVisible();

  await browser.goto(`/s/${slug}/no/cookies`);
  await expect(browser.getByRole("heading", { name: "Egen cookies" })).toBeVisible();
  await expect(browser.getByRole("heading", { level: 1, name: "Informasjonskapsler" })).toBeVisible();

  // A component elsewhere draws nothing; and the pages' own addresses lead to their places.
  await browser.goto(`/s/${slug}/no/ekstra-side`);
  await expect(browser.getByRole("heading", { level: 1, name: "Ekstra side" })).toBeVisible();
  await expect(browser.getByText("Handlekurven er tom.")).toHaveCount(0);
  const moved = await request.get(`/s/${slug}/no/cart-egen`, { maxRedirects: 0 });
  expect([301, 308]).toContain(moved.status());
  expect(moved.headers().location).toContain(`/s/${slug}/no/cart`);
  const signIn = await request.get(`/s/${slug}/no/sign-in-egen`, { maxRedirects: 0 });
  expect(signIn.headers().location).toContain(`/s/${slug}/no/account`);
});

test("My account page alone shows its sign-in form to shoppers who are not signed in", async ({ page: browser }) => {
  const slug = await storeWithShopPages(["account"]);
  await browser.goto(`/s/${slug}/no/account`);
  await expect(browser.getByRole("heading", { name: "Egen account" })).toBeVisible();
  await expect(browser.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();
  await expect(browser.getByLabel("E-post")).toBeVisible();
});

test("a store with none chosen keeps the standard cart, account and cookies pages", async ({ page }) => {
  await page.goto("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await page.goto("/s/demo/no/account");
  await expect(page.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();
  await page.goto("/s/demo/no/cookies");
  await expect(page.getByRole("heading", { level: 1, name: "Informasjonskapsler" })).toBeVisible();
});

/**
 * The cart, checkout and order pages in pieces (D117): a store's own page
 * lays them out as it likes, and each piece draws only on its own page.
 */
async function storeWithPieces(role: string, parts: string[]): Promise<{ slug: string; storeId: string }> {
  const slug = `pieces-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Delebutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Delebutikk', null) as id`;
    const content = page(`${role} deler`, `${role}-deler`, parts.map((part, i) => ({ id: `p${i}`, type: "storePart", part })));
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, ${content.slug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
    await sql`insert into commerce.page_roles (store_id, role, page_id) values (${id}, ${role}, ${row.id})`;
    return { slug, storeId: String(id) };
  } finally {
    await sql.end();
  }
}

test("a cart page lays out the cart's pieces in the owner's order", async ({ page: browser }) => {
  const { slug } = await storeWithPieces("cart", ["cart_summary", "cart_checkout", "cart_lines", "cart_continue"]);

  // Empty: the lines piece says so, and the pieces that need a cart draw nothing.
  await browser.goto(`/s/${slug}/no/cart`);
  await expect(browser.getByText("Handlekurven er tom.")).toBeVisible();
  await expect(browser.getByText("Sum varer")).toHaveCount(0);
  await expect(browser.getByRole("button", { name: /Til kassen/ })).toHaveCount(0);

  await browser.goto(`/s/${slug}/no/p/demo-handlenett`);
  await browser.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(browser.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
  await browser.goto(`/s/${slug}/no/cart`);

  // The summary comes before the lines, as the page was laid out; the standard page has it after.
  await expect(browser.getByText("Sum varer")).toBeVisible();
  await expect(browser.getByRole("link", { name: "Fortsett å handle" })).toBeVisible();
  const body = await browser.locator("main").innerText();
  expect(body.indexOf("Sum varer")).toBeGreaterThan(-1);
  expect(body.indexOf("Sum varer")).toBeLessThan(body.indexOf("Handlenett"));
  await expect(browser.getByRole("link", { name: "Fortsett å handle" })).toBeVisible();
  await expect(browser.getByLabel("Rabattkode")).toHaveCount(0);
});

test("an order page lays out the order's pieces, and a piece elsewhere draws nothing", async ({ page: browser }) => {
  const { slug, storeId } = await storeWithPieces("order", ["order_totals", "order_lines", "order_continue"]);
  const sql = testDb();
  let address: string;
  try {
    const [variant] = await sql`select v.id from commerce.product_variants v where v.store_id = ${storeId} and v.sku = 'DEMO-NOTEBOOK-LINED'`;
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor,
        tax_minor, total_minor, billing_address, shipping_address)
      values (${storeId}, 'E2E-2', 'NO', 'NOK', 'nb-NO', 'kunde@example.com', 'paid', 12900, 2580, 12900,
        '{"name": "Kunde"}', '{}')
      returning id`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor,
        total_minor, tax_minor, tax_rate, tax_code)
      values (${storeId}, ${order.id}, ${variant.id}, 'DEMO-NOTEBOOK-LINED', 'Notatbok stripete', 1, 12900, 12900, 2580, 0.25,
        'txcd_99999999')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}, ${order.id}, 'venue', ${`venue_e2e_${order.id}`}, 12900, 'NOK', 'pending')`;
    address = `/s/${slug}/no/order/${order.id}?session_id=venue_e2e_${order.id}`;
  } finally {
    await sql.end();
  }

  await browser.goto(address);
  await expect(browser.getByText("Notatbok stripete")).toBeVisible();
  const body = await browser.locator("main").innerText();
  // Totals first, then the lines, then the link; and no thank-you heading, since the page has no such piece.
  expect(body.indexOf("Totalt")).toBeGreaterThan(-1);
  expect(body.indexOf("Totalt")).toBeLessThan(body.indexOf("Notatbok stripete"));
  await expect(browser.getByRole("heading", { name: /Takk/ })).toHaveCount(0);
  await expect(browser.getByRole("link", { name: "Fortsett å handle" })).toBeVisible();

  // The order's pieces on another page draw nothing there.
  const stray = await storeWithPieces("cart", ["order_lines", "cart_lines"]);
  await browser.goto(`/s/${stray.slug}/no/cart`);
  await expect(browser.getByText("Handlekurven er tom.")).toBeVisible();
  await expect(browser.getByText("Notatbok stripete")).toHaveCount(0);
});
