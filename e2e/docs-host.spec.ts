import { expect, test, type Page } from "@playwright/test";

import { testDb } from "./db";

/**
 * The docs portal on its own host (D442, `docs/wave-14-developer-platform.md` E1). Needs a build with the host set, as CI's `hosts` job makes,
 * where it is a name under the store domain (the case that must never be taken for a store's host):
 *
 *   NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 NEXT_PUBLIC_DOCS_HOST=docs.localhost:3000 pnpm build
 *   NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 NEXT_PUBLIC_DOCS_HOST=docs.localhost:3000 pnpm exec playwright test e2e/docs-host.spec.ts
 *
 * Addresses on the host go through the browser: only Chromium sends `*.localhost` to this machine.
 */
const host = process.env.NEXT_PUBLIC_DOCS_HOST;
test.skip(!host, "needs a build with NEXT_PUBLIC_DOCS_HOST set");

const docs = (path = "/") => `http://${host}${path}`;
const PAGE = "/owners/getting-started/create-your-store";

test("the front page and the pages answer at the host's root, linking within it and to Kaizena Flow in full", async ({ page, baseURL }) => {
  const front = await page.goto(docs("/"));
  expect(front?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow Docs" })).toBeVisible();
  // Next.js writes the root's canonical address without its slash.
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(docs("/").replace(/\/$/, ""));
  const top = page.getByRole("navigation", { name: "Docs" });
  await expect(top.getByRole("link", { name: "Store owners" })).toHaveAttribute("href", "/owners");
  await expect(top.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
  await expect(top.getByRole("link", { name: "Status" })).toHaveAttribute("href", `${baseURL}/status`);

  const response = await page.goto(docs(PAGE));
  expect(response?.status()).toBe(200);
  expect(page.url()).toBe(docs(PAGE));
  await expect(page.getByRole("heading", { level: 1, name: "Create your store" })).toBeVisible();
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(docs(PAGE));
  await expect(page.getByRole("navigation", { name: "Store owners: pages" }).getByRole("link", { name: "Add your first product" })).toHaveAttribute(
    "href",
    "/owners/getting-started/your-first-product",
  );
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Start your store" })).toHaveAttribute("href", `${baseURL}/sign-up`);
  await expect(page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "Norsk" })).toHaveAttribute("href", `/no${PAGE}`);
});

test("Norwegian is under /no on the host, and the developers' track has none", async ({ page }) => {
  const response = await page.goto(docs(`/no${PAGE}`));
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Lag nettbutikken din" })).toBeVisible();
  await page.goto(docs("/no"));
  await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow-dokumentasjon" })).toBeVisible();
  expect((await page.goto(docs("/no/developers/overview/introduction")))?.status()).toBe(404);
});

/** A file on the host, fetched from a page there (a browser may download `text/markdown` rather than show it). */
async function fetchOnHost(page: Page, path: string): Promise<{ status: number; type: string; text: string }> {
  if (!page.url().startsWith(docs("/"))) await page.goto(docs("/"));
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
  }, docs(path));
}

test("each page answers as Markdown on the host, with the host's addresses", async ({ page }) => {
  const md = await fetchOnHost(page, `${PAGE}.md`);
  expect(md.status).toBe(200);
  expect(md.type).toContain("text/markdown");
  expect(md.text.startsWith("# Create your store")).toBe(true);
  expect(md.text).toContain(`](${docs("/owners/getting-started/your-first-product")})`);
  expect((await fetchOnHost(page, `/no${PAGE}.md`)).text).toMatch(/^# Lag nettbutikken din/);
});

test("Kaizena Flow's own /docs moves to the host for good", async ({ page, request }) => {
  const moved = await request.get("/docs", { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toBe(docs("/"));
  const article = await request.get(`/docs${PAGE}?x=1`, { maxRedirects: 0 });
  expect(article.status()).toBe(308);
  expect(article.headers().location).toBe(docs(`${PAGE}?x=1`));
  const norwegian = await request.get(`/no/docs${PAGE}`, { maxRedirects: 0 });
  expect(norwegian.headers().location).toBe(docs(`/no${PAGE}`));
  await page.goto("/docs/developers");
  await expect(page).toHaveURL(docs("/developers"));
});

test("an address on the host that is not the docs' is Kaizena Flow's own; the host is never a store's", async ({ page, baseURL }) => {
  await page.goto(docs("/sign-up"));
  await expect(page).toHaveURL(`${baseURL}/sign-up`);
  await page.goto(docs("/admin/sign-in"));
  await expect(page).toHaveURL(`${baseURL}/admin/sign-in`);
  // `docs` under the store domain is the docs, not a store called docs.
  const front = await page.goto(docs("/"));
  expect(front?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow Docs" })).toBeVisible();
});

test("the host has its own sitemap, rules for crawlers and llms.txt, and Kaizena Flow's sitemap leaves the docs to it", async ({ page, request }) => {
  const sitemap = await page.goto(docs("/sitemap.xml"));
  expect(sitemap?.status()).toBe(200);
  expect(await sitemap?.text()).toContain(`<loc>${docs(PAGE)}</loc>`);
  const robots = await page.goto(docs("/robots.txt"));
  expect(await robots?.text()).toContain(`Sitemap: ${docs("/sitemap.xml")}`);
  expect((await fetchOnHost(page, "/llms.txt")).text).toContain(`(${docs(`${PAGE}.md`)})`);
  expect((await fetchOnHost(page, "/llms-full.txt")).status).toBe(200);
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/docs/sitemap.xml");
});

test("Was this page helpful? answers on the host", async ({ page }) => {
  await page.goto(docs(PAGE));
  const box = page.getByRole("region", { name: "Was this page helpful?" });
  await box.getByRole("button", { name: "Yes" }).click();
  await expect(box.getByRole("status")).toHaveText("Thank you for telling us.");
  const sentence = `Clear on its own host ${Date.now().toString(36)}.`;
  await box.getByLabel("Anything to add? (optional)").fill(sentence);
  await box.getByRole("button", { name: "Send" }).click();
  await expect(box.getByRole("status")).toHaveText("Thank you. We read every sentence.");
  const sql = testDb();
  try {
    expect(await sql`select path, lang, helpful from commerce.docs_feedback where comment = ${sentence}`).toEqual([
      { path: "owners/getting-started/create-your-store", lang: "en", helpful: true },
    ]);
    await sql`delete from commerce.docs_feedback where comment = ${sentence}`;
  } finally {
    await sql.end();
  }
});
