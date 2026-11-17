/**
 * Eight flags over two stored daily readings of production (bloat review step 1.13): what a test cannot see in the database. Pure: no
 * server code, no database. The reading is `commerce.platform_readings` (step 0.2); `src/server/platform-flags.ts` reads it and maps it
 * to `DailyReading`. A counter's difference is today's value minus yesterday's, never below 0 (the statistics were reset), and exists only
 * for a key in both readings: yesterday's reading holds 80 statements, so a statement absent yesterday has no difference (its cumulative
 * counter would raise false flags) and only rule one looks at it.
 */

export type StatementReading = { key: string; text: string; calls: number; totalMs: number; meanMs: number; rows: number };
export type TableReading = { name: string; rows: number; bytes: number; seqScans: number; seqRowsRead: number };
export type IndexReading = { table: string; name: string; scans: number; backsConstraint: boolean };
export type JobReading = { job: string; runs: number; worked: number | null };
export type AiReading = { feature: string; figure: string; value: number; bar: number; daysOver: number };

export type DailyReading = {
  day: string;
  /** The 40 costliest and the 40 most called, without repeats. */
  statements: StatementReading[];
  tables: TableReading[];
  schemas: { name: string; bytes: number }[];
  indexes: IndexReading[];
  jobs: JobReading[];
  ai: AiReading[];
};

export const emptyReading = (day: string): DailyReading => ({ day, statements: [], tables: [], schemas: [], indexes: [], jobs: [], ai: [] });

/**
 * Tables the plan allows to be read whole, each with its reason. At most five; it starts empty and an entry is a deliberate, reviewed
 * step (never added to quiet a flag).
 */
export const WHOLE_READ_ALLOWED: { table: string; reason: string }[] = [];

/** Statements allowed to cost more than the flag's 5 ms each, with a ceiling. At most three when the plan ends; it starts empty. */
export const COSTLY_ALLOWED: { key: string; reason: string; ceilingMs: number }[] = [];

/** The hot tables of CLAUDE.md (Database). */
export const HOT_TABLES = ["orders", "order_lines", "visits", "products", "product_variants", "customers", "carts", "cart_lines"] as const;

export const FLAG_IDS = [
  "new_top_statement",
  "whole_table_read",
  "idle_write",
  "cron_schema_large",
  "unused_hot_index",
  "costly_statement",
  "idle_route_calls",
  "ai_over_bar",
] as const;
export type FlagId = (typeof FLAG_IDS)[number];
export type PlatformFlag = { id: FlagId; subject: string; values: Record<string, string | number> };

export type FlagOptions = {
  /** The day the platform opened to the public; flag five starts 56 days later. Null: no opening date yet, flag five stays off. */
  openedOn?: string | null;
  /** The scheduler's own log over this many bytes raises flag four (80 MB; step 3.1 lowers it to 20 MB). */
  cronSchemaMaxBytes?: number;
  /** Flag seven reads jobs' worked counts: off until step 3.3 writes them. */
  idleCallsOn?: boolean;
  wholeReadAllowed?: readonly { table: string }[];
  costlyAllowed?: readonly { key: string; ceilingMs: number }[];
};

export const CRON_SCHEMA_MAX_BYTES = 80 * 1024 * 1024;
export const NEW_TOP_CALLS = 25;
export const COSTLY_TOP = 40;
export const WHOLE_READ_MIN_ROWS = 500;
export const WHOLE_READ_MIN_SCANS = 10;
export const IDLE_WRITE_MIN_CALLS = 10;
export const COSTLY_MIN_CALLS = 10;
export const COSTLY_MEAN_MS = 5;
export const IDLE_ROUTE_CALLS = 1_100;
export const UNUSED_INDEX_DAYS = 56;
export const AI_OVER_DAYS = 7;

/** A counter's day difference: never below 0. */
const rise = (today: number, yesterday: number) => Math.max(0, today - yesterday);

const byKey = <T>(rows: readonly T[], key: (row: T) => string) => new Map(rows.map((row) => [key(row), row] as const));

const SUBJECT_LENGTH = 120;
const subjectOf = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUBJECT_LENGTH ? `${flat.slice(0, SUBJECT_LENGTH)}…` : flat;
};

const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

type StatementChange = { statement: StatementReading; calls: number; totalMs: number; rows: number };

/** Each statement of today that is also in yesterday's reading, with its day difference. */
function statementChanges(today: DailyReading, yesterday: DailyReading): StatementChange[] {
  const before = byKey(yesterday.statements, (s) => s.key);
  const out: StatementChange[] = [];
  for (const statement of today.statements) {
    const was = before.get(statement.key);
    if (!was) continue;
    out.push({ statement, calls: rise(statement.calls, was.calls), totalMs: rise(statement.totalMs, was.totalMs), rows: rise(statement.rows, was.rows) });
  }
  return out;
}

/** Each table in both readings with its day difference of whole-table reads. */
function tableChanges(today: DailyReading, yesterday: DailyReading) {
  const before = byKey(yesterday.tables, (t) => t.name);
  const out: { table: TableReading; seqScans: number; seqRowsRead: number }[] = [];
  for (const table of today.tables) {
    const was = before.get(table.name);
    if (!was) continue;
    out.push({ table, seqScans: rise(table.seqScans, was.seqScans), seqRowsRead: rise(table.seqRowsRead, was.seqRowsRead) });
  }
  return out;
}

/** The eight flags the two readings raise, in the order of `FLAG_IDS`. */
export function platformFlags(today: DailyReading, yesterday: DailyReading, options: FlagOptions = {}): PlatformFlag[] {
  const flags: PlatformFlag[] = [];
  const changes = statementChanges(today, yesterday);

  // 1. A statement among today's 25 most called that yesterday's reading does not hold at all.
  const known = new Set(yesterday.statements.map((s) => s.key));
  const topCalled = [...today.statements].sort((a, b) => b.calls - a.calls).slice(0, NEW_TOP_CALLS);
  for (const s of topCalled) {
    if (!known.has(s.key)) flags.push({ id: "new_top_statement", subject: subjectOf(s.text), values: { calls: s.calls, key: s.key } });
  }

  // 2. A table of more than 500 rows read whole more than 10 times in the day.
  const wholeAllowed = new Set((options.wholeReadAllowed ?? WHOLE_READ_ALLOWED).map((e) => e.table));
  for (const { table, seqScans } of tableChanges(today, yesterday)) {
    if (table.rows > WHOLE_READ_MIN_ROWS && seqScans > WHOLE_READ_MIN_SCANS && !wholeAllowed.has(table.name)) {
      flags.push({ id: "whole_table_read", subject: table.name, values: { rows: table.rows, n: seqScans } });
    }
  }

  // 3. A write that changed under a tenth as many rows as it was called.
  for (const { statement, calls, rows } of changes) {
    if (!/^(update|delete|insert)\b/i.test(statement.text.trim())) continue;
    if (calls >= IDLE_WRITE_MIN_CALLS && rows < calls / 10) {
      flags.push({ id: "idle_write", subject: subjectOf(statement.text), values: { calls, changed: rows } });
    }
  }

  // 4. The scheduler's own log over its ceiling.
  const cronMax = options.cronSchemaMaxBytes ?? CRON_SCHEMA_MAX_BYTES;
  const cron = today.schemas.find((s) => s.name === "cron");
  if (cron && cron.bytes > cronMax) flags.push({ id: "cron_schema_large", subject: "cron", values: { bytes: cron.bytes, size: mb(cron.bytes) } });

  // 5. An index of a hot table nothing has read, from eight weeks after opening, that backs no constraint.
  if (options.openedOn && daysBetween(options.openedOn, today.day) >= UNUSED_INDEX_DAYS) {
    const hot = new Set<string>(HOT_TABLES);
    for (const index of today.indexes) {
      if (hot.has(index.table) && index.scans === 0 && !index.backsConstraint) {
        flags.push({ id: "unused_hot_index", subject: index.name, values: { table: index.table } });
      }
    }
  }

  // 6. Among the 40 that took the most time today, one called more than 10 times at more than 5 ms each.
  const costlyAllowed = new Map((options.costlyAllowed ?? COSTLY_ALLOWED).map((e) => [e.key, e.ceilingMs] as const));
  for (const { statement, calls, totalMs } of [...changes].sort((a, b) => b.totalMs - a.totalMs).slice(0, COSTLY_TOP)) {
    if (calls <= COSTLY_MIN_CALLS) continue;
    const mean = totalMs / calls;
    if (mean <= COSTLY_MEAN_MS) continue;
    const ceiling = costlyAllowed.get(statement.key);
    if (ceiling !== undefined && mean <= ceiling) continue;
    flags.push({ id: "costly_statement", subject: subjectOf(statement.text), values: { calls, ms: Math.round(mean * 10) / 10 } });
  }

  // 7. Scheduled routes called with nothing to do (only once the jobs say what they worked).
  if (options.idleCallsOn) {
    const before = byKey(yesterday.jobs, (j) => j.job);
    let idle = 0;
    for (const job of today.jobs) {
      if (!job.job.startsWith("route.")) continue;
      const was = before.get(job.job);
      if (!was || job.worked === null || was.worked === null) continue;
      idle += rise(job.runs, was.runs) - rise(job.worked, was.worked);
    }
    if (idle > IDLE_ROUTE_CALLS) flags.push({ id: "idle_route_calls", subject: "route.", values: { n: idle } });
  }

  // 8. An AI figure over its bar for a week.
  for (const ai of today.ai) {
    if (ai.value > ai.bar && ai.daysOver >= AI_OVER_DAYS) {
      flags.push({ id: "ai_over_bar", subject: `${ai.feature} ${ai.figure}`, values: { value: ai.value, bar: ai.bar } });
    }
  }

  return flags;
}

export type DayDifference = {
  schemas: { name: string; bytesChange: number }[];
  statements: { key: string; text: string; calls: number; totalMs: number }[];
  tables: { name: string; seqScans: number; seqRowsRead: number }[];
};

/** What the screen shows: each schema's change in bytes, the 10 statements that took the most time and the 10 tables read whole the most rows. */
export function dayDifference(today: DailyReading, yesterday: DailyReading): DayDifference {
  const before = byKey(yesterday.schemas, (s) => s.name);
  const schemas = today.schemas
    .filter((s) => before.has(s.name))
    .map((s) => ({ name: s.name, bytesChange: s.bytes - (before.get(s.name)?.bytes ?? 0) }))
    .sort((a, b) => Math.abs(b.bytesChange) - Math.abs(a.bytesChange));
  const statements = statementChanges(today, yesterday)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10)
    .map((c) => ({ key: c.statement.key, text: c.statement.text, calls: c.calls, totalMs: Math.round(c.totalMs * 10) / 10 }));
  const tables = tableChanges(today, yesterday)
    .sort((a, b) => b.seqRowsRead - a.seqRowsRead)
    .slice(0, 10)
    .map((c) => ({ name: c.table.name, seqScans: c.seqScans, seqRowsRead: c.seqRowsRead }));
  return { schemas, statements, tables };
}
