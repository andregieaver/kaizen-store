import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/** Whether the store requires two-step sign-in of its members: read now, never from the cached store, because a security setting is not stale for an hour. */
export async function twoStepRequired(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Record<string, unknown>>(sql`select require_two_step from commerce.stores where id = ${storeId}::uuid`);
  return Boolean(row?.require_two_step);
}

/** What the platform's customer page shows of an account's second step: the display mirror (never an access decision) and whether it is waiting to be set up again. */
export async function twoStepOfAccount(accountId: string): Promise<{ seen: boolean; waitingToSetUp: boolean } | null> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select two_step_since is not null as seen, two_step_reenrol_at is not null as waiting from commerce.accounts where id = ${accountId}::uuid
  `);
  return row ? { seen: Boolean(row.seen), waitingToSetUp: Boolean(row.waiting) } : null;
}
