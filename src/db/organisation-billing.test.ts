import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Accounts billed through their account (D748 step E4 part one), against real Postgres (PGlite): `commerce.store_plans` gives each store its
 * own billing until its account has a row in `commerce.organisation_billing`, then the account's; Kaizena Flow's own account is never billed;
 * a price belongs to its plan; and what an account's plan includes follows the account's row once it has one.
 */

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

/** An account with `stores` stores its maker owns. */
async function account(stores = 1): Promise<{ organisation: string; stores: string[] }> {
  counter += 1;
  const person = (await one<{ id: string }>("insert into commerce.accounts (email, name) values ($1, 'Billed') returning id", [`billed-${counter}@example.com`])).id;
  const ids: string[] = [];
  for (let i = 0; i < stores; i++) {
    const store = (await one<{ id: string }>("insert into commerce.stores (slug, name, created_by) values ($1, 'Billed', $2) returning id", [`billed-${counter}-${i}`, person])).id;
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [store, person]);
    ids.push(store);
  }
  const organisation = (await one<{ organisation_id: string }>("select organisation_id from commerce.stores where id = $1", [ids[0]])).organisation_id;
  return { organisation, stores: ids };
}

async function plan(name: string): Promise<{ plan: string; price: string }> {
  const id = (await one<{ id: string }>("insert into commerce.plans (name) values ($1) returning id", [name])).id;
  const price = (await one<{ id: string }>("insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values ($1, 'EUR', 'month', 2900) returning id", [id])).id;
  return { plan: id, price };
}

type Plan = { plan_id: string | null; status: string | null; by_account: boolean; sale_fee_bps_override: number | null; trial_ends_at: string | null };
const planOf = (store: string) => one<Plan>("select plan_id, status, by_account, sale_fee_bps_override, trial_ends_at from commerce.store_plans where store_id = $1", [store]);

describe("commerce.store_plans (D748 E4)", () => {
  it("gives a store its own billing while its account has no row, and nothing when it has none", async () => {
    const { stores } = await account(2);
    const basic = await plan("Own basic");
    await db.query("insert into commerce.store_billing (store_id, plan_id, price_id, status, sale_fee_bps_override) values ($1, $2, $3, 'active', 150)", [stores[0], basic.plan, basic.price]);
    expect(await planOf(stores[0])).toMatchObject({ plan_id: basic.plan, status: "active", by_account: false, sale_fee_bps_override: 150 });
    expect(await planOf(stores[1])).toMatchObject({ plan_id: null, status: null, by_account: false });
  });

  it("gives every store of an account billed through its account the account's plan and trial; a store's own fee still wins", async () => {
    const { organisation, stores } = await account(2);
    const basic = await plan("Old basic");
    const grow = await plan("Account grow");
    await db.query("insert into commerce.store_billing (store_id, plan_id, price_id, status, sale_fee_bps_override) values ($1, $2, $3, 'canceled', 120)", [stores[0], basic.plan, basic.price]);
    await db.query(
      "insert into commerce.organisation_billing (organisation_id, plan_id, price_id, status, sale_fee_bps_override, trial_ends_at) values ($1, $2, $3, 'trialing', 180, now() + interval '5 days')",
      [organisation, grow.plan, grow.price],
    );
    expect(await planOf(stores[0])).toMatchObject({ plan_id: grow.plan, status: "trialing", by_account: true, sale_fee_bps_override: 120 });
    const second = await planOf(stores[1]);
    expect(second).toMatchObject({ plan_id: grow.plan, status: "trialing", by_account: true, sale_fee_bps_override: 180 });
    expect(second.trial_ends_at).not.toBeNull();
  });

  it("never bills Kaizena Flow's own account, and keeps a price to its plan", async () => {
    const platform = (await one<{ id: string }>("select commerce.platform_organisation() as id")).id;
    await expect(db.query("insert into commerce.organisation_billing (organisation_id) values ($1)", [platform])).rejects.toThrow(/organisation_billing\.platform/);
    const { organisation } = await account();
    const a = await plan("Mismatch a");
    const b = await plan("Mismatch b");
    await expect(
      db.query("insert into commerce.organisation_billing (organisation_id, plan_id, price_id) values ($1, $2, $3)", [organisation, a.plan, b.price]),
    ).rejects.toThrow(/organisation_billing_price_plan_fk/);
  });

  it("takes what the plan includes from the account's own plan once it is billed through its account", async () => {
    const { organisation, stores } = await account();
    const own = await plan("Grants own");
    const theirs = await plan("Grants account");
    const size = (id: string) => one<{ id: string }>("select id from commerce.extension_sizes where extension_id = $1 order by position limit 1", [id]);
    await db.query("insert into commerce.plan_extension_grants (plan_id, extension_id, size_id) values ($1, 'ab_testing', $2), ($3, 'work', $4)", [
      own.plan,
      (await size("ab_testing")).id,
      theirs.plan,
      (await size("work")).id,
    ]);
    await db.query("insert into commerce.store_billing (store_id, plan_id, price_id, status) values ($1, $2, $3, 'active')", [stores[0], own.plan, own.price]);
    const included = async () => (await one<{ facts: { included: string[] } }>("select commerce.organisation_extension_facts($1) as facts", [organisation])).facts.included;
    const on = async (id: string) => (await one<{ on: boolean }>("select commerce.extension_on($1, $2) as on", [stores[0], id])).on;
    expect(await included()).toEqual(["ab_testing"]);
    await db.query("insert into commerce.organisation_billing (organisation_id, plan_id, price_id, status) values ($1, $2, $3, 'active')", [organisation, theirs.plan, theirs.price]);
    expect(await included()).toEqual(["work"]);
    await db.query("update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'");
    try {
      expect([await on("ab_testing"), await on("work")]).toEqual([false, true]);
      // The account's plan ended: the stores' old plans do not come back.
      await db.query("update commerce.organisation_billing set status = 'canceled' where organisation_id = $1", [organisation]);
      expect([await on("ab_testing"), await on("work")]).toEqual([false, false]);
    } finally {
      await db.query("update commerce.platform_settings set extensions_launched_at = null");
    }
  });
});
