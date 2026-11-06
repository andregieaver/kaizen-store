import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Kaizena Flow's own store (D466, `docs/platform-parity-plan.md` step 1), against real Postgres (PGlite) with every migration applied: the
 * migration makes it once, a website with Deals in Kaizena Flow's languages; it is never billed, closed, suspended, unmarked or made twice;
 * its members are the platform admins and only they; and it is never news to Kaizena Flow's own integrations.
 */

let db: PGlite;
let house: string;

beforeAll(async () => {
  db = await createTestDatabase();
  house = (await one<{ id: string }>("select commerce.house_store() as id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function refused(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "allowed";
}

let made = 0;
async function account(platformAdmin: boolean): Promise<string> {
  made += 1;
  return (
    await one<{ id: string }>("insert into commerce.accounts (email, name, platform_admin) values ($1, $2, $3) returning id", [
      `house-${made}@example.com`,
      `Person ${made}`,
      platformAdmin,
    ])
  ).id;
}

const membership = (accountId: string) =>
  one<{ role: string; active: boolean } | undefined>(
    "select role::text as role, disabled_at is null as active from commerce.store_members where store_id = $1 and account_id = $2",
    [house, accountId],
  );

describe("Kaizena Flow's own store (D466)", () => {
  it("is made once by the migration, a website with Deals in Kaizena Flow's languages", async () => {
    const store = await one<Record<string, unknown>>(
      "select slug, name, status::text as status, features, sales_pilot, private_mode, locales, country, require_two_step, setup_completed_at is not null as set_up from commerce.stores where house",
    );
    expect(store).toMatchObject({ slug: "kaizenaflow", name: "Kaizena Flow", status: "active", features: ["languages", "sales"], sales_pilot: true, private_mode: true, country: "NO", require_two_step: true, set_up: true });
    expect((store.locales as string[])[0]).toBe("en-GB");
    const market = await one<Record<string, unknown>>("select code, currency, default_locale, active from commerce.markets where store_id = $1", [house]);
    expect(market).toMatchObject({ code: "NO", currency: "NOK", default_locale: "en-GB", active: true });
    expect((await one<{ id: string }>("select commerce.make_house_store() as id")).id).toBe(house);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.stores where house")).n).toBe(1);
  });

  it("is made by nothing else, never unmarked, and no other store becomes it", async () => {
    expect(await refused("insert into commerce.stores (slug, name, house) values ('second-house', 'Second', true)")).toMatch(/stores\.house_fixed/);
    expect(await refused("update commerce.stores set house = false where id = $1", [house])).toMatch(/stores\.house_fixed/);
    const other = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('not-house', 'Not house') returning id")).id;
    expect(await refused("update commerce.stores set house = true where id = $1", [other])).toMatch(/stores\.house_fixed/);
  });

  it("is never closed or suspended", async () => {
    expect(await refused("update commerce.stores set status = 'closed' where id = $1", [house])).toMatch(/stores\.house_open/);
    expect(await refused("update commerce.stores set status = 'suspended' where id = $1", [house])).toMatch(/stores\.house_open/);
  });

  it("has no plan, no subscription and no trial", async () => {
    expect(await refused("insert into commerce.store_billing (store_id, trial_ends_at) values ($1, now())", [house])).toMatch(/store_billing\.house/);
    expect(await refused("insert into commerce.store_billing (store_id, subscription_id, mode) values ($1, 'sub_1', 'test')", [house])).toMatch(/store_billing\.house/);
    // A row with nothing billed, as a fee override would make, is harmless.
    await db.query("insert into commerce.store_billing (store_id) values ($1)", [house]);
  });

  it("has the platform admins as its owners, and only them", async () => {
    const plain = await account(false);
    expect(await refused("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'admin')", [house, plain])).toMatch(
      /store_members\.house/,
    );

    const admin = await account(true);
    expect(await membership(admin)).toEqual({ role: "owner", active: true });

    const second = await account(false);
    await db.query("update commerce.accounts set platform_admin = true where id = $1", [second]);
    expect(await membership(second)).toEqual({ role: "owner", active: true });

    // No longer a platform admin, or disabled: no longer a member.
    await db.query("update commerce.accounts set platform_admin = false where id = $1", [second]);
    expect(await membership(second)).toEqual({ role: "owner", active: false });
    await db.query("update commerce.accounts set disabled_at = now() where id = $1", [admin]);
    expect(await membership(admin)).toEqual({ role: "owner", active: false });

    // Made a platform admin again: a member again. A member cannot be switched back on while they are not one.
    await db.query("update commerce.accounts set platform_admin = true where id = $1", [second]);
    expect(await membership(second)).toEqual({ role: "owner", active: true });
    expect(await refused("update commerce.store_members set disabled_at = null where store_id = $1 and account_id = $2", [house, admin])).toMatch(
      /store_members\.house/,
    );
  });

  it("may be left with no owner while the platform has no admin, where any other store keeps one", async () => {
    await db.query("update commerce.accounts set platform_admin = false where platform_admin");
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.store_members where store_id = $1 and disabled_at is null", [house])).n).toBe(0);
  });

  it("is never news to Kaizena Flow's own integrations", async () => {
    await db.query(
      "insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events) values ('slack', true, 'v2.x', 'hooks.slack.com/…/ab12', '{store.created,store.opened}')",
    );
    await db.query("update commerce.stores set setup_completed_at = null where id = $1", [house]);
    await db.query("update commerce.stores set setup_completed_at = now() where id = $1", [house]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.platform_integration_deliveries where subject_id = $1", [house])).n).toBe(0);
  });
});
