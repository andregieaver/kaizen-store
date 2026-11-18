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
                    : newerSubject(storeId, trigger);
  if (!query) return null;
  const [row] = await db().execute<{ id: string }>(query);
  return row ? String(row.id) : null;
}

/** The latest subject of the triggers of ecosystem plan E3.2 (D718), each as its event is queued; null for a trigger with none here. */
function newerSubject(storeId: string, trigger: WorkflowTrigger) {
  switch (trigger) {
    case "deal.created":
    case "deal.stage_changed":
      return sql`select id from commerce.deals where store_id = ${storeId}::uuid order by updated_at desc limit 1`;
    case "deal.won":
    case "deal.lost":
      return sql`select id from commerce.deals where store_id = ${storeId}::uuid and status = ${trigger === "deal.won" ? "won" : "lost"} order by closed_at desc nulls last limit 1`;
    case "subscriber.subscribed":
    case "subscriber.unsubscribed":
      return sql`select id from commerce.marketing_subscribers where store_id = ${storeId}::uuid and status = ${trigger === "subscriber.subscribed" ? "subscribed" : "unsubscribed"} order by updated_at desc limit 1`;
    case "conversation.ended":
      return sql`select id from commerce.support_conversations where store_id = ${storeId}::uuid and status = 'ended' and source <> 'admin' order by ended_at desc nulls last limit 1`;
    case "conversation.rated":
      return sql`select id from commerce.support_conversations where store_id = ${storeId}::uuid and rating is not null and source <> 'admin' order by updated_at desc limit 1`;
    case "review.published":
      return sql`select id from commerce.product_reviews where store_id = ${storeId}::uuid and imported_from is null and status = 'published' order by created_at desc limit 1`;
    case "checkout.abandoned":
      return sql`select id from commerce.abandoned_checkouts where store_id = ${storeId}::uuid and abandoned_at is not null order by abandoned_at desc limit 1`;
    case "work_client.created":
      return sql`select id from commerce.work_clients where store_id = ${storeId}::uuid order by created_at desc limit 1`;
    case "work_invoice.sent":
    case "work_invoice.paid":
    case "work_invoice.credited":
      return sql`select id from commerce.work_invoices where store_id = ${storeId}::uuid and status <> 'draft' order by updated_at desc limit 1`;
    // Email plan M1.2 (D732).
    case "email.bounced":
    case "email.complained":
      return sql`select id from commerce.email_messages where store_id = ${storeId}::uuid and status = ${trigger === "email.bounced" ? "bounced" : "complained"}::commerce.email_status order by created_at desc limit 1`;
    case "broadcast.sent":
      return sql`select id from commerce.broadcasts where store_id = ${storeId}::uuid and status = 'sent' order by finished_at desc nulls last limit 1`;
    case "marketing.paused":
      return sql`select id from commerce.sending_pauses where store_id = ${storeId}::uuid limit 1`;
    // Ecosystem plan E5.1 (D757).
    case "activity.created":
      return sql`select id from commerce.activities where store_id = ${storeId}::uuid order by created_at desc limit 1`;
    case "activity.done":
      return sql`select id from commerce.activities where store_id = ${storeId}::uuid and done_at is not null order by done_at desc limit 1`;
    case "lead.dismissed":
    case "lead.deal_made":
      return sql`select id from commerce.lead_decisions where store_id = ${storeId}::uuid and decision = ${trigger === "lead.dismissed" ? "dismissed" : "deal"} order by decided_at desc limit 1`;
    case "domain.failing":
    case "domain.recovered":
      return sql`select id from commerce.store_domains where store_id = ${storeId}::uuid and status = 'active'
        and coalesce(checks -> 'watch' ->> 'known', checks -> 'watch' ->> 'serving') = any(${trigger === "domain.failing" ? "{certificate,elsewhere}" : "{ok}"}::text[])
        order by checks -> 'watch' ->> 'at' desc nulls last limit 1`;
    default:
      return null;
  }
}

