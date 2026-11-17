import { readFileSync, writeFileSync } from "node:fs";

import postgres from "postgres";

import { closeDb } from "@/db/client";
import { countStatements, type StatementRecord } from "@/db/statement-count";

/**
 * Test support for the query budget (bloat review step 1.10, `query-budget.int.test.ts`): what a piece of work sends to the database and
 * how many rows Postgres read for it. The name ends in test-support.ts, so the code ratchet does not count it.
 */

export type Figures = { statements: number; rowsRead: number };
export type Measured = Figures & { records: StatementRecord[] };
export type QueryBudget = { one?: Record<string, Figures>; twenty?: Record<string, Figures>; growth?: Record<string, Figures> };

const FILE = new URL("./ratchet.baseline.json", import.meta.url);

/**
 * A second, dedicated connection, so the reads of the statistics are never in a count. It reads only Postgres's statistics views, never a
 * table of `commerce`, so it adds nothing to what it reads either.
 */
let sideConnection: postgres.Sql | null = null;
export function side(): postgres.Sql {
  sideConnection ??= postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
  return sideConnection;
}

export async function closeSide(): Promise<void> {
  await sideConnection?.end();
  sideConnection = null;
}

/** Rows Postgres read from the tables of `commerce`: sequential scans' rows plus the rows index scans fetched. */
async function rowsRead(): Promise<number> {
  await side()`select pg_stat_clear_snapshot()`;
  const [row] = await side()`
    select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint as n from pg_stat_user_tables where schemaname = 'commerce'
  `;
  return Number(row.n);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The app's connections to this database (the side connection aside). */
async function appBackends(): Promise<number> {
  const [row] = await side()`
    select count(*)::int as n from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
  `;
  return Number(row.n);
}

/**
 * Reads until two reads in a row are JSON-equal, at most 15 seconds. A backend writes its counters out up to a second after a statement,
 * and an idle one up to ten seconds after; one that ends writes them as it ends. So the app's pool is closed first and its connections
 * waited for: the counters are then all out, and the reads only confirm it.
 */
export async function settled<T>(read: () => Promise<T>): Promise<T> {
  await closeDb();
  const until = performance.now() + 15_000;
  while ((await appBackends()) > 0 && performance.now() < until) await pause(50);
  let last = JSON.stringify(await read());
  while (performance.now() < until) {
    await pause(200);
    const value = await read();
    const now = JSON.stringify(value);
    if (now === last) return value;
    last = now;
  }
  throw new Error("The statistics did not settle within 15 seconds.");
}

/** The statements `run` sends (control statements aside), the rows Postgres read for them, and the records of what was sent. */
export async function measure(run: () => Promise<unknown>): Promise<Measured> {
  const before = await settled(rowsRead);
  const { count, statements } = await countStatements(run);
  const after = await settled(rowsRead);
  return { statements: count, rowsRead: after - before, records: statements };
}

/**
 * 10:23 UTC on the Wednesday nearest to today: off the hour (the hourly jobs run in its first five minutes), not seven in Oslo (the
 * platform's briefing), not a Monday (the weekly reports) and not past 20:00 anywhere in Europe (the analytics alerts).
 */
export function idleClock(today: Date = new Date()): Date {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 23));
  let offset = (3 - day.getUTCDay() + 7) % 7;
  if (offset > 3) offset -= 7;
  day.setUTCDate(day.getUTCDate() + offset);
  return day;
}

function readFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
}

/** The key `queryBudget` of `src/server/ratchet.baseline.json`. */
export function readBaseline(): QueryBudget {
  return (readFile().queryBudget ?? {}) as QueryBudget;
}

/** Writes the key `queryBudget`, every other key of the file as it was (as `scripts/ratchet.mjs` writes the file). */
export function writeBaseline(next: QueryBudget): void {
  const file = readFile();
  writeFileSync(FILE, `${JSON.stringify({ ...file, queryBudget: next }, null, 2)}\n`);
}

/** The ten texts sent most often, with how often: what a failure prints so the new statements can be found. */
export function mostRepeated(records: StatementRecord[], top = 10): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.control) continue;
    const text = r.text.replace(/\s+/g, " ").trim().slice(0, 160);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([text, n]) => `${n}× ${text}`);
}
