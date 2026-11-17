import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { signPreview } from "../src/lib/ab-preview-sign";
import { parseKey } from "../src/lib/secret-box";

import { storePageWith, testDb } from "./db";

/**
 * A/B tests, phase 20 (D148, D715), in a real browser on a store's pages: a visitor in version B who then goes on to the page the test names is
 * counted in B, once, and one who opened it before seeing the version is not; a form on another page counts for a test of this one; and a preview
 * link shows version B to whoever opens it, with nothing counted at all.
 */

type Json = Record<string, unknown>;
type Setup = { slug: string; address: string; about: string; storeId: string; experiment: string; formId: string };

/** A store with a page under test (`side`, version B says "Side B"), its about page carrying a newsletter form, and a running test of `goal`. */
async function phase20Test(goal: "page" | "form"): Promise<Setup> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const formId = `news-${stamp}`;
  const address = await storePageWith("abp", [{ id: "h1", type: "heading", text: "Side", level: 1 }]);
  const slug = address.split("/")[2];
  const about = address.replace(/\/side$/, "/om-oss");
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    const [target] = await sql`select id, published from commerce.pages where store_id = ${store.id} and slug = 'side' and type = 'page'`;
    const [aboutPage] = await sql`select id, published from commerce.pages where store_id = ${store.id} and slug = 'om-oss' and type = 'page'`;
    // The about page gets the newsletter sign-up a test of `side` can count (a form elsewhere on the site).
    const withForm = {
      ...(aboutPage.published as Json),
      rows: [
        ...((aboutPage.published as Json).rows as Json[]),
        {
          id: `row-${formId}`,
          type: "row",
          layout: "1",
          columns: [
            {
              id: `col-${formId}`,
              blocks: [{ id: formId, type: "newsletter", recipients: [`liste-${stamp}@example.com`], confirm: false, placeholder: "", submitLabel: "", successMessage: "", consent: "" }],
            },
          ],
        },
      ],
    };
    await sql`update commerce.pages set published = ${sql.json(withForm as never)}, draft = ${sql.json(withForm as never)} where id = ${aboutPage.id}`;
    const experiment = randomUUID();
    const slugB = `ab-${experiment.slice(0, 8)}-b`;
    const original = target.published as Json;
    const copy = {
      ...original,
      slug: slugB,
      rows: (original.rows as Json[]).map((row) => ({
        ...row,
        columns: (row.columns as Json[]).map((column) => ({ ...column, blocks: (column.blocks as Json[]).map((block) => (block.id === "h1" ? { ...block, text: "Side B" } : block)) })),
      })),
    };
    const [b] = await sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${store.id}, ${slugB}, 'variant', ${sql.json(copy as never)}, ${sql.json(copy as never)}, now()) returning id`;
    const params = goal === "page" ? { page: aboutPage.id as string } : { block: formId };
    await sql`
      insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal, goal_params) values (${experiment}, ${store.id}, 'Test', ${target.id}, ${goal}, ${sql.json(params)})`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Versjon B', ${b.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, address, about, storeId: store.id as string, experiment, formId };
  } finally {
    await sql.end();
  }
}

const counted = async (experiment: string) => {
  const sql = testDb();
  try {
    const exposures = await sql`select visitor, variant from commerce.experiment_exposures where experiment_id = ${experiment}`;
    const events = await sql`select visitor, variant, goal, ref from commerce.experiment_events where experiment_id = ${experiment}`;
    return { exposures, events };
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

/** Sends the about page's newsletter sign-up and waits for the site's answer. */
async function signUp(page: Page, email: string) {
  // The about page's only form: the one this test put there.
  const form = page.locator("main form");
  await form.getByRole("textbox", { name: "E-post" }).fill(email);
  // People take a few seconds: a form sent faster is a robot's.
  await page.waitForTimeout(2200);
  await form.getByLabel(/send meg nyhetsbrev/).check();
  const answered = page.waitForResponse((response) => response.url().endsWith("/api/forms") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Meld meg på" }).click();
  expect((await answered).status()).toBe(200);
}

test("a visitor in version B who then opens the page the test names is counted in B, once; opening it first counts nothing", async ({ page, context }) => {
  const t = await phase20Test("page");
  // Opened before seeing the version: nothing.
  const early = await enrol(context, t, "b");
  await page.goto(t.about);
  await page.waitForTimeout(800);
  expect((await counted(t.experiment)).events).toHaveLength(0);

  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Side B", level: 1 })).toBeVisible();
  await expect.poll(async () => (await counted(t.experiment)).exposures.length).toBe(1);
  await page.goto(t.about);
  await expect.poll(async () => (await counted(t.experiment)).events.length).toBe(1);
  expect((await counted(t.experiment)).events[0]).toMatchObject({ visitor: early, variant: "b", goal: "page" });
  await page.goto(t.about);
  await page.waitForTimeout(500);
  expect((await counted(t.experiment)).events).toHaveLength(1);
});

test("a form on another page counts for the test of this one", async ({ page, context }) => {
  const t = await phase20Test("form");
  const visitor = await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Side B", level: 1 })).toBeVisible();
  await expect.poll(async () => (await counted(t.experiment)).exposures.length).toBe(1);
  await page.goto(t.about);
  await signUp(page, `ny-${Date.now().toString(36)}@example.com`);
  await expect.poll(async () => (await counted(t.experiment)).events.length).toBe(1);
  expect((await counted(t.experiment)).events[0]).toMatchObject({ visitor, variant: "b", goal: "form", ref: t.formId });
});

test("a preview link shows version B to whoever opens it, never indexed, and counts nothing", async ({ page, context }) => {
  test.setTimeout(90_000);
  const t = await phase20Test("page");
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  const token = signPreview(key, { storeId: t.storeId, experiment: t.experiment, version: "b" });
  // A visitor who allowed statistics and holds the original in their own cookie: the link still shows B, and nothing of the visit is counted.
  await enrol(context, t, "a");
  await page.goto(`/api/ab/preview?t=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(new RegExp(`${t.address}$`));
  await expect(page.getByRole("heading", { name: "Side B", level: 1 })).toBeVisible();
  // The cookie names the test in plain before its token (written URL-encoded), so the page's own script can tell without decoding the token.
  expect(decodeURIComponent((await context.cookies()).find((c) => c.name === "kaizen_ab_preview")?.value ?? "").startsWith(`${t.experiment}:`)).toBe(true);
  const response = await page.request.get(t.address);
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  await page.goto(t.about);
  await page.waitForTimeout(800);
  expect(await counted(t.experiment)).toEqual({ exposures: [], events: [] });

  // A link that was altered is refused; once the test stops, the link goes to the store and keeps nothing.
  expect((await page.request.get(`/api/ab/preview?t=${encodeURIComponent(`${token}x`)}`, { maxRedirects: 0 })).status()).toBe(404);
  const sql = testDb();
  try {
    await sql`update commerce.experiments set status = 'stopped' where id = ${t.experiment}`;
  } finally {
    await sql.end();
  }
  await page.waitForTimeout(21_000); // the server remembers a store's running tests for up to 20 seconds
  await page.goto(`/api/ab/preview?t=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Side B", level: 1 })).toHaveCount(0);
  expect((await context.cookies()).some((c) => c.name === "kaizen_ab_preview" && c.value !== "")).toBe(false);
});
