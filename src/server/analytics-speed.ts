import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isBot } from "@/lib/experiments";
import { storeDomain, storeOrigins } from "@/lib/paths";
import {
  SPEED_DAYS,
  SPEED_KEEP_DAYS,
  SPEED_KINDS,
  SPEED_SAMPLES_PER_STORE_DAY,
  SPEED_SCREENS,
  speedKind,
  speedProblem,
  speedRows,
  type SpeedFigures,
  type SpeedKind,
  type SpeedRow,
  type SpeedScreen,
} from "@/lib/speed";
import { storeDayKey } from "@/lib/visit-hash";
import { fromStoresOwnPage, placeOfPath } from "@/lib/visit-record";

import { wantsPrivacy } from "./analytics-visits";
import { log } from "./log";
import { getOpenStore } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * The speed report's data (wave 7 unit B, D336, `docs/analytics.md` "Speed"): the only writer and reader of `commerce.speed_samples`.
 * A sample is kept only while the store counts visits, from its own pages, never from a robot or a visitor who asks not to be counted,
 * with the page's kind and the screen only; the figures are worked out in code (`speedRows()`), never stored.
 */

const speedInput = z.object({
  store: z.string().min(1).max(100),
  path: z.string().min(1).max(300),
  screen: z.enum(SPEED_SCREENS),
  figures: z.record(z.string(), z.unknown()),
});

export type SpeedOutcome = { recorded: true } | { recorded: false; reason: string };

/** Counts a sample against the store's day before it is written; false when the day's are all taken. */
async function takeSpeedSlot(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, 'speed', date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= SPEED_SAMPLES_PER_STORE_DAY;
}

/** Keeps one page load's figures, or says why not. `headers` are the request's, read for the robot, privacy and own-page checks only. */
export async function recordSpeed({ headers: h, body, now = new Date() }: { headers: Headers; body: unknown; now?: Date }): Promise<SpeedOutcome> {
  const parsed = speedInput.safeParse(body);
  if (!parsed.success) return { recorded: false, reason: "invalid" };
  const input = parsed.data;
  if (speedProblem(input.figures)) return { recorded: false, reason: "invalid" };
  if (isBot(h.get("user-agent"))) return { recorded: false, reason: "bot" };
  if (wantsPrivacy(h)) return { recorded: false, reason: "privacy" };
  const store = await getOpenStore(input.store);
  if (!store) return { recorded: false, reason: "unknown_store" };
  if (!store.visitCounting) return { recorded: false, reason: "off" };
  const requestHost = h.get("x-forwarded-host") ?? h.get("host");
  const own = fromStoresOwnPage({
    origin: h.get("origin"),
    referer: h.get("referer"),
    requestHost,
    slug: store.slug,
    ownHosts: storeOrigins(store.slug).map((origin) => new URL(origin).host),
    storesOnPlatformHost: storeDomain() === null,
  });
  if (!own) return { recorded: false, reason: "wrong_site" };
  const place = placeOfPath(input.path, store.slug, store.allMarkets.map((m) => m.code), store.address);
  const kind = place ? speedKind(place.landing) : null;
  if (!kind) return { recorded: false, reason: "not_measured" };
  if (!(await takeSpeedSlot(store.id))) return { recorded: false, reason: "store_full" };
  const f = input.figures as Partial<Record<string, number | null>>;
  await db().execute(sql`
    insert into commerce.speed_samples (store_id, day, kind, screen, lcp_ms, inp_ms, cls_milli, ttfb_ms)
    values (${store.id}::uuid, ${storeDayKey(now, store.timeZone)}::date, ${kind}, ${input.screen},
      ${f.lcp ?? null}, ${f.inp ?? null}, ${f.cls ?? null}, ${f.ttfb ?? null})
  `);
  return { recorded: true };
}

export type SpeedReport = {
  /** The store counts visits, so samples are being collected. */
  collecting: boolean;
  /** The first and last store day of the period, and of the samples in it (null when there are none). */
  from: string;
  to: string;
  lastSample: string | null;
  loads: number;
  rows: SpeedRow[];
};

/** The last `SPEED_DAYS` store days' figures for a store, worked out in code from its samples. */
export async function speedReport(store: { id: string; timeZone: string; visitCounting: boolean }, now: Date = new Date()): Promise<SpeedReport> {
  const to = storeDayKey(now, store.timeZone);
  const rows = await typedRows(
    z.object({
      kind: z.enum(SPEED_KINDS),
      screen: z.enum(SPEED_SCREENS),
      lcp_ms: col.int.nullable(),
      inp_ms: col.int.nullable(),
      cls_milli: col.int.nullable(),
      ttfb_ms: col.int.nullable(),
      day: z.string(),
    }),
    sql`
      select kind, screen, lcp_ms, inp_ms, cls_milli, ttfb_ms, day::text as day
      from commerce.speed_samples
      where store_id = ${store.id}::uuid and day > ${to}::date - ${SPEED_DAYS}::int and day <= ${to}::date
    `,
  );
  const samples = rows.map((r): SpeedFigures & { kind: SpeedKind; screen: SpeedScreen } => ({
    kind: r.kind,
    screen: r.screen,
    lcp: r.lcp_ms,
    inp: r.inp_ms,
    cls: r.cls_milli,
    ttfb: r.ttfb_ms,
  }));
  const from = new Date(`${to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (SPEED_DAYS - 1));
  return {
    collecting: store.visitCounting,
    from: from.toISOString().slice(0, 10),
    to,
    lastSample: rows.length === 0 ? null : rows.reduce((last, r) => (r.day > last ? r.day : last), rows[0].day),
    loads: rows.length,
    rows: speedRows(samples),
  };
}

/** Deletes samples older than `SPEED_KEEP_DAYS` (the daily job). Never throws: what it managed is returned. */
export async function pruneSpeedSamples(now: Date = new Date()): Promise<number> {
  try {
    const gone = await db().execute(sql`
      delete from commerce.speed_samples where day < (${now.toISOString()}::timestamptz at time zone 'UTC')::date - ${SPEED_KEEP_DAYS}::int returning 1
    `);
    return gone.length;
  } catch (error) {
    log("warn", "speed.prune_failed", {}, error);
    return 0;
  }
}
