import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
const fake = vi.hoisted(() => {
  const refunds: Record<string, unknown>[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    refunds: {
      create: async (params: Record<string, unknown>) => {
        refunds.push(params);
        return { id: `re_h_${refunds.length}_${Math.random().toString(36).slice(2, 8)}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { adjustStock, ledgerProblems } = await import("./inventory");
const { cancelOrder, getOrderAdmin, refundOrder } = await import("./order-admin");
const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const bulk = await import("./bulk-edit");
const ownerTools = await import("./owner-tools");
const support = await import("./inventory-test-support");
const { clearLevels, ledgerIsWhole, mainLocation, movementsOf, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let oslo: string;

beforeAll(async () => {
  store = await newStore("history");
  oslo = await mainLocation(store.storeId);
});

afterAll(async () => {
  await closeDb();
});

const last = async (sku: string) => (await movementsOf(store.storeId, sku)).at(-1)!;
const productOf = async (sku: string) => String((await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}`))[0].product_id);
const lineOf = async (orderId: string, sku: string) => (await getOrderAdmin(store.storeId, orderId))!.lines.find((l) => l.sku === sku)!.id;

describe("every change of a level is a movement that says why, by whom and for which order", () => {
  it("an adjustment on the Inventory page: its reason, the member and the note", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 10);
    await adjustStock(store.member, { reason: "damaged", note: "Dropped in the warehouse", rows: [{ variantId: await variantId(store.storeId, "DEMO-TOTE"), locationId: oslo, mode: "adjust", value: -2, was: 10 }] });
    expect(await last("DEMO-TOTE")).toMatchObject({ delta: -2, after: 8, reason: "damaged", source: "inventory_page", actor: store.accountId, note: "Dropped in the warehouse", orderId: null, returnId: null, jobId: null });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("a paid sale: a movement of the order, by the system", async () => {
    const order = await place(store.storeId, [["DEMO-TOTE", 2]]);
    await pay(store.storeId, order, store.account);
    expect(await last("DEMO-TOTE")).toMatchObject({ delta: -2, after: 6, reason: "sale", source: "order", orderId: order.orderId, actor: null });
    // A holding is not a movement: the level changes when the order is paid.
    const another = await place(store.storeId, [["DEMO-TOTE", 1]]);
    expect(await last("DEMO-TOTE")).toMatchObject({ orderId: order.orderId });
    await pay(store.storeId, another, store.account);
    expect(await last("DEMO-TOTE")).toMatchObject({ orderId: another.orderId, after: 5 });
  });

  it("a refund that puts units back, and a cancelled paid order: restock movements with the order and who", async () => {
    const order = await place(store.storeId, [["DEMO-TOTE", 2]]);
    await pay(store.storeId, order, store.account);
    const lineId = await lineOf(order.orderId, "DEMO-TOTE");
    const refunded = await refundOrder(store.storeId, order.orderId, { amountMinor: 19900, reason: "Faulty", restock: [{ lineId, quantity: 1 }] }, store.accountId);
    expect(refunded).toMatchObject({ ok: true });
    expect(await last("DEMO-TOTE")).toMatchObject({ delta: 1, reason: "order_restock", source: "order", orderId: order.orderId, actor: store.accountId });
    const cancelled = await cancelOrder(store.storeId, order.orderId, "Cancelled", store.accountId);
    expect(cancelled.ok).toBe(true);
    expect(await last("DEMO-TOTE")).toMatchObject({ delta: 1, reason: "order_restock", orderId: order.orderId });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("an inspected return: return_restock movements that carry the return and its source", async () => {
    const order = await place(store.storeId, [["DEMO-MUG-WHITE", 2]]);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 5);
    await pay(store.storeId, order, store.account);
    const lineId = await lineOf(order.orderId, "DEMO-MUG-WHITE");
    const [ret] = await db().execute<Row>(sql`
      insert into commerce.returns (store_id, order_id, number, kind) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'X', 'return') returning id
    `);
    const done = await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "Return", restock: [{ lineId, quantity: 2 }] }, store.accountId, { outside: true, returnId: String(ret.id) });
    expect(done).toMatchObject({ ok: true });
    expect(await last("DEMO-MUG-WHITE")).toMatchObject({ delta: 2, reason: "return_restock", source: "return", orderId: order.orderId, returnId: String(ret.id), actor: store.accountId });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("the product editor: a changed number is a correction, a new variant's first number an opening, both by the member", async () => {
    const context = await getEditorContext(store.member.store);
    const productId = await productOf("DEMO-TOTE");
    const input = (await getProductForEdit(store.member.store, context, productId))!;
    const { archived: _archived, ...edit } = input;
    void _archived;
    edit.variants[0].stock = 33;
    expect(await saveProduct(store.member.store, context, productId, edit, undefined, undefined, store.member.account)).toMatchObject({ ok: true });
    expect(await last("DEMO-TOTE")).toMatchObject({ after: 33, reason: "correction", source: "editor", actor: store.accountId });
    // The same number again changes nothing.
    const count = (await movementsOf(store.storeId, "DEMO-TOTE")).length;
    await saveProduct(store.member.store, context, productId, edit, undefined, undefined, store.member.account);
    expect((await movementsOf(store.storeId, "DEMO-TOTE")).length).toBe(count);
    // A new variant of the product, with its first number.
    const again = (await getProductForEdit(store.member.store, context, productId))!;
    const { archived: _a2, ...more } = again;
    void _a2;
    more.variants.push({ ...more.variants[0], id: null, sku: "DEMO-TOTE-2", stock: 4, options: { ...more.variants[0].options } });
    expect(await saveProduct(store.member.store, context, productId, more, undefined, undefined, store.member.account)).toMatchObject({ ok: true });
    expect(await last("DEMO-TOTE-2")).toMatchObject({ delta: 4, after: 4, reason: "opening", source: "editor", actor: store.accountId });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("a bulk edit: source bulk, the batch's id and the member", async () => {
    const productId = await productOf("DEMO-MUG-BLACK");
    await setLevel(store.storeId, "DEMO-MUG-BLACK", oslo, 5);
    const made = await bulk.startBulk(store.member, { action: "stock", productIds: [productId], change: "+4" });
    if (!made.ok) throw new Error(made.problem);
    expect(await last("DEMO-MUG-BLACK")).toMatchObject({ delta: 4, after: 9, reason: "correction", source: "bulk", actor: store.accountId, jobId: made.batchId });
  });

  it("the AI manager's set_stock: source ai_manager, for the account that asked", async () => {
    await ownerTools.runOwnerTool({ account: store.member.account, store: store.member.store, invalidate: () => {} }, "set_stock", { sku: "DEMO-MUG-BLACK", quantity: 20 });
    expect(await last("DEMO-MUG-BLACK")).toMatchObject({ after: 20, reason: "correction", source: "ai_manager", actor: store.accountId });
  });

  it("a level written with no context at all (a migration, a script) is still a movement, and a removed level is one too", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 1);
    expect(await last("DEMO-TOTE")).toMatchObject({ reason: "correction", source: "system", actor: null, orderId: null });
    await db().execute(sql`delete from commerce.inventory_levels where store_id = ${store.storeId}::uuid and variant_id = ${await variantId(store.storeId, "DEMO-TOTE-2")}::uuid`);
    expect(await last("DEMO-TOTE-2")).toMatchObject({ delta: -4, after: 0 });
    expect(await ledgerProblems(store.storeId)).toEqual([]);
  });

  it("is append-only: a movement is never changed or removed, whoever asks", async () => {
    const [m] = await db().execute<Row>(sql`select id from commerce.inventory_movements where store_id = ${store.storeId}::uuid limit 1`);
    await expect(db().execute(sql`update commerce.inventory_movements set delta = delta + 1 where id = ${String(m.id)}::bigint`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.inventory_movements where id = ${String(m.id)}::bigint`)).rejects.toThrow();
  });
});
