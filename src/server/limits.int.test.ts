import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeCapacityStore } from "./capacity-test-support";
import * as limits from "./limits";



type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let store: Awaited<ReturnType<typeof makeCapacityStore>>;
let plan: string;
let bigPlan: string;

const setDefault = async (key: string, value: number | null) => {
  await db().execute(sql`
    insert into commerce.plan_limits (plan_id, key, value) values (null, ${key}, ${value})
    on conflict (plan_id, key) do update set value = excluded.value`);
};

beforeAll(async () => {
  store = await makeCapacityStore("limits", run);
  const [a] = await db().execute<Row>(sql`insert into commerce.plans (name) values (${`Limits ${run}`}) returning id`);
  const [b] = await db().execute<Row>(sql`insert into commerce.plans (name) values (${`Limits big ${run}`}) returning id`);
  plan = String(a.id);
  bigPlan = String(b.id);
  await db().execute(sql`insert into commerce.plan_limits (plan_id, key, value) values (${plan}::uuid, 'products', 50), (${plan}::uuid, 'stores_owned', 2), (${bigPlan}::uuid, 'stores_owned', 5)`);
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.plan_limits where plan_id is null`);
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.owner}::uuid`);
  await db().execute(sql`delete from commerce.store_billing where store_id = ${store.id}::uuid`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.plan_limits where plan_id is null`);
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.owner}::uuid`);
  await db().execute(sql`delete from commerce.store_billing where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.plans where id in (${plan}::uuid, ${bigPlan}::uuid)`);
  await closeDb();
});

const onPlan = (planId: string, status = "active") =>
  db().execute(sql`insert into commerce.store_billing (store_id, plan_id, status) values (${store.id}::uuid, ${planId}::uuid, ${status})
                   on conflict (store_id) do update set plan_id = excluded.plan_id, status = excluded.status`);

describe("limitFor", () => {
  it("is unlimited when nothing is set", async () => {
    limits.forgetLimitMemos();
    expect(await limits.limitFor(store.id, "products")).toBeNull();
  });

  it("takes the override, then the plan while on it, then the default", async () => {
    await setDefault("products", 10);
    limits.forgetLimitMemos();
    expect(await limits.limitFor(store.id, "products")).toBe(10);
    await onPlan(plan);
    limits.forgetLimitMemos();
    expect(await limits.limitFor(store.id, "products")).toBe(50);
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'products', 900, 'Launch')`);
    limits.forgetLimitMemos();
    expect((await limits.storeLimits(store.id)).limits.products).toEqual({ value: 900, origin: "override" });
  });

  it("ignores an override that has ended, and a plan the store is no longer on", async () => {
    await setDefault("products", 10);
    await onPlan(plan, "canceled");
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason, expires_at) values (${store.id}::uuid, 'products', 900, 'Old', now() - interval '1 day')`);
    limits.forgetLimitMemos();
    expect((await limits.storeLimits(store.id)).limits.products).toEqual({ value: 10, origin: "platform" });
  });

  it("never limits a template or a demo store", async () => {
    await setDefault("products", 1);
    const [template] = await db().execute<Row>(sql`select id from commerce.stores where is_template limit 1`);
    limits.forgetLimitMemos();
    expect(await limits.limitFor(String(template.id), "products")).toBeNull();
  });
});

describe("checkLimit", () => {
  it("refuses only past a hard limit", async () => {
    const used = await limits.usageNow(store.id, "products");
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'products', ${used}, 'Full')`);
    limits.forgetLimitMemos();
    expect(await limits.checkLimit(store.id, "products")).toEqual({ ok: false, key: "products", limit: used, used });
    limits.forgetLimitMemos();
    expect(await limits.checkLimit(store.id, "products", 0)).toEqual({ ok: true });
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'requests_month', 0, 'Soft')`);
    limits.forgetLimitMemos();
    expect(await limits.checkLimit(store.id, "requests_month", 10 ** 6)).toEqual({ ok: true });
  });
});

describe("owner limits", () => {
  it("takes the account's override, else the best plan among its stores, else the default", async () => {
    await setDefault("stores_owned", 1);
    limits.forgetLimitMemos();
    expect(await limits.ownerLimitFor(store.owner, "stores_owned")).toEqual({ value: 1, origin: "platform" });
    await onPlan(plan);
    limits.forgetLimitMemos();
    expect((await limits.ownerLimitFor(store.owner, "stores_owned")).value).toBe(2);
    await onPlan(bigPlan);
    limits.forgetLimitMemos();
    expect((await limits.ownerLimitFor(store.owner, "stores_owned")).value).toBe(5);
    await db().execute(sql`insert into commerce.limit_overrides (account_id, key, value, reason) values (${store.owner}::uuid, 'stores_owned', 1, 'Trial')`);
    limits.forgetLimitMemos();
    expect(await limits.checkOwnerStores(store.owner)).toEqual({ ok: false, key: "stores_owned", limit: 1, used: 1 });
  });
});
