import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Refreshes of cache tags and draws of store layouts, counted per UTC day in `commerce.cache_events_daily` (bloat review step 1.25,
 * `docs/capacity.md`): the tag's family, what it names and who asked. Counts are buffered in memory and written after the response (or at
 * the end of a tracked job), never awaited inside a refresh or a render, and a count never throws.
 */

const jobScope = new AsyncLocalStorage<{ job: string }>();
/** Runs `run` so every refresh inside it knows which job asked. */
export const inJob = <T>(job: string, run: () => Promise<T>): Promise<T> => jobScope.run({ job }, run);
/** The job a refresh runs inside, or null. */
export const currentJob = (): string | null => jobScope.getStore()?.job ?? null;

/**
 * How a scheduled job tells of an error it caught so its other parts can go on (bloat review step 1.26, D843): logged, and the run counted
 * as failed once the job ends (`tracked()` in `cron-runs.ts`). `part` is a fixed word for what failed, never a person's data. It lives
 * beside `inJob()` because storefront pages already load this file and reach some jobs' modules (route load, bloat review 1.8).
 */
export type JobReport = (error: unknown, part?: string) => void;

/** The report outside a scheduled run (a test, a person's action): logged only. */
const logOnly: JobReport = (error, part) => log("error", "cron.job_part_failed", { part: part ?? null }, error);

const reportScope = new AsyncLocalStorage<JobReport>();

/** Runs `run` with `report` as the job's report, for `jobReport()` inside it. */
export const withReport = <T>(report: JobReport, run: () => Promise<T>): Promise<T> => reportScope.run(report, run);

/**
 * The report of the scheduled job this code runs in (`tracked()` keeps it in scope, as `inJob()` keeps the job's name), or `logOnly`
 * outside one. An entry function reads it once, `const report = jobReport();`, and reports each error it catches.
 */
export const jobReport = (): JobReport => reportScope.getStore() ?? logOnly;

/**
 * A tag's family (the text before the first `:`, the whole tag when there is none) and its subject (between the first and second `:`,
 * empty when there is none). `store:demo` gives store and demo; `catalog:7b1e...` gives catalog and the id; `catalog` gives catalog and
 * empty; `terms:platform:article` gives terms and platform.
 */
export function tagParts(tag: string): { family: string; subject: string } {
  const parts = tag.split(":");
  return { family: parts[0].slice(0, 40), subject: (parts[1] ?? "").slice(0, 64) };
}

export type CacheEventKind = "refresh" | "draw";
export type CacheEventSource = "action" | "job" | "route" | "render";

type Pending = { kind: CacheEventKind; family: string; subject: string; source: CacheEventSource; count: number; statements: number };

const pending = new Map<string, Pending>();
let flushScheduled = false;

/** Adds one event to the buffer and makes sure it is written after the response. Never throws. */
export function countCacheEvent(kind: CacheEventKind, family: string, subject: string, source: CacheEventSource, statements = 0): void {
  // Not while Next builds: the build prerenders every store page against production's database, and those draws are no visitor's
  // (17 November 2026: the first deploy counted about 2,000 build draws in an hour of about 60 real ones).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const key = `${kind}|${family}|${subject}|${source}`;
    const entry = pending.get(key);
    if (entry) {
      entry.count += 1;
      entry.statements += statements;
    } else {
      pending.set(key, { kind, family, subject, source, count: 1, statements });
    }
    if (!flushScheduled) {
      try {
        after(() => flushCacheEvents());
        flushScheduled = true;
      } catch {
        // Outside a request after() throws: the next event inside one tries again, and a tracked job flushes at its end.
      }
    }
  } catch {
    // A count never stops what it counts.
  }
}

/** Writes the buffered events in one statement. Never throws. */
export async function flushCacheEvents(): Promise<void> {
  flushScheduled = false;
  const rows = [...pending.values()];
  pending.clear();
  if (rows.length === 0) return;
  try {
    const values = sql.join(
      rows.map((r) => sql`((now() at time zone 'utc')::date, ${r.kind}, ${r.family}, ${r.subject}, ${r.source}, ${r.count}, ${r.statements})`),
      sql`, `,
    );
    await db().execute(sql`
      insert into commerce.cache_events_daily (day, kind, family, subject, source, count, statements)
      values ${values}
      on conflict (day, kind, family, subject, source) do update set
        count = commerce.cache_events_daily.count + excluded.count,
        statements = commerce.cache_events_daily.statements + excluded.statements,
        updated_at = now()`);
  } catch (error) {
    log("warn", "cache.events_failed", { rows: rows.length }, error);
  }
}

/** More job refreshes than this of one subject in a UTC day is flagged: a job should refresh only what changed. */
export const JOB_REFRESH_FLAG = 10;

const eventRow = z.object({
  day: col.text,
  kind: col.text,
  family: col.text,
  subject: col.text,
  source: col.text,
  count: col.int,
  statements: col.minor,
});
export type CacheEventRow = z.output<typeof eventRow>;

/** The last 7 UTC days of events, and the rows a job refreshed more than `JOB_REFRESH_FLAG` times. */
export async function cacheEventsWeek(): Promise<{ rows: CacheEventRow[]; flagged: CacheEventRow[] }> {
  const rows = await typedRows(
    eventRow,
    sql`
      select day::text as day, kind, family, subject, source, count, statements
      from commerce.cache_events_daily
      where day > (now() at time zone 'utc')::date - 7
      order by day desc, kind, family, count desc`,
  );
  const flagged = rows.filter((r) => r.kind === "refresh" && r.source === "job" && r.subject !== "" && r.count > JOB_REFRESH_FLAG);
  return { rows, flagged };
}

/** Events older than 90 days go. */
export const pruneCacheEvents = () => db().execute(sql`delete from commerce.cache_events_daily where day < (now() at time zone 'utc')::date - 90`);
