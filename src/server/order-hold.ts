import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { RULE_LIMITS } from "@/lib/order-rules";

import { audit } from "./auth";
import { writeOrderEvent } from "./order-actor";

type Row = Record<string, unknown>;

/**
 * Fulfilment holds (wave 3, D238, `docs/wave-3-notifications.md` 2.6 and 4.9): while `orders.held_at` is set nothing of the order is sent or handed over
 * (`markSent()` refuses `held`, and the database refuses the shipment whatever the path, `commerce.shipments_not_held()`). Refunds, cancelling, editing, notes,
 * tags and emails are not affected. The only writer of `held_at`, `held_reason`, `held_by_rule` and `held_by`. Every statement names the store and locks the
 * order row first. A hold is put by a rule (`held_by_rule`, the rule's reason, kept when the order is anonymised) or a person (`held_by`, whose reason is the
 * free text an erasure replaces); an order already held keeps its first hold.
 *
 * Events: `order.held` (`data.reason` the reason, so the erasure of D162 covers it; `data.rule` or `data.by`) and `order.hold_released` (`data.by`). A person's
 * hold and release are audited (`order.held`, `order.hold_released`: the order's id, never the reason); a rule's is in its run (`order_rule_runs`).
 */

export const HOLD_EVENTS = { held: "order.held", released: "order.hold_released" } as const;

export type HoldProblem = "not_found" | "copied" | "already_held" | "sent" | "not_held" | "invalid" | "unpaid";

export const HOLD_PROBLEMS: Record<HoldProblem, string> = {
  not_found: "The order was not found.",
  copied: "A copied order is history and is never held.",
  already_held: "This order is already on hold.",
  sent: "This order has been sent in full, so there is nothing left to hold.",
  not_held: "This order is not on hold.",
  invalid: `Write why the order is held, in at most ${RULE_LIMITS.reason} characters.`,
  unpaid: "Only a paid order can be put on hold.",
};

export type HoldResult = { ok: true; heldAt: string } | { ok: false; problem: HoldProblem; message: string };
export type ReleaseResult = { ok: true } | { ok: false; problem: HoldProblem; message: string };

const refuse = (problem: HoldProblem) => ({ ok: false as const, problem, message: HOLD_PROBLEMS[problem] });

/** A reason as kept: one line, trimmed, 1 to 200 characters; null when it is not one. */
export function cleanHoldReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length >= 1 && [...text].length <= RULE_LIMITS.reason ? text : null;
}

export type HoldBy = { rule: { id: string } } | { account: string };

/**
 * Puts an order on hold. Refused for a copied order, one not paid (a hold of an order waiting for payment would be lifted by nothing), one sent in full
 * (`fulfilled` or `closed`) and one already held. `runner` lets a rule's run hold in its own transaction.
 */
export async function holdOrder(storeId: string, orderId: string, input: { reason: unknown; by: HoldBy }, options: { runner?: Db } = {}): Promise<HoldResult> {
  const reason = cleanHoldReason(input.reason);
  if (!reason) return refuse("invalid");
  const byRule = "rule" in input.by ? input.by.rule.id : null;
  const byAccount = "account" in input.by ? input.by.account : null;
  const work = async (tx: Db): Promise<HoldResult> => {
    const [order] = await tx.execute<Row>(sql`
      select status::text as status, copied_from is not null as copied, held_at from commerce.orders
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order) return refuse("not_found");
    if (order.copied) return refuse("copied");
    if (order.held_at) return refuse("already_held");
    const status = String(order.status);
    if (status === "fulfilled" || status === "closed") return refuse("sent");
    if (status !== "paid") return refuse("unpaid");
    const [row] = await tx.execute<Row>(sql`
      update commerce.orders set held_at = now(), held_reason = ${reason}, held_by_rule = ${byRule}::uuid, held_by = ${byAccount}::uuid
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
      returning held_at
    `);
    await writeOrderEvent(tx, storeId, orderId, HOLD_EVENTS.held, { reason, ...(byRule ? { rule: byRule } : { by: byAccount }) }, byRule ? "system" : "staff");
    return { ok: true, heldAt: new Date(String(row.held_at)).toISOString() };
  };
  const result = options.runner ? await work(options.runner) : await db().transaction(work);
  if (result.ok && byAccount) await audit(byAccount, storeId, HOLD_EVENTS.held, {}, { target: { type: "order", id: orderId } });
  return result;
}

/** Releases an order's hold (a person, `orders:write`): it can be sent again. Refused when it is not held. */
export async function releaseHold(storeId: string, orderId: string, accountId: string | null): Promise<ReleaseResult> {
  const result = await db().transaction(async (tx): Promise<ReleaseResult> => {
    const [order] = await tx.execute<Row>(sql`
      select held_at from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order) return refuse("not_found");
    if (!order.held_at) return refuse("not_held");
    await tx.execute(sql`
      update commerce.orders set held_at = null, held_reason = null, held_by_rule = null, held_by = null
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
    await writeOrderEvent(tx, storeId, orderId, HOLD_EVENTS.released, { by: accountId }, accountId ? "staff" : "system");
    return { ok: true };
  });
  if (result.ok) await audit(accountId, storeId, HOLD_EVENTS.released, {}, { target: { type: "order", id: orderId } });
  return result;
}

export type OrderHold = {
  heldAt: string;
  reason: string;
  /** The rule's id and its name now (null when the rule was deleted since), or the person. */
  rule: { id: string; name: string | null } | null;
  byAccount: { id: string; name: string | null } | null;
};

/** An order's hold for its page's banner, or null. */
export async function orderHold(storeId: string, orderId: string): Promise<OrderHold | null> {
  const [row] = await db().execute<Row>(sql`
    select o.held_at, o.held_reason, o.held_by_rule, o.held_by, r.name as rule_name, a.name as account_name
    from commerce.orders o
    left join commerce.order_rules r on r.store_id = o.store_id and r.id = o.held_by_rule
    left join commerce.accounts a on a.id = o.held_by
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.held_at is not null
  `);
  if (!row) return null;
  return {
    heldAt: new Date(String(row.held_at)).toISOString(),
    reason: String(row.held_reason ?? ""),
    rule: row.held_by_rule ? { id: String(row.held_by_rule), name: row.rule_name ? String(row.rule_name) : null } : null,
    byAccount: row.held_by ? { id: String(row.held_by), name: row.account_name ? String(row.account_name) : null } : null,
  };
}
