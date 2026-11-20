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
const permissions = await import("./permissions");
const platform = await import("./platform");
const ownerLevel = await import("./owner-level");

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

  it("refuses its owner the areas it does not serve, as a key they lack (E7 part three)", async () => {
    const store = (await stores.getStore(slug))!;
    const member = { role: "owner" as const, kind: "staff" as const, permissions: null, store };
    for (const key of ["orders:read", "products:write", "website:read", "bookings:read"] as const) expect(permissions.memberCan(member, key), key).toBe(false);
    for (const key of ["owner", "customers:write", "marketing:write", "support:read", "settings:write", "staff:write", "books:read"] as const) {
      expect(permissions.memberCan(member, key), key).toBe(true);
    }
  });

  it("is its owner's place: in their workspaces, and their account's owner at the account's level", async () => {
    expect((await auth.listWorkspaces(owner)).map((s) => s.slug)).toEqual([slug]);
    const { who } = await ownerLevel.ownerWho(owner, await auth.listStores(owner));
    expect(who.owner).toBe(true);
  });

  it("lets its owner open the account's first store, with the plan's free trial, while an account with neither is refused", async () => {
    const [b] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`nobody-${run}@example.com`}, 'Nobody') returning id, email`);
    const nobody: Account = { id: String(b.id), email: String(b.email), name: "Nobody", platformAdmin: false };
    expect(await platform.createStoreForOwner(nobody, "Nobody's", `nobody-${run}`)).toMatchObject({ ok: false });

    const made = await platform.createStoreForOwner(owner, "Solo shop", `solo-shop-${run}`);
    expect(made).toMatchObject({ ok: true });
    if (!made.ok) return;
    const [trial] = await db().execute<Row>(sql`
      select coalesce((select b.trial_ends_at from commerce.store_billing b where b.store_id = s.id),
                      (select o.trial_ends_at from commerce.organisation_billing o where o.organisation_id = s.organisation_id)) is not null as trial,
             s.organisation_id = (select w.organisation_id from commerce.stores w where w.slug = ${slug}) as same_account
        from commerce.stores s where s.id = ${made.storeId}::uuid`);
    expect(trial).toEqual({ trial: true, same_account: true });
    expect(await limits.ownedStoreCount(owner.id)).toBe(1);
  });
});
