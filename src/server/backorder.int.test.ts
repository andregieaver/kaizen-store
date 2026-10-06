import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { t } from "@/lib/i18n";
import { availabilityOf, schemaAvailability } from "@/lib/stock-availability";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
const fake = vi.hoisted(() => {
  const refunds: Record<string, unknown>[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    refunds: {
      create: async (params: Record<string, unknown>) => {
        refunds.push(params);
        return { id: `re_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { changeLine, getCart, sellableQuantity } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { variantStockOf } = await import("./catalog");
const { getOrder } = await import("./orders");
const { cancelOrder, getOrderAdmin, refundOrder } = await import("./order-admin");
const { placeOrder } = await import("./checkout");
const support = await import("./inventory-test-support");
const { addLocation, no, cartOf, clearLevels, holdsOf, levelsOf, mainLocation, movementsOf, newStore, pay, place, setLevel, ledgerIsWhole, variantId } = support;

type Row = Record<string, unknown>;
let storeId: string;
let account: string;
let accountId: string;
let main: string;

beforeAll(async () => {
  const made = await newStore("backorder");
  storeId = made.storeId;
  account = made.account;
  accountId = made.accountId;
  main = await mainLocation(storeId);
});

afterAll(async () => {
  await closeDb();
});

/** The template store's location (the seed names it). */
const MAIN = "Lager Oslo";
const shop = () => ({ storeId, market: no });

/** The thermos the seed has: nothing in stock, keeps selling, "expected to ship within 7 days". */
const THERMOS = "DEMO-THERMOS";

async function eventsOf(orderId: string, type: string): Promise<Row[]> {
  return db().execute<Row>(sql`select data from commerce.order_events where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = ${type} order by id`);
}

describe("a variant that keeps selling at zero stock, in the cart", () => {
  it("is for sale at zero, and the page's read says it is on backorder with the days", async () => {
    await clearLevels(storeId, THERMOS);
    const stock = (await variantStockOf(db(), storeId, [await variantId(storeId, THERMOS), await variantId(storeId, "DEMO-MUG-WHITE")])).get(await variantId(storeId, THERMOS))!;
    expect(stock).toMatchObject({ inStock: 0, stockPolicy: "continue", backorderDays: 7, canBuy: true });
    expect(availabilityOf(stock)).toBe("backorder");
    expect(schemaAvailability(stock)).toBe("https://schema.org/BackOrder");
    // A variant with stock is in stock, with the same words as before.
    const mug = (await variantStockOf(db(), storeId, [await variantId(storeId, "DEMO-MUG-WHITE")])).get(await variantId(storeId, "DEMO-MUG-WHITE"))!;
    expect(availabilityOf(mug)).toBe("in_stock");
    expect(schemaAvailability(mug)).toBe("https://schema.org/InStock");
  });

  it("accepts any quantity up to the line maximum, never `unavailable` for stock", async () => {
    jar.clear();
    await clearLevels(storeId, THERMOS);
    expect(await changeLine(shop(), await variantId(storeId, THERMOS), 3, "add")).toMatchObject({ outcome: "added", quantity: 3 });
    expect(await changeLine(shop(), await variantId(storeId, THERMOS), 25, "add")).toMatchObject({ outcome: "capped", quantity: 20 });
    // The sellable read gives the cap (the line maximum) and the real stock apart.
    const sellable = await db().transaction((tx) => sellableQuantity(tx, shop(), "00000000-0000-0000-0000-000000000000", null, null, 1));
    expect(sellable).toBeNull();
    const own = await db().transaction(async (tx) => sellableQuantity(tx, shop(), await variantId(storeId, THERMOS), null, null, 1));
    expect(own).toMatchObject({ available: 20, inStock: 0, stockPolicy: "continue", backorderDays: 7 });
  });

  it("shows the line as fine, with the units beyond stock and the days stated", async () => {
    jar.clear();
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 2);
    await changeLine(shop(), await variantId(storeId, THERMOS), 5, "add");
    const cart = await getCart(shop());
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ status: "ok", quantity: 5, inStock: 2, available: 20, backorder: { units: 3, days: 7 } });
    const summary = await cartSummary(shop(), cart);
    expect(summary.blocked).toBe(false);
    // Fully in stock: no note.
    await setLevel(storeId, THERMOS, main, 9);
    expect((await getCart(shop())).lines[0].backorder).toBeNull();
  });

  it("leaves a variant that stops at zero as it was: capped at the stock, refused at none, `insufficient` above it", async () => {
    jar.clear();
    const mug = await variantId(storeId, "DEMO-MUG-BLACK");
    await clearLevels(storeId, "DEMO-MUG-BLACK");
    expect(await changeLine(shop(), mug, 1, "add")).toMatchObject({ outcome: "unavailable", quantity: 0 });
    await setLevel(storeId, "DEMO-MUG-BLACK", main, 2);
    expect(await changeLine(shop(), mug, 5, "add")).toMatchObject({ outcome: "capped", quantity: 2 });
    // Stock went meanwhile: the line is `insufficient` and says how many are left, with no backorder note.
    await setLevel(storeId, "DEMO-MUG-BLACK", main, 1);
    const cart = await getCart(shop());
    expect(cart.lines[0]).toMatchObject({ status: "insufficient", available: 1, backorder: null });
    expect((await cartSummary(shop(), cart)).blocked).toBe(true);
  });
});

describe("placing and paying an order for a variant on backorder", () => {
  it("holds the whole line, marks the units beyond stock and their days, and leaves stock below zero once paid", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 3);
    const order = await place(storeId, [[THERMOS, 5]]);
    // Provisional at placement: 2 of the 5 are beyond the 3 in stock; the whole line is held at the location that stocks it.
    const [line] = await db().execute<Row>(sql`select backorder_quantity, backorder_days, quantity from commerce.order_lines where order_id = ${order.orderId}::uuid and variant_id = ${await variantId(storeId, THERMOS)}::uuid`);
    expect(line).toMatchObject({ backorder_quantity: 2, backorder_days: 7, quantity: 5 });
    expect(await holdsOf(storeId, THERMOS)).toEqual({ [MAIN]: 5 });
    // The shopper's order page reads the badge.
    const viewed = await getOrder(storeId, order.orderId);
    expect(viewed?.lines.find((l) => l.sku === THERMOS)?.backorder).toEqual({ units: 2, days: 7 });
    // The money is exactly what the same line in stock costs (5 x 349 kr, shipping and VAT as for any line).
    expect(order.lines[0]).toMatchObject({ unitPriceMinor: 34900, quantity: 5 });

    await pay(storeId, order, account);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: -2 });
    expect(await holdsOf(storeId, THERMOS)).toEqual({});
    const [paid] = await db().execute<Row>(sql`select backorder_quantity, backorder_days from commerce.order_lines where order_id = ${order.orderId}::uuid and variant_id = ${await variantId(storeId, THERMOS)}::uuid`);
    expect(paid).toMatchObject({ backorder_quantity: 2, backorder_days: 7 });
    expect((await eventsOf(order.orderId, "stock.backordered"))[0].data).toEqual({ lines: [{ sku: THERMOS, quantity: 2 }] });
    // The history says why: one sale movement of the whole line with the order's id.
    const sale = (await movementsOf(storeId, THERMOS)).filter((m) => m.orderId === order.orderId);
    expect(sale).toEqual([expect.objectContaining({ location: MAIN, delta: -5, after: -2, reason: "sale", source: "order" })]);
    expect(await ledgerIsWhole(storeId)).toBe(true);
    // What is left to see: not for sale from stock, but the variant keeps selling; the page says owed.
    const stock = (await variantStockOf(db(), storeId, [await variantId(storeId, THERMOS)])).get(await variantId(storeId, THERMOS))!;
    expect(stock).toMatchObject({ inStock: 0, rawAvailable: -2, canBuy: true });
  });

  it("keeps what each shopper was told whatever the order of payment: the checkout placed first is never made a backorder by one that pays before it (review)", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 3);
    const a = await place(storeId, [[THERMOS, 3]]);
    // B is placed while A's hold takes all three: all of B's units are backordered at placement, and B's hold says so.
    const b = await place(storeId, [[THERMOS, 3]]);
    const marked = async (orderId: string) =>
      Number((await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where order_id = ${orderId}::uuid and variant_id = ${await variantId(storeId, THERMOS)}::uuid`))[0].backorder_quantity);
    const heldBeyond = async (orderId: string) =>
      Number((await db().execute<Row>(sql`select backorder_quantity from commerce.inventory_reservations where order_id = ${orderId}::uuid`))[0].backorder_quantity);
    expect(await marked(a.orderId)).toBe(0);
    expect(await marked(b.orderId)).toBe(3);
    expect([await heldBeyond(a.orderId), await heldBeyond(b.orderId)]).toEqual([0, 3]);
    // B pays first and is still the backordered one: A's 3 units were held for A.
    await pay(storeId, b, account);
    expect(await marked(b.orderId)).toBe(3);
    await pay(storeId, a, account);
    expect(await marked(a.orderId)).toBe(0);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: -3 });
    expect(await eventsOf(a.orderId, "stock.backordered")).toHaveLength(0);
    expect(await eventsOf(b.orderId, "stock.backordered")).toHaveLength(1);
    // What each order page says is what the cart and checkout said before paying.
    const viewedA = await getOrder(storeId, a.orderId);
    const viewedB = await getOrder(storeId, b.orderId);
    expect(viewedA?.lines.find((l) => l.sku === THERMOS)?.backorder).toBeNull();
    expect(viewedB?.lines.find((l) => l.sku === THERMOS)?.backorder).toEqual({ units: 3, days: 7 });
    expect(await ledgerIsWhole(storeId)).toBe(true);
  });

  it("does not turn a line that was told '2 on backorder' into '5 of 5' because another checkout paid first", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 3);
    const a = await place(storeId, [[THERMOS, 5]]);
    const b = await place(storeId, [[THERMOS, 3]]);
    const marked = async (orderId: string) =>
      Number((await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where order_id = ${orderId}::uuid and variant_id = ${await variantId(storeId, THERMOS)}::uuid`))[0].backorder_quantity);
    expect([await marked(a.orderId), await marked(b.orderId)]).toEqual([2, 3]);
    await pay(storeId, b, account);
    await pay(storeId, a, account);
    expect([await marked(a.orderId), await marked(b.orderId)]).toEqual([2, 3]);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: -5 });
    expect(await ledgerIsWhole(storeId)).toBe(true);
  });

  it("refuses a variant that stops at zero beside one that keeps selling, and writes nothing", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, "DEMO-MUG-BLACK", main, 1);
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid`);
    const [heldBefore] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where store_id = ${storeId}::uuid`);
    const result = await placeOrder(shop(), await cartOf(storeId, [[THERMOS, 2], ["DEMO-MUG-BLACK", 3]]));
    expect(result).toEqual({ ok: false, problem: "stock" });
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid`);
    const [heldAfter] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where store_id = ${storeId}::uuid`);
    expect(after.n).toBe(before.n);
    expect(heldAfter.n).toBe(heldBefore.n);
  });

  it("never sells past stock when asked not to (a weekly box is filled from free stock only)", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 1);
    expect(await placeOrder(shop(), await cartOf(storeId, [[THERMOS, 2]]), {}, { noBackorder: true })).toEqual({ ok: false, problem: "stock" });
    expect((await placeOrder(shop(), await cartOf(storeId, [[THERMOS, 1]]), {}, { noBackorder: true })).ok).toBe(true);
  });

  it("lets two checkouts for the last unit of a variant that stops at zero have exactly one winner, and of one that keeps selling, one in stock and one on backorder", async () => {
    await setLevel(storeId, "DEMO-TOTE", main, 1);
    const tote = await Promise.all([cartOf(storeId, [["DEMO-TOTE", 1]]), cartOf(storeId, [["DEMO-TOTE", 1]])]);
    const tried = await Promise.all(tote.map((cart) => placeOrder(shop(), cart)));
    expect(tried.filter((r) => r.ok)).toHaveLength(1);
    expect(tried.filter((r) => !r.ok)).toEqual([{ ok: false, problem: "stock" }]);

    // The checkouts the earlier tests left open hold nothing now.
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${storeId}::uuid and released_at is null`);
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 1);
    const thermos = await Promise.all([cartOf(storeId, [[THERMOS, 1]]), cartOf(storeId, [[THERMOS, 1]])]);
    const results = await Promise.all(thermos.map((cart) => placeOrder(shop(), cart)));
    expect(results.every((r) => r.ok)).toBe(true);
    const backordered = await db().execute<Row>(sql`
      select ol.backorder_quantity from commerce.order_lines ol where ol.store_id = ${storeId}::uuid and ol.order_id = any(${`{${results.flatMap((r) => (r.ok ? [r.order.orderId] : [])).join(",")}}`}::uuid[])
    `);
    expect(backordered.map((r) => Number(r.backorder_quantity)).sort()).toEqual([0, 1]);
  });
});

describe("what happens to the units owed when an order is refunded or cancelled", () => {
  it("puts back a refunded backordered unit like any other: the level rises from below zero", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 1);
    const order = await place(storeId, [[THERMOS, 3]]);
    await pay(storeId, order, account);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: -2 });
    const admin = await getOrderAdmin(storeId, order.orderId);
    const lineId = admin!.lines.find((l) => l.sku === THERMOS)!.id;
    const done = await refundOrder(storeId, order.orderId, { amountMinor: 34900 * 3, reason: "Not wanted", restock: [{ lineId, quantity: 3 }] }, accountId);
    expect(done).toMatchObject({ ok: true });
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: 1 });
    const back = (await movementsOf(storeId, THERMOS)).filter((m) => m.orderId === order.orderId);
    expect(back.map((m) => [m.reason, m.source, m.delta])).toEqual([["sale", "order", -3], ["order_restock", "order", 3]]);
    expect(back[1].actor).toBe(accountId);
    expect(await ledgerIsWhole(storeId)).toBe(true);
  });

  it("restocks every unit of a cancelled paid order, backordered ones too", async () => {
    await clearLevels(storeId, THERMOS);
    await setLevel(storeId, THERMOS, main, 2);
    const order = await place(storeId, [[THERMOS, 4]]);
    await pay(storeId, order, account);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: -2 });
    const done = await cancelOrder(storeId, order.orderId, "Changed their mind", accountId);
    expect(done.ok).toBe(true);
    expect(await levelsOf(storeId, THERMOS)).toEqual({ [MAIN]: 2 });
  });
});

describe("the words", () => {
  it("states the days with their own word in each language, never a date", () => {
    expect(t("nb").backorder.page(7)).toBe("På restordre: forventes sendt innen 7 dager");
    expect(t("nb").backorder.page(1)).toBe("På restordre: forventes sendt innen 1 dag");
    expect(t("sv").backorder.line(2, 14)).toBe("2 på restorder: förväntas skickas inom 14 dagar");
    expect(t("da").backorder.order(2, 5, 7)).toBe("2 af 5 på restordre: forventes afsendt inden for 7 dage efter din bestilling");
    expect(t("en").backorder.order(1, 1, 1)).toBe("1 of 1 on backorder: expected to ship within 1 day of your order");
    for (const lang of ["nb", "sv", "da", "en"]) expect(t(lang).backorder.page(7)).not.toMatch(/in stock|på lager|i lager/i);
  });
});

describe("one location that owes units beside one that holds stock (review)", () => {
  it("gives the cart, the cart summary and placeOrder the same stock position of the line", async () => {
    const made = await newStore("backorder-two");
    const home = await mainLocation(made.storeId);
    const second = await addLocation(made.storeId, "Bergen", 5);
    await clearLevels(made.storeId, THERMOS);
    await setLevel(made.storeId, THERMOS, home, -3); // 3 units owed after a backorder sale
    await setLevel(made.storeId, THERMOS, second, 5); // 5 units received where they are kept
    const other = { storeId: made.storeId, market: no };
    const id = await variantId(made.storeId, THERMOS);
    jar.clear();
    await changeLine(other, id, 5, "add");
    const five = await getCart(other);
    // The 5 on the shelf are what is in stock: no backorder note for goods that are there.
    expect(five.lines[0]).toMatchObject({ status: "ok", quantity: 5, inStock: 5, backorder: null });
    expect((await cartSummary(other, five)).blocked).toBe(false);
    expect((await variantStockOf(db(), made.storeId, [id])).get(id)).toMatchObject({ inStock: 5, rawAvailable: 2, canBuy: true });
    const placedFive = await place(made.storeId, [[THERMOS, 5]]);
    const [lineFive] = await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where order_id = ${placedFive.orderId}::uuid`);
    expect(Number(lineFive.backorder_quantity)).toBe(0);
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${made.storeId}::uuid and released_at is null`);
    // Seven: 2 beyond the 5 that are there, in the cart and in the order alike.
    await changeLine(other, id, 2, "add");
    const seven = await getCart(other);
    expect(seven.lines[0]).toMatchObject({ quantity: 7, inStock: 5, backorder: { units: 2, days: 7 } });
    const placedSeven = await place(made.storeId, [[THERMOS, 7]]);
    const [lineSeven] = await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where order_id = ${placedSeven.orderId}::uuid`);
    expect(Number(lineSeven.backorder_quantity)).toBe(seven.lines[0].backorder?.units);
    expect(await ledgerIsWhole(made.storeId)).toBe(true);
  });

  it("caps a variant switched back to 'stop selling' at the physical stock, not at the stock less what is owed", async () => {
    const made = await newStore("backorder-two-deny");
    const home = await mainLocation(made.storeId);
    const second = await addLocation(made.storeId, "Bergen", 5);
    await clearLevels(made.storeId, THERMOS);
    await setLevel(made.storeId, THERMOS, home, -3);
    await setLevel(made.storeId, THERMOS, second, 5);
    await db().execute(sql`update commerce.product_variants set stock_policy = 'deny', backorder_days = null where store_id = ${made.storeId}::uuid and sku = ${THERMOS}`);
    const other = { storeId: made.storeId, market: no };
    jar.clear();
    expect(await changeLine(other, await variantId(made.storeId, THERMOS), 9, "add")).toMatchObject({ outcome: "capped", quantity: 5 });
    const placed = await place(made.storeId, [[THERMOS, 5]]);
    expect(placed.orderId).toBeTruthy();
    expect(await placeOrder(other, await cartOf(made.storeId, [[THERMOS, 6]]))).toEqual({ ok: false, problem: "stock" });
  });
});
