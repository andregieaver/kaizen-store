/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * A bank payment that arrives days later (wave 4 unit D, D291, `docs/wave-4-payments.md` 6): `commerce.await_bank_payment()` against every migration
 * applied to a real Postgres (PGlite).
 */

let db: PGlite;
let store: string;
let location: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "bank-a");
  location = await scalar<string>(
    "insert into commerce.inventory_locations (store_id, name, country, priority, active) values ($1, 'Lager', 'NO', 0, true) returning id",
    [store],
  );
});

afterAll(async () => {
  await db.close();
});

/** An order placed with its Stripe payment pending and its stock held for half an hour, as a checkout leaves it. */
async function placed() {
  const order = await placeOrder(db, store, { lines: [{ sku: "A", unit: 10000 }], pay: "pending-only" });
  const reference = await scalar<string>("select provider_reference from commerce.payments where order_id = $1", [order.id]);
  const variant = await scalar<string>("select variant_id from commerce.order_lines where order_id = $1 limit 1", [order.id]);
  await db.query(
    "insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at) values ($1, $2, $3, 1, $4, now() + interval '30 minutes')",
    [store, variant, location, order.id],
  );
  return { order, reference };
}

const awaitBank = (orderId: string, reference: string) =>
  scalar<boolean>("select commerce.await_bank_payment($1, $2, now() + interval '21 days')", [orderId, reference]);

describe("waiting for the bank", () => {
  it("keeps the order unpaid and holds its stock until the bank can answer, once", async () => {
    const { order, reference } = await placed();
    expect(await awaitBank(order.id, reference)).toBe(true);
    expect(await one("select status, awaiting_bank_since is not null as waiting from commerce.orders where id = $1", [order.id])).toEqual({ status: "pending_payment", waiting: true });
    expect(await scalar("select expires_at > now() + interval '20 days' from commerce.inventory_reservations where order_id = $1", [order.id])).toBe(true);
    expect(await scalar("select count(*)::int from commerce.invoices where order_id = $1", [order.id])).toBe(0);
    expect(await scalar("select count(*)::int from commerce.order_events where order_id = $1 and type = 'order.awaiting_bank'", [order.id])).toBe(1);
    // The webhook and the shopper's return both apply it: nothing more.
    expect(await awaitBank(order.id, reference)).toBe(false);
    expect(await scalar("select count(*)::int from commerce.order_events where order_id = $1 and type = 'order.awaiting_bank'", [order.id])).toBe(1);
  });

  it("ends as any payment does: paid when the money arrives, cancelled with its stock let go when it fails", async () => {
    const paid = await placed();
    await awaitBank(paid.order.id, paid.reference);
    expect(await scalar<boolean>("select commerce.complete_order_payment($1, $2)", [paid.order.id, paid.reference])).toBe(true);
    expect(await scalar("select status from commerce.orders where id = $1", [paid.order.id])).toBe("paid");
    expect(await scalar("select released_at is not null from commerce.inventory_reservations where order_id = $1", [paid.order.id])).toBe(true);

    const failed = await placed();
    await awaitBank(failed.order.id, failed.reference);
    await db.query("select commerce.cancel_unpaid_order($1, 'payment failed')", [failed.order.id]);
    expect(await scalar("select status from commerce.orders where id = $1", [failed.order.id])).toBe("cancelled");
    expect(await scalar("select released_at is not null from commerce.inventory_reservations where order_id = $1", [failed.order.id])).toBe(true);
  });

  it("does nothing for an order already cancelled, and refuses an unknown one", async () => {
    const { order, reference } = await placed();
    await db.query("select commerce.cancel_unpaid_order($1, 'checkout expired')", [order.id]);
    expect(await awaitBank(order.id, reference)).toBe(false);
    expect(await scalar("select awaiting_bank_since from commerce.orders where id = $1", [order.id])).toBeNull();
    await rejects("select commerce.await_bank_payment(gen_random_uuid(), 'x', now())", [], /unknown order/);
  });
});
