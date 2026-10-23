import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { makeAccount, makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const owner = await import("./owner-tools");
const manager = await import("./manager-tools");
const { forgetLimitMemos } = await import("./limits");

// Tool answers are loose JSON, read field by field here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;
let store: Awaited<ReturnType<typeof makeStore>>;

beforeAll(async () => {
  store = await makeStore("usage-tools");
  await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'products', 1, 'Test')`);
  forgetLimitMemos();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("usage_and_limits (owner)", () => {
  it("gives the Billing page's lines in words, with the limit and where it comes from", async () => {
    const shop = (await getStore(store.slug))!;
    const answer = (await owner.runOwnerTool({ account: store.account, store: shop, invalidate: () => {} }, "usage_and_limits", {})) as Answer;
    const products = answer.lines.find((l: Answer) => l.what === "Products");
    expect(products).toMatchObject({ limit: "1", from: "set by Kaizena Flow for this store" });
    expect(answer.lines.find((l: Answer) => l.what === "Visits")).toMatchObject({ used: "not measured yet", note: "only warns: the shop stays open" });
    expect(answer.link).toBe(`/admin/${store.slug}/billing`);
  });

  it("is refused to a member whose role may not read billing", async () => {
    const shop = (await getStore(store.slug))!;
    await expect(owner.runOwnerTool({ account: store.account, store: shop, invalidate: () => {}, holder: { role: "admin", permissions: [] } }, "usage_and_limits", {})).rejects.toThrow();
  });
});

describe("store_usage (platform)", () => {
  it("gives one store's lines to a platform admin and nothing to anyone else", async () => {
    const admin = await makeAccount("usage-admin", { platformAdmin: true });
    const ctx = { account: admin, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: () => {} };
    const answer = (await manager.runPlatformTool(ctx, "store_usage", { store: store.slug })) as Answer;
    expect(answer.store).toBeTruthy();
    expect(answer.lines.some((l: Answer) => l.what === "Storage")).toBe(true);
    const top = (await manager.runPlatformTool(ctx, "store_usage", {})) as Answer;
    expect(top.by).toBe("Storage");
    await expect(manager.runPlatformTool({ ...ctx, account: store.account }, "store_usage", {})).rejects.toThrow("Only platform admins");
  });
});
