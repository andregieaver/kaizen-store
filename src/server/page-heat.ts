import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { consentCookieName, decodeConsent, versionHas } from "@/lib/cookie-consent";
import { isBot } from "@/lib/experiments";
import { ANCHOR } from "@/lib/heat-anchor";
import {
  BAND_CAP_MS,
  BANDS,
  CELL_KEEP_DAYS,
  HEAT_BEACONS_PER_STORE_DAY,
  HEAT_DEVICES,
  HEAT_KEEP_DAYS,
  MAX_BINS,
  BIN_PX,
  MAX_CLICKS,
  MAX_TAGS,
  REACH_BUCKETS,
} from "@/lib/page-heat";
import { storeDomain, storeOrigins } from "@/lib/paths";
import { speedKind } from "@/lib/speed";
import { storeDayKey } from "@/lib/visit-hash";
import { fromStoresOwnPage, placeOfPath } from "@/lib/visit-record";

import { wantsPrivacy } from "./analytics-visits";
import { log } from "./log";
import { lockedOut } from "./private-mode";
import { cookieValue, verifiedTags } from "./signal-tags";
import { textList } from "./sql-arrays";
import { col, typedRow } from "./typed-rows";
import { getOpenStore } from "./stores";

/**
 * Heatmaps' totals (D656, `docs/heatmaps-and-recordings.md` 6.2 and 8.1): the only writer of `commerce.page_heat_days` and
 * `commerce.click_cells`. A page view's summary is added to its page's daily totals, once for every visitor (tag '') and once for each
 * A/B version the visitor's cookie confirms; no visitor, address or click is kept on its own. Kept only from a store's own pages, for an
 * open store with heatmaps on, from a visitor who allowed statistics with heatmaps named, and never from a robot or a visitor who asks not
 * to be counted. Three statements per summary: the day's slot and two upserts.
 */

const pair = z.tuple([z.string().uuid(), z.enum(["a", "b", "c", "d"])]);
export const heatInput = z.object({
  v: z.literal(1),
  store: z.string().min(1).max(100),
  path: z.string().min(1).max(300),
  seq: z.number().int().min(0).max(1000),
  device: z.enum(HEAT_DEVICES),
  reach: z.number().int().min(0).max(REACH_BUCKETS - 1).optional(),
  fold: z.number().int().min(0).max(1000).optional(),
  attH: z.number().int().min(1).max(MAX_BINS * BIN_PX).optional(),
  att: z.array(z.number().int().min(0).max(BAND_CAP_MS)).length(BANDS),
  clicks: z
    .array(z.tuple([z.string().max(60).regex(ANCHOR), z.number().int().min(0).max(9), z.number().int().min(0).max(9), z.union([z.literal(0), z.literal(1)]), z.union([z.literal(0), z.literal(1)])]))
    .max(MAX_CLICKS),
  dv: z.union([z.literal(0), z.literal(1)]),
  rv: z.union([z.literal(0), z.literal(1)]),
  fv: z.union([z.literal(0), z.literal(1)]),
  ab: z.array(pair).max(MAX_TAGS),
});

export type HeatOutcome = { recorded: true } | { recorded: false; reason: string };

const COUNT = z.object({ count: col.int });
const DELETED = z.object({ n: col.int });

/** Counts a summary against the store's day before it is written; false when the day's are all taken. */
async function takeHeatSlot(storeId: string): Promise<boolean> {
  const row = await typedRow(COUNT, sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, 'heat', date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return (row?.count ?? 0) <= HEAT_BEACONS_PER_STORE_DAY;
}

const intArray = (values: readonly number[]) => `{${values.map((v) => Math.trunc(v)).join(",")}}`;

export type HeatSummary = z.infer<typeof heatInput>;

/**
 * A summary's figures for its day's row, the engine the stores' heatmaps and the admin's (D895 phase 3b, `admin-heat.ts`) share: the first
 * summary of a view counts it, with its reach, fold and height; later ones add attention, clicks and flags.
 */
export function heatFigures(input: HeatSummary) {
  const first = input.seq === 0;
  const reach = new Array<number>(REACH_BUCKETS).fill(0);
  if (first) reach[input.reach ?? REACH_BUCKETS - 1] = 1;
  return {
    views: first ? 1 : 0,
    reach: intArray(reach),
    fold: first ? (input.fold ?? 1000) : 0,
    att: intArray(input.att),
    attH: first ? (input.attH ?? 0) : 0,
    clicks: input.clicks.length,
    dead: input.clicks.filter((c) => c[3] === 1).length,
    rage: input.clicks.filter((c) => c[4] === 1).length,
  };
}

/** How a day's row adds a summary (`h` the row kept, `excluded` the summary). */
export const HEAT_DAY_SUMS = sql.raw(`views = h.views + excluded.views, reach = commerce.add_int_arrays(h.reach, excluded.reach), fold_sum = h.fold_sum + excluded.fold_sum,
      attention_ms = commerce.add_bigint_arrays(h.attention_ms, excluded.attention_ms), att_height_sum = h.att_height_sum + excluded.att_height_sum,
      clicks = h.clicks + excluded.clicks, dead_clicks = h.dead_clicks + excluded.dead_clicks, rage_clicks = h.rage_clicks + excluded.rage_clicks,
      dead_views = h.dead_views + excluded.dead_views, rage_views = h.rage_views + excluded.rage_views,
      frustrated_views = h.frustrated_views + excluded.frustrated_views`);

/** How a cell's row adds a summary's clicks (`c` the row kept). */
export const CELL_SUMS = sql.raw("clicks = c.clicks + excluded.clicks, dead = c.dead + excluded.dead, rage = c.rage + excluded.rage");

type Cell = { anchor: string; cx: number; cy: number; clicks: number; dead: number; rage: number };

/** A summary's clicks summed per anchor and cell, or null when it has none. Written in key order, so two summaries never lock the same rows in opposite orders. */
export function heatCells(clicks: HeatSummary["clicks"]): Cell[] | null {
  if (clicks.length === 0) return null;
  const cells = new Map<string, Cell>();
  for (const [anchor, cx, cy, d, r] of clicks) {
    const key = `${anchor}|${cx}|${cy}`;
    const cell = cells.get(key) ?? { anchor, cx, cy, clicks: 0, dead: 0, rage: 0 };
    cell.clicks += 1;
    cell.dead += d;
    cell.rage += r;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/** The cells as rows `k(anchor, cx, cy, clicks, dead, rage)` for a select. */
export const cellRows = (list: Cell[]) => sql`unnest(${textList(list.map((k) => k.anchor))}, ${intArray(list.map((k) => k.cx))}::smallint[], ${intArray(list.map((k) => k.cy))}::smallint[],
      ${intArray(list.map((k) => k.clicks))}::int[], ${intArray(list.map((k) => k.dead))}::int[], ${intArray(list.map((k) => k.rage))}::int[])
      as k(anchor, cx, cy, clicks, dead, rage)`;

/** Adds one page view's summary to the totals, or says why not. `headers` are the request's, read for the robot, privacy, own-page and cookie checks. */
export async function recordHeat({ headers: h, body, now = new Date() }: { headers: Headers; body: unknown; now?: Date }): Promise<HeatOutcome> {
  const parsed = heatInput.safeParse(body);
  if (!parsed.success) return { recorded: false, reason: "invalid" };
  const input = parsed.data;
  if (isBot(h.get("user-agent"))) return { recorded: false, reason: "bot" };
  if (wantsPrivacy(h)) return { recorded: false, reason: "privacy" };
  const store = await getOpenStore(input.store);
  if (!store) return { recorded: false, reason: "unknown_store" };
  if (!store.heatmaps) return { recorded: false, reason: "off" };
  if (await lockedOut(store)) return { recorded: false, reason: "locked" };
  const own = fromStoresOwnPage({
    origin: h.get("origin"),
    referer: h.get("referer"),
    requestHost: h.get("x-forwarded-host") ?? h.get("host"),
    slug: store.slug,
    ownHosts: storeOrigins(store.slug).map((origin) => new URL(origin).host),
    storesOnPlatformHost: storeDomain() === null,
  });
  if (!own) return { recorded: false, reason: "wrong_site" };
  const consent = decodeConsent(cookieValue(h.get("cookie"), consentCookieName(store.id)));
  if (!consent?.choices.statistics || !versionHas(consent.version, "heat")) return { recorded: false, reason: "no_consent" };
  const place = placeOfPath(input.path, store.slug, store.allMarkets.map((m) => m.code), store.address);
  if (!place || !speedKind(place.landing)) return { recorded: false, reason: "not_measured" };
  if (!(await takeHeatSlot(store.id))) return { recorded: false, reason: "store_full" };

  const tags = ["", ...(await verifiedTags(store.id, input.ab, h.get("cookie")))];
  const day = storeDayKey(now, store.timeZone);
  const f = heatFigures(input);
  await db().execute(sql`
    insert into commerce.page_heat_days as h
      (store_id, day, page, device, tag, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
    select ${store.id}::uuid, ${day}::date, ${place.landing}, ${input.device}, t.tag, ${f.views}, ${f.reach}::int[], ${f.fold}, ${f.att}::bigint[], ${f.attH},
      ${f.clicks}, ${f.dead}, ${f.rage}, ${input.dv}, ${input.rv}, ${input.fv}
    from unnest(${textList(tags)}) as t(tag) order by t.tag
    on conflict (store_id, day, page, device, tag) do update set ${HEAT_DAY_SUMS}
  `);
  const k = heatCells(input.clicks);
  if (!k) return { recorded: true };
  await db().execute(sql`
    insert into commerce.click_cells as c (store_id, day, page, device, tag, anchor, cx, cy, clicks, dead, rage)
    select ${store.id}::uuid, ${day}::date, ${place.landing}, ${input.device}, t.tag, k.anchor, k.cx, k.cy, k.clicks, k.dead, k.rage
    from unnest(${textList(tags)}) as t(tag)
    cross join ${cellRows(k)}
    order by t.tag, k.anchor, k.cx, k.cy
    on conflict (store_id, day, page, device, tag, anchor, cx, cy) do update set ${CELL_SUMS}
  `);
  return { recorded: true };
}

/** Deletes page totals older than 13 months and click cells older than 90 days, for every store whatever its state; never throws. */
export async function pruneHeat(now: Date = new Date()): Promise<{ days: number; cells: number }> {
  try {
    const days = await typedRow(DELETED, sql`
      with d as (delete from commerce.page_heat_days where day < (${now.toISOString()}::timestamptz - make_interval(days => ${HEAT_KEEP_DAYS}))::date returning 1)
      select count(*)::int as n from d
    `);
    const cells = await typedRow(DELETED, sql`
      with d as (delete from commerce.click_cells where day < (${now.toISOString()}::timestamptz - make_interval(days => ${CELL_KEEP_DAYS}))::date returning 1)
      select count(*)::int as n from d
    `);
    return { days: days?.n ?? 0, cells: cells?.n ?? 0 };
  } catch (error) {
    log("warn", "heat.prune_failed", {}, error);
    return { days: 0, cells: 0 };
  }
}
