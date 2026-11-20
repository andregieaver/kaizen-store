import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { storePageRows } from "./db";

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
 * Bloat review step 2.6 (links state what they may fetch ahead, `docs/performance.md` *What the router fetches ahead*): the front page, a product page, a
 * content page and the cart are held to 6 (measured 19 November 2026 after it: 3, 3, 3 and 5; before it 19, 18 and 20, and 47 on the home before step 0.12),
 * and the listing too (4 after it, 20 before).
 * A change that passes a budget is a regression to look at, not a number to raise.
 */
const ROUTER_REQUESTS: Record<string, number> = {
  "/s/demo/no": 6,
  "/s/demo/no/p/demo-keramikkopp": 6,
  "/s/demo/no/om-oss": 6,
  "/s/demo/no/products": 6,
  "/s/demo/no/cart": 6,
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

/**
 * Bloat review step 2.6. A computer's home page fetches little ahead (the header's top links and the plain cart anchor are not in view as links to fetch), a footer link
 * waits to be pointed at, and the first Add to cart makes the router ask again for little (32 links in view before; a server action that sets a cookie makes the router
 * ask again for every link in view, so the number of links on sight is the cost of each one).
 */
test("the home on a computer fetches little ahead", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    const seen = watch(page);
    await page.goto("/s/demo/no");
    const giveUp = Date.now() + 30_000;
    while (seen.quietFor() < 3_000) {
      if (Date.now() > giveUp) throw new Error("the router never went quiet");
      await page.waitForTimeout(250);
    }
    const prefetches = await seen.prefetches();
    if (MEASURE) console.log(`[router] computer home ${prefetches.length}`);
    else expect(prefetches.length, `router requests of the home at 1280 px:\n${prefetches.join("\n")}`).toBeLessThanOrEqual(8);
  } finally {
    await context.close();
  }
});

test("a footer link waits to be pointed at", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await phone(browser);
  try {
    const seen = watch(page);
    await page.goto("/s/demo/no");
    await readToFooter(page);
    const cookies = page.getByRole("contentinfo").getByRole("link", { name: "Informasjonskapsler" });
    await expect(cookies).toBeVisible();
    const cookieRequests = async () => (await seen.prefetches()).filter((path) => path.includes("/cookies"));
    expect(await cookieRequests(), "router requests for the cookies page before it is pointed at").toEqual([]);
    await cookies.hover();
    await page.waitForTimeout(1500);
    expect((await cookieRequests()).length, "router requests for the cookies page once it is pointed at").toBeGreaterThanOrEqual(1);
    let documents = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documents++;
    });
    await cookies.click();
    await expect(page).toHaveURL(/\/s\/demo\/no\/cookies$/);
    expect(documents, "document requests of the press").toBe(0);
    // Let the requests the press started finish being read before the page closes.
    await page.waitForTimeout(1500);
    await seen.all();
  } finally {
    await context.close();
  }
});

test("the first add to cart asks for little again", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await phone(browser);
  try {
    const seen = watch(page);
    await page.goto("/s/demo/no/p/demo-handlenett");
    await page.waitForTimeout(3000);
    const add = page.getByRole("button", { name: "Legg i handlekurven" }).first();
    // A press before the page has come alive does nothing, so wait for the button to be live as a shopper would.
    await expect(add).toBeEnabled();
    const press = async () => {
      const before = (await seen.prefetches()).length;
      await add.click();
      await page.waitForTimeout(4000);
      return (await seen.prefetches()).length - before;
    };
    const first = await press();
    const second = await press();
    if (MEASURE) {
      console.log(`[router] first add ${first}, second ${second}`);
      return;
    }
    expect(first, "router requests in the 4 s after the first Add to cart (32 before step 2.6)").toBeLessThanOrEqual(10);
    expect(second, "router requests in the 4 s after the second Add to cart").toBe(0);
  } finally {
    await context.close();
  }
});

/**
 * Bloat review step 2.7 (PF-4): a built page's links go through `BlockLink` (`src/components/block-link.tsx`), which stays in the app for an address of the
 * app and fetches it on intent. A tap on the home page's first product tile was a whole document and 42 requests before (1 and 42); it is a navigation inside
 * the app now. A link to a pay path stays a full page load (`docs/pci.md`).
 */
function collect(page: Page) {
  const seen: Request[] = [];
  const listen = (request: Request) => seen.push(request);
  page.on("request", listen);
  return {
    stop: () => page.off("request", listen),
    documents: () => seen.filter((request) => request.resourceType() === "document"),
    all: () => seen,
    list: () => seen.map((request) => `${request.resourceType()} ${request.url()}`).join("\n"),
  };
}

test("a press on a built page's tile stays in the app", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/s/demo/no", { waitUntil: "networkidle" });
    const tile = page.locator("main article a[href*='/p/']").first();
    await expect(tile).toBeVisible();
    const requests = collect(page);
    await tile.tap();
    await expect(page).toHaveURL(/\/p\//);
    await page.waitForTimeout(3500);
    requests.stop();
    if (MEASURE) console.log(`[tile] documents ${requests.documents().length}, requests ${requests.all().length}\n${requests.list()}`);
    expect(requests.documents().length, `document requests of the tap:\n${requests.list()}`).toBe(0);
    expect(requests.all().length, `requests of the tap (42 before step 2.7):\n${requests.list()}`).toBeLessThanOrEqual(8);
  } finally {
    await context.close();
  }
});

test("a built page's link to the cart is a full page load", async ({ page }) => {
  const url = await storePageRows("blokk-kurv", [
    { id: "r0", type: "row", layout: "1", columns: [{ id: "c0", blocks: [{ id: "b0", type: "button", label: "Til kurven", href: "/s/demo/no/cart" }] }] },
  ]);
  await page.goto(url, { waitUntil: "networkidle" });
  const requests = collect(page);
  await page.getByRole("link", { name: "Til kurven" }).click();
  await expect(page).toHaveURL(/\/s\/demo\/no\/cart/);
  await page.waitForLoadState("load");
  requests.stop();
  expect(requests.documents().length, `document requests of the press:\n${requests.list()}`).toBe(1);
});
