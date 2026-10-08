import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { storePageWith, testDb } from "./db";

/**
 * A/B tests of the front page and the All products page (D148, phase 10). A new store's front page is the template's ("Produkter" over the
 * product grid) and its All products page is at /products. A visitor given version B is served the same address with the version's content;
 * a visitor in the original, outside the test or without consent has the page as it is.
 */

type Setup = { slug: string; storeId: string; experiment: string };

type Json = Record<string, unknown>;

/** The page's published content with the heading `blockId` saying `text`. */
const withHeading = (content: Json, blockId: string, text: string): Json => ({
  ...content,
  rows: (content.rows as Json[]).map((row) => ({
    ...row,
    columns: (row.columns as Json[]).map((column) => ({ ...column, blocks: (column.blocks as Json[]).map((block) => (block.id === blockId ? { ...block, text } : block)) })),
  })),
});

/** A running test of the store's page `pageSlug` (the store's `place` page), version B with `blockId` saying `text`; by a part when `part` is set. */
async function runTest(pageSlug: string, blockId: string, text: string, part: { id: string; kind: string } | null): Promise<Setup> {
  const address = await storePageWith("abf", [{ id: "h1", type: "heading", text: "Side", level: 1 }]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    const [target] = await sql`select id, published from commerce.pages where store_id = ${store.id} and slug = ${pageSlug} and type = 'page'`;
    const experiment = randomUUID();
    const slugB = `ab-${experiment.slice(0, 8)}-b`;
    const copy = { ...withHeading(target.published as Json, blockId, text), slug: slugB };
    const [b] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${slugB}, 'variant', ${sql.json(copy as never)}, ${sql.json(copy as never)}, now()) returning id`;
    await sql`
      insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal, target_part, target_part_kind) values (${experiment}, ${store.id}, 'Test', ${target.id}, 'orders', ${part?.id ?? null}, ${part?.kind ?? null})`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Versjon B', ${b.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, storeId: store.id as string, experiment };
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

async function enrol(context: BrowserContext, t: Setup, version: string) {
  const visitor = randomUUID();
  await context.addCookies([
    { name: `consent_${t.storeId}`, value: `1.${visitor}.statistics.010`, domain: "localhost", path: "/" },
    { name: `kaizen_ab_${t.storeId}`, value: `1.${visitor}.${t.experiment}=${version}`, domain: "localhost", path: "/" },
    { name: "kaizen_ab", value: "1", domain: "localhost", path: "/" },
  ]);
  return visitor;
}

test("a visitor given version B has the front page's version at the market's own address (the store's, without the country: D181), and is counted once", async ({ page, context }) => {
  const t = await runTest("forside", "front-heading", "Produkter B", null);
  const visitor = await enrol(context, t, "b");
  await page.goto(`/s/${t.slug}`);
  await expect(page).toHaveURL(`/s/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Produkter B", level: 1 })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
  expect((await exposures(t.experiment))[0]).toMatchObject({ visitor, variant: "b" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Produkter B", level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await exposures(t.experiment)).toHaveLength(1);
  // Other pages are not touched by it.
  await page.goto(`/s/${t.slug}/products`);
  await expect(page.getByRole("heading", { name: "Produkter B" })).toHaveCount(0);
});

test("a visitor in the original, outside the test or without consent has the front page as it is", async ({ page, context }) => {
  const t = await runTest("forside", "front-heading", "Produkter B", null);
  await enrol(context, t, "a");
  await page.goto(`/s/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Produkter", level: 1, exact: true })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["a"]);
  await context.clearCookies();
  await page.goto(`/s/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Produkter", level: 1, exact: true })).toBeVisible();
  expect(await exposures(t.experiment)).toHaveLength(1);
});

test("a part of the All products page under test: version B is served at /products", async ({ page, context }) => {
  const t = await runTest("alle-produkter", "products-heading", "Alt vi selger", { id: "products-heading", kind: "block" });
  await enrol(context, t, "b");
  await page.goto(`/s/${t.slug}/products`);
  await expect(page).toHaveURL(`/s/${t.slug}/products`);
  await expect(page.getByRole("heading", { name: "Alt vi selger", level: 1 })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["b"]);
  // The front page is not part of this test.
  await page.goto(`/s/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Alt vi selger" })).toHaveCount(0);
});
