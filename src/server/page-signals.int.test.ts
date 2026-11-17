import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, todayIn } from "@/lib/analytics-period";
import { signalPlan, stripText } from "@/lib/page-signals";
import { heatmapsEn } from "@/lib/admin-messages/heatmaps.en";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { getStore } = await import("./stores");
const { heatKeyPage, pageSignals } = await import("./page-signals");
const { placeTestOrder } = await import("./analytics-insights-fixture");

/**
 * The *how it performs* strip's reads (ecosystem plan E2.3, D713) against a store with heat totals, counted product views, an order,
 * speed samples, a recording and a running A/B test: only the page's keys, every visitor's totals and the last 30 days are counted, and
 * another store's rows never are.
 */

const run = Date.now().toString(36);
const now = new Date();
const ZONE = "Europe/Oslo";
const today = todayIn(now, ZONE);
let store: Store;
let other: Store;
let quiet: Store;
let pageId: string;
let mugId: string;

async function makeStore(name: string): Promise<Store> {
  const slug = `${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Signals', null) as id`);
  await db().execute(sql`update commerce.stores set time_zone = ${ZONE} where id = ${String(created.id)}::uuid`);
  return (await getStore(slug))!;
}

const totals = (s: Store, day: string, page: string, device: string, tag: string, views: number, frustrated: number, half: number) => {
  const reach = new Array<number>(21).fill(0);
  reach[20] = half;
  reach[3] = views - half;
  return sql`
    insert into commerce.page_heat_days (store_id, day, page, device, tag, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
    values (${s.id}::uuid, ${day}::date, ${page}, ${device}, ${tag}, ${views}, ${`{${reach.join(",")}}`}::int[], ${views * 400},
      ${`{${new Array<number>(20).fill(0).join(",")}}`}::bigint[], 0, ${views}, ${frustrated}, 0, ${frustrated}, 0, ${frustrated})`;
};

const sample = (s: Store, kind: string, screen: string, lcp: number) =>
  sql`insert into commerce.speed_samples (store_id, day, kind, screen, lcp_ms, inp_ms, cls_milli, ttfb_ms) values (${s.id}::uuid, ${today}::date, ${kind}, ${screen}, ${lcp}, 100, 40, 300)`;

beforeAll(async () => {
  store = await makeStore("signals");
  other = await makeStore("signals-other");
  quiet = await makeStore("signals-quiet");
  await db().execute(sql`update commerce.stores set heatmaps = true, visit_counting = true where id = ${store.id}::uuid`);
  store = (await getStore(store.slug))!;

  // The page's two keys, a day out of the period, a version's totals, another page and another store's same page.
  await db().execute(totals(store, today, "/no/om-oss", "mobile", "", 100, 10, 40));
  await db().execute(totals(store, addDays(today, -5), "/no/om-oss", "desktop", "", 50, 5, 30));
  await db().execute(totals(store, today, "/se/om-oss", "mobile", "", 20, 0, 20));
  await db().execute(totals(store, addDays(today, -40), "/no/om-oss", "mobile", "", 900, 900, 0));
  await db().execute(totals(store, today, "/no/p/mug", "mobile", "", 70, 7, 7));
  await db().execute(totals(other, today, "/no/om-oss", "mobile", "", 500, 500, 0));

  const [page] = await db().execute<Row>(sql`select id, published from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and slug = 'om-oss'`);
  pageId = String(page.id);
  // A running test of the page: the original and a published version.
  const copySlug = `ab-${run}-b`;
  const [copy] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, slug, draft, published, published_at, type)
    values (${store.id}::uuid, ${copySlug}, ${JSON.stringify({ ...(page.published as object), slug: copySlug })}::jsonb, ${JSON.stringify({ ...(page.published as object), slug: copySlug })}::jsonb, now(), 'variant')
    returning id`);
  const [test] = await db().execute<Row>(sql`insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values (${store.id}::uuid, 'Shorter story', ${pageId}::uuid, 'orders') returning id`);
  await db().execute(sql`
    insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
    values (${store.id}::uuid, ${String(test.id)}::uuid, 'a', 'Original', null, 0.5), (${store.id}::uuid, ${String(test.id)}::uuid, 'b', 'Version B', ${String(copy.id)}::uuid, 0.5)`);
  await db().execute(sql`update commerce.experiments set status = 'running' where id = ${String(test.id)}::uuid`);
  await db().execute(totals(store, today, "/no/om-oss", "mobile", `${String(test.id)}:b`, 300, 300, 0));

  // The mug: 200 counted views in the period (and 1000 before it), one paid checkout order with it and one without.
  const [mug] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.id}::uuid and sku = 'DEMO-MUG-WHITE'`);
  mugId = String(mug.product_id);
  await db().execute(sql`
    insert into commerce.product_views (store_id, day, product_id, views) values
      (${store.id}::uuid, ${today}::date, ${mugId}::uuid, 120), (${store.id}::uuid, ${addDays(today, -10)}::date, ${mugId}::uuid, 80),
      (${store.id}::uuid, ${addDays(today, -45)}::date, ${mugId}::uuid, 1000)`);
  await placeTestOrder(store, { at: now.toISOString(), mug: true });
  await placeTestOrder(store, { at: now.toISOString() });

  // Speed: 25 phone loads of other pages (enough for a figure) and 5 computer loads (too few); product pages are another kind.
  for (let i = 0; i < 25; i++) await db().execute(sample(store, "page", "phone", 2000));
  for (let i = 0; i < 5; i++) await db().execute(sample(store, "page", "computer", 9000));
  for (let i = 0; i < 25; i++) await db().execute(sample(store, "product", "phone", 5000));

  // A recording through the page, and one through another.
  await db().execute(sql`
    insert into commerce.recordings (id, store_id, day, started_at, last_at, device, entry_page, pages, mask)
    values (gen_random_uuid(), ${store.id}::uuid, ${today}::date, now(), now(), 'mobile', '/no', '{/no,/no/om-oss}', 'balanced'),
      (gen_random_uuid(), ${store.id}::uuid, ${today}::date, now(), now(), 'mobile', '/no', '{/no/p/mug}', 'balanced')`);
});

afterAll(async () => {
  await closeDb();
});

const countries = () => store.allMarkets.map((m) => m.code);

describe("a page's signals", () => {
  it("adds the page's keys over the last 30 days, every visitor's, per device, and finds the key seen most", async () => {
    const plan = signalPlan({ type: "page", slug: "om-oss" }, ["NO", "SE"]);
    const facts = await pageSignals(store, { ...plan, pageId }, { owner: true, now });
    expect(facts.heat).toEqual({
      total: { views: 170, frustrated: 15, reachedHalf: 90 },
      devices: { mobile: { views: 120, frustrated: 10, reachedHalf: 60 }, tablet: { views: 0, frustrated: 0, reachedHalf: 0 }, desktop: { views: 50, frustrated: 5, reachedHalf: 30 } },
      topKey: "/no/om-oss",
    });
    expect(facts.productViews).toBeNull();
    expect(facts.test).toMatchObject({ name: "Shorter story" });
    expect(facts.recordings).toEqual({ page: "/no/om-oss", count: 1 });
    // Its kind's speed: the phone's figures rated, the computer's too few.
    expect(facts.speed?.kind).toBe("page");
    expect(facts.speed?.rows.map((r) => [r.screen, r.loads, r.cells.find((c) => c.metric === "lcp")?.rating ?? null])).toEqual([
      ["phone", 25, "good"],
      ["computer", 5, null],
    ]);
    expect(stripText(facts, heatmapsEn.strip).line).toBe("Last 30 days: 170 views · 9 % met a dead or rage click · 53 % scrolled halfway · loads well · an A/B test is running");
  });

  it("counts recordings for the owner alone", async () => {
    const plan = signalPlan({ type: "page", slug: "om-oss" }, countries());
    expect((await pageSignals(store, { ...plan, pageId }, { owner: false, now })).recordings).toBeNull();
  });

  it("reads nothing for a store that measures nothing, and says what to switch on", async () => {
    const plan = signalPlan({ type: "page", slug: "om-oss" }, quiet.allMarkets.map((m) => m.code));
    const facts = await pageSignals(quiet, { ...plan, pageId: null }, { owner: true, now });
    expect(facts).toMatchObject({ heat: null, productViews: null, speed: null, test: null, recordings: { count: 0 } });
    expect(stripText(facts, heatmapsEn.strip)).toEqual({ line: null, switchOn: "both" });
  });
});

describe("a heat key's page (the heatmap's Edit this part, E2.3)", () => {
  it("finds the published page that draws a key, its own store's only", async () => {
    const found = await heatKeyPage(store, "/se/om-oss");
    expect(found).toMatchObject({ id: pageId, type: "page" });
    expect(found?.content.rows.length).toBeGreaterThan(0);
    expect((await heatKeyPage(other, "/no/om-oss"))?.id).not.toBe(pageId);
    expect(await heatKeyPage(store, "/no/no-such-page")).toBeNull();
    expect(await heatKeyPage(store, "(other)")).toBeNull();
    if (store.frontPageId) expect(await heatKeyPage(store, "/no")).toMatchObject({ id: store.frontPageId, type: "page" });
    // A product's page is drawn by its layout, or by the built-in one, which has no builder.
    const product = await heatKeyPage(store, "/no/p/mug");
    expect(product === null || product.type === "product_layout").toBe(true);
  });
});

describe("a product's signals", () => {
  it("gives its counted views of the period and the share that ordered, with its heat totals and its kind's speed", async () => {
    const plan = signalPlan({ type: "product", handle: "mug" }, countries());
    expect(plan.keys).toContain("/no/p/mug");
    const facts = await pageSignals(store, { ...plan, productId: mugId }, { owner: true, now });
    expect(facts).toMatchObject({ productViews: 200, orders: 1, test: null, recordings: { page: "/no/p/mug", count: 1 } });
    expect(facts.heat?.total).toEqual({ views: 70, frustrated: 7, reachedHalf: 7 });
    expect(facts.speed?.rows.map((r) => r.cells.find((c) => c.metric === "lcp")?.rating)).toEqual(["poor"]);
    expect(stripText(facts, heatmapsEn.strip).line).toBe("Last 30 days: 200 views · 0.5 % ordered · 10 % met a dead or rage click · 10 % scrolled halfway · loads slowly");
  });

  it("knows no views before visit counting counted a day, and keeps heat totals measured before heatmaps were switched off", async () => {
    const [mug] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${other.id}::uuid and sku = 'DEMO-MUG-WHITE'`);
    const product = await pageSignals(other, { ...signalPlan({ type: "product", handle: "mug" }, ["NO"]), productId: String(mug.product_id) }, { owner: false, now });
    expect(product).toMatchObject({ productViews: null, orders: null, heat: null });
    expect(stripText(product, heatmapsEn.strip).switchOn).toBe("both");
    // Heatmaps are off there, but the page's totals it kept still count, and only its own.
    const page = await pageSignals(other, signalPlan({ type: "page", slug: "om-oss" }, ["NO"]), { owner: false, now });
    expect(page.heat?.total).toEqual({ views: 500, frustrated: 500, reachedHalf: 0 });
  });
});
