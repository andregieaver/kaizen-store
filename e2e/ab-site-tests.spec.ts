import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { storePageWith, testDb } from "./db";

/**
 * A/B tests of what every page shows (D148, phase 3): a store whose header is under test. A visitor given version B is served
 * every page of the store with that header, however they move about (a full load, a click on a link, a server action), at the
 * same addresses; a visitor in the original, or who refused statistics, has the header as it is.
 */

const heading = (id: string, text: string) => ({ id, type: "heading", text, level: 2 });
const content = (title: string, slug: string, text: string) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: [{ id: "row-h", type: "row", layout: "1", columns: [{ id: "col-h", blocks: [heading("head-1", text)] }] }],
});

/** A store whose header says "Header A", with a running test of it whose version B says "Header B". */
async function headerTest() {
  const address = await storePageWith("abh", [{ id: "h1", type: "heading", text: "Side", level: 1 }]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    const experiment = randomUUID();
    const original = content("Topp", `ab-topp-${slug}`, "Header A");
    const version = content("Topp B", `ab-${experiment.slice(0, 8)}-b`, "Header B");
    const [header] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${original.slug}, 'header', ${sql.json(original)}, ${sql.json(original)}, now()) returning id`;
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${version.slug}, 'variant', ${sql.json(version)}, ${sql.json(version)}, now()) returning id`;
    // The store is open, so a page's robots rule is its own: noindex only for a version of the header.
    await sql`update commerce.stores set header_id = ${header.id}, setup_completed_at = now() where id = ${store.id}`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${experiment}, ${store.id}, 'Topp', ${header.id}, 'orders')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Topp B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, address, storeId: store.id as string, experiment };
  } finally {
    await sql.end();
  }
}

const exposures = async (experiment: string) => {
  const sql = testDb();
  try {
    return await sql`select visitor, variant from commerce.experiment_exposures where experiment_id = ${experiment}`;
  } finally {
    await sql.end();
  }
};

async function enrol(context: BrowserContext, t: { storeId: string; experiment: string }, version: string) {
  const visitor = randomUUID();
  await context.addCookies([
    { name: `consent_${t.storeId}`, value: `1.${visitor}.statistics.010`, domain: "localhost", path: "/" },
    { name: `kaizen_ab_${t.storeId}`, value: `1.${visitor}.${t.experiment}=${version}`, domain: "localhost", path: "/" },
    { name: "kaizen_ab", value: "1", domain: "localhost", path: "/" },
  ]);
  return visitor;
}

test("a visitor given version B has its header on every page, at the same addresses, and is counted once", async ({ page, context }) => {
  const t = await headerTest();
  const visitor = await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page).toHaveURL(t.address);
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Header A" })).toHaveCount(0);
  // Not a page of its own for search engines, and the real address is the canonical one.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/s/${t.slug}/no/side$`));
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
  expect((await exposures(t.experiment))[0]).toMatchObject({ visitor, variant: "b" });

  // Another page by a full load, and by a click (the footer's cookies page), keep the version and the address.
  await page.goto(`/s/${t.slug}/no/cookies`);
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
  await page.goto(t.address);
  await page.getByRole("contentinfo").getByRole("link", { name: "Informasjonskapsler" }).click();
  await expect(page).toHaveURL(`/s/${t.slug}/no/cookies`);
  await expect(page.getByRole("heading", { level: 1, name: "Informasjonskapsler" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await exposures(t.experiment)).toHaveLength(1);
});

test("the version stays through a server action: adding to the cart", async ({ page, context }) => {
  const t = await headerTest();
  await enrol(context, t, "b");
  await page.goto(`/s/${t.slug}/no/p/demo-keramikkopp`);
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
  const variants = page.getByRole("region", { name: "Varianter" });
  await variants.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(variants.getByRole("status")).toContainText("Lagt i handlekurven.");
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
  await expect(page).toHaveURL(`/s/${t.slug}/no/p/demo-keramikkopp`);
  // And the cart page, reached by the same visitor, has it too.
  await page.goto(`/s/${t.slug}/no/cart`);
  await expect(page.getByRole("heading", { name: "Header B" })).toBeVisible();
});

test("a visitor in the original, outside the test or without consent has the header as it is", async ({ page, context }) => {
  const t = await headerTest();
  await enrol(context, t, "a");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Header A" })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["a"]);
  await context.clearCookies();
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Header A" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("accepting statistics gives a version by itself, kept on every page", async ({ page, context }) => {
  const t = await headerTest();
  await page.goto(t.address);
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  await banner.getByRole("button", { name: "Godta alle" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === `kaizen_ab_${t.storeId}`)).toBe(true);
  await page.reload();
  const first = (await page.getByRole("heading", { name: /Header [AB]/ }).textContent()) ?? "";
  expect(["Header A", "Header B"]).toContain(first);
  await page.goto(`/s/${t.slug}/no/cookies`);
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
});

/** A store whose product layout (used by every product) says "Layout A" over the product's title, under test with a version that says "Layout B". */
async function layoutTest() {
  const address = await storePageWith("abl", [{ id: "h1", type: "heading", text: "Side", level: 1 }]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    const experiment = randomUUID();
    const layout = (text: string, name: string) => ({
      ...content("Oppsett", name, text),
      rows: [{ id: "row-l", type: "row", layout: "1", columns: [{ id: "col-l", blocks: [heading("head-1", text), { id: "prod-1", type: "product", part: "title" }] }] }],
    });
    const original = layout("Layout A", `ab-oppsett-${slug}`);
    const version = layout("Layout B", `ab-${experiment.slice(0, 8)}-b`);
    const [page] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${original.slug}, 'product_layout', ${sql.json(original)}, ${sql.json(original)}, now()) returning id`;
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${version.slug}, 'variant', ${sql.json(version)}, ${sql.json(version)}, now()) returning id`;
    await sql`update commerce.stores set product_layout_id = ${page.id}, setup_completed_at = now() where id = ${store.id}`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${experiment}, ${store.id}, 'Oppsett', ${page.id}, 'cart')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Oppsett B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, address, storeId: store.id as string, experiment };
  } finally {
    await sql.end();
  }
}

test("a product page has the layout's version for a visitor in it, and only product pages are touched", async ({ page, context }) => {
  const t = await layoutTest();
  const product = `/s/${t.slug}/no/p/demo-keramikkopp`;
  await enrol(context, t, "b");
  await page.goto(product);
  await expect(page.getByRole("heading", { name: "Layout B" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Layout A" })).toHaveCount(0);
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["b"]);
  // Another page of the store is not part of the test: no version, no exposure of its own.
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Side" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  // A visitor in the original has the original.
  await context.clearCookies();
  await enrol(context, t, "a");
  await page.goto(product);
  await expect(page.getByRole("heading", { name: "Layout A" })).toBeVisible();
});
