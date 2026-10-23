import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { forgetLimitMemos, usageNow } = await import("./limits");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof makeStore>>;

/** A store override of one limit at what the store uses now plus `room`. */
async function cap(key: string, room = 0): Promise<void> {
  forgetLimitMemos();
  const used = key === "stores_owned" ? 0 : await usageNow(store.id, key as Parameters<typeof usageNow>[1]);
  await db().execute(sql`
    insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, ${key}, ${used + room}, 'Test')
    on conflict (store_id, account_id, key) do update set value = excluded.value`);
  forgetLimitMemos();
}

beforeAll(async () => {
  store = await makeStore("enforce");
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.account.id}::uuid`);
  forgetLimitMemos();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.account.id}::uuid`);
  await closeDb();
});

describe("the product limit", () => {
  it("refuses a new product at the limit, and still saves one that already counts", async () => {
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const shop = (await getStore(store.slug))!;
    const editor = await getEditorContext(shop);
    const [existing] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and status <> 'archived' and kind = 'goods' order by created_at limit 1`);
    const input = (await getProductForEdit(shop, editor, String(existing.id)))!;
    await cap("products");
    const copy = { ...input, handle: `${input.handle}-again`, variants: input.variants.map((v) => ({ ...v, id: null, sku: `${v.sku}-again` })) };
    const refused = await saveProduct(shop, editor, null, copy as typeof input);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? "" : refused.problems.join(" ")).toMatch(/products/);
    expect(await saveProduct(shop, editor, String(existing.id), input)).toMatchObject({ ok: true });
  });
});

describe("the staff limit", () => {
  it("refuses an invitation past the store's places", async () => {
    const settings = await import("./settings");
    const member = await membershipOf(store.slug, store.account);
    await cap("staff_seats");
    const result = await settings.inviteStaff(member, `seat-${store.slug}@example.com`, "admin");
    expect(result).toMatchObject({ ok: false });
    await cap("staff_seats", 1);
    expect(await settings.inviteStaff(member, `seat-${store.slug}@example.com`, "admin")).toEqual({ ok: true });
  });
});

describe("the store limit", () => {
  it("refuses another store past the owner's limit", async () => {
    const platform = await import("./platform");
    await db().execute(sql`insert into commerce.limit_overrides (account_id, key, value, reason) values (${store.account.id}::uuid, 'stores_owned', 1, 'Test')`);
    const made = await platform.createStoreForOwner(store.account, "Second", `${store.slug}-second`);
    expect(made).toMatchObject({ ok: false });
    expect(made.ok ? "" : made.problems.join(" ")).toMatch(/1 stores/);
  });
});

describe("storage", () => {
  it("refuses a person's upload past the limit, never Kaizena Flow's own", async () => {
    const { storageRefusal } = await import("./limits");
    await cap("storage_bytes", 1000);
    expect(await storageRefusal(store.id, 500)).toBeNull();
    expect(await storageRefusal(store.id, 5000)).toMatch(/storage/);
    expect(await storageRefusal(null, 10 ** 12)).toBeNull();
    expect(await storageRefusal("platform", 10 ** 12)).toBeNull();
  });
});

describe("AI on Kaizena Flow's key", () => {
  it("is no AI for the month at the limit, and only for that store", async () => {
    const ai = await import("./ai");
    const [had] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ai_providers where store_id is null and enabled`);
    if (Number(had.n) === 0) {
      await db().execute(sql`insert into commerce.ai_providers (store_id, provider, base_url, enabled, text_model) values (null, 'openai', null, true, 'text-a')`).catch(() => undefined);
    }
    const before = await ai.aiFor(store.id, { feature: "search" });
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'ai_cost_month_micros', 0, 'Test')`);
    forgetLimitMemos();
    if (before?.source === "platform") expect(await ai.aiFor(store.id, { feature: "search" })).toBeNull();
    expect(await ai.aiFor(null, { feature: "search" })).toEqual(before ? expect.objectContaining({ source: before.source }) : null);
  });
});
