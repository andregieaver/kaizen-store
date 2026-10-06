import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams } from "@/lib/order-list";
import { VIEWS_MAX } from "@/lib/order-limits";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { deleteOrderView, getOrderView, listOrderViews, reorderOrderViews, saveOrderView, updateOrderView } = await import("./order-views");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { listOrdersPage, resolveOrderList } = await import("./order-list");

type Row = Record<string, unknown>;

/**
 * Saved views against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.4, V1 to V4): saved per store, the title case-insensitively unique, at most 30, the stored
 * record is only keys the address could hold, a view of another store is never found, and a view opened through the address applies its filters and its columns.
 */

afterAll(async () => {
  await closeDb();
});

describe("saving, renaming, deleting", () => {
  it("saves a list state under a name and reads it back without the cursor", async () => {
    const store = await newPlainStore("views-save");
    const actor = staffActor(store.accountId);
    const params = parseOrderListParams({ q: "vip", pay: "paid", after: "abc", cols: "order,date,total" });
    const saved = await saveOrderView(store.storeId, actor, { title: "  VIP   paid ", params });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.view.title).toBe("VIP paid");
    expect(saved.view.params).toMatchObject({ q: "vip", pay: "paid" });
    expect(saved.view.params).not.toHaveProperty("after");
    expect(saved.view.params).not.toHaveProperty("cols");
    expect(saved.view.columns?.length).toBeGreaterThan(0);
    expect((await getOrderView(store.storeId, saved.view.id))?.title).toBe("VIP paid");
    const [entry] = await db().execute<Row>(sql`select action, details from commerce.audit_log where store_id = ${store.storeId}::uuid order by id desc limit 1`);
    expect(String(entry.action)).toBe("order.view_saved");
    // The audit entry names the title and a count, never the search text.
    expect(JSON.stringify(entry.details)).not.toContain("vip\"");
    expect(entry.details).toMatchObject({ title: "VIP paid" });
  });

  it("refuses an empty, an over-long and a taken title (case-insensitively)", async () => {
    const store = await newPlainStore("views-titles");
    const actor = staffActor(store.accountId);
    const params = parseOrderListParams({ pay: "paid" });
    expect(await saveOrderView(store.storeId, actor, { title: "   ", params })).toEqual({ ok: false, problem: "title_empty" });
    expect(await saveOrderView(store.storeId, actor, { title: "x".repeat(41), params })).toEqual({ ok: false, problem: "title_too_long" });
    expect((await saveOrderView(store.storeId, actor, { title: "Late", params })).ok).toBe(true);
    expect(await saveOrderView(store.storeId, actor, { title: "LATE", params })).toEqual({ ok: false, problem: "title_taken" });
    expect(await listOrderViews(store.storeId)).toHaveLength(1);
  });

  it("allows the same title in two stores, and never finds or changes another store's view", async () => {
    const a = await newPlainStore("views-a");
    const b = await newPlainStore("views-b");
    const params = parseOrderListParams({ pay: "paid" });
    const inA = await saveOrderView(a.storeId, staffActor(a.accountId), { title: "Open", params });
    const inB = await saveOrderView(b.storeId, staffActor(b.accountId), { title: "Open", params });
    expect(inA.ok && inB.ok).toBe(true);
    if (!inA.ok || !inB.ok) return;
    expect(await getOrderView(a.storeId, inB.view.id)).toBeNull();
    expect(await updateOrderView(a.storeId, staffActor(a.accountId), inB.view.id, { title: "Hijacked" })).toEqual({ ok: false, problem: "not_found" });
    expect(await deleteOrderView(a.storeId, staffActor(a.accountId), inB.view.id)).toEqual({ ok: false, problem: "not_found" });
    expect((await getOrderView(b.storeId, inB.view.id))?.title).toBe("Open");
    expect(await getOrderView(a.storeId, "not-an-id")).toBeNull();
  });

  it("stops at 30 views a store and frees a place when one is deleted", async () => {
    const store = await newPlainStore("views-limit");
    const actor = staffActor(store.accountId);
    const params = parseOrderListParams({ pay: "paid" });
    let last = "";
    for (let i = 0; i < VIEWS_MAX; i += 1) {
      const done = await saveOrderView(store.storeId, actor, { title: `View ${i}`, params });
      expect(done.ok).toBe(true);
      if (done.ok) last = done.view.id;
    }
    expect(await saveOrderView(store.storeId, actor, { title: "One too many", params })).toEqual({ ok: false, problem: "limit" });
    expect(await deleteOrderView(store.storeId, actor, last)).toEqual({ ok: true });
    expect((await saveOrderView(store.storeId, actor, { title: "One too many", params })).ok).toBe(true);
  });

  it("renames, replaces the filters, deletes and reorders", async () => {
    const store = await newPlainStore("views-edit");
    const actor = staffActor(store.accountId);
    const first = await saveOrderView(store.storeId, actor, { title: "First", params: parseOrderListParams({ pay: "paid" }) });
    const second = await saveOrderView(store.storeId, actor, { title: "Second", params: parseOrderListParams({ ship: "to_send" }) });
    const third = await saveOrderView(store.storeId, actor, { title: "Third", params: parseOrderListParams({ tag: "vip" }) });
    if (!first.ok || !second.ok || !third.ok) throw new Error("setup");
    const renamed = await updateOrderView(store.storeId, actor, first.view.id, { title: "Renamed" });
    expect(renamed.ok && renamed.view.title).toBe("Renamed");
    expect(renamed.ok && renamed.view.params).toMatchObject({ pay: "paid" });
    // A title that another view has is refused on a rename too.
    expect(await updateOrderView(store.storeId, actor, first.view.id, { title: "second" })).toEqual({ ok: false, problem: "title_taken" });
    const replaced = await updateOrderView(store.storeId, actor, second.view.id, { params: parseOrderListParams({ gift: "1" }) });
    expect(replaced.ok && replaced.view.params).toEqual({ gift: "1" });
    const order = await reorderOrderViews(store.storeId, [third.view.id, "00000000-0000-4000-8000-000000000000", first.view.id]);
    expect(order.map((v) => v.title)).toEqual(["Third", "Renamed", "Second"]);
    expect(await deleteOrderView(store.storeId, actor, third.view.id)).toEqual({ ok: true });
    expect((await listOrderViews(store.storeId)).map((v) => v.title)).toEqual(["Renamed", "Second"]);
    expect(await deleteOrderView(store.storeId, actor, third.view.id)).toEqual({ ok: false, problem: "not_found" });
  });

  it("a stored record with a key that no longer means anything is read without it, and reported", async () => {
    const store = await newPlainStore("views-record");
    const [row] = await db().execute<Row>(sql`
      insert into commerce.order_views (store_id, title, params, position) values (${store.storeId}::uuid, 'Old', '{"pay":"paid","drop":"table"}'::jsonb, 0) returning id
    `);
    const resolved = await resolveOrderList(store.storeId, { view: String(row.id) });
    expect(resolved.params.pay).toEqual(["paid"]);
    expect(JSON.stringify(resolved.params)).not.toContain("table");
  });
});

describe("opening a view through the address", () => {
  it("applies its filters, lets the address override them, and reports a view that is not the store's", async () => {
    const store = await newPlainStore("views-open");
    const other = await newPlainStore("views-open-other");
    const actor = staffActor(store.accountId);
    await seedOrder(store, { status: "paid", captured: true, tags: ["vip"], email: "a@example.com" });
    await seedOrder(store, { status: "paid", captured: true, email: "b@example.com" });
    await seedOrder(store, { status: "fulfilled", captured: true, tags: ["vip"], email: "c@example.com" });
    const saved = await saveOrderView(store.storeId, actor, { title: "VIP", params: parseOrderListParams({ tag: "vip" }) });
    if (!saved.ok) throw new Error("setup");
    const resolved = await resolveOrderList(store.storeId, { view: saved.view.id });
    expect(resolved.view).toEqual({ id: saved.view.id, title: "VIP" });
    const context = resolved.context;
    const page = await listOrdersPage(store.storeId, resolved.params, context);
    expect(page.rows.map((r) => r.email).sort()).toEqual(["a@example.com", "c@example.com"]);
    // The address overrides a filter of the view.
    const narrowed = await resolveOrderList(store.storeId, { view: saved.view.id, status: "fulfilled" });
    expect((await listOrdersPage(store.storeId, narrowed.params, context)).rows.map((r) => r.email)).toEqual(["c@example.com"]);
    // Another store's view id finds nothing and says so; the list is the store's own default one.
    const foreign = await saveOrderView(other.storeId, staffActor(other.accountId), { title: "Theirs", params: parseOrderListParams({ tag: "vip" }) });
    if (!foreign.ok) throw new Error("setup");
    const missing = await resolveOrderList(store.storeId, { view: foreign.view.id });
    expect(missing.view).toBeNull();
    expect(missing.ignored).toContain("view");
    expect((await listOrdersPage(store.storeId, missing.params, context)).rows).toHaveLength(3);
  });

  it("drops a market the store no longer has from a view and reports it", async () => {
    const store = await newPlainStore("views-market");
    const saved = await saveOrderView(store.storeId, staffActor(store.accountId), { title: "Finland", params: parseOrderListParams({ market: "FI" }) });
    if (!saved.ok) throw new Error("setup");
    const resolved = await resolveOrderList(store.storeId, { view: saved.view.id });
    expect(resolved.params.market).toBeNull();
    expect(resolved.ignored).toContain("market");
  });
});
