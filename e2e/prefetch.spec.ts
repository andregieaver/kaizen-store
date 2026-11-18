import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * What a page asks for ahead of a press (bloat review step 0.12, `docs/performance.md`), held in the real build: prefetching only runs in a production build.
 * A router prefetch is a request carrying `next-router-prefetch` or `next-router-segment-prefetch` (`NEXT_ROUTER_PREFETCH_HEADER` and `NEXT_ROUTER_SEGMENT_PREFETCH_HEADER`
 * in `node_modules/next/dist/client/components/app-router-headers.js`, Next 16.4: both confirmed on the `_rsc=` and `.segments` requests of /s/demo/no); its address
 * carries `_rsc=` or a `.segments` path.
 */
// Measured before step 0.12: the phone home page read to the footer made 47 prefetches, 24 of them for other views (other languages, currencies and countries);
// the /s/demo front door 12; Kaizena Flow's front page 2 /admin answers, 6 admin scripts and the admin's stylesheet. Budgets only fall.
/**
 * One budget per page (bloat review step 1.3): the router requests (`watch()`'s prefetches) a phone makes loading the page, reading to the footer, and
 * waiting until no router request has started for three seconds. Each is the measured count plus 2 (counts wobble by one or two with what is in view),
 * or the number step 0.12 set where that is stricter (the home page's 23, the front door's 0). `E2E_MEASURE=1` prints `[router] path count`.
 * Measured on the build of 17 November 2026: the front page 19, a product page 18, a listing 20, the cart 20, the front door 0.
 */
const ROUTER_REQUESTS: Record<string, number> = {
  "/s/demo/no": 21,
  "/s/demo/no/p/demo-keramikkopp": 20,
  "/s/demo/no/products": 22,
  "/s/demo/no/cart": 22,
  "/s/demo": 0,
};
const MEASURE = process.env.E2E_MEASURE === "1";
const PAGES = ["/", "/s/demo", "/s/demo/no", "/s/demo/no/cart"];
const PREFETCH_HEADERS = ["next-router-prefetch", "next-router-segment-prefetch"];

type Seen = { path: string; prefetch: boolean; segment: string };
type Sheet = { url: string; afterLoad: boolean };

/** Every request the page makes (whether it is a router prefetch, from its headers) and every stylesheet (and whether it began after the load event). */
function watch(page: Page) {
  const requests: Promise<Seen>[] = [];
  const stylesheets: Sheet[] = [];
  let loaded = false;
  let lastPrefetchAt = Date.now();
  page.on("load", () => {
    loaded = true;
  });
  page.on("request", (request) => {
    requests.push(
      request.allHeaders().then((headers) => {
        const prefetch = PREFETCH_HEADERS.some((name) => name in headers);
        if (prefetch) lastPrefetchAt = Date.now();
        return { path: new URL(request.url()).pathname, prefetch, segment: headers["next-router-segment-prefetch"] ?? "" };
      }),
    );
    if (request.resourceType() === "stylesheet") stylesheets.push({ url: request.url(), afterLoad: loaded });
  });
  return {
    stylesheets,
    /** Milliseconds since a router request last started. */
    quietFor: () => Date.now() - lastPrefetchAt,
    all: () => Promise.all(requests),
    prefetches: async () => (await Promise.all(requests)).filter((seen) => seen.prefetch).map((seen) => seen.path),
    /** The same router prefetches with their segment header, for a report of what repeats. */
    prefetchesWithSegment: async () => (await Promise.all(requests)).filter((seen) => seen.prefetch).map((seen) => `${seen.path} ${seen.segment}`.trim()),
  };
}

/** A reader's pace: down 400 px every 300 ms to the bottom, then 3 s more for what the footer's links ask for. */
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

async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return { context, page: await context.newPage() };
}

/** The market a prefetch's path is for: `/s/demo/no-sv/...` gives `no-sv`; a segment prefetch's `no.segments` gives `no`. */
function marketOf(path: string): string {
  return (path.split("/")[3] ?? "").replace(/\.(segments|rsc)$/, "");
}

for (const [path, budget] of Object.entries(ROUTER_REQUESTS)) {
  test(`${path} makes at most ${budget} router requests on a phone, and goes quiet`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser);
    try {
      const seen = watch(page);
      await page.goto(path);
      await readToFooter(page);
      const giveUp = Date.now() + 30_000;
      while (seen.quietFor() < 3_000) {
        if (Date.now() > giveUp) throw new Error(`${path}: the router never went quiet; most recent: ${(await seen.prefetches()).slice(-5).join(", ")}`);
        await page.waitForTimeout(250);
      }
      const prefetches = await seen.prefetches();
      if (MEASURE) {
        console.log(`[router] ${path} ${prefetches.length}`);
        return;
      }
      expect(prefetches.length, `router requests of ${path}:\n${prefetches.join("\n")}`).toBeLessThanOrEqual(budget);
    } finally {
      await context.close();
    }
  });
}

test("no other view is fetched ahead", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await phone(browser);
  try {
    const seen = watch(page);
    await page.goto("/s/demo/no");
    await readToFooter(page);
    const prefetches = await seen.prefetches();
    const others = prefetches.filter((path) => path.startsWith("/s/demo/") && marketOf(path) !== "no");
    expect(others, `prefetches for other views:\n${others.join("\n")}`).toEqual([]);
    expect(prefetches.length, `all prefetches:\n${prefetches.join("\n")}`).toBeLessThanOrEqual(ROUTER_REQUESTS["/s/demo/no"]);
  } finally {
    await context.close();
  }
});

test("the front door asks for nothing ahead", async ({ browser }) => {
  const { context, page } = await phone(browser);
  try {
    const seen = watch(page);
    await page.goto("/s/demo");
    await page.waitForTimeout(3000);
    const prefetches = await seen.prefetches();
    expect(prefetches, `front door prefetches:\n${prefetches.join("\n")}`).toHaveLength(ROUTER_REQUESTS["/s/demo"]);
  } finally {
    await context.close();
  }
});

test("the site does not fetch the admin or a store ahead", async ({ browser }) => {
  const { context, page } = await phone(browser);
  try {
    const seen = watch(page);
    await page.goto("/");
    await page.waitForTimeout(3000);
    const all = await seen.all();
    expect(all.filter((r) => r.path === "/admin" || r.path.startsWith("/admin/")).map((r) => r.path)).toEqual([]);
    expect(all.filter((r) => r.prefetch && r.path.startsWith("/s/")).map((r) => r.path)).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const path of PAGES) {
  test(`${path}: no stylesheet arrives that the HTML did not link`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser);
    try {
      const seen = watch(page);
      const response = await page.goto(path);
      const html = (await response?.text()) ?? "";
      const linked = [...html.matchAll(/<link\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => /\brel="stylesheet"/.test(tag))
        .map((tag) => /\bhref="([^"]*)"/.exec(tag)?.[1])
        .filter((href): href is string => Boolean(href))
        .map((href) => new URL(href.replaceAll("&amp;", "&"), page.url()).href);
      expect(linked.length, "the HTML links at least one stylesheet").toBeGreaterThan(0);
      await readToFooter(page);
      const late = seen.stylesheets.filter((sheet) => sheet.afterLoad && !linked.includes(sheet.url)).map((sheet) => sheet.url);
      expect(late, `stylesheets fetched after load that the HTML did not link:\n${late.join("\n")}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

/**
 * A store page goes quiet (bloat review step 0.14, `next.config.ts` `optimisticRouting: false`): the count is `watch()`'s router prefetches, registered before `goto`.
 * Before the setting the search page made 624 in 4 s and never stopped (the `@drawer/[...rest]` slot's segment asked for without end). The 60 and the 0 do not move.
 */
test.describe("a store page goes quiet", () => {
  for (const path of ["/s/demo/no/search?q=lampe", "/s/demo/no/category/hjem", "/s/demo/no/cart", "/themes"]) {
    test(path, async ({ page }) => {
      const seen = watch(page);
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(3000);
      const first = (await seen.prefetches()).length;
      expect(first, `router prefetches in the 3 s after load of ${path}`).toBeLessThan(60);
      await page.waitForTimeout(2000);
      const all = await seen.prefetchesWithSegment();
      const counts = new Map<string, number>();
      for (const line of all) counts.set(line, (counts.get(line) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([line, n]) => `${n} x ${line}`).join("\n");
      expect(all.length - first, `router prefetches after the first 3 s of ${path} (total ${all.length}); most repeated:\n${top}`).toBe(0);
    });
  }
});
