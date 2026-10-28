import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { subjectOf, type WorkflowTrigger } from "@/lib/workflows";

/**
 * What a workflow's *Test* (D356) runs on: the latest subject of its trigger in the store, read without acting. Apart from `workflows.ts`,
 * which sends email, so the events named here are never read as email kinds.
 */
/** The latest subject of a trigger in the store: what *Test* runs on. */
export async function latestSubject(storeId: string, trigger: WorkflowTrigger): Promise<string | null> {
  const subject = subjectOf(trigger);
  const query =
    subject === "order"
      ? trigger === "order.paid" || trigger === "order.sent"
        ? sql`select id from commerce.orders where store_id = ${storeId}::uuid and copied_from is null and status in ('paid', 'fulfilled', 'closed') order by placed_at desc limit 1`
        : trigger === "order.cancelled"
          ? sql`select id from commerce.orders where store_id = ${storeId}::uuid and copied_from is null and status = 'cancelled' order by placed_at desc limit 1`
          : sql`select id from commerce.orders where store_id = ${storeId}::uuid and copied_from is null order by placed_at desc limit 1`
      : subject === "customer"
        ? sql`select id from commerce.customers where store_id = ${storeId}::uuid and copied_from is null order by created_at desc limit 1`
        : subject === "subscription"
          ? sql`select id from commerce.subscriptions where store_id = ${storeId}::uuid order by created_at desc limit 1`
          : subject === "return"
            ? sql`select id from commerce.returns where store_id = ${storeId}::uuid order by created_at desc limit 1`
            : subject === "withdrawal"
              ? sql`select id from commerce.withdrawal_requests where store_id = ${storeId}::uuid and confirmed_at is not null order by confirmed_at desc limit 1`
              : subject === "product"
                ? sql`select id from commerce.products where store_id = ${storeId}::uuid order by updated_at desc limit 1`
                : subject === "stock"
                  ? sql`select variant_id as id from commerce.stock_alerts where store_id = ${storeId}::uuid and state = 'low' order by crossed_at desc limit 1`
                  : subject === "discount"
                    ? sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid order by created_at desc limit 1`
                    : null;
  if (!query) return null;
  const [row] = await db().execute<{ id: string }>(query);
  return row ? String(row.id) : null;
}

