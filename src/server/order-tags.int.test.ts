import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { TAGS_PER_ORDER } from "@/lib/order-limits";
import { normaliseTag, parseTagList, tagsOf } from "@/lib/order-tags";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { changeOrderTags, getOrderTags, pruneAnonymisedOrderTags, tagSuggestions, tagsForOrders } = await import("./order-tags");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { getOrderEvents } = await import("./orders");

type Row = Record<string, unknown>;

/**
 * Order tags against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 6.2, T1, T2 and T4): added and removed on one order, per store, case-insensitive, 40 characters, 250 per order,
 * idempotent, one history event whose note says it in words, filtered in the list, found by search, carried on copied history, and gone with an anonymised order.
 */

afterAll(async () => {
  await closeDb();
});

const add = (text: string) => parseTagList(text).tags;

describe("adding and removing", () => {
  it("adds tags to an order, the first spelling stays, and VIP then vip is one tag", async () => {
    const store = await newPlainStore("tags");
    const order = await seedOrder(store);
    const actor = staffActor(store.accountId);
    const first = await changeOrderTags(store.storeId, order.id, { add: add("VIP, Late") }, actor);
    expect(first.ok && first.change.added.map((t) => t.label)).toEqual(["VIP", "Late"]);
    const again = await changeOrderTags(store.storeId, order.id, { add: add("vip") }, actor);
    expect(again.ok && again.change.alreadyHad.map((t) => t.label)).toEqual(["VIP"]);
    expect(again.ok && again.change.changed).toBe(false);
    expect((await getOrderTags(store.storeId, order.id)).map((t) => t.label).sort()).toEqual(["Late", "VIP"]);
    const removed = await changeOrderTags(store.storeId, order.id, { remove: add("LATE, never-there") }, actor);
    expect(removed.ok && removed.change.removed.map((t) => t.label)).toEqual(["Late"]);
    expect(removed.ok && removed.change.didNotHave.map((t) => t.label)).toEqual(["never-there"]);
    expect((await getOrderTags(store.storeId, order.id)).map((t) => t.label)).toEqual(["VIP"]);
  });

  it("writes one history event per change with the words in its note and nothing else, and none when nothing changed", async () => {
    const store = await newPlainStore("tags-events");
    const order = await seedOrder(store);
    const actor = staffActor(store.accountId);
    await changeOrderTags(store.storeId, order.id, { add: add("vip, late") }, actor);
    await changeOrderTags(store.storeId, order.id, { add: add("vip") }, actor);
    await changeOrderTags(store.storeId, order.id, { add: add("new"), remove: add("late") }, actor);
    const events = (await getOrderEvents(store.storeId, order.id)).filter((e) => e.type === "order.tags_changed");
    expect(events.map((e) => e.data)).toEqual([{ note: "Added: vip, late" }, { note: "Added: new. Removed: late" }]);
    expect(events.every((e) => e.actor === "staff")).toBe(true);
    // The audit entry holds counts, never the tags.
    const audit = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.tags_changed' order by id`);
    expect(audit.map((a) => a.details)).toEqual([{ added: 2, removed: 0 }, { added: 1, removed: 1 }]);
  });

  it("keeps the same tag text in two stores as two independent tags, with their own counts and suggestions", async () => {
    const [a, b] = [await newPlainStore("tags-a"), await newPlainStore("tags-b")];
    const [orderA1, orderA2, orderB] = [await seedOrder(a), await seedOrder(a), await seedOrder(b)];
    await changeOrderTags(a.storeId, orderA1.id, { add: add("vip") }, staffActor(a.accountId));
    await changeOrderTags(a.storeId, orderA2.id, { add: add("VIP") }, staffActor(a.accountId));
    await changeOrderTags(b.storeId, orderB.id, { add: add("vip, only-b") }, staffActor(b.accountId));
    expect(await tagSuggestions(a.storeId)).toEqual([{ key: "vip", label: "vip", orders: 2 }]);
    expect((await tagSuggestions(b.storeId)).map((s) => [s.key, s.orders]).sort()).toEqual([["only-b", 1], ["vip", 1]]);
    // A tag of one store never reaches another store's order, even with its id.
    const cross = await changeOrderTags(b.storeId, orderA1.id, { add: add("intruder") }, staffActor(b.accountId));
    expect(cross).toEqual({ ok: false, problem: "not_found" });
    expect((await getOrderTags(a.storeId, orderA1.id)).map((t) => t.key)).toEqual(["vip"]);
    expect((await tagsForOrders(b.storeId, [orderA1.id])).size).toBe(0);
  });

  it("refuses a 251st tag for that order and goes on with the others; two writers at once cannot both take the last place", async () => {
    const store = await newPlainStore("tags-limit");
    const order = await seedOrder(store);
    const other = await seedOrder(store);
    const actor = staffActor(store.accountId);
    const many = Array.from({ length: TAGS_PER_ORDER - 1 }, (_, i) => `tag-${i}`);
    await db().execute(sql`
      insert into commerce.order_tags (store_id, order_id, key, label)
      select ${store.storeId}::uuid, ${order.id}::uuid, t, t from unnest(${`{${many.join(",")}}`}::text[]) as t
    `);
    // Two staff add different tags at the same moment: one gets the 250th place, the other is refused.
    const [x, y] = await Promise.all([
      changeOrderTags(store.storeId, order.id, { add: add("racer-x") }, actor),
      changeOrderTags(store.storeId, order.id, { add: add("racer-y") }, actor),
    ]);
    const outcomes = [x, y].map((r) => (r.ok ? { added: r.change.added.length, refused: r.change.refused.length } : null));
    expect(outcomes.filter((o) => o?.added === 1)).toHaveLength(1);
    expect(outcomes.filter((o) => o?.refused === 1)).toHaveLength(1);
    expect(await getOrderTags(store.storeId, order.id)).toHaveLength(TAGS_PER_ORDER);
    // At the limit a new tag is reported for that order alone: another order takes it.
    const full = await changeOrderTags(store.storeId, order.id, { add: add("one-more") }, actor);
    expect(full.ok && full.change.refused.map((t) => t.label)).toEqual(["one-more"]);
    const fine = await changeOrderTags(store.storeId, other.id, { add: add("one-more") }, actor);
    expect(fine.ok && fine.change.added).toHaveLength(1);
    // Adding a tag the full order already has is not an error.
    const same = await changeOrderTags(store.storeId, order.id, { add: add("TAG-3") }, actor);
    expect(same.ok && same.change.alreadyHad).toHaveLength(1);
    // The database holds the limit too, whatever the code does.
    await expect(db().execute(sql`insert into commerce.order_tags (store_id, order_id, key, label) values (${store.storeId}::uuid, ${order.id}::uuid, 'overflow', 'overflow')`)).rejects.toThrow();
  });

  it("holds the text rules: 40 characters (an emoji is one), no comma or control character", () => {
    expect(normaliseTag("x".repeat(40)).ok).toBe(true);
    expect(normaliseTag("x".repeat(41))).toEqual({ ok: false, problem: "too_long" });
    expect(normaliseTag("🎁".repeat(40)).ok).toBe(true);
    expect(normaliseTag("a,b")).toEqual({ ok: false, problem: "invalid_chars" });
    expect(tagsOf(["ok", "no,pe"]).problems).toHaveLength(1);
  });
});

describe("in the list, on history and on copied orders", () => {
  it("filters by tag, shows the tag on the row, and finds it by search", async () => {
    const store = await newPlainStore("tags-list");
    const [one, two, none] = [await seedOrder(store), await seedOrder(store), await seedOrder(store)];
    const actor = staffActor(store.accountId);
    await changeOrderTags(store.storeId, one.id, { add: add("VIP, late") }, actor);
    await changeOrderTags(store.storeId, two.id, { add: add("vip") }, actor);
    const ctx = await loadOrderListContext(store.storeId);
    const run = async (query: string) => (await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams(query)), ctx, 50)).rows;
    expect((await run("tag=VIP")).map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
    expect((await run("tag=vip,late")).map((r) => r.id)).toEqual([one.id]);
    expect((await run("q=late")).map((r) => r.id)).toEqual([one.id]);
    const row = (await run("tag=late"))[0];
    expect(row.tags.map((t) => t.label).sort()).toEqual(["VIP", "late"]);
    expect((await run("")).find((r) => r.id === none.id)?.tags).toEqual([]);
  });

  it("tags copied history (D129) and writes its event, while every other write to it is still refused", async () => {
    const store = await newPlainStore("tags-copied");
    const copied = await seedOrder(store, { copied: true });
    const done = await changeOrderTags(store.storeId, copied.id, { add: add("reviewed") }, staffActor(store.accountId));
    expect(done.ok && done.change.added).toHaveLength(1);
    const events = (await getOrderEvents(store.storeId, copied.id)).map((e) => e.type);
    expect(events).toContain("order.tags_changed");
    await expect(db().execute(sql`update commerce.orders set email = 'changed@example.com' where id = ${copied.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/copied/) } });
  });

  it("is deleted with an anonymised order, and its history note goes with the person's data", async () => {
    const store = await newPlainStore("tags-erased");
    const order = await seedOrder(store, { status: "pending_payment", email: "gone@person.test" });
    await changeOrderTags(store.storeId, order.id, { add: add("asked-by-gone-person") }, staffActor(store.accountId));
    await db().execute(sql`select commerce.anonymise_order(${store.storeId}::uuid, ${order.id}::uuid, 'erasure')`);
    expect(await getOrderTags(store.storeId, order.id)).toHaveLength(1);
    expect(await pruneAnonymisedOrderTags()).toBeGreaterThanOrEqual(1);
    expect(await getOrderTags(store.storeId, order.id)).toEqual([]);
    const [event] = (await getOrderEvents(store.storeId, order.id)).filter((e) => e.type === "order.tags_changed");
    expect(JSON.stringify(event.data)).not.toContain("asked-by-gone-person");
  });
});
