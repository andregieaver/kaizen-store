import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

type Sent = { kind: string; to: string; email: { subject: string; html: string; text: string }; secrets?: readonly string[]; fromName: string };
const sent: Sent[] = [];
vi.mock("./email", async (original) => ({
  ...(await original<typeof import("./email")>()),
  sendEmail: vi.fn(async (message: Sent) => {
    sent.push(message);
    return "logged";
  }),
}));

const { collectSupplierOrders, listSupplierOrders, postSupplierParcel, reportSupplierProblem, sendDueSupplierOrders, supplierOrderByToken } = await import("./supplier-orders");
const { saveDropShipSupplier, setVariantsSupplier } = await import("./suppliers");
const support = await import("./inventory-test-support");
const { clearLevels, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let supplierId = "";

beforeAll(async () => {
  store = await newStore("supplier-orders");
  const saved = await saveDropShipSupplier(store.member, { name: "Nordic Wool", orderEmail: "orders@nordicwool.example", shipsFrom: "DK", orderLanguage: "da", orderNote: "Send uden eget logo." });
  if (!saved.ok) throw new Error(saved.problem);
  supplierId = saved.id;
  await setVariantsSupplier(store.member, supplierId, [await variantId(store.storeId, "DEMO-MUG-WHITE")], true);
  const [location] = await db().execute<Row>(sql`select id from commerce.inventory_locations where supplier_id = ${supplierId}::uuid`);
  await clearLevels(store.storeId, "DEMO-MUG-WHITE");
  await setLevel(store.storeId, "DEMO-MUG-WHITE", String(location.id), 50);
});

afterAll(async () => {
  await closeDb();
});

/** A paid order of the supplier's mug (and a product the store sends itself), its supplier order made. */
async function paidOrder(units: number): Promise<{ orderId: string; supplierOrderId: string }> {
  const order = await place(store.storeId, [["DEMO-MUG-WHITE", units], ["DEMO-TOTE", 1]]);
  await pay(store.storeId, order, store.account);
  await collectSupplierOrders(mine());
  const [row] = await db().execute<Row>(sql`select id from commerce.supplier_orders where order_id = ${order.orderId}::uuid`);
  return { orderId: order.orderId, supplierOrderId: String(row.id) };
}

/** Other test files leave supplier orders of their own stores: the job is asked about this store alone. */
const mine = () => ({ storeId: store.storeId });

const due = (id: string) => db().execute(sql`update commerce.supplier_orders set send_after = now() - interval '1 minute' where id = ${id}::uuid`);

/** The link in the last email to the supplier, as the supplier reads it. */
const tokenOfLastEmail = (): string => {
  const email = [...sent].reverse().find((m) => m.kind === "supplier.order");
  const match = email?.email.html.match(/\/supply\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no link in the supplier's email");
  return match[1];
};

describe("supplier orders (D541, step 2)", () => {
  let first: { orderId: string; supplierOrderId: string };
  let token = "";

  it("are made from the units the payment drew at the supplier's location, and wait for the store's wait", async () => {
    first = await paidOrder(2);
    const [so] = await db().execute<Row>(sql`select state, send_after > now() + interval '25 minutes' as waits from commerce.supplier_orders where id = ${first.supplierOrderId}::uuid`);
    expect(so).toEqual({ state: "waiting", waits: true });
    const lines = await db().execute<Row>(sql`select ol.sku, l.quantity from commerce.supplier_order_lines l join commerce.order_lines ol on ol.id = l.order_line_id where l.supplier_order_id = ${first.supplierOrderId}::uuid`);
    expect(lines).toEqual([{ sku: "DEMO-MUG-WHITE", quantity: 2 }]);
    // Made once: the job finds nothing new the next time.
    expect(await collectSupplierOrders(mine())).toBe(0);
    expect(await sendDueSupplierOrders(mine())).toEqual({ sent: 0, cancelled: 0 });
  });

  it("go to the supplier once the wait is over, in its language, with a link only its hash of which is kept", async () => {
    await due(first.supplierOrderId);
    expect(await sendDueSupplierOrders(mine())).toEqual({ sent: 1, cancelled: 0 });
    const email = sent.find((m) => m.kind === "supplier.order")!;
    expect(email.to).toBe("orders@nordicwool.example");
    expect(email.email.subject).toContain("send venligst");
    expect(email.email.text).toContain("Kari Nordmann");
    expect(email.email.text).toContain("Send uden eget logo.");
    expect(email.email.text).not.toContain("DEMO-TOTE");
    token = tokenOfLastEmail();
    expect(email.secrets).toEqual([token]);
    const [so] = await db().execute<Row>(sql`select state, token_hash from commerce.supplier_orders where id = ${first.supplierOrderId}::uuid`);
    expect(so.state).toBe("sent");
    expect(String(so.token_hash)).not.toContain(token);
    expect(await sendDueSupplierOrders(mine())).toEqual({ sent: 0, cancelled: 0 });
  });

  it("show the supplier its order alone on its page", async () => {
    const view = await supplierOrderByToken(token);
    expect(view).toMatchObject({ state: "sent", language: "da", note: "Send uden eget logo.", lines: [{ sku: "DEMO-MUG-WHITE", quantity: 2 }], orderPaid: true });
    expect(view?.shipTo).toContain("Kari Nordmann");
    expect(await supplierOrderByToken("x".repeat(43))).toBeNull();
    expect(await supplierOrderByToken("short")).toBeNull();
  });

  it("record the supplier's parcel for its lines only and email the customer the shop's shipped email, once", async () => {
    expect(await postSupplierParcel(token, { carrier: "postnord", trackingNumber: "!" })).toEqual({ ok: false, problem: "tracking" });
    expect(await postSupplierParcel(token, { carrier: "pigeon", trackingNumber: "AB123456" })).toEqual({ ok: false, problem: "carrier" });
    expect(await postSupplierParcel(token, { carrier: "postnord", trackingNumber: "00370712345678901234" })).toEqual({ ok: true });
    const [parcel] = await db().execute<Row>(sql`
      select s.tracking_number, (select string_agg(ol.sku || ':' || sl.quantity, ',') from commerce.shipment_lines sl join commerce.order_lines ol on ol.id = sl.order_line_id where sl.shipment_id = s.id) as lines
      from commerce.shipments s where s.order_id = ${first.orderId}::uuid
    `);
    expect(parcel).toEqual({ tracking_number: "00370712345678901234", lines: "DEMO-MUG-WHITE:2" });
    const [order] = await db().execute<Row>(sql`select status from commerce.orders where id = ${first.orderId}::uuid`);
    expect(order.status).toBe("paid"); // the tote, the store's own, is still to send
    expect(sent.some((m) => m.kind === "order.sent" && m.to === "kari@example.com")).toBe(true);
    expect(await postSupplierParcel(token, { carrier: "postnord", trackingNumber: "00370712345678901234" })).toEqual({ ok: false, problem: "done" });
    expect((await supplierOrderByToken(token))?.shipTo).toEqual([]);
  });

  it("tell the owners once when the supplier cannot send, refunding nothing", async () => {
    const second = await paidOrder(1);
    await due(second.supplierOrderId);
    await sendDueSupplierOrders(mine());
    const link = tokenOfLastEmail();
    expect(await reportSupplierProblem(link, "x")).toEqual({ ok: false, problem: "reason" });
    expect(await reportSupplierProblem(link, "Udsolgt til næste uge")).toEqual({ ok: true });
    expect(await reportSupplierProblem(link, "Stadig udsolgt")).toEqual({ ok: true });
    expect(sent.filter((m) => m.kind === "supplier.problem")).toHaveLength(1);
    expect(sent.find((m) => m.kind === "supplier.problem")?.email.text).toContain("Udsolgt til næste uge");
    const rows = await listSupplierOrders(store.storeId, supplierId);
    expect(rows.find((r) => r.orderId === second.orderId)).toMatchObject({ state: "problem", problem: "Stadig udsolgt", units: 1 });
    const [refunds] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${second.orderId}::uuid`);
    expect(refunds.n).toBe(0);
  });

  it("are cancelled, never sent, when the order is cancelled during the wait", async () => {
    const third = await paidOrder(1);
    await db().execute(sql`update commerce.orders set status = 'cancelled' where id = ${third.orderId}::uuid`);
    await due(third.supplierOrderId);
    const before = sent.length;
    expect(await sendDueSupplierOrders(mine())).toEqual({ sent: 0, cancelled: 1 });
    expect(sent.length).toBe(before);
  });
});
