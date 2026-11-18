import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Organisations (D748 step E1, `docs/extensions.md` 8.1), against real Postgres (PGlite) with every migration applied: the account that
 * billing will see. The database places every store, however it was made: Kaizena Flow's own (the template, store templates, sandboxes,
 * the house store) in the platform's one organisation, every other in the organisation of the account that made it, which that account
 * owns; a sandbox kept by its visitor moves to theirs; a store nobody owns yet waits for its first owner.
 */

let db: PGlite;
let template: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  ({ id: template } = await one<{ id: string }>("insert into commerce.stores (slug, name, is_template) values ('tpl-orgs', 'Nordlys', true) returning id"));
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [template],
  );
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function account(name: string | null = null): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.accounts (email, name) values ($1, $2) returning id", [`orgs-${counter}@example.com`, name])).id;
}

/** A store copied from the template for `owner`, as a new store is. */
async function storeFor(owner: string): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("select commerce.clone_store($1, $2, 'Copy', $3) as id", [template, `orgs-copy-${counter}`, owner])).id;
}

const organisationOf = async (store: string) =>
  (await one<{ organisation_id: string | null }>("select organisation_id from commerce.stores where id = $1", [store])).organisation_id;

/** The account that owns the organisation a store is in. */
const ownerOf = async (store: string) =>
  (
    await one<{ account_id: string } | undefined>(
      "select m.account_id from commerce.stores s join commerce.organisation_members m on m.organisation_id = s.organisation_id and m.role = 'owner' where s.id = $1",
      [store],
    )
  )?.account_id;

const platform = async () => (await one<{ id: string }>("select id from commerce.organisations where platform")).id;

describe("organisations (D748 E1)", () => {
  it("puts Kaizena Flow's own stores in the platform's one organisation, which nobody belongs to", async () => {
    const house = (await one<{ id: string }>("select commerce.house_store() as id")).id;
    expect(await organisationOf(house)).toBe(await platform());
    expect(await organisationOf(template)).toBe(await platform());
    expect(await one("select count(*)::int as n from commerce.organisations where platform")).toEqual({ n: 1 });
    expect(await one("select name from commerce.organisations where platform")).toEqual({ name: "Kaizena Flow" });
    expect(await one("select count(*)::int as n from commerce.organisation_members where organisation_id = $1", [await platform()])).toEqual({ n: 0 });
  });

  it("gives an approved store's owner an organisation of their own, owned by them and named after the store, not the person", async () => {
    const admin = await account("Admin");
    const { id: request } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name) values ('kari-orgs@example.com', 'Kari Nordmann', 'Karis Kopper') returning id",
    );
    const { store_id: store } = await one<{ store_id: string }>("select commerce.approve_access_request($1, 'karis-kopper-orgs', 'Karis Kopper', $2) as store_id", [request, admin]);
    const row = await one<Record<string, unknown>>(
      `select o.name, o.platform, m.role, a.email
         from commerce.stores s
         join commerce.organisations o on o.id = s.organisation_id
         join commerce.organisation_members m on m.organisation_id = o.id
         join commerce.accounts a on a.id = m.account_id
        where s.id = $1`,
      [store],
    );
    expect(row).toEqual({ name: "Karis Kopper", platform: false, role: "owner", email: "kari-orgs@example.com" });
  });

  it("keeps every store one person makes in their one organisation, named after the first", async () => {
    const owner = await account();
    const first = await storeFor(owner);
    const second = await storeFor(owner);
    expect(await organisationOf(first)).not.toBeNull();
    expect(await organisationOf(second)).toBe(await organisationOf(first));
    expect(await one("select name from commerce.organisations where id = $1", [await organisationOf(first)])).toEqual({ name: "Copy" });
    expect(await one("select count(*)::int as n from commerce.organisation_members where account_id = $1", [owner])).toEqual({ n: 1 });
  });

  it("places a store with the account that made it, not another owner", async () => {
    const maker = await account("Maker");
    const partner = await account("Partner");
    await db.query("select commerce.account_organisation($1)", [partner]);
    counter += 1;
    const { id: store } = await one<{ id: string }>("insert into commerce.stores (slug, name, created_by) values ($1, 'Shared', $2) returning id", [
      `orgs-shared-${counter}`,
      maker,
    ]);
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [store, partner]);
    expect(await ownerOf(store)).toBe(partner);
    // Placed once, a store stays: the maker arriving later moves nothing.
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [store, maker]);
    expect(await ownerOf(store)).toBe(partner);

    // With both owners there when it is placed, the maker takes it.
    counter += 1;
    await db.query("begin");
    const { id: both } = await one<{ id: string }>("insert into commerce.stores (slug, name, created_by) values ($1, 'Both', $2) returning id", [
      `orgs-both-${counter}`,
      maker,
    ]);
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner'), ($1, $3, 'owner')", [both, partner, maker]);
    await db.query("commit");
    expect(await ownerOf(both)).toBe(maker);
    expect(await one("select o.name from commerce.stores s join commerce.organisations o on o.id = s.organisation_id where s.id = $1", [both])).toEqual({ name: "Both" });
  });

  it("leaves a store nobody owns unplaced until its first owner arrives; an admin does not place it", async () => {
    counter += 1;
    const { id: store } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, 'Waiting') returning id", [`orgs-waiting-${counter}`]);
    expect(await organisationOf(store)).toBeNull();
    const helper = await account("Helper");
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'admin')", [store, helper]);
    expect(await organisationOf(store)).toBeNull();
    const owner = await account("Owner");
    await db.query("update commerce.store_members set role = 'owner' where store_id = $1 and account_id = $2", [store, helper]);
    expect(await ownerOf(store)).toBe(helper);
    expect(await one("select count(*)::int as n from commerce.organisation_members where account_id = $1", [owner])).toEqual({ n: 0 });
  });

  it("holds a sandbox in the platform's organisation and moves it to its visitor's when they keep it", async () => {
    counter += 1;
    const slug = `try-${String(counter).padStart(8, "0")}`;
    const { id: sandbox } = await one<{ id: string }>("select commerce.make_sandbox(null, $1, $2, 7) as id", [slug, "a".repeat(64)]);
    const { store_id: store } = await one<{ store_id: string }>("select store_id from commerce.sandboxes where id = $1", [sandbox]);
    expect(await organisationOf(store)).toBe(await platform());
    const { id: request } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name, sandbox_id) values ('keeper-orgs@example.com', 'Keeper', 'Kept', $1) returning id",
      [sandbox],
    );
    await db.query("select commerce.adopt_sandbox($1, 'kept-orgs', 'Kept', null)", [request]);
    expect(await one("select o.name, o.platform, m.role from commerce.stores s join commerce.organisations o on o.id = s.organisation_id join commerce.organisation_members m on m.organisation_id = o.id where s.id = $1", [store])).toEqual({
      name: "Kept",
      platform: false,
      role: "owner",
    });
  });

  it("refuses a second platform organisation, a nameless one and an unknown role", async () => {
    await expect(db.query("insert into commerce.organisations (name, platform) values ('Another', true)")).rejects.toThrow(/organisations_one_platform/);
    await expect(db.query("insert into commerce.organisations (name) values ('  ')")).rejects.toThrow(/organisations_name_present/);
    const org = (await one<{ id: string }>("insert into commerce.organisations (name) values ('Shop AS') returning id")).id;
    await expect(db.query("insert into commerce.organisation_members (organisation_id, account_id, role) values ($1, $2, 'boss')", [org, await account()])).rejects.toThrow(
      /organisation_members_role/,
    );
    await expect(db.query("select commerce.account_organisation($1)", [crypto.randomUUID()])).rejects.toThrow(/organisations\.no_account/);
  });

  it("leaves no owned store or platform store without an organisation", async () => {
    expect(
      await one(
        `select count(*)::int as n from commerce.stores s
          where s.organisation_id is null
            and (s.is_template or s.starter or s.sandbox or s.house
                 or exists (select 1 from commerce.store_members m where m.store_id = s.id and m.role = 'owner'))`,
      ),
    ).toEqual({ n: 0 });
  });
});
