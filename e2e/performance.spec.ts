import { brotliCompressSync } from "node:zlib";

import { expect, test, type Page } from "@playwright/test";

import { parsePageContent } from "../src/lib/page-content";
import { ORBIT_PACK, orbitHomePage } from "../src/lib/signature/orbit";

import { storePageRows, testDb, testStore } from "./db";

/**
 * What a visitor's page loads first (D211, `docs/performance.md`): held here in the real build, as numbers a Lighthouse score
 * would move with but that do not wobble as a score does. `pnpm perf` runs Lighthouse itself.
 */

const base = `http://localhost:${process.env.PORT ?? 3000}`;

/** `E2E_MEASURE=1` prints every figure the budgets below are set from (`[first-scripts]`, `[document]`, `[stylesheet]`, `[wire]`) and holds none. */
const MEASURE = process.env.E2E_MEASURE === "1";

/**
 * The scripts the page's HTML asks for, as the server sends it, each fetched with its text, each file once: every `<script src>` tag
 * but a `nomodule` one (Next's polyfills, 225,082 bytes twice over, which no browser that runs the page loads), never what the page has
 * loaded by the time it is looked at, which grows with what it does after (bloat review step 1.3, as `e2e/signed-in/admin-scripts.spec.ts`).
 */
function scriptAddresses(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/<script\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => !/\snomodule\b/i.test(tag))
        .map((tag) => /\ssrc="([^"]+)"/.exec(tag)?.[1])
        .filter((src): src is string => Boolean(src))
        .map((src) => new URL(src.replaceAll("&amp;", "&"), base).href),
    ),
  ];
}

async function firstScripts(page: Page, address: string): Promise<{ url: string; text: string }[]> {
  const html = await (await page.request.get(address)).text();
  return Promise.all(scriptAddresses(html).map(async (url) => ({ url, text: await (await page.request.get(url)).text() })));
}

test("the front page's first scripts carry no zod, no lightbox and no checkout form", async ({ page }) => {
  const scripts = await firstScripts(page, "/s/demo/no");
  // zod's own messages: a schema in the visitor's scripts (`storefront-bundle.scan.test.ts` holds the imports; this, the build).
  expect(scripts.filter((script) => /invalid_type|ZodError/.test(script.text)).map((s) => s.url)).toEqual([]);
  // A part the page does not draw is not in its first scripts: the gallery's lightbox, the checkout's payment form.
  expect(scripts.filter((script) => script.text.includes("kz-lightbox")).map((s) => s.url)).toEqual([]);
  expect(scripts.filter((script) => script.text.includes("CheckoutSdkContext")).map((s) => s.url)).toEqual([]);
  // Not a visitor's scripts (bloat review step 0.16): the features table and the admin's words, the cookie catalogue's purposes, and
  // the listing filter's dialog, which loads on the first press or when a pointer nears (only its button is here).
  for (const marker of ["Sell to businesses", "Waiting for payment", "Kommer ihåg om du valde ljusa", "filter-dialog-title"]) {
    expect(scripts.filter((script) => script.text.includes(marker)).map((s) => s.url), marker).toEqual([]);
  }
});

/**
 * Every route a visitor or a person signing in meets first has its own first-scripts budget (PSI PERF-11; bloat review step 1.3), raw
 * (before compression): the text of the files the server's HTML names, no `nomodule` file, each file once. The eight store routes
 * (`/s/...`) are set to their figure plus 3 %, the six others to plus 4 %, each rounded up to the next 1,000. Measured on the build of
 * 17 November 2026: the front page 614,339, the product page 662,244, the other store routes 729,906 each, Kaizena Flow's front page
 * 608,377, sign-up 626,891, status 617,496, sign-in 487,166, forgot password 486,102, the docs page 498,519. A budget only falls: a change that lowers a figure by more than its room lowers the budget in the same change, and one
 * that needs a budget raised says why in docs/decisions.md.
 */
const FIRST_SCRIPTS_BUDGETS: Record<string, number> = {
  "/s/demo/no": 633_000,
  "/s/demo/no/p/demo-keramikkopp": 683_000,
  "/s/demo/no/om-oss": 633_000,
  "/s/demo/no/category/belysning": 752_000,
  "/s/demo/no/search?q=lampe": 752_000,
  "/s/demo/no/cart": 752_000,
  "/s/demo/no/checkout": 752_000,
  "/s/demo/no/account": 752_000,
  "/": 633_000,
  "/sign-up": 652_000,
  "/status": 643_000,
  "/admin/sign-in": 507_000,
  "/admin/forgot-password": 506_000,
  "/docs/owners/getting-started/create-your-store": 519_000,
};

for (const [path, max] of Object.entries(FIRST_SCRIPTS_BUDGETS)) {
  test(`${path}'s first scripts stay within their budget`, async ({ page }) => {
    const scripts = await firstScripts(page, path);
    const total = scripts.reduce((sum, script) => sum + script.text.length, 0);
    if (MEASURE) {
      console.log(`[first-scripts] ${path} ${total}`);
      return;
    }
    expect(total, `${path} first scripts: ${total} bytes`).toBeLessThan(max);
  });
}

/**
 * The document a page sends and what is in it (bloat review step 1.3): `document` is the characters of the HTML, `payload` the characters
 * of the inline scripts that carry the page's data to the browser (`self.__next_f.push(`), `main` the characters from the first `<main` to
 * the last `</main>`. Five pages, the last a six-row page made from Orbit's home. Each budget is its figure plus 5 %, rounded up to the next
 * 500, measured on the build of 17 November 2026 (the home 134,151 and its payload 93,017, the product page 138,003, /products 153,070 and 107,040, Kaizena Flow's front page 39,827, the six-row page 147,059). In CI's e2e job the specs before this one add to the demo
 * store, so the home's main and /products are set from CI's run of 18 November (the home's main 12,173; /products 163,817, 113,030 and 9,957). A budget only falls.
 */
async function documentOf(page: Page, address: string): Promise<{ document: number; payload: number; main: number }> {
  const html = await (await page.request.get(address)).text();
  const payload = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((text) => text.startsWith("(self.__next_f=self.__next_f||[]).push(") || text.startsWith("self.__next_f.push("))
    .reduce((sum, text) => sum + text.length, 0);
  const from = html.indexOf("<main");
  const to = html.lastIndexOf("</main>");
  return { document: html.length, payload, main: from >= 0 && to > from ? to + "</main>".length - from : 0 };
}

const DOCUMENT_BUDGETS: Record<string, { document: number; payload: number; main: number }> = {
  "/s/demo/no": { document: 141_000, payload: 98_000, main: 13_000 },
  "/s/demo/no/p/demo-keramikkopp": { document: 145_000, payload: 95_500, main: 4_000 },
  "/s/demo/no/products": { document: 172_500, payload: 119_000, main: 10_500 },
  "/": { document: 42_000, payload: 25_500, main: 1_500 },
  "six-row page": { document: 154_500, payload: 109_500, main: 18_000 },
};

test.describe("a page's document and its payload stay within their budgets", () => {
  let sixRows = "";
  test.beforeAll(async () => {
    const content = parsePageContent(orbitHomePage(ORBIT_PACK, () => null));
    expect(content).not.toBeNull();
    expect(content!.rows).toHaveLength(6);
    sixRows = await storePageRows("ytelse-seks-rader", content!.rows as never);
  });

  for (const [key, budget] of Object.entries(DOCUMENT_BUDGETS)) {
    test(key, async ({ page }) => {
      const measured = await documentOf(page, key === "six-row page" ? sixRows : key);
      if (MEASURE) {
        console.log(`[document] ${key} ${measured.document} ${measured.payload} ${measured.main}`);
        return;
      }
      const text = `${key}: ${JSON.stringify(measured)}`;
      expect(measured.document, text).toBeLessThan(budget.document);
      expect(measured.payload, text).toBeLessThan(budget.payload);
      expect(measured.main, text).toBeLessThan(budget.main);
    });
  }
});

/**
 * The stylesheets a page links (bloat review step 1.3): every `<link>` whose `rel` is stylesheet and whose `href` is under `/_next/static/`
 * (the fonts' route is not counted), each fetched once; `raw` is the sum of the bodies' bytes, `brotli` the sum of what Brotli makes of
 * each. Each budget is its figure plus 4 %, rounded up to the next 500, measured on the build of 17 November 2026 (the store home and Kaizena Flow's front page, one file each: 217,830 raw and 28,866 Brotli, 183,124 raw on the review's build of 12 November; the admin's sign-in, two files: 238,913 raw and 32,362 Brotli).
 * A budget only falls.
 */
async function stylesheetsOf(page: Page, address: string): Promise<{ raw: number; brotli: number; files: number }> {
  const html = await (await page.request.get(address)).text();
  const hrefs = [
    ...new Set(
      [...html.matchAll(/<link\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => /\srel="stylesheet"/.test(tag))
        .map((tag) => /\shref="([^"]+)"/.exec(tag)?.[1])
        .filter((href): href is string => Boolean(href) && href!.startsWith("/_next/static/"))
        .map((href) => new URL(href.replaceAll("&amp;", "&"), base).href),
    ),
  ];
  const bodies = await Promise.all(hrefs.map(async (href) => (await page.request.get(href)).body()));
  return {
    raw: bodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0),
    brotli: bodies.reduce((sum, body) => sum + brotliCompressSync(body).length, 0),
    files: hrefs.length,
  };
}

const STYLESHEET_BUDGETS: Record<string, { raw: number; brotli: number }> = {
  "/s/demo/no": { raw: 227_000, brotli: 30_500 },
  "/": { raw: 227_000, brotli: 30_500 },
  "/admin/sign-in": { raw: 248_500, brotli: 34_000 },
};

for (const [path, budget] of Object.entries(STYLESHEET_BUDGETS)) {
  test(`${path}'s stylesheets stay within their budget, raw and Brotli`, async ({ page }) => {
    const measured = await stylesheetsOf(page, path);
    if (MEASURE) {
      console.log(`[stylesheet] ${path} ${measured.raw} ${measured.brotli} ${measured.files} files`);
      return;
    }
    const text = `${path}: ${JSON.stringify(measured)}`;
    expect(measured.files, text).toBeGreaterThanOrEqual(1);
    expect(measured.raw, text).toBeLessThan(budget.raw);
    expect(measured.brotli, text).toBeLessThan(budget.brotli);
  });
}

test("the store home's style text and breakpoint sheets stay few", async ({ page }) => {
  const html = await (await page.request.get("/s/demo/no")).text();
  const styleText = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].reduce((sum, match) => sum + match[1].length, 0);
  const breakpointSheets = html.split("kz-bp-").length - 1;
  if (MEASURE) {
    console.log(`[style-text] /s/demo/no ${styleText} ${breakpointSheets}`);
    return;
  }
  expect(styleText, "characters inside <style> elements").toBeLessThanOrEqual(6_000);
  expect(breakpointSheets, "occurrences of kz-bp-").toBeLessThanOrEqual(4);
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

test("a full-width picture on a 2x phone and a two-column picture on a 3x phone draw the 800 px copy", async ({ browser }) => {
  test.setTimeout(120_000);
  // The media library keeps one row per address: each run's picture has its own. The files are the site's own public ones, so the
  // browser can fetch them.
  const run = Date.now().toString(36);
  const big = `${base}/demo/cabin.svg?run=${run}&w=1600`;
  const medium = `${base}/demo/cabin.svg?run=${run}&w=800`;
  const small = `${base}/demo/mug.svg?run=${run}`;
  const picture = (id: string) => ({ id, type: "image", image: { url: big, width: 1600, height: 900, alt: "Hytte" } });
  const url = await storePageRows("ytelse-bilde", [
    { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [picture("p1")] }] },
    {
      id: "r2",
      type: "row",
      layout: "2",
      stack: false,
      columns: [
        { id: "c2", blocks: [picture("p2")] },
        { id: "c3", blocks: [{ id: "h1", type: "heading", text: "Ved siden av", level: 2 }] },
      ],
    },
  ]);
  const store = url.split("/")[2];
  const sql = testDb();
  try {
    // The picture is in the store's media library with its small and 800 px copies, as an upload leaves it.
    await sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, medium_url, bucket, path, file_name, content_type, width, height)
      select id, 'image', ${big}, ${small}, ${medium}, 'product-media', ${`${store}/cabin.webp`}, 'cabin.webp', 'image/webp', 1600, 900
      from commerce.stores where slug = ${store}`;
  } finally {
    await sql.end();
  }
  const size = { width: 390, height: 844 };
  const source = (img: import("@playwright/test").Locator) => img.evaluate((el) => (el as HTMLImageElement).currentSrc);
  const twoX = await browser.newContext({ viewport: size, screen: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const threeX = await browser.newContext({ viewport: size, screen: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  try {
    const first = await twoX.newPage();
    await first.goto(url);
    await expect.poll(() => source(first.locator('img[alt="Hytte"]').first())).toBe(medium);
    const second = await threeX.newPage();
    await second.goto(url);
    await expect.poll(() => source(second.locator('img[alt="Hytte"]').nth(1))).toBe(medium);
    // At 3x a full-width picture needs 1,170 pixels, so the large file is right there.
    await expect.poll(() => source(second.locator('img[alt="Hytte"]').first())).toBe(big);
  } finally {
    await twoX.close();
    await threeX.close();
  }
});

test("a product tile takes the 800 px copy on a 3x phone, and no tile or gallery picture is fetched more than 1.5 times too wide (bloat review 0.33)", async ({ browser }) => {
  test.setTimeout(120_000);
  // A store of its own, nothing of it cached yet: its products' first pictures are three real files of 480, 800 and 1,600 px, as an
  // upload leaves a picture wider than 800 px, with this run's own addresses (the media library keeps one row per address).
  const { slug, id } = await testStore("tre-filer");
  const run = Date.now().toString(36);
  const file = (width: number) => `${base}/demo/e2e/tile-${width}.webp?run=${run}`;
  const sql = testDb();
  try {
    await sql`
      update commerce.product_media pm set url = ${file(1600)}, thumbnail_url = ${file(480)}
      where pm.store_id = ${id} and pm.position = (select min(o.position) from commerce.product_media o where o.product_id = pm.product_id)`;
    await sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, medium_url, bucket, path, file_name, content_type, width, height)
      values (${id}, 'image', ${file(1600)}, ${file(480)}, ${file(800)}, 'product-media', ${`${id}/tile.webp`}, 'tile.webp', 'image/webp', 1600, 800)`;
  } finally {
    await sql.end();
  }

  const FILES = [480, 800, 1600];
  /** Which file the browser took, and whether it is at most 1.5 times what the box needs, or the smallest file that covers it. */
  const fetched = async (img: import("@playwright/test").Locator) => {
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).currentSrc), { timeout: 15_000 }).toMatch(/tile-\d+\.webp/);
    const { src, box, ratio } = await img.evaluate((el) => ({
      src: (el as HTMLImageElement).currentSrc,
      box: el.getBoundingClientRect().width,
      ratio: window.devicePixelRatio,
    }));
    const fileWidth = Number(src.match(/tile-(\d+)\.webp/)?.[1]);
    const needed = Math.ceil(box * ratio);
    const smallestEnough = FILES.find((width) => width >= needed) ?? FILES[FILES.length - 1];
    return { src, fileWidth, needed, fits: fileWidth <= 1.5 * needed || fileWidth === smallestEnough };
  };

  for (const device of [
    { width: 390, height: 844, scale: 2, tile: 480 },
    { width: 390, height: 844, scale: 3, tile: 800 },
    { width: 360, height: 800, scale: 3, tile: 480 },
  ]) {
    // The screen as a phone's, the size of its viewport: left at the project's desktop screen (1920 px), Chromium's preload of the first
    // tile reads its `sizes` against that screen and fetches the 1,600 px file, which no phone does.
    const size = { width: device.width, height: device.height };
    const context = await browser.newContext({ viewport: size, screen: size, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(`/s/${slug}/products`);
      const card = page.locator("li.product-card").filter({ has: page.locator("img.product-card-image") }).first();
      const tile = card.locator("img.product-card-image");
      await expect(tile).toHaveAttribute("srcset", `${file(480)} 480w, ${file(800)} 800w, ${file(1600)} 1600w`);
      const onTile = await fetched(tile);
      const at = `${device.width} px at ${device.scale}x`;
      if (device.tile) expect(onTile.src, `tile ${at}: ${JSON.stringify(onTile)}`).toMatch(new RegExp(`tile-${device.tile}\\.webp`));
      expect(onTile.fits, `tile ${at}: ${JSON.stringify(onTile)}`).toBe(true);

      // The product page's main gallery picture, from the same three files.
      const href = await card.locator("h2 a").getAttribute("href");
      await page.goto(href!);
      const main = page.locator('[aria-roledescription="slide"] img').first();
      const onGallery = await fetched(main);
      expect(onGallery.fits, `gallery ${at}: ${JSON.stringify(onGallery)}`).toBe(true);
    } finally {
      await context.close();
    }
  }
});

/**
 * Five pages as a phone loads them, from a cold cache until the network has been quiet for three seconds (bloat review step 1.3): the
 * bytes on the wire (`wire`: body and headers of every request), the script files the page's HTML did not name (`lateScripts` and
 * `lateScriptBytes`, decoded, held exactly: they are the build's, they do not wobble), the page's own fetches that are not the router's
 * (`ownFetches`: the visit count, the tiles' call) and every request to another host (none is allowed). `wire` is its figure plus 4 %,
 * rounded up to the next 1,000. Measured on the build of 17 November 2026 (three runs: the largest wire of each page is the figure: the front page 351,687, the product page 370,098, /products 360,361, /om-oss 405,020 and the cart 410,890 bytes; the late scripts, 3, 4, 3, 7 and 5 files, were the same each time). A budget only falls.
 */
const WIRE_BUDGETS: Record<string, { wire: number; lateScripts: number; lateScriptBytes: number; ownFetches: number }> = {
  "/s/demo/no": { wire: 366_000, lateScripts: 3, lateScriptBytes: 61_416, ownFetches: 0 },
  "/s/demo/no/p/demo-keramikkopp": { wire: 385_000, lateScripts: 4, lateScriptBytes: 65_979, ownFetches: 0 },
  "/s/demo/no/products": { wire: 375_000, lateScripts: 3, lateScriptBytes: 61_416, ownFetches: 0 },
  "/s/demo/no/om-oss": { wire: 422_000, lateScripts: 7, lateScriptBytes: 197_608, ownFetches: 0 },
  "/s/demo/no/cart": { wire: 428_000, lateScripts: 5, lateScriptBytes: 81_954, ownFetches: 0 },
};

const QUIET_MS = 3_000;

for (const [path, budget] of Object.entries(WIRE_BUDGETS)) {
  test(`${path} on a phone: bytes on the wire, late scripts and the page's own calls stay within their budgets`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const firstTags = new Set(scriptAddresses(await (await context.request.get(path)).text()).map((url) => url.split("#")[0]));
      const requests: Promise<{ url: string; type: string; bytes: number; router: boolean; bodyLength: number }>[] = [];
      const last: string[] = [];
      let moved = Date.now();
      page.on("request", (request) => {
        moved = Date.now();
        last.push(request.url());
      });
      page.on("requestfinished", (request) => {
        moved = Date.now();
        requests.push(
          (async () => {
            const headers = await request.allHeaders();
            const sizes = await request.sizes();
            const type = request.resourceType();
            const bodyLength = type === "script" ? ((await (await request.response())?.body().catch(() => null))?.length ?? 0) : 0;
            return {
              url: request.url(),
              type,
              bytes: sizes.responseBodySize + sizes.responseHeadersSize,
              router: "next-router-prefetch" in headers || "next-router-segment-prefetch" in headers || "rsc" in headers,
              bodyLength,
            };
          })().catch(() => ({ url: request.url(), type: "", bytes: 0, router: false, bodyLength: 0 })),
        );
      });
      page.on("requestfailed", () => {
        moved = Date.now();
      });
      await page.goto(path, { waitUntil: "load" });
      const giveUp = Date.now() + 30_000;
      while (Date.now() - moved < QUIET_MS) {
        if (Date.now() > giveUp) throw new Error(`${path}: the page never went quiet; the last requests: ${last.slice(-5).join(", ")}`);
        await page.waitForTimeout(250);
      }
      const seen = await Promise.all(requests);
      const wire = seen.reduce((sum, r) => sum + r.bytes, 0);
      const late = seen.filter((r) => r.type === "script" && !firstTags.has(r.url.split("#")[0]));
      const lateScripts = late.length;
      const lateScriptBytes = late.reduce((sum, r) => sum + r.bodyLength, 0);
      const otherHosts = seen.filter((r) => new URL(r.url).host !== new URL(base).host && !r.url.startsWith("data:") && !r.url.startsWith("blob:")).map((r) => r.url);
      const ownFetches = seen.filter((r) => (r.type === "fetch" || r.type === "xhr") && !r.router).length;
      if (MEASURE) {
        console.log(`[wire] ${path} ${wire} ${lateScripts} ${lateScriptBytes} ${ownFetches} ${otherHosts.length}`);
        return;
      }
      const text = `${path}: wire ${wire}, late scripts ${lateScripts} (${lateScriptBytes} bytes: ${late.map((r) => r.url).join(", ")}), own fetches ${ownFetches}`;
      expect(wire, text).toBeLessThan(budget.wire);
      expect(lateScripts, text).toBe(budget.lateScripts);
      expect(lateScriptBytes, text).toBe(budget.lateScriptBytes);
      expect(ownFetches, text).toBeLessThanOrEqual(budget.ownFetches);
      expect(otherHosts, `${path} asked another host for these`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

/**
 * The demo store's front page and a product page as a phone loads them (D336): the bytes sent over the wire, the largest picture and
 * the time to the page's first byte, each under its budget. Bytes are as transferred (compressed), counted from every response the
 * page asked for until two seconds after it loaded; the first load is cold (its bytes are the weight), and the first byte is the
 * median of the three loads after it. Measured on the build of 2026-10-27: the front page 311 KB, the product page 331 KB, the largest
 * picture about 1 KB (the demo's pictures are drawings), the first byte under 10 ms. The weight is the page's wire budget above (one number per page; this load waits two seconds, the other until three quiet ones). The budgets leave room for ordinary growth and a
 * slower runner: a change that passes one is a regression to look at, not a number to raise.
 */
const SPEED_BUDGETS = {
  "/s/demo/no": { weight: WIRE_BUDGETS["/s/demo/no"].wire, largestPicture: 200_000, firstByteMs: 250 },
  "/s/demo/no/p/demo-keramikkopp": { weight: WIRE_BUDGETS["/s/demo/no/p/demo-keramikkopp"].wire, largestPicture: 200_000, firstByteMs: 250 },
};

for (const [path, budget] of Object.entries(SPEED_BUDGETS)) {
  test(`${path} stays within its page weight, largest picture and first byte budget`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const firstBytes: number[] = [];
      let weight = 0;
      let largestPicture = 0;
      for (let load = 0; load < 4; load++) {
        const sizes: Promise<{ bytes: number; picture: boolean }>[] = [];
        const counting = (response: import("@playwright/test").Response) => {
          sizes.push(
            response
              .request()
              .sizes()
              .then((s) => ({ bytes: s.responseBodySize + s.responseHeadersSize, picture: response.request().resourceType() === "image" }))
              .catch(() => ({ bytes: 0, picture: false })),
          );
        };
        page.on("response", counting);
        await page.goto(path, { waitUntil: "load" });
        // What the page asks for after it has loaded (pictures coming near, the late scripts): a quiet moment, not "network idle",
        // which a page that keeps a connection open never reaches.
        await page.waitForTimeout(2_000);
        page.off("response", counting);
        if (load === 0) {
          // The first load is the cold one, as a new visitor's: what it transfers is the page's weight. The browser's cache then
          // serves the rest, so later loads only time the first byte.
          const all = await Promise.all(sizes);
          weight = all.reduce((sum, s) => sum + s.bytes, 0);
          largestPicture = Math.max(0, ...all.filter((s) => s.picture).map((s) => s.bytes));
          continue;
        }
        firstBytes.push(await page.evaluate(() => {
          const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
          return nav.responseStart - nav.requestStart;
        }));
      }
      const firstByte = firstBytes.sort((a, b) => a - b)[1];
      const measured = `${path}: ${weight} bytes, largest picture ${largestPicture} bytes, first byte ${firstByte.toFixed(0)} ms`;
      console.log(measured);
      expect(weight, measured).toBeLessThan(budget.weight);
      expect(largestPicture, measured).toBeLessThan(budget.largestPicture);
      expect(firstByte, measured).toBeLessThan(budget.firstByteMs);
    } finally {
      await context.close();
    }
  });
}

/**
 * A store on a launch theme (bloat review step 1.6): `e2e-orbit`, which `pnpm seed:themed` (e2e/seed/themed-store.seed.ts) makes before
 * the build through the platform's own functions: a demo store wearing Orbit whole on its own content, with its header, footer, product
 * layout, two font families (Unbounded and Manrope, installed from e2e/fixtures/fonts) and its photographs with all three stored sizes.
 * Four pages are held, each figure at its first measure plus 5 % (rounded up to the next 500 for characters and bytes): the home, its first
 * product's page, the products listing and the about page (a built page). For each: the document, its payload and `<main>`
 * (`documentOf()`), the characters inside `<style>` elements, and `identicalRows`, the rows (`[data-row]`) in `<main>` whose outer HTML
 * equals another's (held at the count measured). For the home also: each linked stylesheet by its address's pattern (raw bytes; a new one
 * fails), the font files a phone loads from a cold cache (at most 2 files and 80,000 bytes, each preloaded: React names the preload in the
 * response's `Link` header, `FontPreloads`), the pictures a 3x phone draws (none from a file more than 1.5 times as wide as its box; their
 * transferred bytes), and the router requests after load, read to the footer (the count plus 2). Orbit's home as stored is held too.
 * Measured on the build of 18 November 2026 (four runs): the home 216,550 / 154,157 / 22,855, style text 17,224; the product page 177,126
 * / 124,513 / 10,533 and 11,376; the listing 192,183 / 136,556 / 10,444 and 11,373; the about page 153,134 / 112,645 / 4,833 and 12,709;
 * no identical rows; the stylesheets 217,830, 584 and 576 bytes; two font files of 75,740 bytes together; pictures at 3x 142,903 bytes
 * (none too wide); 21 router requests. The first request after the server starts streams the product page in another order (tens of
 * bytes); later runs are identical. A first figure is not the end: after phase 2 the themed pages are judged against the bare
 * store's bars (docs/rules/budgets.md). `E2E_MEASURE=1` prints each figure as `[themed] <page> <measure> <value>` and holds none.
 * Without the seed a local run skips them; in CI a missing store fails.
 */
const THEMED_PAGES = ["home", "product", "products", "page"] as const;
type ThemedPage = (typeof THEMED_PAGES)[number];

const THEMED_BUDGETS: Record<ThemedPage, { document: number; payload: number; main: number; styleText: number; identicalRows: number }> = {
  home: { document: 227_500, payload: 162_000, main: 24_000, styleText: 18_500, identicalRows: 0 },
  product: { document: 186_000, payload: 131_000, main: 11_500, styleText: 12_000, identicalRows: 0 },
  products: { document: 202_000, payload: 143_500, main: 11_000, styleText: 12_000, identicalRows: 0 },
  page: { document: 161_000, payload: 118_500, main: 5_500, styleText: 13_500, identicalRows: 0 },
};

/** The themed home's stylesheets, by the pattern of their address: the build's one file and the two families' sheets. Raw bytes plus 5 %, to the byte. */
const THEMED_STYLESHEETS: Record<string, number> = {
  "/_next/static/chunks/*.css": 228_722,
  "/api/fonts/css/unbounded": 614,
  "/api/fonts/css/manrope": 605,
};

/** The themed home on a phone: its font files, its pictures' transferred bytes on a 3x phone, and its router requests (the count plus 2). */
const THEMED_HOME = { fontFiles: 2, fontBytes: 80_000, pictureBytes: 150_500, routerRequests: 23 };

/**
 * Orbit's home as stored (`octet_length(published::text)`): the brief's bar was 11,100 bytes; the first seeded figure is 11,384 (its six
 * pictures' full addresses on the test server), held at that figure rounded up to the next 100, as a ceiling already passed is held.
 */
const THEMED_HOME_STORED = 11_400;

/** A stylesheet's address as a pattern: the build's hashed file names folded, the query left off. */
const sheetPattern = (href: string) => new URL(href, base).pathname.replace(/^\/_next\/static\/chunks\/[^/]+\.css$/, "/_next/static/chunks/*.css");

/** A reader's pace (as e2e/prefetch.spec.ts reads): down 400 px every 300 ms to the bottom, then 3 s more for what the footer's links ask for. */
async function readToFooter(page: Page) {
  for (let step = 0; step < 300; step++) {
    const atEnd = await page.evaluate(() => {
      window.scrollBy(0, 400);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    });
    if (atEnd) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(3000);
}

/** A router request, as e2e/prefetch.spec.ts's `watch()` tells one: it carries one of Next's prefetch headers. */
const ROUTER_HEADERS = ["next-router-prefetch", "next-router-segment-prefetch"];

test.describe("a store on a launch theme (Orbit)", () => {
  const addresses = {} as Record<ThemedPage, string>;
  let homeStored = 0;

  test.beforeAll(async () => {
    const sql = testDb();
    try {
      const [store] = await sql`
        select s.id, s.country,
          (select count(*)::int from commerce.markets m where m.store_id = s.id and m.active) as markets,
          (select lower(m.code) from commerce.markets m where m.store_id = s.id and m.active order by m.code <> coalesce(s.country, 'NO'), m.code limit 1) as market,
          (select p.handle from commerce.products p where p.store_id = s.id and p.status = 'active' order by p.created_at, p.handle limit 1) as product,
          (select octet_length(pg.published::text) from commerce.pages pg where pg.id = s.front_page_id and pg.store_id = s.id) as home
        from commerce.stores s where s.slug = 'e2e-orbit'`;
      if (!store) {
        if (process.env.CI) throw new Error("The store e2e-orbit is missing: CI seeds it before the build (pnpm seed:themed)");
        test.skip(true, "no store e2e-orbit: run pnpm seed:themed before the build");
        return;
      }
      const root = Number(store.markets) > 1 ? `/s/e2e-orbit/${store.market}` : "/s/e2e-orbit";
      addresses.home = root;
      addresses.product = `${root}/p/${store.product}`;
      addresses.products = `${root}/products`;
      addresses.page = `${root}/about`;
      homeStored = Number(store.home);
    } finally {
      await sql.end();
    }
  });

  test("Orbit's home as stored stays within its bytes", () => {
    if (MEASURE) {
      console.log(`[themed] home stored ${homeStored}`);
      return;
    }
    expect(homeStored, "octet_length(published::text) of the home page").toBeLessThanOrEqual(THEMED_HOME_STORED);
  });

  for (const key of THEMED_PAGES) {
    test(`the themed ${key}: document, payload, main, style text and identical rows`, async ({ browser, page }) => {
      const address = addresses[key];
      const measured = await documentOf(page, address);
      const html = await (await page.request.get(address)).text();
      const styleText = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].reduce((sum, match) => sum + match[1].length, 0);
      // The rows as the server drew them: a context without JavaScript keeps the HTML as sent.
      const plain = await browser.newContext({ javaScriptEnabled: false });
      let identicalRows = 0;
      try {
        const raw = await plain.newPage();
        await raw.goto(address);
        const rows = await raw.locator("main [data-row]").evaluateAll((els) => els.map((el) => el.outerHTML));
        identicalRows = rows.filter((row, i) => rows.some((other, j) => j !== i && other === row)).length;
      } finally {
        await plain.close();
      }
      const figures = { ...measured, styleText, identicalRows };
      if (MEASURE) {
        for (const [measure, value] of Object.entries(figures)) console.log(`[themed] ${key} ${measure} ${value}`);
        return;
      }
      const budget = THEMED_BUDGETS[key];
      const text = `${address}: ${JSON.stringify(figures)}`;
      expect(figures.document, text).toBeLessThan(budget.document);
      expect(figures.payload, text).toBeLessThan(budget.payload);
      expect(figures.main, text).toBeLessThan(budget.main);
      expect(figures.styleText, text).toBeLessThan(budget.styleText);
      expect(figures.identicalRows, text).toBeLessThanOrEqual(budget.identicalRows);
    });
  }

  test("the themed home's stylesheets: each file's bytes, and no new sheet", async ({ page }) => {
    const html = await (await page.request.get(addresses.home)).text();
    const hrefs = [
      ...new Set(
        [...html.matchAll(/<link\b[^>]*>/g)]
          .map((match) => match[0])
          .filter((tag) => /\srel="stylesheet"/i.test(tag))
          .map((tag) => /\shref="([^"]+)"/.exec(tag)?.[1])
          .filter((href): href is string => Boolean(href))
          .map((href) => href.replaceAll("&amp;", "&")),
      ),
    ];
    const sheets = await Promise.all(hrefs.map(async (href) => ({ pattern: sheetPattern(href), bytes: (await (await page.request.get(href)).body()).length })));
    if (MEASURE) {
      for (const sheet of sheets) console.log(`[themed] home stylesheet ${sheet.pattern} ${sheet.bytes}`);
      return;
    }
    const text = `${addresses.home} stylesheets: ${JSON.stringify(sheets)}`;
    expect(sheets.map((sheet) => sheet.pattern).sort(), text).toEqual(Object.keys(THEMED_STYLESHEETS).sort());
    // At most three of the build's own, beside the two font sheets.
    expect(sheets.filter((sheet) => !sheet.pattern.startsWith("/api/fonts/")).length, text).toBeLessThanOrEqual(3);
    for (const sheet of sheets) expect(sheet.bytes, text).toBeLessThan(THEMED_STYLESHEETS[sheet.pattern]);
  });

  test("the themed home on a phone: at most two font files and 80 KB, each preloaded", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const fonts: Promise<{ url: string; bytes: number }>[] = [];
      let moved = Date.now();
      page.on("request", () => {
        moved = Date.now();
      });
      page.on("requestfinished", (request) => {
        moved = Date.now();
        if (request.resourceType() !== "font") return;
        fonts.push(
          (async () => ({ url: new URL(request.url()).pathname, bytes: (await (await request.response())?.body().catch(() => null))?.length ?? 0 }))(),
        );
      });
      const response = await page.goto(addresses.home, { waitUntil: "load" });
      const giveUp = Date.now() + 30_000;
      while (Date.now() - moved < QUIET_MS) {
        if (Date.now() > giveUp) throw new Error(`${addresses.home}: the page never went quiet`);
        await page.waitForTimeout(250);
      }
      const files = await Promise.all(fonts);
      const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
      // Preloaded in the HTML's head or in the response's Link header, where React names a preload it can send early.
      const html = (await response?.text()) ?? "";
      const preloads = [
        ...[...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\srel="preload"/i.test(tag) && /\sas="font"/i.test(tag)).map((tag) => /\shref="([^"]+)"/.exec(tag)?.[1] ?? ""),
        ...[...((await response?.headerValue("link")) ?? "").matchAll(/<([^>]+)>;[^,]*rel=preload;[^,]*as="?font"?/g)].map((m) => m[1]),
      ].map((href) => new URL(href, base).pathname);
      if (MEASURE) {
        console.log(`[themed] home fontFiles ${files.length}`);
        console.log(`[themed] home fontBytes ${bytes}`);
        return;
      }
      const text = `${addresses.home} fonts: ${JSON.stringify(files)}; preloaded: ${preloads.join(", ")}`;
      expect(files.length, text).toBeLessThanOrEqual(THEMED_HOME.fontFiles);
      expect(bytes, text).toBeLessThanOrEqual(THEMED_HOME.fontBytes);
      expect(files.filter((file) => !preloads.includes(file.url)).map((file) => file.url), text).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the themed home on a 3x phone: no picture from a file more than 1.5 times too wide, and its pictures' bytes", async ({ browser }) => {
    test.setTimeout(120_000);
    const size = { width: 390, height: 844 };
    const context = await browser.newContext({ viewport: size, screen: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const pictures: Promise<number>[] = [];
      let moved = Date.now();
      page.on("request", () => {
        moved = Date.now();
      });
      page.on("requestfinished", (request) => {
        moved = Date.now();
        if (request.resourceType() !== "image") return;
        pictures.push(
          request
            .sizes()
            .then((s) => s.responseBodySize + s.responseHeadersSize)
            .catch(() => 0),
        );
      });
      await page.goto(addresses.home, { waitUntil: "load" });
      const giveUp = Date.now() + 30_000;
      while (Date.now() - moved < QUIET_MS) {
        if (Date.now() > giveUp) throw new Error(`${addresses.home}: the page never went quiet`);
        await page.waitForTimeout(250);
      }
      const bytes = (await Promise.all(pictures)).reduce((sum, n) => sum + n, 0);
      // Every picture in view after load: the file's width against what its box needs at 3x.
      const tooWide = await page.evaluate(() =>
        [...document.querySelectorAll("img")]
          .filter((img) => {
            const box = img.getBoundingClientRect();
            return img.complete && img.naturalWidth > 0 && box.width > 0 && box.bottom > 0 && box.top < window.innerHeight;
          })
          .map((img) => ({ src: img.currentSrc, ratio: img.naturalWidth / (img.getBoundingClientRect().width * 3) }))
          .filter((seen) => seen.ratio > 1.5),
      );
      if (MEASURE) {
        console.log(`[themed] home pictureBytes ${bytes}`);
        console.log(`[themed] home tooWide ${tooWide.length}`);
        return;
      }
      expect(tooWide, `pictures drawn from a file more than 1.5 times as wide as their box at 3x`).toEqual([]);
      expect(bytes, `${addresses.home}: picture bytes on a 3x phone`).toBeLessThan(THEMED_HOME.pictureBytes);
    } finally {
      await context.close();
    }
  });

  test("the themed home's router requests on a phone, read to the footer, and it goes quiet", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const routed: Promise<boolean>[] = [];
      let lastRouter = Date.now();
      page.on("request", (request) => {
        routed.push(
          request.allHeaders().then((headers) => {
            const router = ROUTER_HEADERS.some((name) => name in headers);
            if (router) lastRouter = Date.now();
            return router;
          }),
        );
      });
      await page.goto(addresses.home);
      await readToFooter(page);
      const giveUp = Date.now() + 30_000;
      while (Date.now() - lastRouter < 3_000) {
        if (Date.now() > giveUp) throw new Error(`${addresses.home}: never went quiet`);
        await page.waitForTimeout(250);
      }
      const count = (await Promise.all(routed)).filter(Boolean).length;
      if (MEASURE) {
        console.log(`[themed] home routerRequests ${count}`);
        return;
      }
      expect(count, `router requests of ${addresses.home}`).toBeLessThanOrEqual(THEMED_HOME.routerRequests);
    } finally {
      await context.close();
    }
  });
});

test("a page load's speed reaches the store's report when the visitor closes the tab, and nothing with Do Not Track (D336)", async ({ browser }) => {
  const { slug, id } = await testStore("fart");
  const sql = testDb();
  try {
    await sql`update commerce.stores set visit_counting = true where id = ${id}`;
    const count = async () => Number((await sql`select count(*)::int as n from commerce.speed_samples where store_id = ${id}`)[0].n);
    // With Do Not Track the beacon sends nothing.
    const private_ = await browser.newContext({ extraHTTPHeaders: { DNT: "1" } });
    const hidden = await private_.newPage();
    await hidden.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
    await hidden.goto(`/s/${slug}`);
    await hidden.waitForTimeout(1_000);
    await hidden.close();
    await private_.close();
    // A visitor on a phone opens the front page and closes the tab: its figures are sent as it is hidden, with its main content's
    // time (which the browser knows only then), kept as the page's kind and the screen. (Headless Chromium does not deliver a
    // beacon sent while it navigates to another page, so closing is what is tested here; a browser sends on either.)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/s/${slug}`);
    await page.waitForTimeout(1_000);
    await page.close();
    await expect.poll(count, { timeout: 10_000 }).toBe(1);
    const [row] = await sql`select kind, screen, lcp_ms, ttfb_ms from commerce.speed_samples where store_id = ${id}`;
    expect(row).toMatchObject({ kind: "home", screen: "phone" });
    expect(row.lcp_ms).not.toBeNull();
    expect(row.ttfb_ms).not.toBeNull();
    await context.close();
  } finally {
    await sql.end();
  }
});

test("an embedded HTML frame always has a name for screen readers", async ({ page }) => {
  const url = await storePageRows("ytelse-ramme", [
    { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "f1", type: "html", html: "<p>Hei</p>", title: "" }] }] },
  ]);
  await page.goto(url);
  await expect(page.locator("iframe")).toHaveAttribute("title", "Innebygd innhold");
});
