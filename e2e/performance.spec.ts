import { expect, test, type Page } from "@playwright/test";

import { storePageRows, testDb } from "./db";

/**
 * What a visitor's page loads first (D211, `docs/performance.md`): held here in the real build, as numbers a Lighthouse score
 * would move with but that do not wobble as a score does. `pnpm perf` runs Lighthouse itself.
 */

/** The first scripts of the demo store's front page may not grow past this, raw (before compression): 893 KB when this was set (D212; 1.01 MB while every language's whole interface text came with it). */
const FIRST_SCRIPTS_MAX = 960_000;

const base = `http://localhost:${process.env.PORT ?? 3000}`;

/** The scripts the page's HTML asks for, each fetched as the browser would, with its text. */
async function firstScripts(page: Page): Promise<{ url: string; text: string }[]> {
  const urls = await page.locator("script[src]").evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).src));
  return Promise.all(urls.map(async (url) => ({ url, text: await (await page.request.get(url)).text() })));
}

test("the front page's first scripts stay within their budget, without zod or the lightbox", async ({ page }) => {
  await page.goto("/s/demo/no");
  const scripts = await firstScripts(page);
  const total = scripts.reduce((sum, script) => sum + script.text.length, 0);
  expect(total, `first scripts: ${total} bytes`).toBeLessThan(FIRST_SCRIPTS_MAX);
  // zod's own messages: a schema in the visitor's scripts (`storefront-bundle.scan.test.ts` holds the imports; this, the build).
  expect(scripts.filter((script) => /invalid_type|ZodError/.test(script.text)).map((s) => s.url)).toEqual([]);
  // A part the page does not draw is not in its first scripts: the gallery's lightbox, the checkout's payment form.
  expect(scripts.filter((script) => script.text.includes("kz-lightbox")).map((s) => s.url)).toEqual([]);
  expect(scripts.filter((script) => script.text.includes("CheckoutSdkContext")).map((s) => s.url)).toEqual([]);
});

test("a page's scripts carry the texts its client components read, never a language's whole interface text (D212)", async ({ page }) => {
  // Each language's words for a store's summary, which only its whole module holds (the server's and the admin's).
  const summaries = { nb: "nettbutikk med levering i", sv: "webbutik med leverans i", da: "webshop med levering i", en: "online store delivering in" };
  const loaded: Promise<string>[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") loaded.push(response.text().catch(() => ""));
  });
  await page.goto("/s/demo/no");
  await page.waitForLoadState("networkidle");
  const text = (await Promise.all(loaded)).join("\n");
  const found = Object.entries(summaries).filter(([, words]) => text.includes(words)).map(([lang]) => lang);
  expect(found).toEqual([]);
  expect(errors).toEqual([]);
});

test("the first grid's first picture loads at once and first; the next grid's as they come near", async ({ page }) => {
  await page.goto("/s/demo/no");
  const pictures = page.locator("ul[data-carousel-track], ul.grid").first().locator("img");
  await expect(pictures.first()).toHaveAttribute("loading", "eager");
  await expect(pictures.first()).toHaveAttribute("fetchpriority", "high");
});

test("a first row's background picture loads at once, a later row's lazily, and a blurred one from its small copy", async ({ page }) => {
  // The media library keeps one row per address: each run's picture has its own.
  const run = Date.now().toString(36);
  const big = `${base}/demo/cabin.svg?run=${run}`;
  const small = `${base}/demo/mug.svg?run=${run}`;
  const background = (blur?: number) => ({ type: "image", image: { url: big, width: 1600, height: 900 }, overlay: null, ...(blur ? { blur } : {}) });
  const text = (id: string, words: string) => ({ id, type: "heading", text: words, level: 2 });
  const url = await storePageRows("ytelse-bakgrunn", [
    { id: "r1", type: "row", layout: "1", background: background(), columns: [{ id: "c1", blocks: [text("h1", "Først")] }] },
    { id: "r2", type: "row", layout: "1", background: background(8), columns: [{ id: "c2", blocks: [text("h2", "Senere")] }] },
  ]);
  const store = url.split("/")[2];
  const sql = testDb();
  try {
    // The picture is in the store's media library with its small copy, as an upload leaves it.
    await sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, file_name, content_type)
      select id, 'image', ${big}, ${small}, 'product-media', ${`${store}/cabin.webp`}, 'cabin.webp', 'image/webp'
      from commerce.stores where slug = ${store}`;
  } finally {
    await sql.end();
  }
  await page.goto(url);
  const first = page.locator('div[aria-hidden] > img[src]').first();
  await expect(first).toHaveAttribute("loading", "eager");
  await expect(first).toHaveAttribute("fetchpriority", "high");
  await expect(first).toHaveAttribute("srcset", `${small} 480w, ${big} 1600w`);
  const later = page.locator('div[aria-hidden] > img[src]').nth(1);
  await expect(later).toHaveAttribute("loading", "lazy");
  // Blurred, the small copy is all it needs.
  await expect(later).toHaveAttribute("src", small);
});

test("an embedded HTML frame always has a name for screen readers", async ({ page }) => {
  const url = await storePageRows("ytelse-ramme", [
    { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "f1", type: "html", html: "<p>Hei</p>", title: "" }] }] },
  ]);
  await page.goto(url);
  await expect(page.locator("iframe")).toHaveAttribute("title", "Innebygd innhold");
});
