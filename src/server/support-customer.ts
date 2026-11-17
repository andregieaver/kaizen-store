import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { bought } from "./bought-sql";
import type { OrderStatus } from "./orders";
import { col, typedRows } from "./typed-rows";

/**
 * The customer a conversation is with, and their latest orders, for the inbox's Context column (ecosystem plan E1.1,
 * `docs/audits/ecosystem-2026-11.md`): staff answer "where is my order?" without leaving the conversation. A signed-in chat is
 * the customer's own account; an email or form message only matches an address (`addressCustomer`, never proof). Staff only:
 * nothing here reaches the customer or the AI, and the inbox asks for it once per opening, not on every poll.
 */

/** How many of the latest orders the column lists. */
export const CONVERSATION_ORDERS = 3;

export type ConversationOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  placedAt: string;
  totalMinor: number;
  currency: string;
};

export type ConversationCustomer = {
  /** The customer's page is `/admin/{store}/customers/{id}`. */
  id: string;
  /** True for a signed-in chat; false when only the address matched. */
  verified: boolean;
  /** The latest orders, newest first, or null for a person who may not read orders. */
  orders: ConversationOrder[] | null;
  /** How many orders they have in all (null with `orders`). */
  orderCount: number | null;
};

const ORDER_STATUSES = ["pending_payment", "authorized", "paid", "fulfilled", "cancelled", "closed"] as const satisfies readonly OrderStatus[];

const orderRow = z.object({
  id: col.uuid,
  number: col.text,
  status: z.enum(ORDER_STATUSES),
  placed_at: col.timestamp,
  total_minor: col.minor,
  currency: col.currency,
  n: col.int,
});

/**
 * A customer's latest orders in a store, by their account or the account's address, as the customer's own page counts them: paid
 * (even if cancelled later) or held on a card, never history copied from another store, never a restricted or anonymised order.
 */
export async function latestOrdersOf(storeId: string, customerId: string): Promise<{ orders: ConversationOrder[]; count: number }> {
  const rows = await typedRows(orderRow, sql`
    select o.id, o.number, o.status, o.placed_at, o.total_minor, o.currency, count(*) over ()::int as n
    from commerce.orders o
    where o.store_id = ${storeId}::uuid
      and (o.customer_id = ${customerId}::uuid or lower(o.email) = (
        select lower(c.email) from commerce.customers c where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid))
      and (${bought} or o.status = 'authorized')
      and o.restricted_at is null and o.anonymised_at is null
    order by o.placed_at desc, o.id
    limit ${CONVERSATION_ORDERS}
  `);
  return {
    orders: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      placedAt: r.placed_at,
      totalMinor: r.total_minor,
      currency: r.currency,
    })),
    count: rows[0]?.n ?? 0,
  };
}

/**
 * The customer a conversation is with, for a person who may read customers: the signed-in account, else the account whose address an
 * email or form came from. Orders only for a person who may also read orders.
 */
export async function conversationCustomer(
  storeId: string,
  who: { customerId: string | null; addressCustomer: string | null },
  mayReadOrders: boolean,
): Promise<ConversationCustomer | null> {
  const id = who.customerId ?? who.addressCustomer;
  if (!id) return null;
  const latest = mayReadOrders ? await latestOrdersOf(storeId, id) : null;
  return { id, verified: who.customerId !== null, orders: latest?.orders ?? null, orderCount: latest?.count ?? null };
}
