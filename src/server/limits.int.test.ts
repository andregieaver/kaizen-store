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

describe("recordings of visits (D656)", () => {
  it("counts the month's recordings live and refuses one past the limit", async () => {
    limits.forgetLimitMemos();
    const started = new Date();
    for (let i = 0; i < 3; i++) {
      await db().execute(sql`
        insert into commerce.recordings (id, store_id, day, started_at, last_at, device, entry_page, mask)
        values (gen_random_uuid(), ${store.id}::uuid, ${started.toISOString().slice(0, 10)}::date, ${started.toISOString()}::timestamptz, ${started.toISOString()}::timestamptz, 'mobile', '/no', 'balanced')`);
    }
    try {
      const later = new Date(started.getTime() + 1000);
      expect(await limits.usageNow(store.id, "recordings_month", later)).toBe(3);
      await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'recordings_month', 3, 'Test')`);
      limits.forgetLimitMemos();
      expect(await limits.checkLimit(store.id, "recordings_month", 1, later)).toMatchObject({ ok: false, key: "recordings_month", limit: 3, used: 3 });
    } finally {
      await db().execute(sql`delete from commerce.recordings where store_id = ${store.id}::uuid`);
      await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid`);
    }
  });
});

describe("an account billed through its account (D748 E4)", () => {
  it("takes the account's plan, its stores' overrides at their widest, their use together, and counts its stores", async () => {
    const [sibling] = await db().execute<Row>(sql`
      insert into commerce.stores (slug, name, created_by) values (${`limits-sibling-${run}`}, 'Sibling', ${store.owner}::uuid) returning id`);
    const siblingId = String(sibling.id);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${siblingId}::uuid, ${store.owner}::uuid, 'owner')`);
    const [org] = await db().execute<Row>(sql`select organisation_id from commerce.stores where id = ${store.id}::uuid`);
    const organisation = String(org.organisation_id);
    try {
      limits.forgetLimitMemos();
      const ownSeats = await limits.usageNow(store.id, "staff_seats");
      const siblingSeats = await limits.usageNow(siblingId, "staff_seats");
      expect((await limits.storeLimits(store.id)).account).toBeNull();

      await db().execute(sql`insert into commerce.organisation_billing (organisation_id, plan_id, status) values (${organisation}::uuid, ${plan}::uuid, 'active')`);
      limits.forgetLimitMemos();
      const read = await limits.storeLimits(store.id);
      expect(read.account?.organisationId).toBe(organisation);
      expect(new Set(read.account?.stores)).toEqual(new Set([store.id, siblingId]));
      expect(read.limits.products).toEqual({ value: 50, origin: "plan" });
      expect(await limits.usageNow(store.id, "staff_seats")).toBe(ownSeats + siblingSeats);

      await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${siblingId}::uuid, 'products', 900, 'Launch')`);
      limits.forgetLimitMemos();
      expect((await limits.storeLimits(store.id)).limits.products).toEqual({ value: 900, origin: "override" });

      expect(await limits.ownerLimitFor(store.owner, "stores_owned")).toEqual({ value: 2, origin: "plan" });
      expect(await limits.ownedStoreCount(store.owner)).toBe(2);
      expect(await limits.checkOwnerStores(store.owner)).toEqual({ ok: false, key: "stores_owned", limit: 2, used: 2 });
    } finally {
      await db().execute(sql`delete from commerce.limit_overrides where store_id = ${siblingId}::uuid`);
      await db().execute(sql`delete from commerce.organisation_billing where organisation_id = ${organisation}::uuid`);
      await db().execute(sql`update commerce.stores set status = 'closed' where id = ${siblingId}::uuid`);
      limits.forgetLimitMemos();
    }
  });
});
