import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order a return was exchanged for, as the original order's Returns card links it (D239, `docs/wave-3-exchanges.md` 2.2). */
export type ExchangedFor = { orderId: string; orderNumber: string; settled: boolean };

/**
 * For each of these returns of the store, the order its newest live or settled exchange made (a cancelled or expired exchange's order is left out: it
 * was never the customer's). One query, by the store's id; a return with none is absent from the answer.
 */
export async function exchangeOrdersOfReturns(storeId: string, returnIds: readonly string[]): Promise<Record<string, ExchangedFor>> {
  const ids = returnIds.filter((id) => UUID.test(id));
  if (!UUID.test(storeId) || ids.length === 0) return {};
  const rows = await db().execute<Row>(sql`
    select distinct on (x.return_id) x.return_id, x.status, o.id as order_id, o.number
    from commerce.return_exchanges x
    join commerce.orders o on o.store_id = x.store_id and o.id = x.exchange_order_id
    where x.store_id = ${storeId}::uuid and x.return_id = any(${`{${ids.join(",")}}`}::uuid[]) and x.status in ('processed', 'settled')
    order by x.return_id, x.seq desc
  `);
  return Object.fromEntries(
    rows.map((r) => [String(r.return_id), { orderId: String(r.order_id), orderNumber: String(r.number), settled: r.status === "settled" }]),
  );
}

/** The order's delivery address as the exchange builder starts from it (`orders.shipping_address`: `line1`, `line2`, … as checkout keeps it). */
export async function orderDeliveryAddress(storeId: string, orderId: string): Promise<{ name: string; street: string; postalCode: string; city: string; country: string; phone: string; email: boolean }> {
  const empty = { name: "", street: "", postalCode: "", city: "", country: "", phone: "", email: false };
  if (!UUID.test(storeId) || !UUID.test(orderId)) return empty;
  const [row] = await db().execute<Row>(sql`select shipping_address, email, market_code from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  if (!row) return empty;
  const a = (row.shipping_address ?? {}) as Record<string, unknown>;
  const s = (key: string) => (typeof a[key] === "string" ? String(a[key]).trim() : "");
  return {
    name: s("name"),
    street: [s("line1"), s("line2")].filter(Boolean).join(", "),
    postalCode: s("postalCode"),
    city: s("city"),
    country: (s("country") || String(row.market_code ?? "").trim()).toUpperCase(),
    phone: s("phone"),
    email: Boolean(row.email),
  };
}
