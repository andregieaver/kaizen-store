import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { log } from "./log";

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
  // The Admin API (D355): 120 calls a minute per token (the visitor is the token's id), a store's tokens together ten times that.
  api: { window: "minute", visitor: 120, store: 1200 },
  // The storefront API (D362): a headless site's calls, its visitors' together under one token (the visitor is the token's id).
  storefront: { window: "minute", visitor: 1200, store: 6000 },
  // A cookie choice (D58, D389 SEC-10): a visitor makes a few; the store's ceiling stops a flood of records from many.
  consent: { window: "minute", visitor: 20, store: 3000 },
  // A browser's versions of the running A/B tests (D148, D389 SEC-10): asked once a page view at most.
  ab: { window: "minute", visitor: 60, store: 6000 },
  // The site-wide Report-Only policy's reports (D389 SEC-05), counted under no store: the whole platform shares the ceiling.
  csp: { window: "minute", visitor: 20, store: 2000 },
} as const satisfies Record<string, { window: BudgetWindow; visitor: number; store: number }>;

export type BudgetEndpoint = keyof typeof BUDGETS;

/** Endpoints a failed count refuses rather than allows (PSI SEC-10): guessing a password must not get easier while the database struggles. */
export const FAIL_CLOSED: ReadonlySet<BudgetEndpoint> = new Set<BudgetEndpoint>(["unlock"]);

/** The bucket names of an endpoint, for the store and a visitor. */
export function budgetBuckets(endpoint: BudgetEndpoint, visitor: string): { store: string; visitor: string } {
  return { store: `budget:${endpoint}`, visitor: `budget:${endpoint}:${visitor}` };
}

/**
 * A visitor as a budget knows them from the request: a hash of their address that changes every day (as the chat's `visitorKey()`), so
 * it names no one and is never kept beyond the counters' two days.
 */
export function budgetVisitor(headers: Headers): string {
  const address = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-budget`).digest("hex").slice(0, 32);
}

/**
 * Counts one ask and says whether it is within both budgets; `storeId` null is Kaizena Flow's own site (its counters, `store_id` null,
 * are one bucket as the table's key treats nulls as equal). Counting never blocks the answer when the database is busy: a failure allows,
 * except for an endpoint in `FAIL_CLOSED`, where a guess is what the budget stops (a private store's password).
 */
export async function takeBudget(storeId: string | null, endpoint: BudgetEndpoint, visitor: string): Promise<boolean> {
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
    log("warn", "budget.count_failed", { endpoint }, error);
    return !FAIL_CLOSED.has(endpoint);
  }
}
