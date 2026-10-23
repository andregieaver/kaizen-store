import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeCapacityStore } from "./capacity-test-support";
import { BUDGETS, budgetBuckets, takeBudget } from "./request-budget";

const run = Date.now().toString(36);
let store: Awaited<ReturnType<typeof makeCapacityStore>>;

beforeAll(async () => {
  store = await makeCapacityStore("budget", run);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("takeBudget", () => {
  it("allows a visitor up to the ceiling in a minute, then refuses, and another visitor still gets through", async () => {
    const { visitor } = budgetBuckets("suggest", "busy-visitor");
    // Fill the visitor's minute at once rather than asking 120 times.
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (${store.id}::uuid, ${visitor}, date_trunc('minute', now()), ${BUDGETS.suggest.visitor - 1})
    `);
    expect(await takeBudget(store.id, "suggest", "busy-visitor")).toBe(true);
    expect(await takeBudget(store.id, "suggest", "busy-visitor")).toBe(false);
    expect(await takeBudget(store.id, "suggest", "calm-visitor")).toBe(true);
  });

  it("refuses everyone when the store's own ceiling is passed", async () => {
    const { store: bucket } = budgetBuckets("suggest", "x");
    await db().execute(sql`update commerce.chat_usage set count = ${BUDGETS.suggest.store} where store_id = ${store.id}::uuid and bucket = ${bucket}`);
    expect(await takeBudget(store.id, "suggest", "new-visitor")).toBe(false);
  });
});
