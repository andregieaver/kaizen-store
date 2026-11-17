import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One statement counter for the database client (bloat review step 1.9, AD-12). It is off unless something asks: a test inside
 * `countStatements()`, or a render that registered `setRenderCounter()` (`src/server/render-count.ts`). Outside both, `noteStatement()`
 * returns null and a statement costs one lookup. This file imports nothing but `node:async_hooks` (no 'server-only', React, drizzle or
 * pg), so tests and scripts can load it. The record keeps text and values in memory for tests; no log line ever carries them (D400).
 */

export type StatementRecord = {
  text: string;
  values: unknown[];
  rows: number | null;
  ms: number;
  startedAt: number;
  /** begin, commit, rollback, savepoint, release and `set local`: sent, but not counted as a statement of the screen. */
  control: boolean;
};

const store = new AsyncLocalStorage<{ statements: StatementRecord[] }>();
let renderCounter: (() => { statements: number } | null) | null = null;

const CONTROL = /^(begin|commit|rollback|savepoint|release|set local)/;

/** The render's counter (called once by `src/server/render-count.ts`); null switches it off. */
export function setRenderCounter(get: (() => { statements: number } | null) | null): void {
  renderCounter = get;
}

/** Runs `run` and returns what it sent to the database: the records, the count without control statements, and the time it took. */
export async function countStatements<T>(
  run: () => Promise<T>,
): Promise<{ result: T; statements: StatementRecord[]; count: number; ms: number }> {
  const statements: StatementRecord[] = [];
  const started = performance.now();
  const result = await store.run({ statements }, run);
  let count = 0;
  try {
    count = statements.filter((s) => !s.control).length;
  } catch {
    count = 0;
  }
  return { result, statements, count, ms: performance.now() - started };
}

/**
 * Called by the client's wrapper for each statement. Returns null (nothing to record: the path of every production query outside a test)
 * or the function to call with the row count when the answer came.
 */
export function noteStatement(text: string, values: unknown[]): ((rows: number | null) => void) | null {
  try {
    if (renderCounter) {
      const counter = renderCounter();
      if (counter) counter.statements += 1;
    }
    const s = store.getStore();
    if (!s) return null;
    const record: StatementRecord = {
      text,
      values,
      rows: null,
      ms: 0,
      startedAt: performance.now(),
      control: CONTROL.test(String(text).trim().toLowerCase()),
    };
    s.statements.push(record);
    let done = false;
    return (rows) => {
      if (done) return;
      done = true;
      try {
        record.rows = rows;
        record.ms = performance.now() - record.startedAt;
      } catch {
        // never fails a query
      }
    };
  } catch {
    return null;
  }
}

/**
 * How many waves the statements came in: a statement that starts after every earlier one has answered begins a new wave, so reads one
 * after the other are a wave each and a Promise.all is one. Control statements are left out; 0 for none.
 */
export function waves(records: StatementRecord[]): number {
  try {
    const sorted = records.filter((r) => !r.control).sort((a, b) => a.startedAt - b.startedAt);
    let count = 0;
    let end = -Infinity;
    for (const r of sorted) {
      if (count === 0 || r.startedAt >= end) count += 1;
      end = Math.max(end, r.startedAt + r.ms);
    }
    return count;
  } catch {
    return 0;
  }
}

/** The texts sent twice or more with JSON-equal values (control statements left out), for later budgets. */
export function sameStatementTwice(records: StatementRecord[]): string[] {
  try {
    const seen = new Map<string, number>();
    const texts = new Map<string, string>();
    for (const r of records) {
      if (r.control) continue;
      const key = `${r.text}\u0000${JSON.stringify(r.values)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      texts.set(key, r.text);
    }
    return [...seen].filter(([, n]) => n >= 2).map(([key]) => texts.get(key) as string);
  } catch {
    return [];
  }
}
