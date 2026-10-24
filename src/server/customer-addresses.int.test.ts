import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const addr = await import("./customer-addresses");
const { gatherExport } = await import("./privacy-export");

type Row = Record<string, unknown>;

/**
 * Saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1): add, change, defaults, remove, the limit, `customers.address` kept
 * equal to the default shipping address, one store never reaching another's customer, and the export carrying them.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let customer: string;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  return String(created.id);
}

const place = (line1: string, country = "NO") => ({ name: "Kari", line1, line2: null, postalCode: "0150", city: "Oslo", country });

async function savedOnCustomer(): Promise<Record<string, unknown>> {
  const [row] = await db().execute<Row>(sql`select address from commerce.customers where id = ${customer}::uuid`);
  return row.address as Record<string, unknown>;
}

beforeAll(async () => {
  storeId = await makeStore("addr");
  otherId = await makeStore("addr-other");
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`kari-${run}@example.com`}) returning id`);
  customer = String(row.id);
});

afterAll(async () => {
  await closeDb();
});

describe("saved addresses (D304)", () => {
  it("makes the first address the default for both and keeps customers.address with it", async () => {
    const first = await addr.saveAddress(storeId, customer, { address: place("Home 1"), label: "Home" });
    expect(first.ok).toBe(true);
    const list = await addr.listAddresses(storeId, customer);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Home", isDefaultShipping: true, isDefaultBilling: true });
    expect((await savedOnCustomer()).line1).toBe("Home 1");
  });

  it("moves the default shipping address and the copy on the customer", async () => {
    const work = await addr.saveAddress(storeId, customer, { address: place("Work 2"), label: "Work" });
    if (!work.ok) throw new Error("not saved");
    expect((await savedOnCustomer()).line1).toBe("Home 1");
    await addr.setDefaultAddress(storeId, customer, work.id, "shipping");
    const list = await addr.listAddresses(storeId, customer);
    expect(list[0]).toMatchObject({ id: work.id, isDefaultShipping: true, isDefaultBilling: false });
    expect(list.filter((a) => a.isDefaultShipping)).toHaveLength(1);
    expect((await savedOnCustomer()).line1).toBe("Work 2");
  });

  it("changes the default through the details form, keeping its label", async () => {
    await addr.saveDefaultAddress(storeId, customer, place("Work 3"));
    const list = await addr.listAddresses(storeId, customer);
    expect(list[0]).toMatchObject({ label: "Work", address: { line1: "Work 3" } });
    expect(list).toHaveLength(2);
  });

  it("passes a removed default to the newest left, and empties the customer's copy when none are left", async () => {
    const [shipping] = await addr.listAddresses(storeId, customer);
    await addr.removeAddress(storeId, customer, shipping.id);
    const left = await addr.listAddresses(storeId, customer);
    expect(left).toHaveLength(1);
    expect(left[0].isDefaultShipping).toBe(true);
    expect((await savedOnCustomer()).line1).toBe("Home 1");
    await addr.removeAddress(storeId, customer, left[0].id);
    expect(await savedOnCustomer()).toEqual({});
  });

  it("answers not_found for another store or another customer's address, and stops at the limit", async () => {
    const mine = await addr.saveAddress(storeId, customer, { address: place("Mine") });
    if (!mine.ok) throw new Error("not saved");
    expect(await addr.saveAddress(otherId, customer, { address: place("Theirs") })).toEqual({ ok: false, reason: "not_found" });
    const [stranger] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`ola-${run}@example.com`}) returning id`);
    expect(await addr.removeAddress(storeId, String(stranger.id), mine.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await addr.saveAddress(storeId, String(stranger.id), { id: mine.id, address: place("Taken") })).toEqual({ ok: false, reason: "not_found" });
    for (let i = 1; i < 20; i++) await addr.saveAddress(storeId, customer, { address: place(`Extra ${i}`) });
    expect(await addr.saveAddress(storeId, customer, { address: place("One too many") })).toEqual({ ok: false, reason: "too_many" });
  });

  it("carries the saved addresses in the export", async () => {
    const input = await gatherExport({ storeId, customerId: customer, email: `kari-${run}@example.com`, addresses: [`kari-${run}@example.com`], cartIds: [], orderIds: [], subscriptionIds: [], locale: null } as never, "en", new Date());
    expect(input?.savedAddresses?.length).toBe(20);
  });
});
