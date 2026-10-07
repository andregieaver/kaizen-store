import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { attentionFor } from "@/lib/control-center";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/** Kaizen's platform Stripe client, faked: a change's lower total is refunded through it, and a pay link opens a hosted session. */
const fake = vi.hoisted(() => {
  let n = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_aedit_${++n}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: "co_x" }) },
    checkout: {
      sessions: {
        create: async () => ({ id: `cs_aedit_${++n}`, url: "https://checkout.stripe.test/x", payment_method_types: ["card"] }),
        // A session the checkout paid (the fixture's `cs_…` references): complete, with its payment intent, so a refund can find it.
        retrieve: async (id: string) => (id.startsWith("cs_aedit_") ? { id, status: "open", payment_status: "unpaid" } : { id, status: "complete", payment_status: "paid", payment_intent: `pi_for_${id}`, invoice: null }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const edits = await import("./order-edits");
const { markSent, refundOrder } = await import("./order-admin");
const { getStore } = await import("./stores");
const { staffActor } = await import("./order-actor");
const { periodTotals } = await import("./analytics-totals");
const { refundsReport } = await import("./analytics-refunds-data");
const { taxSnapshot } = await import("./tax-reconciliation");
const { toMainOne } = await import("./analytics-sql");
const { controlCenter } = await import("./control-center");
const { inventoryCounts } = await import("./inventory");
const { orderExportReader } = await import("./order-export");
const ownerTools = await import("./owner-tools");
const { fxStore, paidOrder, readOrder, lineOf, variantOf, NO, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;
// The tools' answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * What the figures do with an order changed after purchase and an order sent in parts (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 4.7 and 5.5,
 * `docs/analytics.md` "Edited order", "Refunds", "Owed" and "Order changes and parcels"), against a real database:
 * - an order lowered by a change counts once, at its new amount, on the day it was placed, and the refund of the difference is not a refund (Finance,
 *   the refunds drill-down, `sales_summary`), in kroner and in a euro order; a later refund still is one;
 * - the payment of a higher total is not an order;
 * - the VAT report's reconciliation names a change made in another period than the order's (`edit_in`, `edit_out`, `edit_credited`) and balances;
 * - owed units are only those still to send; the control center counts partly sent orders and changes waiting for payment for the member who may read orders;
 * - the order file says `fulfilment` and `edited`, and its `refunded` leaves the change's refund out;
 * - `get_order` and `pick_list` answer from the store's own reads, and never from another store's;
 * - a store with none of it shows none of it, never a zero that is not one.
 */

let store: Fx;
let period: Fx;
let other: Fx;
let empty: Fx;
let today: string;

const dayOf = async (daysAgo: number): Promise<string> =>
  String((await db().execute<Row>(sql`select to_char(((now() at time zone 'Europe/Oslo')::date - ${daysAgo}::int), 'YYYY-MM-DD') as d`))[0].d);
const addDay = (day: string, n = 1) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const storeOf = async (fx: Fx): Promise<Store> => (await getStore(fx.slug))!;
const orderRow = async (orderId: string) => (await db().execute<Row>(sql`select total_minor, tax_minor, currency from commerce.orders where id = ${orderId}::uuid`))[0];
const exVat = async (orderId: string) => {
  const o = await orderRow(orderId);
  return Number(o.total_minor) - Number(o.tax_minor);
};
const accountOf = async (fx: Fx): Promise<Account> => {
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${fx.accountId}::uuid`);
  return { id: String(row.id), email: String(row.email), name: "Owner", platformAdmin: false } as Account;
};
const run = async (fx: Fx, name: string, input: unknown = {}) =>
  (await ownerTools.runOwnerTool({ account: await accountOf(fx), store: await storeOf(fx), invalidate: () => {} }, name, input)) as Answer;
/** Moves an order's placing day back: the figures date an order by `placed_at` (not guarded once paid; the documents keep their own dates). */
const placeBack = async (orderId: string, daysAgo: number) =>
  db().execute(sql`update commerce.orders set placed_at = now() - make_interval(days => ${daysAgo}) where id = ${orderId}::uuid`);

beforeAll(async () => {
  store = await fxStore("aedit", { invoicing: true, live: true });
  period = await fxStore("aedit-period", { invoicing: true, live: true });
  other = await fxStore("aedit-other", { invoicing: true, live: true });
  empty = await fxStore("aedit-none");
  today = await dayOf(0);
});
afterAll(async () => {
  await closeDb();
});

describe("an order lowered by a change counts once, at its new amount (Refunds, Edited order)", () => {
  for (const market of [NO, NO_EUR]) {
    it(`leaves the change's refund out of Finance and the refunds drill-down, and counts a later refund (${market.currency})`, async () => {
      const shop = await storeOf(store);
      const day = customPeriod(today, today);
      const before = await periodTotals(shop, day);
      const beforeRefunds = await refundsReport(shop, day);
      const order = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]], { market });
      const placedExVat = await exVat(order.orderId);
      const done = await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [lineOf(order, "DEMO-TOTE").id]: 1 }, reason: "customer_request" }, staffActor(store.accountId));
      if (!done.ok) throw new Error(JSON.stringify(done));
      const [refund] = await db().execute<Row>(sql`select amount_minor, status from commerce.refunds where order_edit_id = ${done.editId}::uuid`);
      expect(refund).toMatchObject({ status: "succeeded" });
      const editedExVat = await exVat(order.orderId);
      expect(editedExVat).toBeLessThan(placedExVat);

      const after = await periodTotals(shop, day);
      const afterRefunds = await refundsReport(shop, day);
      const main = (minor: number) => toMainOne(shop, market.currency, minor)!;
      // Revenue moved by the order's amount as it now is (converted once; a sum converted against its parts may differ by a minor unit).
      expect(Math.abs(after.totals.revenueMinor - before.totals.revenueMinor - main(editedExVat))).toBeLessThanOrEqual(1);
      expect(after.totals.orders - before.totals.orders).toBe(1);
      // The change's refund is not a refund: nothing moved in Refunds, the drill-down or its count.
      expect(after.totals.refundsMinor).toBe(before.totals.refundsMinor);
      expect(afterRefunds.refunds).toBe(beforeRefunds.refunds);
      expect(afterRefunds.refundedOrders).toBe(beforeRefunds.refundedOrders);
      expect(afterRefunds.refundsMinor).toBe(beforeRefunds.refundsMinor);

      // A refund after the change is a refund like any other, scaled to without VAT by the order as it now is.
      const amount = market.currency === "EUR" ? 500 : 5_000;
      const later = await refundOrder(store.storeId, order.orderId, { amountMinor: amount, reason: "Goodwill", restock: [] }, store.accountId);
      expect(later).toMatchObject({ ok: true });
      const o = await orderRow(order.orderId);
      const scaled = Math.round((amount * (Number(o.total_minor) - Number(o.tax_minor))) / Number(o.total_minor));
      const withLater = await periodTotals(shop, day);
      expect(Math.abs(withLater.totals.refundsMinor - after.totals.refundsMinor - main(scaled))).toBeLessThanOrEqual(1);
      expect((await refundsReport(shop, day)).refunds).toBe(beforeRefunds.refunds + 1);
    });
  }

  it("leaves the change's refund out of sales_summary's refunded, and the change's payment is not an order", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const before = await run(store, "sales_summary", { days: 1 });
    const nokBefore = before.per_currency.find((c: Answer) => c.currency === "NOK");
    const outside = await edits.recordEditPaidOutside(
      store.storeId,
      { orderId: order.orderId, raw: { added: [{ variantId: await variantOf(store, "DEMO-MUG-BLACK"), quantity: 1 }], reason: "customer_request" } },
      { method: "bank_transfer" },
      staffActor(store.accountId),
    );
    if (!outside.ok) throw new Error(JSON.stringify(outside));
    const lowered = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const done = await edits.applyOrderEdit(store.storeId, lowered.orderId, { quantities: { [lineOf(lowered, "DEMO-TOTE").id]: 1 }, reason: "out_of_stock" }, staffActor(store.accountId));
    if (!done.ok) throw new Error(JSON.stringify(done));
    const after = await run(store, "sales_summary", { days: 1 });
    const nokAfter = after.per_currency.find((c: Answer) => c.currency === "NOK");
    // One more paid order (the lowered one); the raised one was counted before and its change's payment adds no order.
    expect(nokAfter.paid_orders - nokBefore.paid_orders).toBe(1);
    expect(nokAfter.refunded).toBe(nokBefore.refunded);
  });
});

describe("an order changed in another period than it was placed (Edited order, the reconciliation's edit causes)", () => {
  it("counts on the day it was placed at its amount as changed, and the reconciliation names the change in both periods and balances", async () => {
    const shop = await storeOf(period);
    const placedDay = await dayOf(40);
    const order = await paidOrder(period, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]]);
    await placeBack(order.orderId, 40);
    // E1 lowers it (an edit credit note), E2 adds to it, paid outside Kaizen (an additional invoice).
    const lowered = await edits.applyOrderEdit(period.storeId, order.orderId, { quantities: { [lineOf(order, "DEMO-MUG-WHITE").id]: 0 }, reason: "customer_request" }, staffActor(period.accountId));
    if (!lowered.ok) throw new Error(JSON.stringify(lowered));
    const raised = await edits.recordEditPaidOutside(
      period.storeId,
      { orderId: order.orderId, raw: { added: [{ variantId: await variantOf(period, "DEMO-NOTEBOOK-DOTTED"), quantity: 1 }], reason: "customer_request" } },
      { method: "cash" },
      staffActor(period.accountId),
    );
    if (!raised.ok) throw new Error(JSON.stringify(raised));
    const docs = await db().execute<Row>(sql`select documents from commerce.order_edits where order_id = ${order.orderId}::uuid order by seq`);
    expect(docs.map((d) => d.documents)).toEqual(["issued", "issued"]);

    // Finance: the order on the day it was placed, at its amounts as changed; one order; no refund; nothing on the day of the change.
    const then = await periodTotals(shop, customPeriod(placedDay, placedDay));
    const o = await orderRow(order.orderId);
    expect(then.totals.orders).toBe(1);
    expect(then.totals.revenueMinor).toBe(Number(o.total_minor) - Number(o.tax_minor));
    expect(then.totals.vatMinor).toBe(Number(o.tax_minor));
    expect(then.totals.refundsMinor).toBe(0);
    const now = await periodTotals(shop, customPeriod(today, today));
    expect(now.totals.orders).toBe(0);
    expect(now.totals.refundsMinor).toBe(0);

    const [credit] = await db().execute<Row>(sql`select tax_minor from commerce.credit_notes where order_edit_id = ${lowered.editId}::uuid`);
    const [extra] = await db().execute<Row>(sql`select tax_minor from commerce.invoices where order_edit_id = ${raised.editId}::uuid`);
    const [original] = await db().execute<Row>(sql`select tax_minor from commerce.invoices where order_id = ${order.orderId}::uuid and kind = 'order'`);
    const R = Number(credit.tax_minor);
    const A = Number(extra.tax_minor);
    expect(R).toBeGreaterThan(0);
    expect(A).toBeGreaterThan(0);
    // The documents add up to the order as it now is, VAT included.
    expect(Number(original.tax_minor) + A - R).toBe(Number(o.tax_minor));

    const causeOf = (lines: { kind: string; cause: string | null; taxMinor: number; orders: number }[], cause: string) => lines.find((l) => l.kind === "cause" && l.cause === cause);
    // The period the order was placed in: Finance has it (as changed); the original invoice and the additional one are dated later; the credit is named.
    const p1 = (await taxSnapshot(shop, { from: placedDay, to: addDay(placedDay) })).reconciliation;
    expect(p1.balanced).toBe(true);
    const nok1 = p1.bridges.find((b) => b.currency === "NOK")!;
    expect(nok1.financeMinor).toBe(Number(o.tax_minor));
    expect(nok1.reportMinor).toBe(0);
    expect(causeOf(nok1.lines, "timing_out")).toMatchObject({ orders: 1, taxMinor: Number(original.tax_minor) });
    expect(causeOf(nok1.lines, "edit_out")).toMatchObject({ orders: 1, taxMinor: A });
    expect(causeOf(nok1.lines, "edit_credited")).toMatchObject({ orders: 1, taxMinor: R });
    expect(p1.undocumented.orders).toBe(0);
    // Today: the invoices are dated here, the order is not; the additional invoice is its own named line.
    const p2 = (await taxSnapshot(shop, { from: today, to: addDay(today) })).reconciliation;
    expect(p2.balanced).toBe(true);
    const nok2 = p2.bridges.find((b) => b.currency === "NOK")!;
    expect(nok2.financeMinor).toBe(0);
    expect(nok2.reportMinor).toBe(Number(original.tax_minor) + A);
    expect(causeOf(nok2.lines, "timing_in")).toMatchObject({ orders: 1, taxMinor: Number(original.tax_minor) });
    expect(causeOf(nok2.lines, "edit_in")).toMatchObject({ orders: 1, taxMinor: A });
    // Both together: only the change's credit note is left between the two figures.
    const both = (await taxSnapshot(shop, { from: placedDay, to: addDay(today) })).reconciliation;
    expect(both.balanced).toBe(true);
    const nok = both.bridges.find((b) => b.currency === "NOK")!;
    expect(nok.lines.filter((l) => l.kind === "cause").map((l) => [l.cause, l.taxMinor])).toEqual([["edit_credited", R]]);
    // The refunds line compares refunds with refund credit notes only: the change's refund and its credit note are in neither.
    expect(both.refunds.find((r) => r.currency === "NOK")?.financeMinor ?? 0).toBe(0);
  });

  it("never reads another store's change, and a store with none has no edit line, no partly sent figure and no refund", async () => {
    const theirs = await paidOrder(other, [["DEMO-TOTE", 2]]);
    const done = await edits.applyOrderEdit(other.storeId, theirs.orderId, { quantities: { [lineOf(theirs, "DEMO-TOTE").id]: 1 }, reason: "customer_request" }, staffActor(other.accountId));
    if (!done.ok) throw new Error(JSON.stringify(done));
    const shop = await storeOf(empty);
    const totals = await periodTotals(shop, customPeriod(today, today));
    expect(totals.totals).toMatchObject({ orders: 0, revenueMinor: 0, refundsMinor: 0 });
    const recon = (await taxSnapshot(shop, { from: today, to: addDay(today) })).reconciliation;
    expect(recon.bridges).toEqual([]);
    expect(recon.balanced).toBe(true);
    const center = await controlCenter(await accountOf(empty), empty.slug);
    expect(center.stores[0].partlySent).toBeUndefined();
    expect(center.stores[0].orderChanges).toBeUndefined();
    expect(center.stores[0].owedUnits).toBe(0);
    // The edit store's reconciliation over today holds no row of the other store's change.
    const mine = (await taxSnapshot(await storeOf(period), { from: today, to: addDay(today) })).reconciliation;
    const [own] = await db().execute<Row>(sql`select coalesce(sum(tax_minor), 0)::bigint as tax from commerce.invoices where store_id = ${period.storeId}::uuid and supply_date = ${today}::date`);
    expect(mine.bridges.find((b) => b.currency === "NOK")!.reportMinor).toBe(Number(own.tax));
    expect(mine.balanced).toBe(true);
    const [theirsEdit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_edits where store_id = ${other.storeId}::uuid and documents = 'issued'`);
    expect(Number(theirsEdit.n)).toBeGreaterThan(0);
  });
});

describe("parcels and changes waiting in the figures (Owed, the control center)", () => {
  it("owes only the backordered units still to send, equal to the Inventory page's own figure", async () => {
    const lamp = await variantOf(store, "DEMO-LAMP");
    await db().execute(sql`update commerce.product_variants set stock_policy = 'continue', backorder_days = 7 where id = ${lamp}::uuid`);
    // One lamp on hand in all: an order of four sells three on backorder.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${store.storeId}::uuid and variant_id = ${lamp}::uuid`);
    await db().execute(sql`
      update commerce.inventory_levels set on_hand = 1
      where store_id = ${store.storeId}::uuid and variant_id = ${lamp}::uuid
        and location_id = (select location_id from commerce.inventory_levels where store_id = ${store.storeId}::uuid and variant_id = ${lamp}::uuid order by location_id limit 1)
    `);
    const order = await paidOrder(store, [["DEMO-LAMP", 4]]);
    const line = lineOf(order, "DEMO-LAMP");
    const [backordered] = await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where id = ${line.id}::uuid`);
    expect(Number(backordered.backorder_quantity)).toBe(3);
    const before = await inventoryCounts(store.storeId);
    const centerBefore = (await controlCenter(await accountOf(store), store.slug)).stores[0];
    expect(centerBefore.owedUnits).toBe(before.owed);
    // Send two of the four: of the three on backorder, only the two still to send are owed.
    const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "OW1", trackingUrl: null }, store.accountId, null, { lines: [{ lineId: line.id, quantity: 2 }] });
    expect(sent).toMatchObject({ ok: true, left: 2 });
    const after = await inventoryCounts(store.storeId);
    expect(before.owed - after.owed).toBe(1);
    const center = (await controlCenter(await accountOf(store), store.slug)).stores[0];
    expect(center.owedUnits).toBe(after.owed);
  });

  it("counts partly sent orders and changes waiting for payment, only for a member who may read orders", async () => {
    const order = await paidOrder(period, [["DEMO-TOTE", 2]]);
    const sent = await markSent(period.storeId, order.orderId, { carrier: "posten", trackingNumber: "CC1", trackingUrl: null }, period.accountId, null, {
      lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }],
    });
    expect(sent).toMatchObject({ ok: true, left: 1 });
    const waiting = await paidOrder(period, [["DEMO-TOTE", 1]]);
    const link = await edits.sendOrderEdit(period.storeId, waiting.orderId, { added: [{ variantId: await variantOf(period, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, staffActor(period.accountId), { email: false });
    expect(link).toMatchObject({ ok: true });
    const view = (await controlCenter(await accountOf(period), period.slug)).stores[0];
    expect(view.partlySent).toMatchObject({ orders: 1 });
    expect(view.partlySent!.oldestFirstParcelAt).not.toBeNull();
    expect(view.orderChanges).toEqual({ waiting: 1, expiringSoon: 0 });
    const texts = attentionFor([view]).map((i) => [i.text, i.href]);
    expect(texts).toContainEqual([expect.stringContaining("1 order is partly sent"), `/admin/${period.slug}/orders?ship=partly_sent`]);
    expect(texts).toContainEqual([expect.stringContaining("1 order change is waiting for the customer's payment"), `/admin/${period.slug}/orders?ship=edit_pending`]);
    // A member whose role may not read orders: the figures are left out, never shown as 0.
    expect(attentionFor([{ ...view, hides: ["sales"] }]).some((i) => /partly sent|order change/.test(i.text))).toBe(false);
  });
});

describe("the order file and the AI manager", () => {
  it("writes fulfilment and edited, and leaves the change's refund out of refunded", async () => {
    const order = await paidOrder(other, [["DEMO-TOTE", 3]]);
    const done = await edits.applyOrderEdit(other.storeId, order.orderId, { quantities: { [lineOf(order, "DEMO-TOTE").id]: 2 }, reason: "customer_request" }, staffActor(other.accountId));
    if (!done.ok) throw new Error(JSON.stringify(done));
    await markSent(other.storeId, order.orderId, { carrier: "posten", trackingNumber: "F1", trackingUrl: null }, other.accountId, null, { lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }] });
    const plain = await paidOrder(other, [["DEMO-MUG-WHITE", 1]]);
    const reader = await orderExportReader(await storeOf(other), { mode: "range", from: "2020-01-01", to: "2099-12-31", which: "all", layout: "orders", profile: "accounting", copied: true, dialect: "standard" });
    const read = await reader.read(null, 1000);
    const rows = read.rows.map((r) => Object.fromEntries(reader.header.map((h, i) => [h, r[i]])));
    const edited = rows.find((r) => r.order_number === order.number)!;
    expect(edited).toMatchObject({ fulfilment: "partly_sent", edited: "true", refund_count: 0 });
    expect(rows.find((r) => r.order_number === plain.number)).toMatchObject({ fulfilment: "unsent", edited: "false" });
  });

  it("get_order says the sending, the parcels' contents, what is still to send and the changes, never staff's note", async () => {
    const order = await paidOrder(period, [["DEMO-TOTE", 3], ["DEMO-MUG-WHITE", 1]]);
    const done = await edits.applyOrderEdit(
      period.storeId,
      order.orderId,
      { quantities: { [lineOf(order, "DEMO-MUG-WHITE").id]: 0 }, reason: "customer_request", note: "Secret staff words" },
      staffActor(period.accountId),
    );
    if (!done.ok) throw new Error(JSON.stringify(done));
    const fresh = await readOrder(period, order.orderId);
    await markSent(period.storeId, order.orderId, { carrier: "posten", trackingNumber: "G1", trackingUrl: null }, period.accountId, null, { lines: [{ lineId: lineOf(fresh, "DEMO-TOTE").id, quantity: 1 }] });
    const out = await run(period, "get_order", { order: order.number });
    expect(out.sending).toBe("Partly sent");
    expect(out.still_to_send).toEqual([expect.objectContaining({ sku: "DEMO-TOTE", units: 2 })]);
    expect(out.shipments).toEqual([expect.objectContaining({ tracking: "G1", contents: [expect.objectContaining({ sku: "DEMO-TOTE", units: 1 })] })]);
    expect(out.changes).toEqual([expect.objectContaining({ change: "E1", status: "Applied", reason: "The customer asked" })]);
    expect(out.changes[0].difference).toMatch(/less$/);
    expect(JSON.stringify(out)).not.toContain("Secret staff words");
  });

  it("pick_list sums what is still to send of this store's orders, names the ones it cannot pick, and never another store's", async () => {
    const a = await paidOrder(empty, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]]);
    const b = await paidOrder(empty, [["DEMO-TOTE", 1]]);
    await markSent(empty.storeId, a.orderId, { carrier: "posten", trackingNumber: "PL1", trackingUrl: null }, empty.accountId, null, { lines: [{ lineId: lineOf(a, "DEMO-TOTE").id, quantity: 1 }] });
    const theirs = await paidOrder(other, [["DEMO-TOTE", 5]]);
    const out = await run(empty, "pick_list", { orders: [a.number, b.number, theirs.orderId], by: "product", sort: "sku" });
    expect(out.units_in_all).toBe(3);
    expect(out.orders_to_pick).toBe(2);
    expect(out.products).toEqual([
      { title: expect.any(String), sku: "DEMO-MUG-WHITE", units: 1, orders: 1 },
      { title: expect.any(String), sku: "DEMO-TOTE", units: 2, orders: 2 },
    ]);
    expect(out.left_out).toEqual([{ order: theirs.orderId, why: "Not found" }]);
    expect(out.printable).toMatch(new RegExp(`^/admin/${empty.slug}/orders/pick-list\\?ids=`));
    expect(JSON.stringify(out)).not.toMatch(/\bkr\b|NOK|EUR|@example\.com/);
    // Everything to send: the same two orders, by order.
    const all = await run(empty, "pick_list", { by: "order" });
    expect(all.orders.map((o: Answer) => [o.order, o.units])).toEqual(expect.arrayContaining([[a.number, 2], [b.number, 1]]));
    expect(all.units_in_all).toBe(3);
  });
});
