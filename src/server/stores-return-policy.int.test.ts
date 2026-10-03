import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { DEFAULT_RETURN_POLICY } from "@/lib/structured-data";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { getStore } = await import("./stores");
const { storeFacts } = await import("./seo");

type Row = Record<string, unknown>;

/**
 * The store's return policy as search engines are told it (D153): read with the store, from `commerce.return_settings`, so a store that
 * has not set its rules says the legal defaults and one that has says its own window, who pays and whether excluded goods come back.
 */

const run = Date.now().toString(36);

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

afterAll(async () => {
  await closeDb();
});

describe("Store.returnPolicy", () => {
  it("is the legal default for a store with no return settings", async () => {
    const slug = `rp-default-${run}`;
    await makeStore(slug);
    const store = (await getStore(slug))!;
    expect(store.returnPolicy).toEqual(DEFAULT_RETURN_POLICY);
    expect(storeFacts(store).returns).toEqual(DEFAULT_RETURN_POLICY);
  });

  it("is what the store's settings say, and follows a change", async () => {
    const slug = `rp-own-${run}`;
    const id = await makeStore(slug);
    await db().execute(sql`
      insert into commerce.return_settings (store_id, window_days, who_pays_return, accept_excluded) values (${id}::uuid, 30, 'store', true)
    `);
    expect((await getStore(slug))!.returnPolicy).toEqual({ days: 30, whoPaysReturn: "store", acceptExcluded: true });
    await db().execute(sql`update commerce.return_settings set window_days = 60, who_pays_return = 'shopper', accept_excluded = false where store_id = ${id}::uuid`);
    const store = (await getStore(slug))!;
    expect(store.returnPolicy).toEqual({ days: 60, whoPaysReturn: "shopper", acceptExcluded: false });
    expect(storeFacts(store).returns).toEqual(store.returnPolicy);
  });

  it("is each store's own", async () => {
    const a = `rp-a-${run}`;
    const b = `rp-b-${run}`;
    const idA = await makeStore(a);
    await makeStore(b);
    await db().execute(sql`insert into commerce.return_settings (store_id, window_days) values (${idA}::uuid, 45)`);
    expect((await getStore(a))!.returnPolicy.days).toBe(45);
    expect((await getStore(b))!.returnPolicy.days).toBe(14);
  });
});
