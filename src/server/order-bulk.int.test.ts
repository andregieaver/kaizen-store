import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { BULK_MAX, BULK_PRINT_MAX, TAGS_PER_ORDER } from "@/lib/order-limits";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { runBulk } = await import("./order-bulk");
const { packingSlipData } = await import("./packing-slips");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { getOrderTags } = await import("./order-tags");
const { getOrderEvents } = await import("./orders");

type Row = Record<string, unknown>;

/**
 * Bulk actions and packing slips against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.5, 2.5, B1 to B6): each order in its own transaction so one refusal never
 * undoes the others; the answer says who and why; ids of another store are `not_found` without a number; duplicates collapse; "all matching" runs the list's own query on the server;
 * limits; one audit entry per batch with counts only; mark as sent never charges and tells the customers only when asked; a closed store may tag and archive but not send.
 */

afterAll(async () => {
  await closeDb();
});

const tags = (text: string) => text.split(",").map((t) => t.trim());

async function auditRows(storeId: string, action: string): Promise<Row[]> {
  return db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action} order by id`);
}

describe("tags in bulk", () => {
  it("adds tags to many orders, one event each, one audit entry with counts and no tags or numbers", async () => {
    const store = await newPlainStore("bulk-tag");
    const actor = staffActor(store.accountId);
    const a = await seedOrder(store);
    const b = await seedOrder(store);
    const outcome = await runBulk(store.storeId, actor, { action: "add_tags", selection: { kind: "ids", ids: [a.id, b.id, a.id] }, tags: tags("Wholesale, Rush") });
    expect(outcome).toEqual({ ok: true, result: { action: "add_tags", requested: 2, applied: 2, refused: [] } });
    for (const o of [a, b]) {
      expect((await getOrderTags(store.storeId, o.id)).map((t) => t.label).sort()).toEqual(["Rush", "Wholesale"]);
      expect((await getOrderEvents(store.storeId, o.id)).filter((e) => e.type === "order.tags_changed")).toHaveLength(1);
    }
    const entries = await auditRows(store.storeId, "order.bulk_tagged");
    expect(entries).toHaveLength(1);
    const text = JSON.stringify(entries[0].details);
    expect(text).not.toContain(a.number);
    expect(text).not.toContain("Wholesale");
    expect(entries[0].details).toMatchObject({ requested: 2, applied: 2, refused: 0 });
    // Again: nothing to change, still applied, no second event.
    const again = await runBulk(store.storeId, actor, { action: "add_tags", selection: { kind: "ids", ids: [a.id] }, tags: tags("rush") });
    expect(again).toMatchObject({ ok: true, result: { applied: 1 } });
    expect((await getOrderEvents(store.storeId, a.id)).filter((e) => e.type === "order.tags_changed")).toHaveLength(1);
    // Removing.
    const removed = await runBulk(store.storeId, actor, { action: "remove_tags", selection: { kind: "ids", ids: [a.id, b.id] }, tags: tags("RUSH") });
    expect(removed).toMatchObject({ ok: true, result: { applied: 2 } });
    expect((await getOrderTags(store.storeId, b.id)).map((t) => t.label)).toEqual(["Wholesale"]);
  });

  it("refuses one order at its tag limit and applies the rest", async () => {
    const store = await newPlainStore("bulk-taglimit");
    const full = await seedOrder(store);
    const room = await seedOrder(store);
    await db().execute(sql`
      insert into commerce.order_tags (store_id, order_id, key, label)
      select ${store.storeId}::uuid, ${full.id}::uuid, 'tag-' || g, 'tag-' || g from generate_series(1, ${TAGS_PER_ORDER}) g
    `);
    const outcome = await runBulk(store.storeId, staffActor(store.accountId), { action: "add_tags", selection: { kind: "ids", ids: [full.id, room.id] }, tags: tags("extra") });
    expect(outcome.ok && outcome.result.applied).toBe(1);
    expect(outcome.ok && outcome.result.refused).toEqual([{ id: full.id, number: full.number, reason: "tag_limit" }]);
    expect((await getOrderTags(store.storeId, room.id)).map((t) => t.label)).toEqual(["extra"]);
  });

  it("refuses a request that cannot be run before anything runs", async () => {
    const store = await newPlainStore("bulk-requests");
    const actor = staffActor(store.accountId);
    const order = await seedOrder(store);
    const ids = { kind: "ids" as const, ids: [order.id] };
    expect(await runBulk(store.storeId, actor, { action: "explode" as never, selection: ids })).toEqual({ ok: false, problem: "unknown_action" });
    expect(await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "ids", ids: [] } })).toEqual({ ok: false, problem: "empty" });
    expect(await runBulk(store.storeId, actor, { action: "add_tags", selection: ids })).toEqual({ ok: false, problem: "no_tags" });
    expect(await runBulk(store.storeId, actor, { action: "add_tags", selection: ids, tags: ["bad,tag"] })).toEqual({ ok: false, problem: "invalid_tag" });
    expect(await runBulk(store.storeId, actor, { action: "add_tags", selection: ids, tags: ["x".repeat(41)] })).toEqual({ ok: false, problem: "invalid_tag" });
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "ids", ids: many } })).toEqual({ ok: false, problem: "too_many" });
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `t${i}`);
    expect(await runBulk(store.storeId, actor, { action: "add_tags", selection: ids, tags: fiftyOne })).toEqual({ ok: false, problem: "too_many_tags" });
    expect(await getOrderTags(store.storeId, order.id)).toEqual([]);
    expect(await auditRows(store.storeId, "order.bulk_tagged")).toHaveLength(0);
  });
});

describe("another store's orders", () => {
  it("are not found, with no number, and nothing about them changes", async () => {
    const mine = await newPlainStore("bulk-mine");
    const theirs = await newPlainStore("bulk-theirs");
    const own = await seedOrder(mine, { status: "fulfilled", captured: true });
    const foreign = await seedOrder(theirs, { status: "fulfilled", captured: true });
    const outcome = await runBulk(mine.storeId, staffActor(mine.accountId), {
      action: "archive",
      selection: { kind: "ids", ids: [own.id, foreign.id, "not-a-uuid", "00000000-0000-4000-8000-000000000000"] },
    });
    expect(outcome.ok && outcome.result.applied).toBe(1);
    expect(outcome.ok && outcome.result.refused).toEqual([
      { id: foreign.id, number: null, reason: "not_found" },
      { id: "not-a-uuid", number: null, reason: "not_found" },
      { id: "00000000-0000-4000-8000-000000000000", number: null, reason: "not_found" },
    ]);
    const [row] = await db().execute<Row>(sql`select archived_at from commerce.orders where id = ${foreign.id}::uuid`);
    expect(row.archived_at).toBeNull();
    expect((await getOrderEvents(theirs.storeId, foreign.id)).filter((e) => /archived/.test(e.type))).toHaveLength(0);
    for (const action of ["add_tags", "mark_sent", "print_slips"] as const) {
      const r = await runBulk(mine.storeId, staffActor(mine.accountId), { action, selection: { kind: "ids", ids: [foreign.id] }, tags: tags("x") });
      expect(r.ok && r.result.applied).toBe(0);
      expect(r.ok && r.result.refused).toEqual([{ id: foreign.id, number: null, reason: "not_found" }]);
    }
    expect(await getOrderTags(theirs.storeId, foreign.id)).toEqual([]);
  });
});

describe("archive and unarchive in bulk", () => {
  it("applies to the orders that may be archived and names why the others were refused, each in its own transaction", async () => {
    const store = await newPlainStore("bulk-archive");
    const actor = staffActor(store.accountId);
    const ok1 = await seedOrder(store, { status: "fulfilled", captured: true });
    const ok2 = await seedOrder(store, { status: "paid", captured: true, lines: [{ title: "Guide", sku: "G-9", physical: false }] });
    const toSend = await seedOrder(store, { status: "paid", captured: true });
    const unpaid = await seedOrder(store, { status: "pending_payment" });
    const done = await seedOrder(store, { status: "fulfilled", captured: true, archived: true });
    const numbers = [ok1, ok2, toSend, unpaid, done];
    const before = await db().execute<Row>(sql`select number from commerce.orders where store_id = ${store.storeId}::uuid order by number`);
    const outcome = await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "ids", ids: numbers.map((o) => o.id) } });
    expect(outcome.ok && outcome.result).toMatchObject({ requested: 5, applied: 2 });
    const reasons = Object.fromEntries((outcome.ok ? outcome.result.refused : []).map((r) => [r.number, r.reason]));
    expect(reasons).toEqual({ [toSend.number]: "needs_sending", [unpaid.number]: "unfinished_checkout", [done.number]: "already_archived" });
    // The numbers are untouched.
    expect(await db().execute<Row>(sql`select number from commerce.orders where store_id = ${store.storeId}::uuid order by number`)).toEqual(before);
    const un = await runBulk(store.storeId, actor, { action: "unarchive", selection: { kind: "ids", ids: [ok1.id, toSend.id] } });
    expect(un.ok && un.result.applied).toBe(1);
    expect(un.ok && un.result.refused).toEqual([{ id: toSend.id, number: toSend.number, reason: "not_archived" }]);
    expect(await auditRows(store.storeId, "order.bulk_archived")).toHaveLength(1);
    expect(await auditRows(store.storeId, "order.bulk_unarchived")).toHaveLength(1);
  });

  it("archives copied history", async () => {
    const store = await newPlainStore("bulk-archive-copied");
    const copied = await seedOrder(store, { status: "paid", copied: true });
    const r = await runBulk(store.storeId, staffActor(store.accountId), { action: "archive", selection: { kind: "ids", ids: [copied.id] } });
    expect(r.ok && r.result.applied).toBe(1);
  });
});

describe("all matching", () => {
  it("runs the list's own query on the server and acts on exactly those orders", async () => {
    const store = await newPlainStore("bulk-matching");
    const actor = staffActor(store.accountId);
    const vip = await seedOrder(store, { status: "fulfilled", captured: true, tags: ["vip"] });
    const other = await seedOrder(store, { status: "fulfilled", captured: true });
    const outcome = await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "matching", params: parseOrderListParams({ tag: "vip" }) } });
    expect(outcome).toMatchObject({ ok: true, result: { requested: 1, applied: 1 } });
    const rows = await db().execute<Row>(sql`select id, archived_at from commerce.orders where store_id = ${store.storeId}::uuid`);
    const archived = Object.fromEntries(rows.map((r) => [String(r.id), r.archived_at !== null]));
    expect(archived[vip.id]).toBe(true);
    expect(archived[other.id]).toBe(false);
    // Nothing matches: refused as empty.
    expect(await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "matching", params: parseOrderListParams({ tag: "nobody" }) } })).toEqual({ ok: false, problem: "empty" });
  });

  it("refuses more than 250 matching orders and runs 250 exactly", { timeout: 180_000 }, async () => {
    const store = await newPlainStore("bulk-matching-many");
    const actor = staffActor(store.accountId);
    for (let i = 0; i < BULK_MAX + 1; i += 1) await seedOrder(store, { status: "fulfilled", captured: false, tags: ["mass"] });
    const over = await runBulk(store.storeId, actor, { action: "add_tags", selection: { kind: "matching", params: parseOrderListParams({ tag: "mass" }) }, tags: tags("more") });
    expect(over).toEqual({ ok: false, problem: "too_many" });
    // One tag fewer and it runs.
    const [one] = await db().execute<Row>(sql`select order_id from commerce.order_tags where store_id = ${store.storeId}::uuid and key = 'mass' limit 1`);
    await db().execute(sql`delete from commerce.order_tags where store_id = ${store.storeId}::uuid and order_id = ${String(one.order_id)}::uuid`);
    const fits = await runBulk(store.storeId, actor, { action: "add_tags", selection: { kind: "matching", params: parseOrderListParams({ tag: "mass" }) }, tags: tags("more") });
    expect(fits).toMatchObject({ ok: true, result: { requested: BULK_MAX, applied: BULK_MAX } });
  });
});

describe("mark as sent in bulk", () => {
  it("sends paid orders with something to ship and names why each other order was refused", async () => {
    const store = await newPlainStore("bulk-send");
    const actor = staffActor(store.accountId);
    const a = await seedOrder(store, { status: "paid", captured: true });
    const b = await seedOrder(store, { status: "paid", captured: true });
    const sent = await seedOrder(store, { status: "fulfilled", captured: true });
    const unpaid = await seedOrder(store, { status: "pending_payment" });
    const download = await seedOrder(store, { status: "paid", captured: true, lines: [{ title: "Guide", sku: "G-3", physical: false }] });
    const copied = await seedOrder(store, { status: "paid", copied: true });
    const waiting = await seedOrder(store, { status: "paid", captured: true, lines: [{ title: "Mug", sku: "M-9", quantity: 2, backorder: 2 }] });
    const outcome = await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [a, b, sent, unpaid, download, copied, waiting].map((o) => o.id) } });
    expect(outcome.ok && outcome.result).toMatchObject({ requested: 7, applied: 2, emailed: 0 });
    const reasons = Object.fromEntries((outcome.ok ? outcome.result.refused : []).map((r) => [r.number, r.reason]));
    expect(reasons).toEqual({
      [sent.number]: "already_sent",
      [unpaid.number]: "unpaid",
      [download.number]: "nothing_to_send",
      [copied.number]: "copied",
      [waiting.number]: "waiting_for_stock",
    });
    const rows = await db().execute<Row>(sql`select id, status from commerce.orders where store_id = ${store.storeId}::uuid`);
    const status = Object.fromEntries(rows.map((r) => [String(r.id), String(r.status)]));
    expect(status[a.id]).toBe("fulfilled");
    expect(status[b.id]).toBe("fulfilled");
    expect(status[waiting.id]).toBe("paid");
    expect(status[unpaid.id]).toBe("pending_payment");
    const shipments = await db().execute<Row>(sql`select order_id from commerce.shipments where store_id = ${store.storeId}::uuid and order_id = any(array[${a.id}, ${b.id}]::uuid[])`);
    expect(shipments).toHaveLength(2);
    // The batch never charges or refunds: no payment or refund row was added.
    const [pay] = await db().execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${store.storeId}::uuid`);
    expect(pay.n).toBe(5);
    expect(await auditRows(store.storeId, "order.bulk_sent")).toHaveLength(1);
    // Running it again on the same orders refuses them as already sent.
    const again = await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [a.id, b.id] } });
    expect(again.ok && again.result.applied).toBe(0);
    expect(again.ok && again.result.refused.map((r) => r.reason)).toEqual(["already_sent", "already_sent"]);
  });

  it("tells the customers only when asked", async () => {
    const store = await newPlainStore("bulk-notify");
    const actor = staffActor(store.accountId);
    const quiet = await seedOrder(store, { status: "paid", captured: true, email: "quiet@example.com" });
    const loud = await seedOrder(store, { status: "paid", captured: true, email: "loud@example.com" });
    await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [quiet.id] } });
    const quietMails = await db().execute<Row>(sql`select 1 from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${quiet.id}::uuid and kind like '%shipped%'`);
    expect(quietMails).toHaveLength(0);
    const outcome = await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [loud.id] }, notify: true });
    expect(outcome.ok && outcome.result.applied).toBe(1);
    expect(outcome.ok && outcome.result.emailed).toBe(1);
  });

  it("is refused in a store that is not open, while tagging and archiving still work", async () => {
    const store = await newPlainStore("bulk-closed");
    const actor = staffActor(store.accountId);
    const order = await seedOrder(store, { status: "paid", captured: true });
    const old = await seedOrder(store, { status: "fulfilled", captured: true });
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    try {
      const sent = await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [order.id] } });
      expect(sent.ok && sent.result.refused).toEqual([{ id: order.id, number: order.number, reason: "store_closed" }]);
      expect(await runBulk(store.storeId, actor, { action: "add_tags", selection: { kind: "ids", ids: [order.id] }, tags: tags("held") })).toMatchObject({ ok: true, result: { applied: 1 } });
      expect(await runBulk(store.storeId, actor, { action: "archive", selection: { kind: "ids", ids: [old.id] } })).toMatchObject({ ok: true, result: { applied: 1 } });
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    }
  });
});

describe("packing slips", () => {
  it("prints slips with no prices, in the order's language, for physical lines only, and leaves out copied history and downloads", async () => {
    const store = await newPlainStore("slips");
    const gift = await seedOrder(store, {
      status: "paid",
      captured: true,
      market: "SE",
      name: "Anna Svensson",
      totalMinor: 99_900,
      lines: [
        { title: "Mug White", sku: "MUG-1", quantity: 2, physical: true },
        { title: "Guide", sku: "G-1", physical: false },
      ],
      gift: { to: "Lena", from: "Anna", message: "Grattis!\nMed kärlek" },
    });
    const plain = await seedOrder(store, { status: "paid", captured: true });
    const download = await seedOrder(store, { status: "paid", captured: true, lines: [{ title: "Guide", sku: "G-2", physical: false }] });
    const copied = await seedOrder(store, { status: "paid", copied: true });
    const set = await packingSlipData(store.storeId, [plain.id, gift.id, download.id, copied.id, "00000000-0000-4000-8000-000000000000", gift.id]);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.slips.map((s) => s.number)).toEqual([plain.number, gift.number]);
    expect(set.skipped).toEqual([
      { id: download.id, number: download.number, reason: "nothing_to_ship" },
      { id: copied.id, number: copied.number, reason: "copied" },
      { id: "00000000-0000-4000-8000-000000000000", number: null, reason: "not_found" },
    ]);
    const slip = set.slips[1];
    expect(slip.lang).toBe("sv");
    expect(slip.lines).toEqual([{ quantity: 2, title: "Mug White", sku: "MUG-1" }]);
    expect(slip.shipTo).toMatchObject({ name: "Anna Svensson", city: "Oslo" });
    expect(slip.gift).toMatchObject({ to: "Lena", from: "Anna", message: "Grattis!\nMed kärlek" });
    expect(set.slips[0].gift).toBeNull();
    // No price, VAT, total, payment or discount anywhere in what a slip is made from.
    const text = JSON.stringify(slip);
    expect(text).not.toMatch(/99900|99_900|total|tax|vat|price|discount|payment|invoice/i);
  });

  it("another store's order is not found, and the limits are enforced", async () => {
    const mine = await newPlainStore("slips-mine");
    const theirs = await newPlainStore("slips-theirs");
    const foreign = await seedOrder(theirs, { status: "paid", captured: true });
    const set = await packingSlipData(mine.storeId, [foreign.id]);
    expect(set.ok && set.slips).toEqual([]);
    expect(set.ok && set.skipped).toEqual([{ id: foreign.id, number: null, reason: "not_found" }]);
    expect(await packingSlipData(mine.storeId, [])).toEqual({ ok: false, problem: "empty" });
    const many = Array.from({ length: BULK_PRINT_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await packingSlipData(mine.storeId, many)).toEqual({ ok: false, problem: "too_many" });
    const viaBulk = await runBulk(mine.storeId, staffActor(mine.accountId), { action: "print_slips", selection: { kind: "ids", ids: many } });
    expect(viaBulk).toEqual({ ok: false, problem: "too_many" });
  });

  it("printing changes nothing and leaves no audit entry", async () => {
    const store = await newPlainStore("slips-erased");
    const order = await seedOrder(store, { status: "paid", captured: true });
    const before = await db().execute<Row>(sql`select * from commerce.orders where id = ${order.id}::uuid`);
    const set = await packingSlipData(store.storeId, [order.id]);
    expect(set.ok && set.slips).toHaveLength(1);
    expect(await db().execute<Row>(sql`select * from commerce.orders where id = ${order.id}::uuid`)).toEqual(before);
    const printed = await runBulk(store.storeId, staffActor(store.accountId), { action: "print_slips", selection: { kind: "ids", ids: [order.id] } });
    expect(printed).toMatchObject({ ok: true, result: { applied: 1 } });
    // Printing is a read: it leaves no audit entry.
    expect(await auditRows(store.storeId, "order.bulk_printed")).toHaveLength(0);
  });
});
