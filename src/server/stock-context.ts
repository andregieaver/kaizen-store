import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import { stockContextArgs, type StockContext } from "@/lib/inventory";

/**
 * The why of a change of a stock level (wave 3, D172, `docs/wave-3-inventory.md` 3.3.2). Every change of `inventory_levels.on_hand` is a
 * row of the append-only `commerce.inventory_movements`, written by a trigger so that no writer can forget; the trigger reads the reason,
 * the source, the staff account, the order, the return, the job and the note from a TRANSACTION-LOCAL setting that this helper sets.
 * A level written with none is recorded as `opening`/`system` (an insert) or `correction`/`system` (an update): never wrong about the
 * number, only vague about the reason, which `stock-writers.scan.test.ts` keeps from happening in application code.
 *
 * A transaction is required: the setting is local to it, so a pooled connection never carries a context to the next request. Inside a
 * transaction the context is restored to what it was after the block, so contexts nest (a refund that restocks inside a return's work).
 */

/** What the setting held before, to give back after the block. */
async function previousContext(tx: Db): Promise<string> {
  const [row] = await tx.execute<{ value: string | null }>(sql`select current_setting('kaizen.stock', true) as value`);
  return row?.value ?? "";
}

/** Sets the context for the rest of the transaction (or until it is set again). Prefer `withStockContext()`. */
export async function setStockContext(tx: Db, context: StockContext): Promise<void> {
  const [reason, source, account, order, ret, job, note] = stockContextArgs(context);
  await tx.execute(sql`
    select commerce.stock_context(${reason}, ${source}, ${account}::uuid, ${order}::uuid, ${ret}::uuid, ${job}::uuid, ${note})
  `);
}

/**
 * Runs `block` with the stock context set, then puts back the one that was there. The block's writes of `inventory_levels` (by this
 * transaction) are recorded with the reason, source, account, order, return, job and note given. A block that throws leaves the
 * transaction to roll back; the context is then of no matter.
 */
export async function withStockContext<T>(tx: Db, context: StockContext, block: () => Promise<T>): Promise<T> {
  const before = await previousContext(tx);
  await setStockContext(tx, context);
  const result = await block();
  await tx.execute(sql`select set_config('kaizen.stock', ${before}, true)`);
  return result;
}
