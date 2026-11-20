import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * A standalone account's workspace (D748 E7 part one): its owner's store list, the stores counted against `stores_owned` and the storefront
 * all leave it out, while it stays open for jobs.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const auth = await import("./auth");
const limits = await import("./limits");
const stores = await import("./stores");

const run = Date.now().toString(36);
let owner: Account;
let slug: string;

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`workspace-${run}@example.com`}, 'Solo') returning id, email`);
  owner = { id: String(a.id), email: String(a.email), name: "Solo", platformAdmin: false };
  const [made] = await db().execute<Row>(sql`select commerce.make_workspace(${owner.id}::uuid, 'Solo desk', 'NO', 'NOK', 'nb-NO') as id`);
  const [store] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${String(made.id)}::uuid`);
  slug = String(store.slug);
});

afterAll(async () => {
  await closeDb();
});

describe("a workspace is no store (D748 E7)", () => {
  it("is not in its owner's store list, nor counted against the stores they may have", async () => {
    expect((await auth.listStores(owner)).map((s) => s.slug)).not.toContain(slug);
    expect(await limits.ownedStoreCount(owner.id)).toBe(0);
  });

  it("is never served as a storefront, yet stays open for its jobs", async () => {
    expect(await stores.getStore(slug)).toMatchObject({ workspace: true });
    expect(await stores.getOpenStore(slug)).toBeNull();
    const [active] = await db().execute<Row>(sql`select commerce.store_is_active(id) as on from commerce.stores where slug = ${slug}`);
    expect(active.on).toBe(true);
  });
});
