import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { storePageWith, testDb } from "./db";

/**
 * A/B tests of a working page and of a modal (D148, phase 9). The cart page of a store is under test by a row around the cart: a visitor
 * given version B is served the cart route with that row changed, at the same address; a visitor in the original has it as it is. A popup
 * that opens by itself is under test against the page without it: a visitor in the version has no popup in the page at all.
 */

const heading = (id: string, text: string, level = 2) => ({ id, type: "heading", text, level });
const row = (id: string, blocks: object[], extra: object = {}) => ({ id, type: "row", layout: "1", columns: [{ id: `${id}-col`, blocks }], ...extra });
const page = (title: string, slug: string, rows: object[]) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows,
});

type Setup = { slug: string; address: string; storeId: string; experiment: string };

/** Runs a test of `part` on `target`, whose version is `version` (a copy with the change), after `arrange` has made the target. */
async function runTest(address: string, arrange: (sql: ReturnType<typeof testDb>, storeId: string) => Promise<{ targetId: string; original: object; version: object; part: { id: string; kind: string } }>): Promise<Setup> {
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    const experiment = randomUUID();
    const { targetId, version, part } = await arrange(sql, store.id as string);
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    const slugB = `ab-${experiment.slice(0, 8)}-b`;
    const copy = { ...version, slug: slugB };
    const [b] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${slugB}, 'variant', ${sql.json(copy as never)}, ${sql.json(copy as never)}, now()) returning id`;
    await sql`
      insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal, target_part, target_part_kind) values (${experiment}, ${store.id}, 'Test', ${targetId}, 'orders', ${part.id}, ${part.kind})`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Versjon B', ${b.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, address, storeId: store.id as string, experiment };
  } finally {
    await sql.end();
  }
}

/** A store whose cart page is a trust row ("Fri frakt A") over the cart; the test changes the row. */
async function cartTest(): Promise<Setup> {
  const address = await storePageWith("abc", [heading("h1", "Side", 1)]);
  return runTest(address, async (sql, storeId) => {
    const original = page("Handlekurv", "handlekurv-side", [row("trust", [heading("trust-1", "Fri frakt A")]), row("cart-row", [{ id: "cart-part", type: "storePart", part: "cart" }])]);
    const version = page("Handlekurv B", "handlekurv-side", [row("trust", [heading("trust-1", "Fri frakt B")]), row("cart-row", [{ id: "cart-part", type: "storePart", part: "cart" }])]);
    const [target] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at) values (${storeId}, 'handlekurv-side', ${sql.json(original as never)}, ${sql.json(original as never)}, now()) returning id`;
    await sql`insert into commerce.page_roles (store_id, role, page_id) values (${storeId}, 'cart', ${target.id})`;
    return { targetId: target.id as string, original, version, part: { id: "trust-1", kind: "block" } };
  });
}

/** A store whose page has a popup that opens after a second; the version is the page without it. */
async function modalTest(): Promise<Setup> {
  const address = await storePageWith("abm", [heading("h1", "Side", 1)]);
  return runTest(address, async (sql, storeId) => {
    const popup = row("popup", [heading("popup-1", "Join our list")], { modal: { key: "newsletter", name: "Newsletter", triggers: { timer: { seconds: 1 } }, frequency: "always", size: "md" } });
    const original = page("Side", "side", [row("row-0", [heading("h1", "Side", 1)]), popup]);
    const version = page("Side B", "side", [row("row-0", [heading("h1", "Side", 1)])]);
    const [target] = await sql`select id from commerce.pages where store_id = ${storeId} and slug = 'side'`;
    await sql`update commerce.pages set draft = ${sql.json(original as never)}, published = ${sql.json(original as never)} where id = ${target.id}`;
    return { targetId: target.id as string, original, version, part: { id: "popup", kind: "row" } };
  });
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

test("a visitor given version B has the cart page's row changed, at the cart's own address, and is counted once", async ({ page, context }) => {
  const t = await cartTest();
  const visitor = await enrol(context, t, "b");
  await page.goto(`/s/${t.slug}/cart`);
  await expect(page).toHaveURL(`/s/${t.slug}/cart`);
  await expect(page.getByRole("heading", { name: "Fri frakt B" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fri frakt A" })).toHaveCount(0);
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
  expect((await exposures(t.experiment))[0]).toMatchObject({ visitor, variant: "b" });
  // Another load keeps the version and counts nobody twice.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fri frakt B" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await exposures(t.experiment)).toHaveLength(1);
});

test("a visitor in the original, outside the test or without consent has the cart page as it is", async ({ page, context }) => {
  const t = await cartTest();
  await enrol(context, t, "a");
  await page.goto(`/s/${t.slug}/cart`);
  await expect(page.getByRole("heading", { name: "Fri frakt A" })).toBeVisible();
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["a"]);
  await context.clearCookies();
  await page.goto(`/s/${t.slug}/cart`);
  await expect(page.getByRole("heading", { name: "Fri frakt A" })).toBeVisible();
  expect(await exposures(t.experiment)).toHaveLength(1);
});

test("a popup under test: the original has it in the page, the version has none", async ({ page, context }) => {
  const t = await modalTest();
  // The original has its dialog, which opens by itself.
  await enrol(context, t, "a");
  await page.goto(t.address);
  await expect(page.locator("dialog#modal-newsletter")).toHaveCount(1);
  await expect(page.locator("dialog#modal-newsletter")).toBeVisible({ timeout: 8000 });
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["a"]);

  // The version is the page without it, at the same address.
  await context.clearCookies();
  const b = await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page).toHaveURL(t.address);
  await expect(page.getByRole("heading", { name: "Side", level: 1 })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator("dialog#modal-newsletter")).toHaveCount(0);
  await expect.poll(async () => (await exposures(t.experiment)).some((e) => e.visitor === b && e.variant === "b")).toBe(true);
});
