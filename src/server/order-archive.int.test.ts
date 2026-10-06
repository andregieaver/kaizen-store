import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { archiveOrder, unarchiveOrder, unarchiveForReturn, archiveFinishedOrders } = await import("./order-archive");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { getOrderEvents } = await import("./orders");
const { parseOrderListParams } = await import("@/lib/order-list");

type Row = Record<string, unknown>;

/**
 * Archiving against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.3 and 4.3, A1 to A5): a visibility state only; refused for an unfinished checkout, an order
 * that still has to be sent and an open return; allowed for copied history; idempotent; one event each way; a return brings the order back; the automatic job skips what needs work.
 */

afterAll(async () => {
  await closeDb();
});

const DAY = 24 * 60 * 60 * 1000;

async function archivedAt(orderId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select archived_at from commerce.orders where id = ${orderId}::uuid`);
  return row.archived_at ? String(row.archived_at) : null;
}

describe("archiving one order", () => {
  it("archives a sent order, writes one event, and leaves every figure as it was", async () => {
    const store = await newPlainStore("arch-one");
    const order = await seedOrder(store, { status: "fulfilled", captured: true, totalMinor: 12_345 });
    const before = await db().execute<Row>(sql`select number, total_minor, status from commerce.orders where id = ${order.id}::uuid`);
    const done = await archiveOrder(store.storeId, order.id, staffActor(store.accountId));
    expect(done).toEqual({ ok: true, number: order.number });
    expect(await archivedAt(order.id)).not.toBeNull();
    const after = await db().execute<Row>(sql`select number, total_minor, status from commerce.orders where id = ${order.id}::uuid`);
    expect(after).toEqual(before);
    const events = (await getOrderEvents(store.storeId, order.id)).filter((e) => e.type.startsWith("order.") && /archived/.test(e.type));
    expect(events.map((e) => e.type)).toEqual(["order.archived"]);
    expect(events[0].actor).toBe("staff");
    // An audit entry with no personal data.
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid order by id desc limit 1`);
    expect(String(entry.action)).toMatch(/archive/);
  });

  it("refuses an archived order the second time, with no second event", async () => {
    const store = await newPlainStore("arch-twice");
    const order = await seedOrder(store, { status: "fulfilled", captured: true });
    const actor = staffActor(store.accountId);
    await archiveOrder(store.storeId, order.id, actor);
    const again = await archiveOrder(store.storeId, order.id, actor);
    expect(again).toEqual({ ok: false, reason: "already_archived", number: order.number });
    expect((await getOrderEvents(store.storeId, order.id)).filter((e) => e.type === "order.archived")).toHaveLength(1);
  });

  it("refuses an unfinished checkout, a paid order that still has to be sent, and an order with an open return", async () => {
    const store = await newPlainStore("arch-refuse");
    const actor = staffActor(store.accountId);
    const pending = await seedOrder(store, { status: "pending_payment" });
    const cancelledUnpaid = await seedOrder(store, { status: "cancelled" });
    const toSend = await seedOrder(store, { status: "paid", captured: true });
    const withReturn = await seedOrder(store, { status: "fulfilled", captured: true });
    await db().execute(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${withReturn.id}::uuid, 'return', 'requested')`);
    expect(await archiveOrder(store.storeId, pending.id, actor)).toMatchObject({ ok: false, reason: "unfinished_checkout" });
    expect(await archiveOrder(store.storeId, cancelledUnpaid.id, actor)).toMatchObject({ ok: false, reason: "unfinished_checkout" });
    expect(await archiveOrder(store.storeId, toSend.id, actor)).toMatchObject({ ok: false, reason: "needs_sending" });
    expect(await archiveOrder(store.storeId, withReturn.id, actor)).toMatchObject({ ok: false, reason: "open_return", number: withReturn.number });
    for (const o of [pending, cancelledUnpaid, toSend, withReturn]) {
      expect(await archivedAt(o.id)).toBeNull();
      expect((await getOrderEvents(store.storeId, o.id)).filter((e) => /archived/.test(e.type))).toHaveLength(0);
    }
  });

  it("archives a paid order with nothing to ship, and a cancelled paid order", async () => {
    const store = await newPlainStore("arch-allowed");
    const actor = staffActor(store.accountId);
    const download = await seedOrder(store, { status: "paid", captured: true, lines: [{ title: "Guide", sku: "G-1", physical: false }] });
    const cancelledPaid = await seedOrder(store, { status: "cancelled", captured: true });
    for (const o of [download, cancelledPaid]) expect(await archiveOrder(store.storeId, o.id, actor)).toMatchObject({ ok: true });
  });

  it("archives copied history (D129) and writes its event, and nothing else of it changes", async () => {
    const store = await newPlainStore("arch-copied");
    const copied = await seedOrder(store, { status: "paid", copied: true });
    const actor = staffActor(store.accountId);
    expect(await archiveOrder(store.storeId, copied.id, actor)).toMatchObject({ ok: true });
    expect(await archivedAt(copied.id)).not.toBeNull();
    expect((await getOrderEvents(store.storeId, copied.id)).map((e) => e.type)).toContain("order.archived");
    expect(await unarchiveOrder(store.storeId, copied.id, actor)).toMatchObject({ ok: true, changed: true });
    expect(await archivedAt(copied.id)).toBeNull();
  });

  it("refuses another store's order as not found and changes nothing there", async () => {
    const a = await newPlainStore("arch-a");
    const b = await newPlainStore("arch-b");
    const order = await seedOrder(b, { status: "fulfilled", captured: true });
    expect(await archiveOrder(a.storeId, order.id, staffActor(a.accountId))).toEqual({ ok: false, reason: "not_found", number: null });
    expect(await unarchiveOrder(a.storeId, order.id, staffActor(a.accountId))).toEqual({ ok: false, reason: "not_found", number: null });
    expect(await archivedAt(order.id)).toBeNull();
  });

  it("two archives at once write one event", async () => {
    const store = await newPlainStore("arch-race");
    const order = await seedOrder(store, { status: "fulfilled", captured: true });
    const actor = staffActor(store.accountId);
    const results = await Promise.all([archiveOrder(store.storeId, order.id, actor), archiveOrder(store.storeId, order.id, actor)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0]).toMatchObject({ reason: "already_archived" });
    expect((await getOrderEvents(store.storeId, order.id)).filter((e) => e.type === "order.archived")).toHaveLength(1);
  });
});

describe("unarchiving", () => {
  it("brings an order back, with one event, and refuses one that is not archived", async () => {
    const store = await newPlainStore("unarch");
    const order = await seedOrder(store, { status: "fulfilled", captured: true, archived: true });
    const actor = staffActor(store.accountId);
    expect(await unarchiveOrder(store.storeId, order.id, actor)).toEqual({ ok: true, number: order.number, changed: true });
    expect(await archivedAt(order.id)).toBeNull();
    expect(await unarchiveOrder(store.storeId, order.id, actor)).toEqual({ ok: false, reason: "not_archived", number: order.number });
    expect((await getOrderEvents(store.storeId, order.id)).filter((e) => e.type === "order.unarchived")).toHaveLength(1);
  });

  it("a return starting on an archived order brings it back with the note, and an order that is not archived is left alone", async () => {
    const store = await newPlainStore("unarch-return");
    const archived = await seedOrder(store, { status: "fulfilled", captured: true, archived: true });
    const plain = await seedOrder(store, { status: "fulfilled", captured: true });
    await db().transaction(async (tx) => {
      expect(await unarchiveForReturn(tx, store.storeId, archived.id)).toMatchObject({ ok: true, changed: true });
      expect(await unarchiveForReturn(tx, store.storeId, plain.id)).toMatchObject({ ok: true, changed: false });
    });
    expect(await archivedAt(archived.id)).toBeNull();
    const events = (await getOrderEvents(store.storeId, archived.id)).filter((e) => e.type === "order.unarchived");
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("system");
    expect(events[0].data).toEqual({ note: "A return was started" });
    expect((await getOrderEvents(store.storeId, plain.id)).filter((e) => /archived/.test(e.type))).toHaveLength(0);
  });
});

describe("visibility", () => {
  it("an archived order leaves the default list and shows under the archive filter, and stays searchable by number", async () => {
    const store = await newPlainStore("arch-list");
    const kept = await seedOrder(store, { status: "fulfilled", captured: true });
    const gone = await seedOrder(store, { status: "fulfilled", captured: true });
    await archiveOrder(store.storeId, gone.id, staffActor(store.accountId));
    const context = await loadOrderListContext(store.storeId);
    const list = await listOrdersPage(store.storeId, parseOrderListParams({}), context);
    expect(list.rows.map((r) => r.number)).toEqual([kept.number]);
    const archive = await listOrdersPage(store.storeId, parseOrderListParams({ show: "archived" }), context);
    expect(archive.rows.map((r) => r.number)).toEqual([gone.number]);
    const found = await listOrdersPage(store.storeId, parseOrderListParams({ q: gone.number }), context);
    expect(found.rows.map((r) => r.number)).toContain(gone.number);
  });

  it("the database refuses to archive an unpaid order directly", async () => {
    const store = await newPlainStore("arch-db");
    const order = await seedOrder(store, { status: "pending_payment" });
    await expect(db().execute(sql`update commerce.orders set archived_at = now() where id = ${order.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/archiv/i) } });
  });
});

describe("automatic archiving", () => {
  async function setDays(storeId: string, days: number | null) {
    await db().execute(sql`
      insert into commerce.order_settings (store_id, auto_archive_days) values (${storeId}::uuid, ${days})
      on conflict (store_id) do update set auto_archive_days = excluded.auto_archive_days
    `);
  }

  it("does nothing while the setting is off", async () => {
    const store = await newPlainStore("auto-off");
    const order = await seedOrder(store, { status: "fulfilled", captured: true, placedAt: new Date(Date.now() - 400 * DAY) });
    const run = await archiveFinishedOrders(new Date(), { storeId: store.storeId });
    expect(run).toEqual({ stores: 0, archived: 0 });
    expect(await archivedAt(order.id)).toBeNull();
  });

  it("archives old finished orders only, skips what needs work, copied history and recent ones, and is idempotent", async () => {
    const store = await newPlainStore("auto-on");
    await setDays(store.storeId, 30);
    const old = new Date(Date.now() - 90 * DAY);
    const sent = await seedOrder(store, { status: "fulfilled", captured: true, placedAt: old });
    const download = await seedOrder(store, { status: "paid", captured: true, placedAt: old, lines: [{ title: "Guide", sku: "G-2", physical: false }] });
    const toSend = await seedOrder(store, { status: "paid", captured: true, placedAt: old });
    const unpaid = await seedOrder(store, { status: "pending_payment", placedAt: old });
    const recent = await seedOrder(store, { status: "fulfilled", captured: true, placedAt: new Date(Date.now() - 5 * DAY) });
    const copied = await seedOrder(store, { status: "paid", copied: true, placedAt: old });
    const returning = await seedOrder(store, { status: "fulfilled", captured: true, placedAt: old });
    await db().execute(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${returning.id}::uuid, 'return', 'approved')`);
    const run = await archiveFinishedOrders(new Date(), { storeId: store.storeId });
    expect(run).toEqual({ stores: 1, archived: 2 });
    expect(await archivedAt(sent.id)).not.toBeNull();
    expect(await archivedAt(download.id)).not.toBeNull();
    for (const o of [toSend, unpaid, recent, copied, returning]) expect(await archivedAt(o.id)).toBeNull();
    const events = (await getOrderEvents(store.storeId, sent.id)).filter((e) => e.type === "order.archived");
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("system");
    const again = await archiveFinishedOrders(new Date(), { storeId: store.storeId });
    expect(again).toEqual({ stores: 0, archived: 0 });
    // The audit entry holds counts only.
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action like '%archive%' order by id desc limit 1`);
    expect(JSON.stringify(entry.details)).not.toContain(sent.number);
  });

  it("a store that is not open is left alone, and one store's setting never touches another's orders", async () => {
    const closed = await newPlainStore("auto-closed");
    const other = await newPlainStore("auto-other");
    await setDays(closed.storeId, 20);
    const old = new Date(Date.now() - 90 * DAY);
    const a = await seedOrder(closed, { status: "fulfilled", captured: true, placedAt: old });
    const b = await seedOrder(other, { status: "fulfilled", captured: true, placedAt: old });
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${closed.storeId}::uuid`);
    await archiveFinishedOrders(new Date());
    expect(await archivedAt(a.id)).toBeNull();
    expect(await archivedAt(b.id)).toBeNull();
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${closed.storeId}::uuid`);
  });
});
