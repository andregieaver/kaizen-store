import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { STORE_EXPORT_TABLES, storeExport } = await import("./store-export");
const { newStore } = await import("./inventory-test-support");

/**
 * The whole store as one file (wave 10 unit P, D377): the website, look and settings of the store and of no other, every listed table there,
 * never a secret (a private mode's password hash and the support inbox's keys planted as canaries) or the people a row names, and the owner's only.
 */

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("storefile");
  other = await newStore("storefile-other");
  await db().execute(sql`update commerce.stores set private_password = 'canary-password-hash' where id = ${store.storeId}::uuid`);
  // The support inbox's keys open its channel and its email address: canaries that must stay out, beside settings that must go in.
  await db().execute(sql`
    insert into commerce.support_settings (store_id, email_key, channel_key, transcript_days) values (${store.storeId}::uuid, 'canaryemailkey1234', 'canary-channel-key', 60)
    on conflict (store_id) do update set email_key = excluded.email_key, channel_key = excluded.channel_key, transcript_days = excluded.transcript_days`);
  await db().execute(sql`insert into commerce.shipping_settings (store_id, default_weight_grams) values (${store.storeId}::uuid, 1234) on conflict (store_id) do update set default_weight_grams = 1234`);
});

afterAll(async () => {
  await closeDb();
});

describe("the store as a file", () => {
  it("holds every listed table of this store and nothing of another, with no secret and no person named", async () => {
    const [page] = await db().execute<Row>(sql`select count(*)::int as n from commerce.pages where store_id = ${store.storeId}::uuid`);
    const file = await storeExport(store.member);
    if (!file.ok) throw new Error("no file");
    const parsed = JSON.parse(file.json);
    expect(parsed).toMatchObject({ schema: "kaizen.store-export", version: 1 });
    expect(Object.keys(parsed.tables)).toEqual([...STORE_EXPORT_TABLES]);
    expect(parsed.tables.pages).toHaveLength(Number(page.n));
    expect(parsed.store.slug).toBe(store.slug);
    expect(file.json).not.toContain("canary-password-hash");
    expect(file.json).not.toContain(other.storeId);
    expect(file.json).not.toContain(store.accountId);
    expect(file.json).not.toContain("canaryemailkey1234");
    expect(file.json).not.toContain("canary-channel-key");
    expect(parsed.tables.support_settings).toEqual([expect.objectContaining({ transcript_days: 60 })]);
    expect(parsed.tables.shipping_settings).toEqual([expect.objectContaining({ default_weight_grams: 1234 })]);
    for (const rows of Object.values(parsed.tables) as Record<string, unknown>[][]) {
      for (const row of rows) expect(Object.keys(row).filter((k) => /secret|token|password|_by$|store_id/.test(k))).toEqual([]);
    }
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.exported' order by created_at desc limit 1`);
    expect((entry.details as { counts: Record<string, number> }).counts.pages).toBe(page.n);
  });

  it("is the owner's only", async () => {
    expect(await storeExport({ ...store.member, role: "admin" })).toEqual({ ok: false });
  });
});
