import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { eraseSubject } = await import("./privacy-erasure");
const { fakeStorage } = await import("./data-test-support");

type Row = Record<string, unknown>;

let store: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("review-exports");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("security review: a shopper's own account deletion", () => {
  it("must not delete the owner's ready order file or stop a running export when the shopper was in neither", async () => {
    const storage = fakeStorage();
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.storeId}::uuid, 'brand-new-signup@example.test') returning id`);
    const path = `${store.storeId}/job-ready/part-1.csv`;
    storage.files.set(`exports/${path}`, new TextEncoder().encode("number\r\nK-1\r\n"));
    const files = [{ path, name: "orders.csv", rows: 1, bytes: 12, sha256: "a".repeat(64) }];
    const [ready] = await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values (${store.storeId}::uuid, 'order_export', 'queued', 'write', 'kaizen', ${store.ownerId}::uuid) returning id`);
    await db().execute(sql`update commerce.data_jobs set status = 'running' where id = ${String(ready.id)}::uuid`);
    await db().execute(sql`update commerce.data_jobs set status = 'done', phase = 'assemble', files = ${JSON.stringify(files)}::jsonb, expires_at = now() + interval '7 days' where id = ${String(ready.id)}::uuid`);
    const [running] = await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values (${store.storeId}::uuid, 'customer_export', 'queued', 'write', 'kaizen', ${store.ownerId}::uuid) returning id`);

    const result = await eraseSubject(store.storeId, { customerId: String(customer.id) }, { channel: "shopper", accountId: null }, { avatarRemover: async () => {}, dataStorage: storage });
    expect(result).toMatchObject({ ok: true });

    const state = async (id: unknown) => (await db().execute<Row>(sql`select status, purged_at from commerce.data_jobs where id = ${String(id)}::uuid`))[0];
    // An unrelated visitor's account deletion changes nothing about the owner's exports.
    expect((await state(ready.id)).status).toBe("done");
    expect(storage.files.has(`exports/${path}`)).toBe(true);
    expect((await state(running.id)).status).toBe("queued");
  });
});
