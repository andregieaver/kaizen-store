import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { storePageWith, testDb } from "./db";

/**
 * A test that counts forms sent (D148, phase 11). A page has a newsletter sign-up; the test's goal is that form. A visitor in a version who sends it
 * once the site has accepted the answer is counted in that version, once; a visitor who never accepted statistics, or who is not in the test, is not.
 */

type Json = Record<string, unknown>;
type Setup = { slug: string; address: string; storeId: string; experiment: string; formId: string };

async function formTest(): Promise<Setup> {
  const stamp = Date.now().toString(36);
  const formId = `news-${stamp}`;
  const address = await storePageWith("abg", [
    { id: "h1", type: "heading", text: "Side", level: 1 },
    { id: formId, type: "newsletter", recipients: [`liste-${stamp}@example.com`], confirm: false, placeholder: "", submitLabel: "", successMessage: "", consent: "" },
  ]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    const [target] = await sql`select id, published from commerce.pages where store_id = ${store.id} and slug = 'side' and type = 'page'`;
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
    await sql`
      insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal, goal_params) values (${experiment}, ${store.id}, 'Test', ${target.id}, 'form', ${sql.json({ block: formId })})`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Versjon B', ${b.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { slug, address, storeId: store.id as string, experiment, formId };
  } finally {
    await sql.end();
  }
}

const events = async (experiment: string) => {
  const sql = testDb();
  try {
    return await sql`select visitor, variant, ref from commerce.experiment_events where experiment_id = ${experiment} and goal = 'form'`;
  } finally {
    await sql.end();
  }
};

async function enrol(context: BrowserContext, t: Setup, version: string, statistics = true) {
  const visitor = randomUUID();
  await context.addCookies([
    ...(statistics ? [{ name: `consent_${t.storeId}`, value: `1.${visitor}.statistics.010`, domain: "localhost", path: "/" }] : []),
    { name: `kaizen_ab_${t.storeId}`, value: `1.${visitor}.${t.experiment}=${version}`, domain: "localhost", path: "/" },
    { name: "kaizen_ab", value: "1", domain: "localhost", path: "/" },
  ]);
  return visitor;
}

/** Fills in and sends the page's newsletter sign-up, and waits for the site's answer. */
async function signUp(page: import("@playwright/test").Page, email: string) {
  const form = page.locator("main form");
  await form.getByRole("textbox", { name: "E-post" }).fill(email);
  // People take a few seconds: a form sent faster is a robot's.
  await page.waitForTimeout(2200);
  await form.getByLabel(/send meg nyhetsbrev/).check();
  const answered = page.waitForResponse((response) => response.url().endsWith("/api/forms") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Meld meg på" }).click();
  expect((await answered).status()).toBe(200);
}

test("a visitor in version B who sends the form is counted in B, once", async ({ page, context }) => {
  const t = await formTest();
  const visitor = await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Side B", level: 1 })).toBeVisible();
  await signUp(page, `ny-${Date.now().toString(36)}@example.com`);
  await expect.poll(async () => (await events(t.experiment)).length).toBe(1);
  expect((await events(t.experiment))[0]).toMatchObject({ visitor, variant: "b", ref: t.formId });
  // Sending again, even another address, is still one visitor (the form is back after a reload).
  await page.reload();
  await signUp(page, `nummer2-${Date.now().toString(36)}@example.com`);
  await page.waitForTimeout(500);
  expect(await events(t.experiment)).toHaveLength(1);
});

test("a visitor in the original is counted in the original; one who never accepted statistics leaves no trace", async ({ page, context }) => {
  const t = await formTest();
  await enrol(context, t, "a");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { name: "Side", level: 1, exact: true })).toBeVisible();
  await signUp(page, `a-${Date.now().toString(36)}@example.com`);
  await expect.poll(async () => (await events(t.experiment)).map((e) => e.variant)).toEqual(["a"]);

  await context.clearCookies();
  await enrol(context, t, "b", false);
  await page.goto(t.address);
  await signUp(page, `uten-${Date.now().toString(36)}@example.com`);
  await page.waitForTimeout(500);
  expect(await events(t.experiment)).toHaveLength(1);
});
