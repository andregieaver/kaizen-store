import { expect, test, type Page, type Request } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * What the admin fetches ahead (bloat review step 0.13, `docs/admin-navigation.md` *What the admin fetches ahead*), held in the real build:
 * prefetching only runs in a production build. The rail, the menus, the back links and the rows of the lists are `AdminLink`s, fetched when
 * the pointer, a touch or the focus reaches them, never because they are in view, so a screen at rest asks for no other screen's page.
 * A router prefetch is a request carrying `next-router-prefetch` or `next-router-segment-prefetch` (the header names `e2e/prefetch.spec.ts`
 * confirmed in this Next version, step 0.12).
 */
const PREFETCH_HEADERS = ["next-router-prefetch", "next-router-segment-prefetch"];
const MEASURE = process.env.E2E_MEASURE === "1";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORE = `/admin/${E2E_STORE}`;

/**
 * The eight screens: their address (`{product}` and `{page}` are one of the store's own), who opens it, `prefetches` (the most router prefetch
 * requests allowed in the 3 s after load; each ceiling was written at the count measured then and may only fall) and `fetches` (the exact
 * paths, without query, of every other fetch or XHR request made in those 3 s, as the first run showed them).
 * Held at the count of 14 November 2026; may only fall. The products list's 8 are its own toolbar links (export, import, categories, new), never a product's editor;
 * the orders list's 8 its toolbar links (a new draft, drafts, emails, export), never an order or a customer of a row, so neither count grows with the rows.
 */
const SCREENS: { name: string; address: string; as: typeof OWNER | typeof ADMIN; prefetches: number; fetches: string[] }[] = [
  { name: "home", address: STORE, as: OWNER, prefetches: 0, fetches: ["/admin/account/notices/feed"] },
  { name: "orders", address: `${STORE}/orders`, as: OWNER, prefetches: 8, fetches: ["/admin/account/notices/feed"] },
  { name: "products", address: `${STORE}/products`, as: OWNER, prefetches: 8, fetches: ["/admin/account/notices/feed"] },
  { name: "pages", address: `${STORE}/pages`, as: OWNER, prefetches: 6, fetches: ["/admin/account/notices/feed"] },
  { name: "settings", address: `${STORE}/settings`, as: OWNER, prefetches: 16, fetches: ["/admin/account/notices/feed"] },
  { name: "a product's editor", address: `${STORE}/products/{product}`, as: OWNER, prefetches: 2, fetches: ["/admin/account/notices/feed"] },
  { name: "the builder", address: `${STORE}/pages/{page}`, as: OWNER, prefetches: 0, fetches: ["/admin/account/notices/feed", `${STORE}/pages/{page}`] },
  { name: "the platform home", address: "/admin/platform", as: ADMIN, prefetches: 0, fetches: ["/admin/account/notices/feed"] },
];

type Seen = { path: string; prefetch: boolean };

/** Every fetch or XHR request the page makes once its load event has fired, and whether each is a router prefetch (from its headers). */
function watch(page: Page) {
  const requests: Promise<Seen>[] = [];
  let loaded = false;
  let live = true;
  page.on("load", () => {
    loaded = true;
  });
  const count = (request: Request) => {
    if (!loaded || !live) return;
    const type = request.resourceType();
    requests.push(
      request.allHeaders().then((headers) => ({
        path: new URL(request.url()).pathname,
        prefetch: PREFETCH_HEADERS.some((name) => name in headers),
        type,
      })),
    );
  };
  page.on("request", (request) => {
    // Every call the screen makes after load: fetch, XHR and the rest of what is not a script, stylesheet, picture, font or document it was drawn with.
    if (["fetch", "xhr", "other"].includes(request.resourceType())) count(request);
  });
  return {
    all: async () => Promise.all(requests),
    mark: () => requests.length,
    /** Stops counting, so the requests a press starts are not still being read when the test ends. */
    stop: () => {
      live = false;
    },
    since: async (from: number) => (await Promise.all(requests.slice(from))).filter((seen) => seen.prefetch),
  };
}

async function resolve(address: string): Promise<string> {
  if (!address.includes("{")) return address;
  const sql = testDb();
  try {
    const [product] = await sql`
      select p.id from commerce.products p join commerce.stores s on s.id = p.store_id
      where s.slug = ${E2E_STORE} order by p.created_at limit 1`;
    const [page] = await sql`
      select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${E2E_STORE} and p.type = 'page' order by p.created_at limit 1`;
    return address.replace("{product}", String(product?.id)).replace("{page}", String(page?.id));
  } finally {
    await sql.end();
  }
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use({ storageState: screen.as.state });

    test(`${screen.name} fetches ahead no more than it is held to, and calls nothing it does not name`, async ({ page }) => {
      const address = await resolve(screen.address);
      const seen = watch(page);
      await page.goto(address);
      await page.waitForLoadState("load");
      await page.waitForTimeout(3000);
      const all = await seen.all();
      const prefetches = all.filter((one) => one.prefetch).map((one) => one.path);
      const others = [...new Set(all.filter((one) => !one.prefetch).map((one) => one.path))].sort();
      if (MEASURE) console.log(`[prefetch] ${screen.name}: ${prefetches.length} prefetches ${JSON.stringify(prefetches)}; fetches ${JSON.stringify(others)}`);
      else {
        expect(prefetches.length, `router prefetches after load:\n${prefetches.join("\n")}`).toBeLessThanOrEqual(screen.prefetches);
        const id = address.split("/").pop() as string;
        expect(others, "other fetches after load").toEqual(screen.fetches.map((path) => path.replace("{page}", id)).sort());
        if (screen.name === "products") {
          const editors = prefetches.filter((path) => new RegExp(`^${STORE}/products/${UUID}`).test(path));
          expect(editors, "the list prefetches a product's editor").toEqual([]);
        }
        if (screen.name === "orders") {
          const rows = prefetches.filter((path) => new RegExp(`^${STORE}/(orders|customers)/${UUID}`).test(path));
          expect(rows, "the list prefetches an order or a customer of a row").toEqual([]);
        }
      }
    });
  });
}

test.describe("pointing at a rail link", () => {
  test.use({ storageState: OWNER.state });

  test("hovering Products fetches its page, once or twice, and pressing it opens it", async ({ page }) => {
    const seen = watch(page);
    await page.goto(STORE);
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);
    const before = seen.mark();
    await page.getByRole("navigation").getByRole("link", { name: /Products/ }).first().hover();
    await page.waitForTimeout(2000);
    const after = await seen.since(before);
    seen.stop();
    if (MEASURE) console.log(`[prefetch] hover: ${after.length} ${JSON.stringify(after.map((one) => one.path))}`);
    expect(after.length, `prefetches after the hover:\n${after.map((one) => one.path).join("\n")}`).toBeGreaterThanOrEqual(1);
    expect(after.length, `prefetches after the hover:\n${after.map((one) => one.path).join("\n")}`).toBeLessThanOrEqual(2);
    for (const one of after) expect(one.path).toMatch(new RegExp(`^${STORE}/products(\\.segments.*)?$|^${STORE}/products/`));

    await page.getByRole("navigation").getByRole("link", { name: /Products/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`${STORE}/products$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
