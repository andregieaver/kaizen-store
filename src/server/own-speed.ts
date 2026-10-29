import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isBot } from "@/lib/experiments";
import {
  OWN_SPEED_SITES,
  SPEED_DAYS,
  SPEED_KEEP_DAYS,
  SPEED_KINDS,
  SPEED_SAMPLES_PER_STORE_DAY,
  SPEED_SCREENS,
  ownSpeedKind,
  speedProblem,
  speedRows,
  type OwnSpeedSite,
  type SpeedFigures,
  type SpeedKind,
  type SpeedScreen,
} from "@/lib/speed";

import { wantsPrivacy } from "./analytics-visits";
import type { SpeedOutcome, SpeedReport } from "./analytics-speed";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * How fast Kaizena Flow's own site and the admin are for the people using them (wave 11 unit K, D390, PSI PERF-01 and PERF-02): the only
 * writer and reader of `commerce.own_speed_samples`. The rules are a store's (D336): the speed beacon's figures, never from a robot or
 * someone with Global Privacy Control or Do Not Track, with the page's kind (`ownSpeedKind()`) and the screen only, no address, account or
 * identifier; at most `SPEED_SAMPLES_PER_STORE_DAY` a site and UTC day; the figures worked out in code (`speedRows()`), never stored.
 */

const ownInput = z.object({
  store: z.enum(OWN_SPEED_SITES),
  path: z.string().min(1).max(300),
  screen: z.enum(SPEED_SCREENS),
  figures: z.record(z.string(), z.unknown()),
});

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Counts a sample against the site's day before it is written; false when the day's are all taken. */
async function takeSlot(site: OwnSpeedSite): Promise<boolean> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (null, ${`speed:${site}`}, date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= SPEED_SAMPLES_PER_STORE_DAY;
}

/** Keeps one page load's figures of the site or the admin, or says why not. `headers` are read for the robot and privacy checks only. */
export async function recordOwnSpeed({ headers: h, body, now = new Date() }: { headers: Headers; body: unknown; now?: Date }): Promise<SpeedOutcome> {
  const parsed = ownInput.safeParse(body);
  if (!parsed.success) return { recorded: false, reason: "invalid" };
  const input = parsed.data;
  if (speedProblem(input.figures)) return { recorded: false, reason: "invalid" };
  if (isBot(h.get("user-agent"))) return { recorded: false, reason: "bot" };
  if (wantsPrivacy(h)) return { recorded: false, reason: "privacy" };
  const kind = ownSpeedKind(input.store, input.path);
  if (!kind) return { recorded: false, reason: "not_measured" };
  if (!(await takeSlot(input.store))) return { recorded: false, reason: "store_full" };
  const f = input.figures as Partial<Record<string, number | null>>;
  await db().execute(sql`
    insert into commerce.own_speed_samples (site, day, kind, screen, lcp_ms, inp_ms, cls_milli, ttfb_ms)
    values (${input.store}, ${utcDay(now)}::date, ${kind}, ${input.screen}, ${f.lcp ?? null}, ${f.inp ?? null}, ${f.cls ?? null}, ${f.ttfb ?? null})
  `);
  return { recorded: true };
}

/** The last `SPEED_DAYS` UTC days' figures of one of the two sites. */
export async function ownSpeedReport(site: OwnSpeedSite, now: Date = new Date()): Promise<SpeedReport> {
  const to = utcDay(now);
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
      from commerce.own_speed_samples
      where site = ${site} and day > ${to}::date - ${SPEED_DAYS}::int and day <= ${to}::date
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
    collecting: true,
    from: from.toISOString().slice(0, 10),
    to,
    lastSample: rows.length === 0 ? null : rows.reduce((last, r) => (r.day > last ? r.day : last), rows[0].day),
    loads: rows.length,
    rows: speedRows(samples),
  };
}

/** Deletes samples older than `SPEED_KEEP_DAYS` (the daily job, with the stores'). Never throws: what it managed is returned. */
export async function pruneOwnSpeedSamples(now: Date = new Date()): Promise<number> {
  try {
    const rows = await db().execute(sql`
      delete from commerce.own_speed_samples where day < ${utcDay(now)}::date - ${SPEED_KEEP_DAYS}::int returning 1
    `);
    return rows.length;
  } catch (error) {
    log("warn", "own_speed.prune_failed", {}, error);
    return 0;
  }
}
