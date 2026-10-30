import { expect, test, type Page } from "@playwright/test";

import { storePageRows, testDb, testStore } from "./db";

/**
 * What a visitor's page loads first (D211, `docs/performance.md`): held here in the real build, as numbers a Lighthouse score
 * would move with but that do not wobble as a score does. `pnpm perf` runs Lighthouse itself.
 */

/** The first scripts of the demo store's front page may not grow past this, raw (before compression): 893 KB when this was set (D212; 1.01 MB while every language's whole interface text came with it); 965 KB from D303 (the consent manager's ads tags and shop-event bus; the events' mapping loads only when a tag is on); 972 KB from D303 I2 and I3 (the consent manager posting the ad platforms' ids after a choice, and the first-visit keeper's idle wrapper; the keeper itself loads only where drawn). */
const FIRST_SCRIPTS_MAX = 972_000;

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

/**
 * Every other route a visitor or a person signing in meets first, each under its own first-scripts budget (PSI PERF-11), raw as above.
 * Measured on the build of 30 October 2026, after the signed-out pages stopped loading the admin's whole English text through
 * `ActionForm`, `PasswordField` and the sign-in panels (2.0 to 2.1 MB each before): the product page 993 KB, Kaizena Flow's front page
 * 827 KB, sign-up 840 KB, status 837 KB, sign-in 714 KB, forgot password 713 KB. About 5 % of room; a change that passes one is a
 * regression to look at, not a number to raise.
 */
const FIRST_SCRIPTS_BUDGETS: Record<string, number> = {
  "/s/demo/no/p/demo-keramikkopp": 1_040_000,
  "/": 870_000,
  "/sign-up": 880_000,
  "/status": 880_000,
  "/admin/sign-in": 750_000,
  "/admin/forgot-password": 750_000,
};

for (const [path, max] of Object.entries(FIRST_SCRIPTS_BUDGETS)) {
  test(`${path}'s first scripts stay within their budget`, async ({ page }) => {
    await page.goto(path);
    const scripts = await firstScripts(page);
    const total = scripts.reduce((sum, script) => sum + script.text.length, 0);
    expect(total, `${path} first scripts: ${total} bytes`).toBeLessThan(max);
  });
}

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

/**
 * The demo store's front page and a product page as a phone loads them (D336): the bytes sent over the wire, the largest picture and
 * the time to the page's first byte, each under its budget. Bytes are as transferred (compressed), counted from every response the
 * page asked for until two seconds after it loaded; the first load is cold (its bytes are the weight), and the first byte is the
 * median of the three loads after it. Measured on the build of 2026-10-27: the front page 311 KB, the product page 331 KB, the largest
 * picture about 1 KB (the demo's pictures are drawings), the first byte under 10 ms. The budgets leave room for ordinary growth and a
 * slower runner: a change that passes one is a regression to look at, not a number to raise.
 */
const SPEED_BUDGETS = {
  "/s/demo/no": { weight: 450_000, largestPicture: 200_000, firstByteMs: 250 },
  "/s/demo/no/p/demo-keramikkopp": { weight: 450_000, largestPicture: 200_000, firstByteMs: 250 },
} as const;

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
