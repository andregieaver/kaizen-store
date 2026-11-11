import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

type Sent = { kind: string; to: string; email: { subject: string; html: string; text: string } };
const sent: Sent[] = [];
vi.mock("./email", async (original) => ({
  ...(await original<typeof import("./email")>()),
  sendEmail: vi.fn(async (message: Sent) => {
    sent.push(message);
    return "logged";
  }),
}));

const orders = await import("./supplier-orders");
const suppliers = await import("./suppliers");
const { variantStockOf } = await import("./catalog");
const { checkupFindings } = await import("./store-checkup");
const { storeOf } = await import("./product-data");
const route = await import("@/app/api/supply/v1/[...path]/route");
const { clearLevels, newStore, pay, place, setLevel, variantId, levelsOf, mainLocation } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let supplierId = "";
let key = "";
const mine = () => ({ storeId: store.storeId });

const call = (method: "GET" | "POST", path: string[], body?: unknown, bearer = key) =>
  (method === "GET" ? route.GET : route.POST)(
    new Request(`http://localhost/api/supply/v1/${path.join("/")}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ path }) } as never,
  );

beforeAll(async () => {
  store = await newStore("supplier-steps");
  const saved = await suppliers.saveDropShipSupplier(store.member, { name: "Lagerhuset", orderEmail: "ordre@lagerhuset.example", shipsFrom: "SE", orderLanguage: "sv", orderMethod: "connected", dispatchDays: 2 });
  if (!saved.ok) throw new Error(saved.problem);
  supplierId = saved.id;
  await suppliers.setVariantsSupplier(store.member, supplierId, [await variantId(store.storeId, "DEMO-MUG-WHITE")], true);
  await clearLevels(store.storeId, "DEMO-MUG-WHITE");
});

afterAll(async () => {
  await closeDb();
});

async function paidOrder(units: number) {
  const order = await place(store.storeId, [["DEMO-MUG-WHITE", units]]);
  await pay(store.storeId, order, store.account);
  await orders.collectSupplierOrders(mine());
  const [row] = await db().execute<Row>(sql`select id from commerce.supplier_orders where order_id = ${order.orderId}::uuid`);
  await db().execute(sql`update commerce.supplier_orders set send_after = now() - interval '1 minute' where id = ${String(row.id)}::uuid`);
  return { orderId: order.orderId, supplierOrderId: String(row.id) };
}

describe("a connected supplier and its key (D553, step 3)", () => {
  it("has a key only the owner makes, kept as a hash, refused once revoked", async () => {
    expect(await suppliers.makeSupplierKey({ ...store.member, role: "admin", permissions: ["products:write"] } as never, supplierId)).toMatchObject({ ok: false });
    const made = await suppliers.makeSupplierKey(store.member, supplierId);
    if (!made.ok) throw new Error(made.problem);
    key = made.key;
    expect(key.startsWith("kzsp_")).toBe(true);
    const [row] = await db().execute<Row>(sql`select api_key_hash, api_key_hint from commerce.suppliers where id = ${supplierId}::uuid`);
    expect(String(row.api_key_hash)).not.toContain(key);
    expect(row.api_key_hint).toBe(key.slice(-4));
    expect((await call("GET", ["orders"], undefined, "kzsp_wrong")).status).toBe(401);
  });

  it("sets its stock through the API, only for the variants it sends", async () => {
    const answer = await call("POST", ["stock"], { items: [{ sku: "DEMO-MUG-WHITE", quantity: 25 }, { sku: "DEMO-TOTE", quantity: 9 }] });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true, set: 1, unknown: ["DEMO-TOTE"] });
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ Lagerhuset: 25 });
    expect((await call("POST", ["stock"], { items: [{ sku: "DEMO-MUG-WHITE", quantity: -1 }] })).status).toBe(422);
  });

  it("tells the shopper the supplier's days while the store has none of its own", async () => {
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    expect((await variantStockOf(db(), store.storeId, [mug])).get(mug)).toMatchObject({ inStock: 25, supplierDays: 2 });
    await setLevel(store.storeId, "DEMO-MUG-WHITE", await mainLocation(store.storeId), 3);
    expect((await variantStockOf(db(), store.storeId, [mug])).get(mug)?.supplierDays).toBeUndefined();
    await setLevel(store.storeId, "DEMO-MUG-WHITE", await mainLocation(store.storeId), 0);
  });

  it("reads its orders without an email, posts the parcel, and the customer gets the shipped email", async () => {
    const order = await paidOrder(2);
    expect(await orders.sendDueSupplierOrders(mine())).toEqual({ sent: 1, cancelled: 0 });
    expect(sent.filter((m) => m.kind === "supplier.order")).toHaveLength(0);
    const listed = (await (await call("GET", ["orders"])).json()) as { orders: { id: string; number: string; shipTo: Record<string, string>; lines: { sku: string; quantity: number }[] }[] };
    const mineOrder = listed.orders.find((o) => o.id === order.supplierOrderId)!;
    expect(mineOrder.lines).toEqual([{ sku: "DEMO-MUG-WHITE", title: expect.any(String), quantity: 2 }]);
    expect(mineOrder.shipTo.name).toBe("Kari Nordmann");
    const csv = await (await call("GET", ["orders.csv"])).text();
    expect(csv.split("\r\n")[0]).toContain("order_id,order_number,sku");
    expect(csv).toContain("DEMO-MUG-WHITE");
    const bad = await call("POST", ["orders", order.supplierOrderId, "parcel"], { carrier: "postnord", trackingNumber: "!" });
    expect(bad.status).toBe(422);
    const posted = await call("POST", ["orders", order.supplierOrderId, "parcel"], { carrier: "postnord", trackingNumber: "SE123456789" });
    expect(posted.status).toBe(200);
    expect(sent.some((m) => m.kind === "order.sent" && m.to === "kari@example.com")).toBe(true);
    expect((await call("POST", ["orders", order.supplierOrderId, "parcel"], { carrier: "postnord", trackingNumber: "SE123456789" })).status).toBe(409);
    // Another store's order id is not this supplier's.
    expect((await call("POST", ["orders", "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d", "parcel"], { carrier: "ups", trackingNumber: "1Z999" })).status).toBe(404);
  });

  it("keeps an always-available supplier's stock topped up", async () => {
    const [location] = await db().execute<Row>(sql`select id from commerce.inventory_locations where supplier_id = ${supplierId}::uuid`);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", String(location.id), 4);
    await db().execute(sql`update commerce.suppliers set always_available = true where id = ${supplierId}::uuid`);
    await orders.topUpAlwaysAvailable();
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ Lagerhuset: 10_000 });
    await db().execute(sql`update commerce.suppliers set always_available = false where id = ${supplierId}::uuid`);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", String(location.id), 25);
  });

  it("revokes the key at once", async () => {
    expect(await suppliers.revokeSupplierKey(store.member, supplierId)).toEqual({ ok: true });
    expect((await call("GET", ["orders"])).status).toBe(401);
  });
});

describe("late suppliers, the owner's answers and what is owed (D553, steps 4 and 5)", () => {
  it("reminds a late supplier once and tells the owners once; the checkup names it", async () => {
    // Without a key, the connected supplier gets the email (and so a link to its page and a reminder).
    const order = await paidOrder(1);
    await orders.sendDueSupplierOrders(mine());
    expect(sent.filter((m) => m.kind === "supplier.order")).toHaveLength(1);
    await db().execute(sql`update commerce.supplier_orders set sent_at = now() - interval '10 days' where id = ${order.supplierOrderId}::uuid`);
    expect(await orders.remindLateSuppliers(mine())).toBe(1);
    expect(await orders.remindLateSuppliers(mine())).toBe(0);
    expect(sent.filter((m) => m.kind === "supplier.reminder")).toHaveLength(1);
    expect(sent.find((m) => m.kind === "supplier.reminder")?.email.subject).toContain("Påminnelse");
    expect(sent.filter((m) => m.kind === "supplier.late").length).toBeGreaterThanOrEqual(1);
    const late = (await checkupFindings((await storeOf(store.storeId))!, store.accountId)).find((f) => f.key === "supplier_late");
    expect(late).toMatchObject({ count: 1, page: "/inventory/suppliers" });
    expect(late?.what).toContain("Lagerhuset");
    const listed = await orders.listSupplierOrders(store.storeId, supplierId);
    expect(listed.find((o) => o.id === order.supplierOrderId)).toMatchObject({ state: "sent", late: true });
    const perf = (await orders.supplierPerformance(store.storeId)).find((p) => p.supplierId === supplierId);
    expect(perf).toMatchObject({ shipped: 1, onTime: 1, late: 1 });

    // The owner sends it again: a new email at once, no longer late; then cancels its part.
    expect(await orders.answerSupplierOrder(store.member, order.supplierOrderId, "resend")).toEqual({ ok: true });
    expect(sent.filter((m) => m.kind === "supplier.order")).toHaveLength(2);
    expect(await orders.answerSupplierOrder(store.member, order.supplierOrderId, "cancel")).toEqual({ ok: true });
    expect(await orders.answerSupplierOrder(store.member, order.supplierOrderId, "cancel")).toMatchObject({ ok: false });
  });

  it("adds up what the shop owes for the month's parcels at the frozen cost", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const owed = await orders.owedToSupplier(store.storeId, supplierId, month);
    expect(owed.rows).toHaveLength(1);
    expect(owed.rows[0].units).toBe(2);
    const [line] = await db().execute<Row>(sql`
      select ol.unit_cost_minor from commerce.supplier_orders so join commerce.supplier_order_lines l on l.supplier_order_id = so.id
      join commerce.order_lines ol on ol.id = l.order_line_id where so.supplier_id = ${supplierId}::uuid and so.state = 'shipped' limit 1`);
    expect(owed.totalMinor).toBe(2 * Number(line.unit_cost_minor ?? 0));
    expect(owed.rows[0].missingCost).toBe(line.unit_cost_minor === null);
    expect(await orders.owedToSupplier(store.storeId, supplierId, "bad")).toEqual({ rows: [], totalMinor: 0 });
  });

  it("keeps the store's wait between 0 and a day", async () => {
    expect(await suppliers.saveDropShipWait(store.member, 90)).toEqual({ ok: true });
    expect(await suppliers.dropShipWait(store.storeId)).toBe(90);
    expect(await suppliers.saveDropShipWait(store.member, 2000)).toMatchObject({ ok: false });
  });
});
