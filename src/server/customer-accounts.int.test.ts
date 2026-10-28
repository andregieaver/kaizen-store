import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const { saveAccountsMode } = await import("./customer-accounts");
const { setFeature } = await import("./store-features");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

afterAll(async () => {
  await closeDb();
});

const customer = async (storeId: string) =>
  String((await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`acct-${fx.unique("c")}@example.com`}) returning id`))[0].id);

/**
 * Customer accounts optional, required or off (wave 10 unit B, D365): `placeOrder()` refuses a cart without a signed-in customer while the store
 * requires accounts, and sells to guests again when they are optional; accounts cannot be switched off while a feature needs them, and such a
 * feature cannot be switched on while they are off; every change is audited.
 */
describe("customer accounts", () => {
  it("requires a signed-in customer to place an order while accounts are required", async () => {
    const own = await fx.makeStore("acct-req");
    const owner = await fx.ownerOf(own);
    expect(await saveAccountsMode(owner, "required")).toEqual({ ok: true });
    expect((await getStore(own.slug))!.customerAccounts).toBe("required");

    await expect(fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]])).rejects.toThrow("placeOrder: sign_in_required");
    const placed = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { customerId: await customer(own.storeId) });
    expect(placed.orderId).toBeTruthy();

    expect(await saveAccountsMode(await fx.ownerOf(own), "optional")).toEqual({ ok: true });
    expect((await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]])).orderId).toBeTruthy();

    const audits = await db().execute<Row>(sql`select changes from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'store.customer_accounts' order by id`);
    expect(audits.map((a) => a.changes)).toEqual([{ customerAccounts: { from: "optional", to: "required" } }, { customerAccounts: { from: "required", to: "optional" } }]);
  });

  it("is not switched off while a feature needs accounts, and such a feature is not switched on while they are off", async () => {
    const own = await fx.makeStore("acct-off");
    let owner = await fx.ownerOf(own);
    expect((await setFeature(owner, "bonus", true)).ok).toBe(true);
    owner = await fx.ownerOf(own);
    const refused = await saveAccountsMode(owner, "off", undefined, (id) => `[${id}]`);
    expect(refused).toEqual({ ok: false, problems: ["Switch off [bonus] first: it needs customer accounts."] });
    expect((await setFeature(owner, "bonus", false, { confirmed: true })).ok).toBe(true);

    owner = await fx.ownerOf(own);
    expect(await saveAccountsMode(owner, "off")).toEqual({ ok: true });
    const on = await setFeature(await fx.ownerOf(own), "referrals", true);
    expect(on.ok).toBe(false);
    if (!on.ok) expect(on.problems.join(" ")).toContain("needs customer accounts");
    // Off is still a store that sells to guests.
    expect((await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]])).orderId).toBeTruthy();
  });

  it("refuses a mode that is not one, and a member without settings:write", async () => {
    const own = await fx.makeStore("acct-bad");
    const owner = await fx.ownerOf(own);
    expect((await saveAccountsMode(owner, "sometimes")).ok).toBe(false);
    const admin = { ...owner, role: "read_only" as never, permissions: [] as never };
    expect((await saveAccountsMode(admin, "off")).ok).toBe(false);
  });
});
