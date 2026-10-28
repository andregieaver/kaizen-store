import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Budgets on a store's costly public endpoints (D314, `docs/capacity.md` step 3.2), so one busy or misbehaving visitor or store cannot
 * slow the others: counters in `commerce.chat_usage` (the same table and upsert as the chat's and the ECB's limits), bucket
 * `budget:{endpoint}` for the store and `budget:{endpoint}:{visitor}` for one visitor, whose key is the chat's daily-changing hash
 * (`visitorKey()`), never an address. Ceilings against abuse, generous enough that a real shop never meets them; never used on a page
 * load, the cart, checkout, payment or a webhook. `pruneChatUsage()` removes the rows after two days.
 */

export type BudgetWindow = "minute" | "hour";

/** The ceilings, per window: what one visitor and one store may ask of an endpoint. */
export const BUDGETS = {
  suggest: { window: "minute", visitor: 120, store: 6000 },
  // A product feed (D302): channels fetch a few times a day; the visitor is the feed's address.
  feed: { window: "hour", visitor: 60, store: 600 },
  // A private store's password (D339): a few tries a minute for one visitor, the store's own ceiling against guessing from many.
  unlock: { window: "minute", visitor: 10, store: 120 },
  // A shopping agent's calls to the store's MCP endpoint (D353): the visitor is a daily hash of the caller's address.
  agent: { window: "minute", visitor: 60, store: 1200 },
} as const satisfies Record<string, { window: BudgetWindow; visitor: number; store: number }>;

export type BudgetEndpoint = keyof typeof BUDGETS;

/** The bucket names of an endpoint, for the store and a visitor. */
export function budgetBuckets(endpoint: BudgetEndpoint, visitor: string): { store: string; visitor: string } {
  return { store: `budget:${endpoint}`, visitor: `budget:${endpoint}:${visitor}` };
}

/** Counts one ask and says whether it is within both budgets. Counting never blocks the answer when the database is busy: a failure allows. */
export async function takeBudget(storeId: string, endpoint: BudgetEndpoint, visitor: string): Promise<boolean> {
  const budget = BUDGETS[endpoint];
  const buckets = budgetBuckets(endpoint, visitor);
  const window = budget.window === "minute" ? sql`date_trunc('minute', now())` : sql`date_trunc('hour', now())`;
  try {
    const rows = await db().execute<{ bucket: string; count: number }>(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, ${buckets.visitor}, ${window}, 1), (${storeId}::uuid, ${buckets.store}, ${window}, 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
      returning bucket, count
    `);
    const count = (bucket: string) => Number(rows.find((r) => r.bucket === bucket)?.count ?? 0);
    return count(buckets.visitor) <= budget.visitor && count(buckets.store) <= budget.store;
  } catch (error) {
    console.error("[budget] could not count", endpoint, error instanceof Error ? error.message : "");
    return true;
  }
}
