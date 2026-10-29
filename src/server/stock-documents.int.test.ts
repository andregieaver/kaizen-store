import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const transfers = await import("./stock-transfers");
const orders = await import("./purchase-orders");
const { setFulfilsOnline, deactivateLocation } = await import("./inventory-locations");
const { variantStockOf } = await import("./catalog");
const support = await import("./inventory-test-support");
const { addLocation, cartOf, clearLevels, levelsOf, mainLocation, movementsOf, newStore, setLevel, variantId } = support;
const { placeOrder } = await import("./checkout");
const { allocateStock } = await import("./order-insert");
const { runOwnerTool } = await import("./owner-tools");
const { saveOrderSettings } = await import("./order-settings");

type Row = Record<string, unknown>;

/**
 * Stock transfers, purchase orders, the cost history and locations that do not fulfil online orders (wave 11 unit D, D383): units leave
 * the origin when a transfer is sent (never what checkouts hold there), are counted in at the destination in parts and never past what was
 * sent, go back on a cancel; a purchase order's units arrive at its place and set each variant's cost, converted to the main currency, kept
 * in the history; the database moves both only forward; a location that does not fulfil online orders is neither shown nor sold from.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;
let bergen: string;
const SKU = "DEMO-TOTE";
const SKU2 = "DEMO-MUG-WHITE";

beforeAll(async () => {
  store = await newStore("stockdocs");
  other = await newStore("stockdocs-other");
  oslo = await mainLocation(store.storeId);
  bergen = await addLocation(store.storeId, "Bergen", 5);
  await clearLevels(store.storeId, SKU);
  await clearLevels(store.storeId, SKU2);
  await setLevel(store.storeId, SKU, oslo, 10);
  await setLevel(store.storeId, SKU2, oslo, 4);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const reader = () => ({ ...store.member, role: "admin" as const, permissions: ["products:read"] });
const stockOf = async (sku: string) => (await variantStockOf(db(), store.storeId, [await variantId(store.storeId, sku)])).get(await variantId(store.storeId, sku))!;

describe("stock transfers", () => {
  it("makes a draft from SKUs, refusing what is not the store's own or the same place twice", async () => {
    expect(await transfers.createTransfer(store.member, { origin: oslo, destination: oslo, lines: [{ sku: SKU, quantity: 1 }] })).toMatchObject({ ok: false });
    expect(await transfers.createTransfer(store.member, { origin: oslo, destination: bergen, lines: [{ sku: "NO-SUCH", quantity: 1 }] })).toEqual({
      ok: false,
      problems: ["No shipped goods with the SKU NO-SUCH in this store."],
    });
    const theirs = await mainLocation(other.storeId);
    expect(await transfers.createTransfer(store.member, { origin: oslo, destination: theirs, lines: [{ sku: SKU, quantity: 1 }] })).toEqual({
      ok: false,
      problems: ["Choose two of the store's active locations."],
    });
    expect(await transfers.createTransfer(reader(), { origin: oslo, destination: bergen, lines: [{ sku: SKU, quantity: 1 }] })).toEqual({
      ok: false,
      problems: ["You do not have access to this."],
    });
  });

  it("sends, receives in parts and closes when everything is in, every movement naming the transfer", async () => {
    const made = await transfers.createTransfer(store.member, { origin: oslo, destination: bergen, lines: [{ sku: SKU, quantity: 6 }, { sku: SKU2, quantity: 2 }] });
    if (!made.ok) throw new Error(made.problems.join());
    // Nothing moves on a draft.
    expect(await levelsOf(store.storeId, SKU)).toMatchObject({ "Lager Oslo": 10 });
    expect(await transfers.sendTransfer(store.member, made.id)).toEqual({ ok: true, id: made.id });
    expect(await levelsOf(store.storeId, SKU)).toMatchObject({ "Lager Oslo": 4 });
    // On its way: not for sale anywhere, and shown as incoming at Bergen.
    expect((await stockOf(SKU)).inStock).toBe(4);
    const incoming = await transfers.incomingStock(store.storeId);
    expect(incoming.get(`${await variantId(store.storeId, SKU)}:${bergen}`)).toBe(6);
    // A second send does nothing.
    expect(await transfers.sendTransfer(store.member, made.id)).toEqual({ ok: false, problems: ["Only a draft is sent."] });

    const tote = await variantId(store.storeId, SKU);
    const mug = await variantId(store.storeId, SKU2);
    // Counting more than is to come counts what is to come.
    expect(await transfers.receiveTransfer(store.member, made.id, { lines: [{ variantId: tote, quantity: 4 }] })).toMatchObject({ ok: true, received: 4 });
    expect((await transfers.getTransfer(store.storeId, made.id))?.state).toBe("partly_received");
    expect(await transfers.receiveTransfer(store.member, made.id, { lines: [{ variantId: tote, quantity: 9 }, { variantId: mug, quantity: 2 }] })).toMatchObject({ ok: true, received: 4 });
    expect(await levelsOf(store.storeId, SKU)).toMatchObject({ "Lager Oslo": 4, Bergen: 6 });
    expect((await transfers.getTransfer(store.storeId, made.id))?.status).toBe("received");
    expect((await stockOf(SKU)).inStock).toBe(10);

    const moves = (await movementsOf(store.storeId, SKU)).filter((m) => m.jobId === made.id);
    expect(moves.map((m) => [m.location, m.delta, m.reason, m.source])).toEqual([
      ["Lager Oslo", -6, "transfer_out", "transfer"],
      ["Bergen", 4, "transfer_in", "transfer"],
      ["Bergen", 2, "transfer_in", "transfer"],
    ]);
  });

  it("refuses to send units checkouts hold at the origin, naming the line", async () => {
    await setLevel(store.storeId, SKU2, oslo, 3);
    const cart = await cartOf(store.storeId, [[SKU2, 2]]);
    const placed = await placeOrder({ storeId: store.storeId, market: support.no }, cart, {}, {});
    if (!placed.ok) throw new Error(placed.problem);
    const made = await transfers.createTransfer(store.member, { origin: oslo, destination: bergen, lines: [{ sku: SKU2, quantity: 2 }] });
    if (!made.ok) throw new Error(made.problems.join());
    expect(await transfers.sendTransfer(store.member, made.id)).toEqual({ ok: false, problems: [`${SKU2}: 1 free at the origin, 2 to send.`] });
    expect((await levelsOf(store.storeId, SKU2))["Lager Oslo"]).toBe(3);
    expect(await transfers.cancelTransfer(store.member, made.id)).toEqual({ ok: true, id: made.id });
  });

  it("puts what was not counted in back at the origin when a sent transfer is cancelled", async () => {
    await setLevel(store.storeId, SKU, oslo, 5);
    const made = await transfers.createTransfer(store.member, { origin: oslo, destination: bergen, lines: [{ sku: SKU, quantity: 3 }] });
    if (!made.ok) throw new Error(made.problems.join());
    await transfers.sendTransfer(store.member, made.id);
    await transfers.receiveTransfer(store.member, made.id, { lines: [{ variantId: await variantId(store.storeId, SKU), quantity: 1 }] });
    expect(await transfers.cancelTransfer(store.member, made.id)).toEqual({ ok: true, id: made.id });
    expect(await levelsOf(store.storeId, SKU)).toMatchObject({ "Lager Oslo": 4, Bergen: 7 });
    expect(await transfers.cancelTransfer(store.member, made.id)).toEqual({ ok: false, problems: ["This transfer is already closed."] });
  });

  it("is moved only forward by the database, and a closed one stays as it closed", async () => {
    const made = await transfers.createTransfer(store.member, { origin: oslo, destination: bergen, lines: [{ sku: SKU, quantity: 1 }] });
    if (!made.ok) throw new Error(made.problems.join());
    await expect(db().execute(sql`update commerce.stock_transfers set status = 'received' where id = ${made.id}::uuid`)).rejects.toThrow();
    await transfers.cancelTransfer(store.member, made.id);
    await expect(db().execute(sql`update commerce.stock_transfers set note = 'later' where id = ${made.id}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.stock_transfers where id = ${made.id}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.stock_transfer_lines set quantity = 5 where transfer_id = ${made.id}::uuid`)).rejects.toThrow();
  });
});

describe("purchase orders", () => {
  it("counts units in at its place and sets each variant's cost, converted to the main currency, keeping the history", async () => {
    await setLevel(store.storeId, SKU, bergen, 0);
    const made = await orders.createPurchaseOrder(store.member, {
      supplier: "Vevstua AS",
      reference: "PO-17",
      currency: "NOK",
      location: bergen,
      expectedOn: "2026-11-10",
      lines: [{ sku: SKU, quantity: 10, unitCost: "45,50" }],
    });
    if (!made.ok) throw new Error(made.problems.join());
    const view = await orders.getPurchaseOrder(store.storeId, made.id);
    expect(view).toMatchObject({ supplier: "Vevstua AS", currency: "NOK", totalMinor: 45500, state: "draft", expectedOn: "2026-11-10" });
    // A draft is not received.
    const tote = await variantId(store.storeId, SKU);
    expect(await orders.receivePurchaseOrder(store.member, made.id, { lines: [{ variantId: tote, quantity: 1 }] })).toEqual({
      ok: false,
      problems: ["Only an ordered purchase order is received."],
    });
    expect(await orders.placePurchaseOrder(store.member, made.id)).toEqual({ ok: true, id: made.id });
    // Its lines are fixed once ordered.
    await expect(db().execute(sql`update commerce.purchase_order_lines set unit_cost_minor = 1 where purchase_order_id = ${made.id}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.purchase_orders set currency = 'EUR' where id = ${made.id}::uuid`)).rejects.toThrow();

    expect(await orders.receivePurchaseOrder(store.member, made.id, { lines: [{ variantId: tote, quantity: 4 }] })).toMatchObject({ ok: true, received: 4, costsKept: 0 });
    expect((await levelsOf(store.storeId, SKU)).Bergen).toBe(4);
    const [cost] = await db().execute<Row>(sql`select cost_minor from commerce.product_variants where id = ${tote}::uuid`);
    expect(Number(cost.cost_minor)).toBe(4550);
    const history = await orders.costHistory(store.storeId, tote);
    expect(history[0]).toMatchObject({ cost_minor: 4550, source: "purchase_order", purchase_order_id: made.id, source_currency: "NOK", source_cost_minor: 4550 });
    await expect(db().execute(sql`delete from commerce.variant_cost_history where variant_id = ${tote}::uuid`)).rejects.toThrow();

    const moves = (await movementsOf(store.storeId, SKU)).filter((m) => m.jobId === made.id);
    expect(moves.map((m) => [m.location, m.delta, m.reason, m.source])).toEqual([["Bergen", 4, "received", "purchase_order"]]);
    expect(await orders.receivePurchaseOrder(store.member, made.id, { lines: [{ variantId: tote, quantity: 6 }] })).toMatchObject({ ok: true, received: 6 });
    expect((await orders.getPurchaseOrder(store.storeId, made.id))?.status).toBe("received");
  });

  it("converts a cost in another currency at the store's rates, and keeps the cost where there is no rate", async () => {
    const mug = await variantId(store.storeId, SKU2);
    await db().execute(sql`update commerce.product_variants set cost_minor = 1000 where id = ${mug}::uuid`);
    const eur = await orders.createPurchaseOrder(store.member, { supplier: "Lisboa Lda", currency: "EUR", location: oslo, lines: [{ sku: SKU2, quantity: 2, unitCost: "3.00" }] });
    if (!eur.ok) throw new Error(eur.problems.join());
    await orders.placePurchaseOrder(store.member, eur.id);
    const got = await orders.receivePurchaseOrder(store.member, eur.id, { lines: [{ variantId: mug, quantity: 2 }] });
    expect(got).toMatchObject({ ok: true, received: 2 });
    const [after] = await db().execute<Row>(sql`select cost_minor from commerce.product_variants where id = ${mug}::uuid`);
    const { convertMinor } = await import("@/lib/currency");
    const expected = convertMinor(300, "EUR", "NOK", store.member.store.localization.rates);
    if (expected === null) expect(Number(after.cost_minor)).toBe(1000);
    else expect(Number(after.cost_minor)).toBe(expected);

    const usd = await orders.createPurchaseOrder(store.member, { supplier: "Far Away Inc", currency: "USD", location: oslo, lines: [{ sku: SKU2, quantity: 1, unitCost: "9.99" }] });
    if (!usd.ok) throw new Error(usd.problems.join());
    await orders.placePurchaseOrder(store.member, usd.id);
    const [before] = await db().execute<Row>(sql`select cost_minor from commerce.product_variants where id = ${mug}::uuid`);
    const result = await orders.receivePurchaseOrder(store.member, usd.id, { lines: [{ variantId: mug, quantity: 1 }] });
    if (store.member.store.localization.rates.has("USD")) expect(result).toMatchObject({ ok: true });
    else {
      expect(result).toMatchObject({ ok: true, costsKept: 1 });
      const [kept] = await db().execute<Row>(sql`select cost_minor from commerce.product_variants where id = ${mug}::uuid`);
      expect(Number(kept.cost_minor)).toBe(Number(before.cost_minor));
    }
  });

  it("refuses a cost it cannot read, and a cancelled order keeps what arrived", async () => {
    expect(await orders.createPurchaseOrder(store.member, { supplier: "X", currency: "NOK", location: oslo, lines: [{ sku: SKU, quantity: 1, unitCost: "lots" }] })).toEqual({
      ok: false,
      problems: [`Write what one unit of ${SKU} costs as an amount.`],
    });
    const made = await orders.createPurchaseOrder(store.member, { supplier: "Y", currency: "NOK", location: oslo, lines: [{ sku: SKU, quantity: 5, unitCost: "10" }] });
    if (!made.ok) throw new Error(made.problems.join());
    await orders.placePurchaseOrder(store.member, made.id);
    const before = (await levelsOf(store.storeId, SKU))["Lager Oslo"];
    await orders.receivePurchaseOrder(store.member, made.id, { lines: [{ variantId: await variantId(store.storeId, SKU), quantity: 2 }] });
    expect(await orders.cancelPurchaseOrder(store.member, made.id)).toEqual({ ok: true, id: made.id });
    expect((await levelsOf(store.storeId, SKU))["Lager Oslo"]).toBe(before + 2);
    expect(await orders.listPurchaseOrders(store.storeId, { open: true })).toEqual([]);
  });

  it("reads nothing of another store", async () => {
    const mine = await orders.listPurchaseOrders(store.storeId);
    expect(mine.length).toBeGreaterThan(0);
    expect(await orders.getPurchaseOrder(other.storeId, mine[0].id)).toBeNull();
    expect(await orders.placePurchaseOrder(other.member, mine[0].id)).toEqual({ ok: false, problems: ["This purchase order is not in this store."] });
  });
});

describe("a location that does not fulfil online orders", () => {
  it("is neither shown nor sold online, is the owner's to switch, and one always stays", async () => {
    await setLevel(store.storeId, SKU, oslo, 0);
    await setLevel(store.storeId, SKU, bergen, 3);
    expect((await stockOf(SKU)).inStock).toBe(3);
    expect(await setFulfilsOnline({ ...store.member, role: "admin" as const, permissions: null }, bergen, false)).toEqual({ ok: false, problem: "You do not have access to this." });
    expect(await setFulfilsOnline(store.member, bergen, false)).toEqual({ ok: true, id: bergen });
    expect((await stockOf(SKU)).inStock).toBe(0);
    const cart = await cartOf(store.storeId, [[SKU2, 1]]);
    await setLevel(store.storeId, SKU2, oslo, 0);
    await setLevel(store.storeId, SKU2, bergen, 5);
    const refused = await placeOrder({ storeId: store.storeId, market: support.no }, cart, {}, { noBackorder: true });
    expect(refused.ok).toBe(false);
    // The last location that takes online orders stays on, and is not deactivated.
    expect(await setFulfilsOnline(store.member, oslo, false)).toMatchObject({ ok: false });
    expect(await deactivateLocation(store.member, oslo, 0)).toMatchObject({ ok: false });
    expect(await setFulfilsOnline(store.member, bergen, true)).toEqual({ ok: true, id: bergen });
    expect((await stockOf(SKU)).inStock).toBe(3);
  });
});

describe("unit D2 (D383)", () => {
  it("takes an order's units from the delivery country's locations first when the store says so", async () => {
    const stockholm = await addLocation(store.storeId, "Stockholm", 2);
    await db().execute(sql`update commerce.inventory_locations set country = 'SE' where id = ${stockholm}::uuid`);
    for (const l of [oslo, bergen, stockholm]) await setLevel(store.storeId, SKU2, l, 0);
    await setLevel(store.storeId, SKU2, oslo, 5);
    await setLevel(store.storeId, SKU2, stockholm, 5);
    const mug = await variantId(store.storeId, SKU2);
    const takenAt = () =>
      db().transaction(async (tx) => {
        const plan = await allocateStock(tx, store.storeId, [{ variantId: mug, quantity: 1, policy: "deny" }], [], { country: "SE" });
        if (!plan.ok) throw new Error("no plan");
        return plan.holds.map((h) => h.locationId);
      });
    expect(await takenAt()).toEqual([oslo]);
    expect(await saveOrderSettings(store.member, { stockRouting: "nearest" })).toMatchObject({ ok: true });
    expect(await takenAt()).toEqual([stockholm]);
    await saveOrderSettings(store.member, { stockRouting: "rank" });
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${stockholm}::uuid`);
  });

  it("draws stock no checkout held only from locations that fulfil online orders when the order is paid", async () => {
    await setLevel(store.storeId, SKU, oslo, 2);
    await setLevel(store.storeId, SKU, bergen, 0);
    const order = await support.place(store.storeId, [[SKU, 2]]);
    // The hold lapsed before payment: the draw takes free stock, and Bergen (now holding all of it) does not fulfil online orders.
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where order_id = ${order.orderId}::uuid`);
    await setLevel(store.storeId, SKU, oslo, 0);
    await setLevel(store.storeId, SKU, bergen, 5);
    await setFulfilsOnline(store.member, bergen, false);
    await support.pay(store.storeId, order, store.account);
    expect((await levelsOf(store.storeId, SKU)).Bergen).toBe(5);
    await setFulfilsOnline(store.member, bergen, true);
  });

  it("lets the AI manager make a draft transfer by the locations' names, which moves nothing", async () => {
    await setLevel(store.storeId, SKU2, oslo, 4);
    const ctx = { account: store.member.account, store: store.member.store, invalidate: () => {} };
    const made = (await runOwnerTool(ctx, "create_transfer", { from: "lager oslo", to: "Bergen", lines: [{ sku: SKU2, quantity: 2 }] })) as { pages: { transfer: string } };
    expect(made).toMatchObject({ made: "a draft transfer", from: "Lager Oslo", to: "Bergen", units: 2 });
    const id = made.pages.transfer.split("/").at(-1)!;
    expect((await transfers.getTransfer(store.storeId, id))?.status).toBe("draft");
    expect((await levelsOf(store.storeId, SKU2))["Lager Oslo"]).toBe(4);
    await expect(runOwnerTool(ctx, "create_transfer", { from: "Nowhere", to: "Bergen", lines: [{ sku: SKU2, quantity: 1 }] })).rejects.toThrow("no location called Nowhere");
  });
});
