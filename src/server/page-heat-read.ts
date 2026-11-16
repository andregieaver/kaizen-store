import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { addArrays, type CellTotal } from "@/lib/heat-read";
import { BANDS, CELL_KEEP_DAYS, HEAT_DEVICES, REACH_BUCKETS, type HeatDevice } from "@/lib/page-heat";

import { setBased } from "./analytics-totals";
import { owned } from "./owned";
import { checkedRows, col } from "./typed-rows";

/**
 * Heatmaps' reads for the admin (D656, `docs/heatmaps-and-recordings.md` 8.5): the daily totals of `page_heat_days` and `click_cells`,
 * summed over a period. Every read filters with `owned()` and runs through `setBased()` with checked rows; arrays come back per day and are
 * added in code (`addArrays()`). The page list reads every visitor's totals (tag `''`), so a version's rows are never counted twice.
 */

const numbers = z.array(z.union([z.number(), z.string()]).transform(Number));
const DEVICE = z.enum(HEAT_DEVICES);

export type HeatPeriod = { from: string; to: string };

export type HeatPageRow = {
  page: string;
  views: number;
  frustratedViews: number;
  deadViews: number;
  rageViews: number;
  clicks: number;
  /** The share of views that reached half the page, 0..1. */
  reachedHalf: number;
};

const PAGE_ROW = z.object({
  page: col.text,
  views: col.minor,
  frustrated_views: col.minor,
  dead_views: col.minor,
  rage_views: col.minor,
  clicks: col.minor,
  reached_half: col.minor,
});

/** Per page key, every visitor's totals over `[from, to)`, on one device or all; most viewed first, at most 200 pages. */
export async function heatPages(storeId: string, { from, to, device }: HeatPeriod & { device?: HeatDevice }): Promise<HeatPageRow[]> {
  const rows = checkedRows(
    PAGE_ROW,
    await setBased(sql`
      select page, sum(views)::bigint as views, sum(frustrated_views)::bigint as frustrated_views, sum(dead_views)::bigint as dead_views,
        sum(rage_views)::bigint as rage_views, sum(clicks)::bigint as clicks,
        coalesce(sum((select sum(r) from unnest(reach[11:21]) as r)), 0)::bigint as reached_half
      from commerce.page_heat_days
      where ${owned(storeId)} and tag = '' and day >= ${from}::date and day < ${to}::date ${device ? sql`and device = ${device}` : sql``}
      group by page order by sum(views) desc, page limit 200
    `),
  );
  return rows.map((r) => ({
    page: r.page,
    views: r.views,
    frustratedViews: r.frustrated_views,
    deadViews: r.dead_views,
    rageViews: r.rage_views,
    clicks: r.clicks,
    reachedHalf: r.views > 0 ? r.reached_half / r.views : 0,
  }));
}

/** A page's views per device over `[from, to)`, every visitor's. */
export async function pageDevices(storeId: string, page: string, { from, to }: HeatPeriod): Promise<Record<HeatDevice, number>> {
  const rows = checkedRows(
    z.object({ device: DEVICE, views: col.minor }),
    await setBased(sql`
      select device, sum(views)::bigint as views from commerce.page_heat_days
      where ${owned(storeId)} and tag = '' and page = ${page} and day >= ${from}::date and day < ${to}::date group by device
    `),
  );
  const out: Record<HeatDevice, number> = { mobile: 0, tablet: 0, desktop: 0 };
  for (const r of rows) out[r.device] = r.views;
  return out;
}

export type HeatCell = CellTotal & { dead: number; rage: number };

export type PageHeat = {
  views: number;
  /** The reach histogram: views per 5 % step, 21 numbers. */
  reach: number[];
  foldSum: number;
  /** Ms of attention per band, 20 numbers, summed over every view. */
  attention: number[];
  attHeightSum: number;
  clicks: number;
  deadClicks: number;
  rageClicks: number;
  deadViews: number;
  rageViews: number;
  frustratedViews: number;
  /** Clicks per anchor and cell, summed over the period's last `CELL_KEEP_DAYS` days. */
  cells: HeatCell[];
};

const DAY_ROW = z.object({
  views: col.int,
  reach: numbers,
  fold_sum: col.minor,
  attention_ms: numbers,
  att_height_sum: col.minor,
  clicks: col.int,
  dead_clicks: col.int,
  rage_clicks: col.int,
  dead_views: col.int,
  rage_views: col.int,
  frustrated_views: col.int,
});

const CELL_ROW = z.object({ anchor: col.text, cx: col.int, cy: col.int, clicks: col.minor, dead: col.minor, rage: col.minor });

/** One page's totals on one device and version (`tag`, `''` for every visitor) over `[from, to)`. */
export async function pageHeat(storeId: string, { page, device, tag = "", from, to }: HeatPeriod & { page: string; device: HeatDevice; tag?: string }): Promise<PageHeat> {
  const where = sql`${owned(storeId)} and page = ${page} and device = ${device} and tag = ${tag}`;
  const [days, cells] = await Promise.all([
    setBased(sql`
      select views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views
      from commerce.page_heat_days where ${where} and day >= ${from}::date and day < ${to}::date
    `),
    setBased(sql`
      select anchor, cx, cy, sum(clicks)::bigint as clicks, sum(dead)::bigint as dead, sum(rage)::bigint as rage
      from commerce.click_cells
      where ${where} and day >= greatest(${from}::date, ${to}::date - ${CELL_KEEP_DAYS}::int) and day < ${to}::date
      group by anchor, cx, cy order by sum(clicks) desc limit 5000
    `),
  ]);
  const rows = checkedRows(DAY_ROW, days);
  const sum = (key: keyof z.output<typeof DAY_ROW>) => rows.reduce((total, r) => total + (r[key] as number), 0);
  return {
    views: sum("views"),
    reach: addArrays(rows.map((r) => r.reach), REACH_BUCKETS),
    foldSum: sum("fold_sum"),
    attention: addArrays(rows.map((r) => r.attention_ms), BANDS),
    attHeightSum: sum("att_height_sum"),
    clicks: sum("clicks"),
    deadClicks: sum("dead_clicks"),
    rageClicks: sum("rage_clicks"),
    deadViews: sum("dead_views"),
    rageViews: sum("rage_views"),
    frustratedViews: sum("frustrated_views"),
    cells: checkedRows(CELL_ROW, cells),
  };
}
