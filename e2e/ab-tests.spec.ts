import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { storePageWith, testDb } from "./db";

/**
 * A/B tests of pages (D148): a store with a running test on its page. Visitors who accepted statistics cookies are given a
 * version, see it at the page's own address and are counted once; visitors who refused see the page as it is and leave
 * no trace; stopping the test sends everyone back to the page.
 */

const HEADING = (id: string, text: string) => ({ id, type: "heading", text, level: 1 });

/** A store whose page "side" says "Original", with a running test whose version B says "Versjon B". */
async function runningTest() {
  const address = await storePageWith("ab", [HEADING("h1", "Original")]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    const [page] = await sql`select id, published from commerce.pages where store_id = ${store.id} and slug = 'side'`;
    const experiment = randomUUID();
    const b = { ...page.published, title: "Side B", slug: `ab-${experiment.slice(0, 8)}-b`, rows: [{ ...page.published.rows[0], columns: [{ ...page.published.rows[0].columns[0], blocks: [HEADING("h1", "Versjon B")] }] }] };
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${store.id}, ${`ab-${experiment.slice(0, 8)}-b`}, ${sql.json(b)}, ${sql.json(b)}, now(), 'variant') returning id`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${experiment}, ${store.id}, 'Overskrift', ${page.id}, 'orders')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${store.id}, ${experiment}, 'a', 'Original', null, 0.5), (${store.id}, ${experiment}, 'b', 'Versjon B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running' where id = ${experiment}`;
    return { address, slug, storeId: store.id as string, experiment };
  } finally {
    await sql.end();
  }
}

const exposures = async (experiment: string) => {
  const sql = testDb();
  try {
    return await sql`select visitor, variant, market, device from commerce.experiment_exposures where experiment_id = ${experiment}`;
  } finally {
    await sql.end();
  }
};

/** What a browser holds after it accepted statistics and was given `version`: the consent and the assignment. */
async function enrol(context: BrowserContext, test: { storeId: string; experiment: string }, version: string, visitor = randomUUID()) {
  await context.addCookies([
    { name: `consent_${test.storeId}`, value: `1.${visitor}.statistics.010`, domain: "localhost", path: "/" },
    { name: `kaizen_ab_${test.storeId}`, value: `1.${visitor}.${test.experiment}=${version}`, domain: "localhost", path: "/" },
    { name: "kaizen_ab", value: "1", domain: "localhost", path: "/" },
  ]);
  return visitor;
}

test("a visitor given version B sees it at the page's own address and is counted once", async ({ page, context }) => {
  const t = await runningTest();
  const visitor = await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page).toHaveURL(t.address);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Versjon B");
  // The version is never indexed on its own: it names the page as its canonical address.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${t.address}$`));
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
  expect((await exposures(t.experiment))[0]).toMatchObject({ visitor, variant: "b" });
  // Seeing it again counts nothing more.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Versjon B");
  await page.waitForTimeout(500);
  expect(await exposures(t.experiment)).toHaveLength(1);
});

test("a visitor given the original sees the page as it is, and is counted in it", async ({ page, context }) => {
  const t = await runningTest();
  await enrol(context, t, "a");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original");
  await expect.poll(async () => (await exposures(t.experiment)).map((e) => e.variant)).toEqual(["a"]);
});

test("a visitor outside the test, or who refused statistics, sees the page as it is and leaves no trace", async ({ page, context }) => {
  const t = await runningTest();
  // Refusing is one press; nothing is set and nobody is counted.
  await page.goto(t.address);
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  await expect(banner).toContainText("statistikk");
  await banner.getByRole("button", { name: "Avslå alle" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original");
  const names = (await context.cookies()).map((c) => c.name);
  expect(names).not.toContain("kaizen_ab");
  expect(names).not.toContain(`kaizen_ab_${t.storeId}`);
  await page.waitForTimeout(500);
  expect(await exposures(t.experiment)).toHaveLength(0);
});

test("accepting statistics gives a version by itself, and it stays the same on every visit", async ({ page, context }) => {
  const t = await runningTest();
  await page.goto(t.address);
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  await banner.getByRole("button", { name: "Godta alle" }).click();
  await expect(banner).toBeHidden();
  // The assignment is asked for after the choice; the next visit shows the version.
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === `kaizen_ab_${t.storeId}`)).toBe(true);
  await page.reload();
  const first = await page.getByRole("heading", { level: 1 }).textContent();
  expect(["Original", "Versjon B"]).toContain(first);
  for (let i = 0; i < 3; i += 1) {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first ?? "");
  }
  await expect.poll(async () => (await exposures(t.experiment)).length).toBe(1);
  expect((await exposures(t.experiment))[0].variant).toBe(first === "Original" ? "a" : "b");
});

test("stopping the test sends everyone back to the page as it is", async ({ page, context }) => {
  const t = await runningTest();
  await enrol(context, t, "b");
  await page.goto(t.address);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Versjon B");
  const sql = testDb();
  try {
    await sql`update commerce.experiments set status = 'stopped' where id = ${t.experiment}`;
  } finally {
    await sql.end();
  }
  // The stop is seen within the proxy's short memory and the page cache's tag; poll until the original shows.
  await expect
    .poll(async () => {
      await page.goto(t.address);
      return page.getByRole("heading", { level: 1 }).textContent();
    }, { timeout: 60_000 })
    .toBe("Original");
});
