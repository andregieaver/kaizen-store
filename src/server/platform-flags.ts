import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  CRON_SCHEMA_MAX_BYTES,
  dayDifference,
  emptyReading,
  platformFlags,
  type DailyReading,
  type DayDifference,
  type FlagOptions,
  type PlatformFlag,
} from "@/lib/platform-flags";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * The two newest stored readings of production (`commerce.platform_readings`, bloat review steps 0.2 and 1.13) and the flags they raise.
 * Reads the stored rows only, never a statistics view: the reading is of the whole database, so Kaizena Flow's own and null-store rows
 * are counted with every other, and no store filter is added.
 */

const figures = z.record(z.string(), z.unknown());
const Row = z.object({ day: col.text, kind: col.text, name: col.text, figures, query: col.textOrNull });

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));

/** Splits at the first dot: '<table>.<index>' and '<feature>.<figure>' (an index name holds none; a feature's figure may). */
const split = (name: string): [string, string] => {
  const at = name.indexOf(".");
  return at < 0 ? [name, ""] : [name.slice(0, at), name.slice(at + 1)];
};

/** The two newest days of readings, newest first; on or before `now`'s day when given (the clock is never read here). */
export async function latestReadings(now?: Date): Promise<[DailyReading, DailyReading] | null> {
  const upTo = now ? sql`and day <= ${now.toISOString().slice(0, 10)}::date` : sql``;
  const rows = await typedRows(
    Row,
    sql`
      select day::text as day, kind, name, figures, query
      from commerce.platform_readings
      where day in (select distinct day from commerce.platform_readings where true ${upTo} order by day desc limit 2)
      order by day desc
    `,
  );
  const days = [...new Set(rows.map((r) => r.day))].sort().reverse();
  if (days.length < 2) return null;
  const readings = new Map(days.map((day) => [day, emptyReading(day)] as const));
  for (const r of rows) {
    const reading = readings.get(r.day);
    if (!reading) continue;
    const f = r.figures;
    if (r.kind === "statement") {
      reading.statements.push({ key: r.name, text: r.query ?? "", calls: num(f.calls), totalMs: num(f.total_ms), meanMs: num(f.mean_ms), rows: num(f.rows) });
    } else if (r.kind === "table") {
      reading.tables.push({ name: r.name, rows: num(f.rows), bytes: num(f.bytes), seqScans: num(f.seq_scan), seqRowsRead: num(f.seq_tup_read) });
    } else if (r.kind === "schema") {
      reading.schemas.push({ name: r.name, bytes: num(f.bytes) });
    } else if (r.kind === "index") {
      const [table, name] = split(r.name);
      reading.indexes.push({ table, name, scans: num(f.scans), backsConstraint: f.backs_constraint === true });
    } else if (r.kind === "job") {
      reading.jobs.push({ job: r.name, runs: num(f.runs), worked: numOrNull(f.worked) });
    } else if (r.kind === "ai") {
      const [feature, figure] = split(r.name);
      reading.ai.push({ feature, figure, value: num(f.value), bar: num(f.bar), daysOver: num(f.days_over) });
    }
  }
  const [today, yesterday] = days.map((day) => readings.get(day) ?? emptyReading(day));
  return [today, yesterday];
}

export type CurrentFlags = { today: DailyReading; yesterday: DailyReading; flags: PlatformFlag[]; difference: DayDifference };

/**
 * The flags the two newest readings raise, with the day's difference the screen shows; null when fewer than two days are stored. It never
 * throws: a failed read is logged as 'platform_flags.failed' and gives null. No table holds an opening date today (`platform_settings` has
 * none, and step 0.2 adds none), so the screen and the briefing pass no `openedOn` and flag five (an unused index on a hot table) stays
 * off: the step that records the opening date passes it here.
 */
export async function currentFlags(now?: Date, options: FlagOptions = {}): Promise<CurrentFlags | null> {
  try {
    const pair = await latestReadings(now);
    if (!pair) return null;
    const [today, yesterday] = pair;
    const flags = platformFlags(today, yesterday, {
      ...options,
      openedOn: options.openedOn ?? null,
      idleCallsOn: options.idleCallsOn ?? false,
      cronSchemaMaxBytes: options.cronSchemaMaxBytes ?? CRON_SCHEMA_MAX_BYTES,
    });
    return { today, yesterday, flags, difference: dayDifference(today, yesterday) };
  } catch (error) {
    log("error", "platform_flags.failed", {}, error);
    return null;
  }
}
