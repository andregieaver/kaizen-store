/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4): every rule the database holds, against every migration applied to
 * a real Postgres (PGlite).
 */

let db: PGlite;
let store: string;
let location: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "cap-a");
  location = await scalar<string>(
    "insert into commerce.inventory_locations (store_id, name, country, priority, active) values ($1, 'Lager', 'NO', 0, true) returning id",
    [store],
  );
});

afterAll(async () => {
  await db.close();
});

/** An order checked out to be captured later: placed, its Stripe payment pending, its stock held for half an hour. */
async function heldOrder(mode: "when_sent" | "by_hand" | null = "by_hand") {
  const order = await placeOrder(db, store, { lines: [{ sku: "A", unit: 10000 }], pay: "pending-only" });
  await db.query("update commerce.orders set capture_mode = $2 where id = $1", [order.id, mode]);
  const reference = await scalar<string>("select provider_reference from commerce.payments where order_id = $1", [order.id]);
  const variant = await scalar<string>("select variant_id from commerce.order_lines where order_id = $1 limit 1", [order.id]);
  await db.query(
    "insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at) values ($1, $2, $3, 1, $4, now() + interval '30 minutes')",
    [store, variant, location, order.id],
  );
  return { order, reference };
}

const authorize = (orderId: string, reference: string, days = 7) =>
  scalar<boolean>(`select commerce.authorize_order_payment($1, $2, now() + make_interval(days => ${days}))`, [orderId, reference]);

describe("an authorisation", () => {
  it("holds the order: authorized with its deadline, the payment authorized, the stock held to the deadline, the cart converted, nothing a sale", async () => {
    const { order, reference } = await heldOrder();
    expect(await authorize(order.id, reference)).toBe(true);
    expect(await one("select status, capture_before > now() + interval '6 days' as later from commerce.orders where id = $1", [order.id])).toEqual({ status: "authorized", later: true });
    expect(await scalar("select status from commerce.payments where order_id = $1", [order.id])).toBe("authorized");
    expect(await scalar("select expires_at > now() + interval '7 days' from commerce.inventory_reservations where order_id = $1", [order.id])).toBe(true);
    expect(await scalar("select count(*)::int from commerce.invoices where order_id = $1", [order.id])).toBe(0);
    expect(await scalar("select count(*)::int from commerce.store_events where subject_id = $1 and event = 'order.paid'", [order.id])).toBe(0);
    expect(await scalar("select count(*)::int from commerce.order_events where order_id = $1 and type = 'order.authorized'", [order.id])).toBe(1);
    // Applied again: nothing more.
    expect(await authorize(order.id, reference)).toBe(false);
  });

  it("is refused for an order not checked out to be captured later, and an authorized order always has its mode and deadline", async () => {
    const { order, reference } = await heldOrder(null);
    await rejects("select commerce.authorize_order_payment($1, $2, now())", [order.id, reference], /orders.not_capture_later/);
    await rejects("update commerce.orders set status = 'authorized' where id = $1", [order.id], /orders_capture_before/);
  });
});

describe("the capture", () => {
  it("makes the order paid as an automatic payment does: stock drawn, the invoice issued, the staff event queued", async () => {
    const { order, reference } = await heldOrder("when_sent");
    await authorize(order.id, reference);
    expect(await scalar<boolean>("select commerce.complete_order_payment($1, $2)", [order.id, reference])).toBe(true);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [order.id]);
    expect(await scalar("select status from commerce.orders where id = $1", [order.id])).toBe("paid");
    expect(await scalar("select (released_at is not null) from commerce.inventory_reservations where order_id = $1", [order.id])).toBe(true);
    expect(await scalar("select count(*)::int from commerce.invoices where order_id = $1", [order.id])).toBe(1);
    expect(await scalar("select count(*)::int from commerce.store_events where subject_id = $1 and event = 'order.paid'", [order.id])).toBe(1);
    expect(await scalar("select data->>'was' from commerce.order_events where order_id = $1 and type = 'order.paid'", [order.id])).toBe("authorized");
  });

  it("captures less by releasing the rest: a succeeded release with no provider reference, credited against the invoice", async () => {
    const { order, reference } = await heldOrder();
    await authorize(order.id, reference);
    await db.query("select commerce.complete_order_payment($1, $2)", [order.id, reference]);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [order.id]);
    const payment = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
    await rejects(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, provider_reference) values ($1, $2, 2000, 'Not captured', 'succeeded', 'release', 're_x')",
      [store, payment],
      /refunds_release/,
    );
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind) values ($1, $2, 2000, 'Not captured', 'succeeded', 'release')", [store, payment]);
    expect(await scalar("select count(*)::int from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1", [order.id])).toBe(1);
  });
});

describe("a hold that ends", () => {
  it("cancels the order, releases its stock and is never paid twice", async () => {
    const { order, reference } = await heldOrder();
    await authorize(order.id, reference);
    expect(await scalar<boolean>("select commerce.cancel_unpaid_order($1, 'authorization expired')", [order.id])).toBe(true);
    expect(await scalar("select status from commerce.orders where id = $1", [order.id])).toBe("cancelled");
    expect(await scalar("select (released_at is not null) from commerce.inventory_reservations where order_id = $1", [order.id])).toBe(true);
    expect(await scalar<boolean>("select commerce.cancel_unpaid_order($1, 'again')", [order.id])).toBe(false);
  });
});
