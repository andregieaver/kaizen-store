import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { SUPPLIER_PRIORITY_BASE } from "@/lib/drop-shipping";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { listDropShipSuppliers, saveDropShipSupplier, setVariantsSupplier, stopDropShipping, supplierVariants } = await import("./suppliers");
const { listLocations } = await import("./inventory-locations");
const support = await import("./inventory-test-support");
const { clearLevels, holdsOf, levelsOf, mainLocation, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("suppliers");
  other = await newStore("suppliers-other");
});

afterAll(async () => {
  await closeDb();
});

const wool = { name: "Nordic Wool", orderEmail: "Orders@NordicWool.example", shipsFrom: "dk", orderLanguage: "da", dispatchDays: 3, orderNote: "Send without your own branding." };
const staff = () => ({ ...store.member, role: "admin" as const, permissions: ["products:read", "products:write"] });
const readOnly = () => ({ ...store.member, role: "viewer" as const, permissions: ["products:read"] });

describe("a drop-shipping supplier (D550, step 1)", () => {
  let supplierId = "";

  it("is added with a location of its own, kept off the store's own places and ranked after them", async () => {
    const saved = await saveDropShipSupplier(store.member, wool);
    if (!saved.ok) throw new Error(saved.problem);
    supplierId = saved.id;
    const [supplier] = await listDropShipSuppliers(store.storeId);
    expect(supplier).toMatchObject({ name: "Nordic Wool", orderEmail: "orders@nordicwool.example", shipsFrom: "DK", outsideEu: false, orderLanguage: "da", dispatchDays: 3, orderMethod: "email", variants: 0 });
    const [location] = await db().execute<Row>(sql`select name, country, priority, active, fulfils_online from commerce.inventory_locations where store_id = ${store.storeId}::uuid and supplier_id = ${supplierId}::uuid`);
    expect(location).toMatchObject({ name: "Nordic Wool", country: "DK", active: true, fulfils_online: true });
    expect(Number(location.priority)).toBeGreaterThan(SUPPLIER_PRIORITY_BASE);
    expect((await listLocations(store.storeId)).map((l) => l.name)).not.toContain("Nordic Wool");
  });

  it("refuses a second with the same name, a bad address or country, and staff who may not change products", async () => {
    expect(await saveDropShipSupplier(store.member, { ...wool, name: " nordic  WOOL " })).toEqual({ ok: false, problem: "A drop-shipping supplier already has this name." });
    expect(await saveDropShipSupplier(store.member, { ...wool, name: "B", orderEmail: "no-at-sign" })).toEqual({ ok: false, problem: "Check the email address." });
    expect(await saveDropShipSupplier(store.member, { ...wool, name: "C", shipsFrom: "ZZ" })).toEqual({ ok: false, problem: "Choose the country it ships from." });
    expect(await saveDropShipSupplier(store.member, { ...wool, name: "D", dispatchDays: 31 })).toMatchObject({ ok: false });
    expect(await saveDropShipSupplier(readOnly() as never, { ...wool, name: "E" })).toMatchObject({ ok: false });
  });

  it("takes over a supplier the store already books bills from, and flags one outside the EU", async () => {
    await db().execute(sql`insert into commerce.suppliers (store_id, name) values (${store.storeId}::uuid, 'Shenzhen Goods')`);
    const saved = await saveDropShipSupplier(staff() as never, { ...wool, name: "shenzhen goods", shipsFrom: "CN", orderLanguage: "en" });
    if (!saved.ok) throw new Error(saved.problem);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.suppliers where store_id = ${store.storeId}::uuid and lower(name) = 'shenzhen goods'`);
    expect(count.n).toBe(1);
    expect((await listDropShipSuppliers(store.storeId)).find((s) => s.id === saved.id)).toMatchObject({ name: "Shenzhen Goods", outsideEu: true });
    // A change of name follows to its location.
    expect(await saveDropShipSupplier(store.member, { ...wool, name: "Shenzhen Goods Ltd", shipsFrom: "CN" }, saved.id)).toEqual({ ok: true, id: saved.id });
    const [location] = await db().execute<Row>(sql`select name from commerce.inventory_locations where supplier_id = ${saved.id}::uuid`);
    expect(location.name).toBe("Shenzhen Goods Ltd");
  });

  it("marks physical goods as sent by it, with a level at its location, and not another store's", async () => {
    const white = await variantId(store.storeId, "DEMO-MUG-WHITE");
    const elsewhere = await variantId(other.storeId, "DEMO-MUG-WHITE");
    expect(await setVariantsSupplier(store.member, supplierId, [white, elsewhere], true)).toEqual({ ok: true, changed: 1 });
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ "Nordic Wool": 0 });
    const listed = await supplierVariants(store.storeId, supplierId);
    expect(listed[0]).toMatchObject({ id: white, supplierId, sku: "DEMO-MUG-WHITE" });
    expect(await supplierVariants(store.storeId, supplierId, "zzz-nothing")).toEqual([]);
    expect((await listDropShipSuppliers(store.storeId)).find((s) => s.id === supplierId)?.variants).toBe(1);
    // Marking it again changes nothing; another store's supplier is refused.
    expect(await setVariantsSupplier(store.member, supplierId, [white], true)).toEqual({ ok: true, changed: 0 });
    expect(await setVariantsSupplier(other.member, supplierId, [elsewhere], true)).toEqual({ ok: false, problem: "This supplier is not in this store." });
  });

  it("sends an order from the supplier when the store has none of it, and own stock first when it has some", async () => {
    const [location] = await db().execute<Row>(sql`select id from commerce.inventory_locations where supplier_id = ${supplierId}::uuid`);
    const own = await mainLocation(store.storeId);
    await clearLevels(store.storeId, "DEMO-MUG-WHITE");
    await setLevel(store.storeId, "DEMO-MUG-WHITE", String(location.id), 40);

    const first = await place(store.storeId, [["DEMO-MUG-WHITE", 2]]);
    expect(await holdsOf(store.storeId, "DEMO-MUG-WHITE")).toEqual({ "Nordic Wool": 2 });
    await pay(store.storeId, first, store.account);
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ "Nordic Wool": 38 });

    await setLevel(store.storeId, "DEMO-MUG-WHITE", own, 1);
    const ownName = String((await db().execute<Row>(sql`select name from commerce.inventory_locations where id = ${own}::uuid`))[0].name);
    const second = await place(store.storeId, [["DEMO-MUG-WHITE", 3]]);
    expect(await holdsOf(store.storeId, "DEMO-MUG-WHITE")).toEqual({ [ownName]: 1, "Nordic Wool": 2 });
    await pay(store.storeId, second, store.account);
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ [ownName]: 0, "Nordic Wool": 36 });
  });

  it("is left out of a copy of the store, with the stock kept at its location", async () => {
    const [copy] = await db().execute<Row>(sql`
      select commerce.duplicate_store(${store.storeId}::uuid, ${`${store.slug}-copy`}, 'Copy', ${store.accountId}::uuid, null, null, null) as id
    `);
    const copyId = String(copy.id);
    const [locations] = await db().execute<Row>(sql`
      select count(*) filter (where supplier_id is not null)::int as suppliers, count(*) filter (where name = 'Nordic Wool')::int as named
      from commerce.inventory_locations where store_id = ${copyId}::uuid
    `);
    expect(locations).toEqual({ suppliers: 0, named: 0 });
    const [variant] = await db().execute<Row>(sql`select supplier_id from commerce.product_variants where store_id = ${copyId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    expect(variant.supplier_id).toBeNull();
  });

  it("is stopped by the owner only: its variants go back to the store and its location closes", async () => {
    expect(await stopDropShipping(staff() as never, supplierId)).toMatchObject({ ok: false });
    expect(await stopDropShipping(store.member, supplierId)).toEqual({ ok: true, variants: 1 });
    expect(await stopDropShipping(store.member, supplierId)).toMatchObject({ ok: false });
    const [variant] = await db().execute<Row>(sql`select supplier_id from commerce.product_variants where id = ${await variantId(store.storeId, "DEMO-MUG-WHITE")}::uuid`);
    expect(variant.supplier_id).toBeNull();
    const [location] = await db().execute<Row>(sql`select active from commerce.inventory_locations where supplier_id = ${supplierId}::uuid`);
    expect(location.active).toBe(false);
    expect((await listDropShipSuppliers(store.storeId)).map((s) => s.id)).not.toContain(supplierId);
    // Added again, it drop-ships from the same location, open again.
    expect(await saveDropShipSupplier(store.member, wool)).toEqual({ ok: true, id: supplierId });
    const [again] = await db().execute<Row>(sql`select active, count(*) over ()::int as n from commerce.inventory_locations where supplier_id = ${supplierId}::uuid`);
    expect(again).toMatchObject({ active: true, n: 1 });
  });
});
