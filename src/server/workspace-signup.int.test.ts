import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * A sign-up for extensions (D748 E7 part two): a request that ticked no store is approved into a workspace in its country, with the trials
 * of what it ticked started (once extensions are sold); a store's request that ticked extensions starts their trials beside its store.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const platform = await import("./platform");

const run = Date.now().toString(36);
let admin: Account;
const origin = "https://kaizen.test";

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`ws-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(a.id), email: String(a.email), name: "Admin", platformAdmin: true };
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = null`);
  await closeDb();
});

const requestOf = async (email: string) => {
  const [row] = await db().execute<Row>(sql`select id, wants_store, extensions, country from commerce.access_requests where lower(email) = lower(${email}) order by created_at desc limit 1`);
  return row;
};

describe("a sign-up for extensions (D748 E7)", () => {
  it("keeps what was ticked; a request for no store and no extension is a store's", async () => {
    const email = `ws-none-${run}@example.com`;
    await platform.createAccessRequest({ name: "None", email, storeName: "None", message: "", wantsStore: false, extensions: [] }, { quiet: true });
    expect(await requestOf(email)).toMatchObject({ wants_store: true, extensions: [] });
  });

  it("approves a request without a store into a workspace in its country, with the trials of what it ticked", async () => {
    const email = `ws-solo-${run}@example.com`;
    await platform.createAccessRequest(
      { name: "Solo", email, storeName: "Solo desk", message: "", wantsStore: false, extensions: ["support_desk", "deals"], country: "NO" },
      { quiet: true },
    );
    const request = await requestOf(email);
    expect(request).toMatchObject({ wants_store: false, extensions: ["support_desk", "deals"], country: "NO" });
    const result = await platform.approveAccessRequest(admin, String(request.id), "unused-slug", "Unused", origin);
    expect(result).toMatchObject({ ok: true, workspace: true, email });
    if (!result.ok) return;
    const [store] = await db().execute<Row>(sql`
      select s.workspace, s.name, (select k.currency from commerce.markets k where k.store_id = s.id and k.active) as currency
        from commerce.stores s where s.id = ${result.storeId}::uuid`);
    expect(store).toEqual({ workspace: true, name: "Solo desk", currency: "NOK" });
    const trials = await db().execute<Row>(sql`
      select e.extension_id, e.source from commerce.organisation_extensions e
        join commerce.stores s on s.organisation_id = e.organisation_id where s.id = ${result.storeId}::uuid order by e.extension_id`);
    expect(trials).toEqual([
      { extension_id: "deals", source: "trial" },
      { extension_id: "support_desk", source: "trial" },
    ]);
  });

  it("starts the trials a store's sign-up ticked beside its store", async () => {
    const email = `ws-store-${run}@example.com`;
    await platform.createAccessRequest({ name: "Shop", email, storeName: "Shop", message: "", extensions: ["email_automation"] }, { quiet: true });
    const request = await requestOf(email);
    const result = await platform.approveAccessRequest(admin, String(request.id), `ws-shop-${run}`, "Shop", origin);
    expect(result).toMatchObject({ ok: true, trials: 1 });
    expect(result.ok && result.workspace).toBeFalsy();
  });
});
