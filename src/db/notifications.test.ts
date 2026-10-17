/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { areaOfAction } from "@/lib/audit";
import { EDITABLE_NOTIFICATIONS, LOCKED_NOTIFICATIONS, NOTIFICATION_IDS, REQUIRED_NOTIFICATIONS, SWITCHABLE_NOTIFICATIONS } from "@/lib/notifications";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { RULE_LIMITS } from "@/lib/order-rules";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0, type OrderSpec } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Customer notifications, delivery tracking and staff alerts (wave 3, D238, `docs/wave-3-notifications.md` 3.3): every rule the database holds, against
 * every migration applied to a real Postgres (PGlite), and the store copy of 3.6.
 */

let db: PGlite;
let store: string;
let other: string;
let account: string;
let counter = 0;
const next = () => (counter += 1);

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "ntf-a");
  other = await createInvoiceStore(db, "ntf-b");
  account = await scalar<string>("insert into commerce.accounts (email) values ('ntf-staff@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

const paid = (spec: Partial<OrderSpec> = {}, s = store) => placeOrder(db, s, { lines: [{ sku: "A", quantity: 2, unit: 10000 }, { sku: "B", quantity: 1, unit: 5000 }], shipping: 4900, ...spec });

/** A parcel, written as markSent() does: the shipment and its lines in one transaction. */
async function ship(orderId: string, lines: [string, number][], s = store): Promise<string> {
  let id = "";
  await db.transaction(async (tx) => {
    id = (await tx.query<{ id: string }>("insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values ($1, $2, 'Posten', $3) returning id", [s, orderId, `T${next()}`]))
      .rows[0].id;
    for (const [lineId, quantity] of lines) {
      await tx.query("insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) values ($1, $2, $3, $4)", [s, id, lineId, quantity]);
    }
  });
  return id;
}

/** A tracking row for a parcel, as pollTracking() keeps it; `delivered` is a verified delivered event's time. */
const track = (shipmentId: string, orderId: string, delivered: string | null, s = store) =>
  db.query(
    `insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, phase_verified, events, delivered_at)
     values ($1, $2, $3, 'bring', $4, $5, $6, $7)
     on conflict (store_id, shipment_id) do update set phase = excluded.phase, phase_verified = excluded.phase_verified, delivered_at = excluded.delivered_at`,
    [
      s,
      shipmentId,
      orderId,
      delivered ? "delivered" : "in_transit",
      true,
      JSON.stringify(delivered ? [{ at: delivered, code: "DELIVERED", phase: "delivered", verified: true, description: "Delivered, signed by Kari Nordmann", location: "OSLO" }] : []),
      delivered,
    ],
  );

const record = (orderId: string, at: string, s = store) => scalar<boolean>("select commerce.record_carrier_delivery($1, $2, $3::timestamptz)", [s, orderId, at]);

const events = (s: string, event?: string) =>
  rows<{ event: string; subject_id: string }>("select event, subject_id from commerce.store_events where store_id = $1 and ($2::text is null or event = $2) order by created_at", [s, event ?? null]);

describe("notification switches and templates (3.3 point 1)", () => {
  it("lists the catalogue's ids in its checks and refuses a required notification off", async () => {
    for (const id of SWITCHABLE_NOTIFICATIONS) {
      await db.query("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, $2, false)", [store, id]);
    }
    for (const id of REQUIRED_NOTIFICATIONS) {
      await rejects("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, $2, false)", [store, id], /notification_settings_required/);
      // On is a harmless row.
      await db.query("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, $2, true)", [store, id]);
      await rejects("update commerce.notification_settings set enabled = false where store_id = $1 and notification = $2", [store, id], /notification_settings_required/);
    }
    await rejects("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, 'draft.pay_link', false)", [store], /notification_settings_notification/);
    expect(await scalar<number>("select count(*)::int from commerce.notification_settings where store_id = $1", [store])).toBe(NOTIFICATION_IDS.length);
    await rejects("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, 'order.sent', true)", [store], /notification_settings_pkey|duplicate key/);
  });

  it("keeps a template's slots within their limits, never empty, never for the acknowledgement", async () => {
    const insert = (notification: string, locale: string, subject: string | null, heading: string | null = null, body: string | null = null) =>
      db.query("insert into commerce.email_templates (store_id, notification, locale, subject, heading, body) values ($1, $2, $3, $4, $5, $6)", [
        store,
        notification,
        locale,
        subject,
        heading,
        body,
      ]);
    await insert("order.sent", "nb", "Ordre {order_number} er sendt");
    await insert("order.sent", "sv", null, null, "Hej {customer_first_name}");
    for (const id of LOCKED_NOTIFICATIONS) await expect(insert(id, "nb", "x")).rejects.toThrow(/email_templates_notification/);
    expect(EDITABLE_NOTIFICATIONS).toContain("return.approved");
    await insert("return.approved", "en", "Approved");
    await expect(insert("order.sent", "da", null, null, null)).rejects.toThrow(/email_templates_slots/);
    await expect(insert("order.sent", "da", "")).rejects.toThrow(/email_templates_slots/);
    await expect(insert("order.sent", "da", "x".repeat(151))).rejects.toThrow(/email_templates_slots/);
    await expect(insert("order.sent", "da", null, "x".repeat(121))).rejects.toThrow(/email_templates_slots/);
    await expect(insert("order.sent", "da", null, null, "x".repeat(2001))).rejects.toThrow(/email_templates_slots/);
    await insert("order.sent", "da", "x".repeat(150), "y".repeat(120), "z".repeat(2000));
    await expect(insert("order.sent", "nb-NO", "x")).rejects.toThrow(/email_templates_locale/);
    await expect(insert("order.sent", "NB", "x")).rejects.toThrow(/email_templates_locale/);
    await expect(insert("order.sent", "nb", "again")).rejects.toThrow(/duplicate key|email_templates_pkey/);
  });
});

describe("the store events queue (3.3 points 2 and 3)", () => {
  it("queues one order.paid per order, in the paying transaction, whatever pays it twice", async () => {
    const s = await createInvoiceStore(db, "ntf-q1");
    const o = await paid({ pay: "pending-only" }, s);
    expect(await events(s)).toEqual([]);
    await db.query("select commerce.complete_order_payment($1::uuid, 'cs_again')", [o.id]);
    expect(await events(s, "order.paid")).toEqual([{ event: "order.paid", subject_id: o.id }]);
    // A retried webhook, a replayed session: the payment again, and the queue function itself again.
    await db.query("select commerce.complete_order_payment($1::uuid, 'cs_again')", [o.id]).catch(() => undefined);
    await db.query("select commerce.queue_store_event($1, 'order.paid', $2)", [s, o.id]);
    expect(await events(s, "order.paid")).toHaveLength(1);
    // A later status change (sent) is no new payment.
    await db.query("update commerce.orders set status = 'fulfilled' where id = $1", [o.id]);
    expect(await events(s, "order.paid")).toHaveLength(1);
  });

  it("queues order.paid for an order paid after it was cancelled for want of payment", async () => {
    const s = await createInvoiceStore(db, "ntf-q-cancel");
    const o = await paid({ pay: "pending-only" }, s);
    await db.query("select commerce.cancel_unpaid_order($1::uuid, 'expired')", [o.id]);
    expect(await events(s)).toEqual([]);
    await db.query("select commerce.complete_order_payment($1::uuid, 'cs_late')", [o.id]);
    expect(await events(s, "order.paid")).toEqual([{ event: "order.paid", subject_id: o.id }]);
  });

  it("queues an order inserted paid (a renewal), never a copied one, never a demo store's or starter's", async () => {
    const s = await createInvoiceStore(db, "ntf-q2");
    const o = await paid({}, s);
    expect(await events(s, "order.paid")).toEqual([{ event: "order.paid", subject_id: o.id }]);
    const copied = await paid({ copied: true }, s);
    expect((await events(s, "order.paid")).map((e) => e.subject_id)).not.toContain(copied.id);
    const renewal = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, status, email, market_code, currency, locale, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, $2, 'paid', 'renew@example.com', 'NO', 'NOK', 'nb-NO', 1000, 0, 0, 200, 1000, '{}', '{}') returning id`,
      [s, `R-${next()}`],
    );
    expect((await events(s, "order.paid")).map((e) => e.subject_id)).toContain(renewal.id);
    // A store template or a starter takes no order at all (`orders_store_open()`); the trigger leaves them out as well, should one ever be written.
    const starter = await createInvoiceStore(db, "ntf-starter");
    await db.query("update commerce.stores set starter = true where id = $1", [starter]);
    await rejects(
      `insert into commerce.orders (store_id, number, status, email, market_code, currency, locale, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, 'S-1', 'paid', 'x@example.com', 'NO', 'NOK', 'nb-NO', 1000, 0, 0, 200, 1000, '{}', '{}')`,
      [starter],
      /store|starter|open/i,
    );
    expect(await events(starter)).toEqual([]);
    expect(await scalar<string>("select prosrc from pg_proc where proname = 'store_event_order_paid'")).toContain("s.is_template OR s.starter");
  });

  it("queues a return made requested, once, and not one made in another state", async () => {
    const o = await paid();
    const r = await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', 'requested') returning id", [store, o.id]);
    expect((await events(store, "return.requested")).map((e) => e.subject_id)).toEqual([r.id]);
    const approved = await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', 'approved') returning id", [store, o.id]);
    expect((await events(store, "return.requested")).map((e) => e.subject_id)).not.toContain(approved.id);
  });

  it("refuses an unknown event and keeps the queue's fields in bounds", async () => {
    await rejects("insert into commerce.store_events (store_id, event, subject_id) values ($1, 'order.sent', gen_random_uuid())", [store], /store_events_event/);
    await rejects("insert into commerce.store_events (store_id, event, subject_id, attempts) values ($1, 'order.paid', gen_random_uuid(), 11)", [store], /store_events_attempts/);
    await rejects("insert into commerce.store_events (store_id, event, subject_id, last_error) values ($1, 'order.paid', gen_random_uuid(), $2)", [store, "e".repeat(501)], /store_events_last_error/);
  });
});

describe("holds (3.3 point 5)", () => {
  it("refuses a parcel or a handover of a held order, on every path, until it is released", async () => {
    const o = await paid();
    await db.query("update commerce.orders set held_at = now(), held_reason = 'Check the address', held_by = $2 where id = $1", [o.id, account]);
    await expect(ship(o.id, [[o.lineIds[0], 1]])).rejects.toThrow(/shipments\.held/);
    await rejects("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values ($1, $2, 'x', 'y', true)", [store, o.id], /shipments\.held/);
    await db.query("update commerce.orders set held_at = null, held_reason = null, held_by = null where id = $1", [o.id]);
    expect(await ship(o.id, [[o.lineIds[0], 1]])).toBeTruthy();
  });

  it("keeps a hold's fields together", async () => {
    const o = await paid();
    await rejects("update commerce.orders set held_reason = 'x' where id = $1", [o.id], /orders_held/);
    await rejects("update commerce.orders set held_at = now(), held_by = $2, held_by_rule = gen_random_uuid() where id = $1", [o.id, account], /orders_held/);
    await rejects("update commerce.orders set held_at = now(), held_reason = $2 where id = $1", [o.id, "r".repeat(201)], /orders_held/);
    await rejects("update commerce.orders set held_at = now(), held_reason = '' where id = $1", [o.id], /orders_held/);
    await db.query("update commerce.orders set held_at = now(), held_by_rule = gen_random_uuid(), held_reason = 'Rule' where id = $1", [o.id]);
  });
});

describe("rules (3.3 points 4 and 9)", () => {
  it("refuses a 51st rule a store, counting each store apart", async () => {
    const s = await createInvoiceStore(db, "ntf-rules");
    const insert = (st: string, n: number) =>
      db.query(`insert into commerce.order_rules (store_id, name, actions, position) values ($1, $2, '[{"kind":"notify","note":"x"}]', $3)`, [st, `Rule ${n}`, n]);
    for (let n = 0; n < RULE_LIMITS.rules; n += 1) await insert(s, n);
    await expect(insert(s, 99)).rejects.toThrow(/order_rules\.limit/);
    await insert(other, 1);
    const rule = await scalar<string>("select id from commerce.order_rules where store_id = $1 limit 1", [s]);
    await rejects("update commerce.order_rules set store_id = $2 where id = $1", [rule, other], /order_rules\.store_fixed|order_rules_store/);
  });

  it("keeps a rule's lists, match and name within bounds", async () => {
    const base = "insert into commerce.order_rules (store_id, name, match, conditions, actions) values ($1, $2, $3, $4, $5)";
    await rejects(base, [other, "R", "all", "[]", "[]"], /order_rules_lists/);
    await rejects(base, [other, "R", "all", JSON.stringify(Array.from({ length: 11 }, () => ({ kind: "is_gift" }))), '[{"kind":"notify","note":"x"}]'], /order_rules_lists/);
    await rejects(base, [other, "R", "all", "[]", JSON.stringify(Array.from({ length: 6 }, () => ({ kind: "notify", note: "x" })))], /order_rules_lists/);
    await rejects(base, [other, "R", "some", "[]", '[{"kind":"notify","note":"x"}]'], /order_rules_match/);
    await rejects(base, [other, " R", "all", "[]", '[{"kind":"notify","note":"x"}]'], /order_rules_name/);
    await rejects(base, [other, "R", "all", '{"kind":"is_gift"}', '[{"kind":"notify","note":"x"}]'], /order_rules_lists/);
  });

  it("runs a rule once per store event", async () => {
    const o = await paid();
    const event = await scalar<string>("select id from commerce.store_events where store_id = $1 and subject_id = $2", [store, o.id]);
    const rule = await scalar<string>(`insert into commerce.order_rules (store_id, name, actions) values ($1, 'Once', '[{"kind":"notify","note":"x"}]') returning id`, [store]);
    const run = (matched: boolean) =>
      db.query(
        "insert into commerce.order_rule_runs (store_id, rule_id, rule_name, rule_version, event_id, order_id, matched) values ($1, $2, 'Once', 1, $3, $4, $5) on conflict (rule_id, event_id) do nothing returning id",
        [store, rule, event, o.id, matched],
      );
    expect((await run(true)).rows).toHaveLength(1);
    expect((await run(false)).rows).toHaveLength(0);
    // A run outlives its rule, and an order of another store cannot be named.
    await db.query("delete from commerce.order_rules where id = $1", [rule]);
    expect(await scalar<number>("select count(*)::int from commerce.order_rule_runs where rule_id = $1", [rule])).toBe(1);
    await rejects(
      "insert into commerce.order_rule_runs (store_id, rule_id, rule_name, rule_version, order_id, matched) values ($1, gen_random_uuid(), 'X', 1, $2, true)",
      [other, o.id],
      /order_rule_runs_order_fk/,
    );
  });
});

describe("a delivery recorded from the carrier (3.3 point 6, 4.6)", () => {
  it("records the latest parcel's delivery once, as the carrier's, with the event", async () => {
    const o = await paid();
    await db.query("update commerce.orders set placed_at = '2026-10-01T00:00:00Z' where id = $1", [o.id]);
    const [a, b] = o.lineIds;
    const p1 = await ship(o.id, [[a, 2]]);
    const p2 = await ship(o.id, [[b, 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, o.id]);
    expect(await scalar("select status from commerce.orders where id = $1", [o.id])).toBe("fulfilled");
    await track(p1, o.id, "2026-10-13T09:00:00Z");
    // The second parcel is still on its way: nothing is recorded.
    await track(p2, o.id, null);
    expect(await record(o.id, "2026-10-13T09:00:00Z")).toBe(false);
    await track(p2, o.id, "2026-10-14T15:30:00Z");
    expect(await record(o.id, "2026-10-14T15:30:00Z")).toBe(true);
    const after = await one("select delivered_at, delivered_source from commerce.orders where id = $1", [o.id]);
    expect([new Date(after.delivered_at).toISOString(), after.delivered_source]).toEqual(["2026-10-14T15:30:00.000Z", "carrier"]);
    const event = await one("select data, actor from commerce.order_events where order_id = $1 and type = 'order.delivered'", [o.id]);
    expect(event).toMatchObject({ actor: "system", data: { by: "carrier", carrier: "bring" } });
    // Never twice, never over the date it wrote.
    expect(await record(o.id, "2026-10-15T00:00:00Z")).toBe(false);
    expect(await scalar<number>("select count(*)::int from commerce.order_events where order_id = $1 and type = 'order.delivered'", [o.id])).toBe(1);
  });

  it("never records before the order was placed, and never in the future", async () => {
    const o = await paid();
    const p = await ship(o.id, [[o.lineIds[0], 2], [o.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, o.id]);
    await track(p, o.id, "2001-01-01T00:00:00Z");
    expect(await record(o.id, "2001-01-01T00:00:00Z")).toBe(true);
    const placed = await scalar<string>("select placed_at from commerce.orders where id = $1", [o.id]);
    expect(new Date(await scalar<string>("select delivered_at from commerce.orders where id = $1", [o.id])).getTime()).toBe(new Date(placed).getTime());

    const later = await paid();
    const q = await ship(later.id, [[later.lineIds[0], 2], [later.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, later.id]);
    await track(q, later.id, "2999-01-01T00:00:00Z");
    expect(await record(later.id, "2999-01-01T00:00:00Z")).toBe(true);
    expect(await scalar<boolean>("select delivered_at <= now() from commerce.orders where id = $1", [later.id])).toBe(true);
  });

  it("keeps a date staff gave, writes nothing while partly sent, with an untracked parcel or for another store", async () => {
    const staff = await paid();
    const p = await ship(staff.id, [[staff.lineIds[0], 2], [staff.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, staff.id]);
    await db.query("update commerce.orders set delivered_at = '2026-10-12T10:00:00Z', delivered_source = 'staff' where id = $1", [staff.id]);
    await track(p, staff.id, "2026-10-14T10:00:00Z");
    expect(await record(staff.id, "2026-10-14T10:00:00Z")).toBe(false);
    expect(await scalar("select delivered_source from commerce.orders where id = $1", [staff.id])).toBe("staff");

    const partly = await paid();
    const pp = await ship(partly.id, [[partly.lineIds[0], 1]]);
    await track(pp, partly.id, "2026-10-14T10:00:00Z");
    expect(await record(partly.id, "2026-10-14T10:00:00Z")).toBe(false);

    const untracked = await paid();
    const u1 = await ship(untracked.id, [[untracked.lineIds[0], 2]]);
    await ship(untracked.id, [[untracked.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, untracked.id]);
    await track(u1, untracked.id, "2026-10-14T10:00:00Z");
    expect(await record(untracked.id, "2026-10-14T10:00:00Z")).toBe(false);

    expect(await record(staff.id, "2026-10-14T10:00:00Z", other)).toBe(false);
    // A copied order is never recorded (it has no parcels; the function refuses it anyway).
    const copied = await paid({ copied: true });
    expect(await record(copied.id, "2026-10-14T10:00:00Z")).toBe(false);
  });

  it("refuses the carrier's source written any other way, and a date changed under it", async () => {
    const o = await paid();
    await rejects("update commerce.orders set delivered_at = now(), delivered_source = 'carrier' where id = $1", [o.id], /orders\.delivered_source/);
    await rejects("update commerce.orders set delivered_source = 'staff' where id = $1", [o.id], /orders_delivered_source/);
    await rejects("update commerce.orders set delivered_at = now(), delivered_source = 'driver' where id = $1", [o.id], /orders_delivered_source/);
    await db.query("update commerce.orders set delivered_at = now(), delivered_source = 'handover' where id = $1", [o.id]);
    // A row from before the column: a date and no source, read as staff's.
    await db.query("update commerce.orders set delivered_at = now(), delivered_source = null where id = $1", [o.id]);

    const c = await paid();
    const p = await ship(c.id, [[c.lineIds[0], 2], [c.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, c.id]);
    await track(p, c.id, "2026-10-14T10:00:00Z");
    expect(await record(c.id, "2026-10-14T10:00:00Z")).toBe(true);
    await rejects("update commerce.orders set delivered_at = '2026-10-13T10:00:00Z' where id = $1", [c.id], /orders\.delivered_source/);
    // Staff correct the carrier's date: the source becomes theirs.
    await db.query("update commerce.orders set delivered_at = '2026-10-13T10:00:00Z', delivered_source = 'staff' where id = $1", [c.id]);
    await rejects("update commerce.orders set delivered_at = null where id = $1", [c.id], /orders_delivered_source/);
  });

  it("is cleared, and the parcel no longer followed, when the parcel is undone", async () => {
    const o = await paid();
    const p = await ship(o.id, [[o.lineIds[0], 2], [o.lineIds[1], 1]]);
    await db.query("select commerce.refresh_fulfilment($1, $2)", [store, o.id]);
    await track(p, o.id, "2026-10-14T10:00:00Z");
    expect(await record(o.id, "2026-10-14T10:00:00Z")).toBe(true);
    await db.query("select commerce.undo_shipment($1, $2, $3, null)", [store, p, account]);
    expect(await one("select delivered_at, delivered_source, status from commerce.orders where id = $1", [o.id])).toEqual({ delivered_at: null, delivered_source: null, status: "paid" });
    expect(await one("select stopped, stopped_at is not null as at from commerce.shipment_tracking where shipment_id = $1", [p])).toEqual({ stopped: "undone", at: true });
  });
});

describe("tracking rows", () => {
  it("keeps a phase and a stop of the lists, at most 30 events, and its parcel's own order", async () => {
    const o = await paid();
    const p = await ship(o.id, [[o.lineIds[0], 1]]);
    const base = "insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, stopped, stopped_at, events) values ($1, $2, $3, 'bring', $4, $5, $6, $7)";
    await rejects(base, [store, p, o.id, "lost", null, null, "[]"], /shipment_tracking_phase/);
    await rejects(base, [store, p, o.id, "in_transit", "bored", "2026-10-14T00:00:00Z", "[]"], /shipment_tracking_stopped/);
    await rejects(base, [store, p, o.id, "in_transit", "old", null, "[]"], /shipment_tracking_stopped/);
    await rejects(base, [store, p, o.id, "in_transit", null, null, JSON.stringify(Array.from({ length: 31 }, () => ({})))], /shipment_tracking_events/);
    await rejects(base, [other, p, o.id, "in_transit", null, null, "[]"], /shipment_tracking_shipment_fk|shipment_tracking_order_fk/);
    await db.query(base, [store, p, o.id, "in_transit", null, null, "[]"]);
  });

  it("is cleared with the order's personal data, and a person's hold reason with it", async () => {
    // An order never paid is anonymised at once by an erasure (a sale would be restricted until its keeping period ends; the patch is the same step).
    const o = await paid({ pay: false });
    const p = await ship(o.id, [[o.lineIds[0], 2], [o.lineIds[1], 1]]);
    await track(p, o.id, "2026-10-14T10:00:00Z");
    await db.query("update commerce.orders set held_at = now(), held_by = $2, held_reason = 'Call Kari first' where id = $1", [o.id, account]);
    expect(await scalar<string>("select commerce.anonymise_order($1, $2, 'erasure')", [store, o.id])).toBe("anonymised");
    expect(await scalar("select events from commerce.shipment_tracking where shipment_id = $1", [p])).toEqual([]);
    expect(await scalar("select phase from commerce.shipment_tracking where shipment_id = $1", [p])).toBe("delivered");
    expect(await scalar("select held_reason from commerce.orders where id = $1", [o.id])).toBe("[removed]");
  });

  it("keeps a rule's hold reason when the order is anonymised", async () => {
    const o = await paid({ pay: false });
    await db.query("update commerce.orders set held_at = now(), held_by_rule = gen_random_uuid(), held_reason = 'Big order' where id = $1", [o.id]);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o.id]);
    expect(await scalar("select commerce.anonymise_order($1, $2, 'erasure')", [store, o.id])).toBe("anonymised");
    expect(await scalar("select held_reason from commerce.orders where id = $1", [o.id])).toBe("Big order");
  });
});

describe("store copies (3.6)", () => {
  it("duplicate_store() copies switches, the summary choice without recipients, and rules kept to the copied products", async () => {
    const src = await createInvoiceStore(db, "ntf-dup-src");
    const keep = await scalar<string>("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'keep', 'txcd_99999999', 'standard') returning id", [src]);
    const drop = await scalar<string>(
      "insert into commerce.products (store_id, handle, tax_code, vat_category, status) values ($1, 'drop', 'txcd_99999999', 'standard', 'archived') returning id",
      [src],
    );
    await db.query("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, 'order.sent', false), ($1, 'order.parcel_delivered', true)", [src]);
    await db.query("insert into commerce.email_templates (store_id, notification, locale, subject) values ($1, 'order.sent', 'nb', 'Sendt {order_number}')", [src]);
    await db.query(
      "insert into commerce.staff_alert_settings (store_id, configured_at, summary, summary_weekday, summary_hour, contact_events, summary_last_period) values ($1, now(), 'weekly', 3, 7, '{new_order}', 'weekly:2026-10-11')",
      [src],
    );
    await db.query("insert into commerce.staff_alert_recipients (store_id, account_id, events) values ($1, $2, '{new_order}')", [src, account]);
    const tagRule = JSON.stringify([{ kind: "tag", label: "Big" }]);
    await db.query("insert into commerce.order_rules (store_id, name, conditions, actions, position) values ($1, 'Plain', '[{\"kind\":\"is_gift\"}]', $2, 0)", [src, tagRule]);
    await db.query("insert into commerce.order_rules (store_id, name, conditions, actions, position) values ($1, 'Kept', $2, $3, 1)", [
      src,
      JSON.stringify([{ kind: "has_product", productIds: [keep] }]),
      tagRule,
    ]);
    await db.query("insert into commerce.order_rules (store_id, name, conditions, actions, position) values ($1, 'Mixed', $2, $3, 2)", [
      src,
      JSON.stringify([{ kind: "has_product", productIds: [keep, drop] }, { kind: "is_gift" }]),
      tagRule,
    ]);
    await db.query("insert into commerce.order_rules (store_id, name, conditions, actions, position) values ($1, 'Gone', $2, $3, 3)", [
      src,
      JSON.stringify([{ kind: "is_gift" }, { kind: "has_product", productIds: [drop] }]),
      tagRule,
    ]);
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'ntf-dup-copy', 'Copy', $2, null, array[$3]::uuid[], null) as id", [src, account, keep]);
    expect(await rows("select notification, enabled from commerce.notification_settings where store_id = $1 order by notification", [copy])).toEqual([
      { notification: "order.parcel_delivered", enabled: true },
      { notification: "order.sent", enabled: false },
    ]);
    expect(await one("select configured_at, summary, summary_weekday, summary_hour, contact_events, summary_last_period from commerce.staff_alert_settings where store_id = $1", [copy])).toEqual({
      configured_at: null,
      summary: "weekly",
      summary_weekday: 3,
      summary_hour: 7,
      contact_events: ["new_order"],
      summary_last_period: null,
    });
    expect(await scalar<number>("select count(*)::int from commerce.staff_alert_recipients where store_id = $1", [copy])).toBe(0);
    expect(await scalar<number>("select count(*)::int from commerce.email_templates where store_id = $1", [copy])).toBe(0);
    const keepCopy = await scalar<string>("select commerce.clone_id($1, $2)", [copy, keep]);
    const rules = await rows<any>("select name, conditions, enabled, version from commerce.order_rules where store_id = $1 order by position", [copy]);
    expect(rules).toEqual([
      { name: "Plain", conditions: [{ kind: "is_gift" }], enabled: true, version: 1 },
      { name: "Kept", conditions: [{ kind: "has_product", productIds: [keepCopy] }], enabled: true, version: 1 },
      { name: "Mixed", conditions: [{ kind: "has_product", productIds: [keepCopy] }, { kind: "is_gift" }], enabled: false, version: 1 },
      { name: "Gone", conditions: [{ kind: "is_gift" }], enabled: false, version: 1 },
    ]);
    // The email texts come only when the owner ticks them.
    expect(await scalar<number>("select commerce.copy_email_templates($1, $2)", [src, copy])).toBe(1);
    expect(await one("select notification, locale, subject from commerce.email_templates where store_id = $1", [copy])).toEqual({ notification: "order.sent", locale: "nb", subject: "Sendt {order_number}" });
    expect(await scalar<number>("select commerce.copy_email_templates($1, $2)", [src, copy])).toBe(0);
    await rejects("select commerce.copy_email_templates($1, $1)", [src], /copy_email_templates\.same_store/);
  });

  it("clone_store() copies none of it", async () => {
    const src = await createInvoiceStore(db, "ntf-tpl");
    await db.query("insert into commerce.notification_settings (store_id, notification, enabled) values ($1, 'order.sent', false)", [src]);
    await db.query("insert into commerce.email_templates (store_id, notification, locale, subject) values ($1, 'order.sent', 'nb', 'Sendt')", [src]);
    await db.query(`insert into commerce.order_rules (store_id, name, actions) values ($1, 'R', '[{"kind":"notify","note":"x"}]')`, [src]);
    const { id: made } = await one<{ id: string }>("select commerce.clone_store($1, 'ntf-tpl-made', 'Made', $2) as id", [src, account]);
    for (const table of ["notification_settings", "email_templates", "order_rules", "staff_alert_settings", "staff_alert_recipients", "store_events", "shipment_tracking"]) {
      expect([table, await scalar<number>(`select count(*)::int from commerce.${table} where store_id = $1`, [made])]).toEqual([table, 0]);
    }
  });

  it("classifies every new table", () => {
    expect(COPY_RULES.notification_settings.group).toBe("settings");
    expect(COPY_RULES.email_templates.group).toBe("emails");
    expect(COPY_RULES.staff_alert_settings.group).toBe("settings");
    expect(COPY_RULES.order_rules.group).toBe("settings");
    for (const t of ["staff_alert_recipients", "store_events", "order_rule_runs", "shipment_tracking"]) expect([t, COPY_RULES[t].group]).toEqual([t, "never"]);
  });
});

describe("housekeeping", () => {
  it("turns row-level security on for every new table and fixes every new function's search path", async () => {
    const tables = ["notification_settings", "email_templates", "staff_alert_settings", "staff_alert_recipients", "store_events", "order_rules", "order_rule_runs", "shipment_tracking"];
    const rls = await rows<{ relname: string; on: boolean }>(
      "select c.relname, c.relrowsecurity as on from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = any($1) order by 1",
      [tables],
    );
    expect(rls).toHaveLength(tables.length);
    for (const r of rls) expect([r.relname, r.on]).toEqual([r.relname, true]);
    const fns = ["queue_store_event", "store_event_order_paid", "store_event_return_requested", "shipments_not_held", "order_rules_rules", "orders_delivered_source", "record_carrier_delivery", "copy_email_templates"];
    const found = await rows<{ proname: string; config: string[] | null; src: string }>(
      "select p.proname, p.proconfig as config, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'commerce' and p.proname = any($1)",
      [fns],
    );
    expect(found.map((f) => f.proname).sort()).toEqual([...fns].sort());
    for (const f of found) {
      expect([f.proname, JSON.stringify(f.config)]).toEqual([f.proname, '["search_path=\\"\\""]']);
      expect([f.proname, /\b(delete|truncate|drop)\b/i.test(f.src)]).toEqual([f.proname, false]);
    }
  });

  it("files the new audit actions where the TypeScript does", async () => {
    for (const action of ["notification.template_saved", "notification.template_reset", "notification.staff_saved", "automation.rule_saved", "automation.rules_ordered", "order.held", "order.hold_released"]) {
      expect([action, await scalar("select commerce.audit_area_of($1)", [action])]).toEqual([action, areaOfAction(action)]);
    }
    expect(areaOfAction("notification.template_saved")).toBe("settings");
    expect(areaOfAction("automation.rule_deleted")).toBe("settings");
    expect(areaOfAction("order.held")).toBe("orders");
  });

  it("describes the five plan features, in no plan yet", async () => {
    const features = await rows<{ name: string; granted: number }>(
      `select f.name, (select count(*)::int from commerce.plan_feature_grants g where g.feature_id = f.id) as granted
         from commerce.plan_features f where f.position between 421 and 425 order by f.position`,
    );
    expect(features.map((f) => f.name)).toEqual([
      "Editable customer emails",
      "Delivery tracking on the order page",
      "Delivery emails from carrier events",
      "Staff order alerts and summaries",
      "Order automation rules",
    ]);
    expect(features.every((f) => f.granted === 0)).toBe(true);
  });
});
