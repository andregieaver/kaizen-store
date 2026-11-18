import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { runBytes } from "../run-bytes";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The script four admin screens have run by the time they are idle (bloat review step 1.14, `docs/performance.md` *Time on a slow phone*),
 * signed in at desktop width with the CPU slowed four times: the bytes V8 counted as run, each byte once (`e2e/run-bytes.ts`), held within
 * 5 % over (a fall is a note) in `ADMIN_RUN_BYTES`, as `e2e/performance.spec.ts` holds the store's. Each screen also prints its largest paint and its
 * blocking time (`admin-run <screen> lcp=<ms> blocking=<ms> run=<bytes>`) and keeps them as annotations: timings are printed, never held.
 * The one timing that can be held is the home's and orders' largest paint, at most 2,500 ms, and only with `ADMIN_PAINT_BAR=1`: the bar is
 * judged after phase 2 of the review (step 2.32), so until then it is printed, not enforced. `E2E_MEASURE=1` prints the run bytes only.
 */
test.use({ storageState: OWNER.state, viewport: { width: 1440, height: 900 } });

const MEASURE = process.env.E2E_MEASURE === "1";

/**
 * Measured on the build of 18 November 2026, three runs each: home 474,185 to 474,420, orders 451,870 to 452,752, a product's editor
 * 803,166 to 805,106, the page builder 1,635,333 to 1,640,464 (under 0.4 % apart); each held at its highest figure, rounded up. Largest
 * paint (0.8 to 1.4 s, the builder 3.4 to 4.4 s) and blocking time (about 0.2 s, 0.4 to 0.6 s and 1.0 to 1.5 s) are printed only.
 */
const ADMIN_RUN_BYTES: Record<string, number> = {
  home: 474_500,
  orders: 452_800,
  "product editor": 805_200,
  "page builder": 1_640_500,
};

/** The first product and the first page of the e2e store, as `admin-scripts.spec.ts` finds them. */
async function idsOf(): Promise<{ product: string; page: string }> {
  const sql = testDb();
  try {
    const [product] = await sql`
      select p.id from commerce.products p join commerce.stores s on s.id = p.store_id where s.slug = ${E2E_STORE} order by p.created_at, p.handle limit 1`;
    const [page] = await sql`
      select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${E2E_STORE} and p.type = 'page' order by p.created_at, p.slug limit 1`;
    return { product: String(product.id), page: String(page.id) };
  } finally {
    await sql.end();
  }
}

for (const screen of Object.keys(ADMIN_RUN_BYTES)) {
  test(`the admin's ${screen} runs the script it has held`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "page.coverage is Chromium's");
    const ids = await idsOf();
    const path = {
      home: `/admin/${E2E_STORE}`,
      orders: `/admin/${E2E_STORE}/orders`,
      "product editor": `/admin/${E2E_STORE}/products/${ids.product}`,
      "page builder": `/admin/${E2E_STORE}/pages/${ids.page}`,
    }[screen]!;
    const { runBytes: figure, lcpMs, blockingMs } = await runBytes(page, path, { cpu: 4 });
    console.log(`admin-run ${screen} lcp=${lcpMs} blocking=${blockingMs} run=${figure}`);
    test.info().annotations.push({ type: "lcp", description: `${lcpMs} ms` }, { type: "blocking", description: `${blockingMs} ms` });
    if (MEASURE) return;
    const held = ADMIN_RUN_BYTES[screen];
    expect(figure, `${screen}: ${figure} bytes of script run by idle, held ${held}: more script runs before idle: find what was added`).toBeLessThanOrEqual(held * 1.05);
    // A fall is a note, not a failure: lower ADMIN_RUN_BYTES in this file.
    if (figure < held * 0.95) console.info(`${screen}: ${figure} bytes of script run by idle, held ${held}: less script runs; lower ADMIN_RUN_BYTES in this file`);
    if (process.env.ADMIN_PAINT_BAR === "1" && (screen === "home" || screen === "orders")) expect(lcpMs, `${screen}: largest paint ${lcpMs} ms`).toBeLessThanOrEqual(2_500);
  });
}
