import { readFileSync, writeFileSync } from "node:fs";

import { countStatements, type StatementRecord } from "@/db/statement-count";

import { settled, side } from "./query-budget-test-support";

/**
 * Per-table statistics for the budgets of bloat review step 1.12 (`order-writes.int.test.ts`): what a piece of work scanned, read and wrote,
 * table by table, read from Postgres's own counters on the query budget's side connection once they have settled. The name ends in
 * test-support.ts, so the code ratchet does not count it.
 */

export type TableStats = { scans: number; seqScans: number; rowsRead: number; inserted: number; updated: number; deleted: number };

const FILE = new URL("./ratchet.baseline.json", import.meta.url);

/** Every table of `commerce` with its counters as Postgres has them now. */
export async function tableStats(): Promise<Map<string, TableStats>> {
  await side()`select pg_stat_clear_snapshot()`;
  const rows = await side()`
    select relname,
      coalesce(seq_scan, 0) + coalesce(idx_scan, 0) as scans, coalesce(seq_scan, 0) as seq_scans,
      coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) as rows_read,
      n_tup_ins as inserted, n_tup_upd as updated, n_tup_del as deleted
    from pg_stat_user_tables where schemaname = 'commerce'
  `;
  return new Map(
    rows.map((r) => [
      String(r.relname),
      {
        scans: Number(r.scans),
        seqScans: Number(r.seq_scans),
        rowsRead: Number(r.rows_read),
        inserted: Number(r.inserted),
        updated: Number(r.updated),
        deleted: Number(r.deleted),
      },
    ]),
  );
}

const asObject = (stats: Map<string, TableStats>) => Object.fromEntries(stats);

/**
 * The statements `run` sends (control statements aside), their records, and, for each table whose scans, inserts, updates or deletes
 * moved, what moved (a table missing before counts from 0).
 */
export async function measureTables(run: () => Promise<unknown>): Promise<{ statements: number; records: StatementRecord[]; tables: Record<string, TableStats> }> {
  const before = new Map(Object.entries(await settled(async () => asObject(await tableStats()))));
  const { count, statements } = await countStatements(run);
  const after = await settled(async () => asObject(await tableStats()));
  const zero: TableStats = { scans: 0, seqScans: 0, rowsRead: 0, inserted: 0, updated: 0, deleted: 0 };
  const tables: Record<string, TableStats> = {};
  for (const [name, now] of Object.entries(after)) {
    const was = before.get(name) ?? zero;
    const delta = {
      scans: now.scans - was.scans,
      seqScans: now.seqScans - was.seqScans,
      rowsRead: now.rowsRead - was.rowsRead,
      inserted: now.inserted - was.inserted,
      updated: now.updated - was.updated,
      deleted: now.deleted - was.deleted,
    };
    if (delta.scans || delta.inserted || delta.updated || delta.deleted) tables[name] = delta;
  }
  return { statements: count, records: statements, tables };
}

function readFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
}

/** A top-level key of `src/server/ratchet.baseline.json`. */
export function readKey<T>(name: string): T | undefined {
  return readFile()[name] as T | undefined;
}

/** Writes one top-level key of the file, every other key as it was, as `scripts/ratchet.mjs` writes it. */
export function writeKey(name: string, value: unknown): void {
  const file = readFile();
  writeFileSync(FILE, `${JSON.stringify({ ...file, [name]: value }, null, 2)}\n`);
}
