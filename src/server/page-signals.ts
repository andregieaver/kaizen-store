import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, todayIn } from "@/lib/analytics-period";
import type { PageContent } from "@/lib/page-content";
import { HEAT_DEVICES, type HeatDevice } from "@/lib/page-heat";
import { placeOfKey, SIGNAL_DAYS, speedRowOf, type HeatFigures, type SignalFacts } from "@/lib/page-signals";
import { SPEED_DAYS, SPEED_SCREENS, type SpeedKind } from "@/lib/speed";
import { storeDayKey } from "@/lib/visit-hash";

import { dayStart, FROM_CHECKOUT, PAID, soldIn } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import { publishedContentOf, runningTestOf } from "./experiment-admin";
import { owned } from "./owned";
import { productLayoutFor } from "./product-layouts";
import type { Store } from "./stores";
import { checkedRows, col, typedRow, typedRows } from "./typed-rows";

/**
 * How one page or one product performs, for the strip in its editor (ecosystem plan E2.3, D713): the last 30 store days of what the store
 * already measures, read in one go so the editor's first paint never waits for it (the strip streams in its own Suspense boundary).
 *
 * - Heat totals (D656) over the page's keys (`signalPlan()` in `src/lib/page-signals.ts`), every visitor's (`tag ''`), per device and key:
 *   page views, those with a dead or rage click and those that reached half the page. Read whatever the switch says, so totals kept
 *   before heatmaps were switched off still show; null while it is off and there are none.
 * - For a product, its page views as visit counting keeps them (`product_views`, D152) and the paid orders from the shop's checkout with
 *   it from the first counted day, as Analytics → Products counts its conversion.
 * - The speed of its kind of page (D336) per screen over the speed report's 28 days: the 75th percentile worked out by the database
 *   (`percentile_disc`, the nearest rank `percentile75()` takes) so no sample is fetched, rated in code (`speedRowOf()`).
 * - The A/B test running on the page, or on the product's layout (D148).
 * - For the owner, the recordings that visited it (they are the owner's alone, D656 step 11).
 *
 * Daily totals only, never a visitor; nothing here is cached, and every read filters with `owned()`.
 */

/** A Postgres text array literal of the page keys (which hold no quote or backslash, but are escaped all the same). */
const textArray = (values: readonly string[]) => `{${values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;

export type SignalTarget = {
  /** The heat page keys (`signalPlan().keys`), in their order. */
  keys: readonly string[];
  /** The kind of page its speed is read for (`signalPlan().kind`). */
  kind: SpeedKind | null;
  /** The page, for the test running on it. */
  pageId?: string | null;
  /** The product, for its counted views, its orders and its layout's test. */
  productId?: string | null;
};

const HEAT_ROW = z.object({ page: col.text, device: z.enum(HEAT_DEVICES), views: col.minor, frustrated: col.minor, reached_half: col.minor });

const zero = (): HeatFigures => ({ views: 0, frustrated: 0, reachedHalf: 0 });
const add = (a: HeatFigures, b: HeatFigures): HeatFigures => ({ views: a.views + b.views, frustrated: a.frustrated + b.frustrated, reachedHalf: a.reachedHalf + b.reachedHalf });

/** The heat totals of the keys over `[from, to)`, per device, and the key with the most page views. */
async function heatOf(storeId: string, keys: readonly string[], from: string, to: string): Promise<{ total: HeatFigures; devices: Record<HeatDevice, HeatFigures>; topKey: string | null; rows: number }> {
  const rows =
    keys.length === 0
      ? []
      : checkedRows(
          HEAT_ROW,
          await setBased(sql`
            select page, device, sum(views)::bigint as views, sum(frustrated_views)::bigint as frustrated,
              coalesce(sum((select sum(r) from unnest(reach[11:21]) as r)), 0)::bigint as reached_half
            from commerce.page_heat_days
            where ${owned(storeId)} and tag = '' and page = any(${textArray(keys)}::text[]) and day >= ${from}::date and day < ${to}::date
            group by page, device
          `),
        );
  const devices: Record<HeatDevice, HeatFigures> = { mobile: zero(), tablet: zero(), desktop: zero() };
  const perKey = new Map<string, number>();
  for (const r of rows) {
    devices[r.device] = add(devices[r.device], { views: r.views, frustrated: r.frustrated, reachedHalf: r.reached_half });
    perKey.set(r.page, (perKey.get(r.page) ?? 0) + r.views);
  }
  // The most viewed key, the first in the plan's order on a tie (the page's own place before its slug, the store's own country first).
  let topKey: string | null = null;
  for (const key of keys) if ((perKey.get(key) ?? 0) > (topKey ? (perKey.get(topKey) ?? 0) : 0)) topKey = key;
  const total = HEAT_DEVICES.reduce((sum, d) => add(sum, devices[d]), zero());
  return { total, devices, topKey, rows: rows.length };
}

/** A product's counted page views over `[from, to)` and the paid checkout orders with it from the store's first counted day in it. */
async function productFigures(store: Store, productId: string, from: string, to: string): Promise<{ views: number | null; orders: number | null }> {
  const counted = await typedRow(
    z.object({ views: col.minor, first_day: col.textOrNull }),
    sql`select
          (select coalesce(sum(views), 0)::bigint from commerce.product_views
            where ${owned(store.id)} and product_id = ${productId}::uuid and day >= ${from}::date and day < ${to}::date) as views,
          (select min(day)::text from commerce.product_views where ${owned(store.id)} and day >= ${from}::date and day < ${to}::date) as first_day`,
  );
  // No counted day in the period: the views are not known, and neither is the conversion (Analytics → Products says the same).
  if (!counted?.first_day) return { views: null, orders: null };
  if (counted.views === 0) return { views: 0, orders: null };
  const since = counted.first_day > from ? counted.first_day : from;
  const sold = await typedRow(
    z.object({ orders: col.minor }),
    sql`select count(distinct o.id)::bigint as orders
        from commerce.orders o
        join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
        join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
        where ${owned(store.id, sql`o.store_id`)} and v.product_id = ${productId}::uuid and ${PAID} and ${FROM_CHECKOUT}
          and ${soldIn(store, { from, to })} and o.placed_at >= ${dayStart(store, since)}`,
  );
  return { views: counted.views, orders: sold?.orders ?? 0 };
}

const nullableInt = col.int.nullable();
const SPEED_ROW = z.object({
  screen: z.enum(SPEED_SCREENS),
  loads: col.minor,
  lcp_n: col.minor,
  lcp: nullableInt,
  inp_n: col.minor,
  inp: nullableInt,
  cls_n: col.minor,
  cls: nullableInt,
  ttfb_n: col.minor,
  ttfb: nullableInt,
});

/** The speed rows of one kind of page over the speed report's last 28 store days (as `speedReport()` reads them), phones first. */
async function speedOf(store: Store, kind: SpeedKind, now: Date): Promise<NonNullable<SignalFacts["speed"]>> {
  const to = storeDayKey(now, store.timeZone);
  const rows = await typedRows(
    SPEED_ROW,
    sql`select screen, count(*)::bigint as loads,
          count(lcp_ms)::bigint as lcp_n, percentile_disc(0.75) within group (order by lcp_ms) as lcp,
          count(inp_ms)::bigint as inp_n, percentile_disc(0.75) within group (order by inp_ms) as inp,
          count(cls_milli)::bigint as cls_n, percentile_disc(0.75) within group (order by cls_milli) as cls,
          count(ttfb_ms)::bigint as ttfb_n, percentile_disc(0.75) within group (order by ttfb_ms) as ttfb
        from commerce.speed_samples
        where ${owned(store.id)} and kind = ${kind} and day > ${to}::date - ${SPEED_DAYS}::int and day <= ${to}::date
        group by screen`,
  );
  return {
    kind,
    rows: SPEED_SCREENS.flatMap((screen) => {
      const r = rows.find((row) => row.screen === screen);
      if (!r) return [];
      return [
        speedRowOf(kind, screen, r.loads, {
          lcp: { n: r.lcp_n, p75: r.lcp },
          inp: { n: r.inp_n, p75: r.inp },
          cls: { n: r.cls_n, p75: r.cls },
          ttfb: { n: r.ttfb_n, p75: r.ttfb },
        }),
      ];
    }),
  };
}

/** Recordings started in the period, per key they visited. */
async function recordingsOf(store: Store, keys: readonly string[], from: string): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ page: col.text, n: col.minor }),
    sql`select p as page, count(*)::bigint as n
        from commerce.recordings, unnest(pages) as p
        where ${owned(store.id)} and started_at >= ${dayStart(store, from)} and pages && ${textArray(keys)}::text[] and p = any(${textArray(keys)}::text[])
        group by p`,
  );
  return new Map(rows.map((r) => [r.page, r.n]));
}

/** The running test of the page, or of the layout the product's page is drawn with. */
async function testOf(storeId: string, target: SignalTarget): Promise<{ id: string; name: string } | null> {
  if (target.pageId) return runningTestOf(storeId, target.pageId);
  if (!target.productId) return null;
  const layout = await productLayoutFor(storeId, target.productId);
  return layout ? runningTestOf(storeId, layout.id) : null;
}

/**
 * The page whose builder draws a heat key's parts (the heatmap's "Edit this part" and "A/B test this part"): the front page, All products,
 * the page chosen for the place, the page or article by its address, or the layout a product's page is drawn with; its published content,
 * whose part ids the click anchors are. Null for the built-in layout or page, or an address no page of the store's has.
 */
export async function heatKeyPage(store: Store, key: string): Promise<{ id: string; type: "page" | "article" | "product_layout"; content: PageContent } | null> {
  const place = placeOfKey(key);
  if (!place) return null;
  let found: { id: string; type: "page" | "article" | "product_layout" } | null = null;
  if (place.place === "front") found = store.frontPageId ? { id: store.frontPageId, type: "page" } : null;
  else if (place.place === "products") found = store.productsPageId ? { id: store.productsPageId, type: "page" } : null;
  else if (place.place === "role") found = store.pageRoles[place.role] ? { id: store.pageRoles[place.role]!, type: "page" } : null;
  else if (place.place === "product") {
    const product = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.products where ${owned(store.id)} and handle = ${place.handle}`);
    const layout = product ? await productLayoutFor(store.id, product.id) : null;
    found = layout ? { id: layout.id, type: "product_layout" } : null;
  } else {
    const type = place.place;
    const page = await typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.pages where ${owned(store.id)} and type = ${type} and slug = ${place.slug} and published_at is not null`,
    );
    found = page ? { id: page.id, type } : null;
  }
  if (!found) return null;
  const content = await publishedContentOf(store.id, found.id);
  return content ? { ...found, content } : null;
}

/** Everything the strip says about one page or product, over the last `SIGNAL_DAYS` store days. `owner` adds the recordings' count. */
export async function pageSignals(store: Store, target: SignalTarget, { owner, now = new Date() }: { owner: boolean; now?: Date }): Promise<SignalFacts> {
  const today = todayIn(now, store.timeZone);
  const from = addDays(today, 1 - SIGNAL_DAYS);
  const to = addDays(today, 1);
  const [heat, product, speed, test, recordings] = await Promise.all([
    heatOf(store.id, target.keys, from, to),
    target.productId ? productFigures(store, target.productId, from, to) : Promise.resolve({ views: null, orders: null }),
    target.kind ? speedOf(store, target.kind, now) : Promise.resolve(null),
    testOf(store.id, target),
    owner ? recordingsOf(store, target.keys, from) : Promise.resolve(null),
  ]);
  // The recordings list filters by one page: the key seen most, else the first.
  const recordingsPage = heat.topKey ?? target.keys[0] ?? null;
  return {
    measuring: { visits: store.visitCounting, heatmaps: store.heatmaps },
    productViews: product.views,
    orders: product.orders,
    // A page with no key of its own (nested, or the category pages' layout) is not measured: no "0 views" for it.
    heat: target.keys.length > 0 && (store.heatmaps || heat.rows > 0) ? { total: heat.total, devices: heat.devices, topKey: heat.topKey } : null,
    speed: speed && speed.rows.length > 0 ? speed : null,
    test,
    recordings: recordings && recordingsPage ? { page: recordingsPage, count: recordings.get(recordingsPage) ?? 0 } : null,
  };
}
