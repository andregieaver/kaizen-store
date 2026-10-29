import "server-only";

import type { SQLWrapper } from "drizzle-orm";
import { z } from "zod";

import { db, type Db } from "@/db/client";

/**
 * Typed reads (PSI 2026-10-24, CODE-02): `db().execute<Row>()` hands back `Record<string, unknown>`, so a renamed column or a null
 * where a number was meant is found only by an integration test, or by a shopper. New code, and every read that carries money,
 * describes its row with `col` and reads through `typedRows()`/`typedRow()`: each row is checked, and a row of another shape throws
 * `RowShapeError`, naming the column and never its value. Older reads move over as they are touched.
 */

/** Anything that runs a query: the database or a transaction. */
export type Executor = Pick<Db, "execute">;

const safeInteger = z.int();

/** Columns as node-postgres hands them over: an `int` as a number, a `bigint` or `numeric` as a string, a timestamp as a Date. */
export const col = {
  uuid: z.uuid(),
  text: z.string(),
  textOrNull: z.string().nullable(),
  bool: z.boolean(),
  int: safeInteger,
  /** Minor units (a `bigint` sum comes as a string): a safe integer, never a float. */
  minor: z.union([z.number(), z.string()]).transform(Number).pipe(safeInteger),
  minorOrNull: z.union([z.number(), z.string()]).nullable().transform((v) => (v === null ? null : Number(v))).pipe(safeInteger.nullable()),
  /** An ISO 4217 code; a `char(3)` column is trimmed. */
  currency: z.string().transform((v) => v.trim()).pipe(z.string().regex(/^[A-Z]{3}$/)),
  /** A rate or share (`numeric`, `double precision`): a finite number. */
  decimal: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite()),
  /** A `timestamptz`, as an ISO string. */
  timestamp: z.union([z.date(), z.string()]).transform((v) => new Date(v).toISOString()),
  timestampOrNull: z.union([z.date(), z.string()]).nullable().transform((v) => (v === null ? null : new Date(v).toISOString())),
};

/** A row that is not the shape its read described: a query and its description disagree. */
export class RowShapeError extends Error {
  constructor(issues: z.core.$ZodIssue[], index: number) {
    super(`Row ${index} is not the shape its read expects: ${issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ")}`);
    this.name = "RowShapeError";
  }
}

/** Every row of a query, each checked against `schema`. */
export async function typedRows<S extends z.ZodType>(schema: S, query: SQLWrapper, executor: Executor = db()): Promise<z.output<S>[]> {
  return checkedRows(schema, await executor.execute(query));
}

/**
 * Rows another runner fetched (the analytics' planner-guarded `setBased()`, a snapshot's read), each checked against `schema` as
 * `typedRows()` checks its own.
 */
export function checkedRows<S extends z.ZodType>(schema: S, rows: readonly unknown[]): z.output<S>[] {
  return rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new RowShapeError(parsed.error.issues, index);
    return parsed.data;
  });
}

/** The first row of a query, checked, or null when there is none. */
export async function typedRow<S extends z.ZodType>(schema: S, query: SQLWrapper, executor: Executor = db()): Promise<z.output<S> | null> {
  return (await typedRows(schema, query, executor))[0] ?? null;
}
