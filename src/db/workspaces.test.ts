import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * A standalone account's workspace (D748 step E7 part one, `docs/extensions.md` 7), against real Postgres (PGlite): made only by
 * `commerce.make_workspace()`, one per account, in its owner's account, with one market and its owner; open for jobs as any store; never
 * also a template, demo store, sandbox or Kaizena Flow's own, and never marked or unmarked after.
 */

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function account(): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.accounts (email, name) values ($1, 'Solo') returning id", [`workspace-${counter}@example.com`])).id;
}

const make = (person: string) => one<{ id: string }>("select commerce.make_workspace($1, 'Solo desk', 'NO', 'NOK', 'nb-NO') as id", [person]);

describe("commerce.make_workspace() (D748 E7)", () => {
  it("makes one hidden, private store in its owner's account, with a market and its owner, open for jobs", async () => {
    const person = await account();
    const { id } = await make(person);
    const store = await one<{
      workspace: boolean;
      private_mode: boolean;
      slug: string;
      owner: string | null;
      organisation: string | null;
      active: boolean;
      market: string | null;
      features: string[];
      modules: string[];
    }>(
      `select s.workspace, s.private_mode, s.slug, s.organisation_id as organisation, commerce.store_is_active(s.id) as active, s.features, s.modules,
              (select m.account_id from commerce.store_members m where m.store_id = s.id and m.role = 'owner') as owner,
              (select k.currency from commerce.markets k where k.store_id = s.id and k.active) as market
         from commerce.stores s where s.id = $1`,
      [id],
    );
    expect(store).toMatchObject({ workspace: true, private_mode: true, owner: person, active: true, market: "NOK" });
    // E7 part three: Deals' and Projects' store features (D904) and Work switched on, never the online shop.
    expect(store).toMatchObject({ features: ["projects", "sales"], modules: ["work"] });
    expect(store.slug).toMatch(/^ws-[0-9a-f]{12}$/);
    const own = await one<{ organisation_id: string }>("select organisation_id from commerce.organisation_members where account_id = $1 and role = 'owner'", [person]);
    expect(store.organisation).toBe(own.organisation_id);
  });

  it("keeps one workspace per account: asking again gives the same one", async () => {
    const person = await account();
    const first = await make(person);
    expect((await make(person)).id).toBe(first.id);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.stores where workspace and created_by = $1", [person])).n).toBe(1);
  });

  it("is made only there, never marked or unmarked after, and never also another kind of store", async () => {
    const person = await account();
    const { id } = await make(person);
    await expect(db.query("insert into commerce.stores (slug, name, workspace) values ('ws-by-hand', 'By hand', true)")).rejects.toThrow(/made only by commerce.make_workspace/);
    await expect(db.query("update commerce.stores set workspace = false where id = $1", [id])).rejects.toThrow(/never becomes or stops being a workspace/);
    await expect(db.query("update commerce.stores set starter = true where id = $1", [id])).rejects.toThrow(/stores_workspace_alone/);
    const plain = await one<{ id: string }>("insert into commerce.stores (slug, name) values ('plain-store-ws', 'Plain') returning id");
    await expect(db.query("update commerce.stores set workspace = true where id = $1", [plain.id])).rejects.toThrow(/never becomes or stops being a workspace/);
  });

  it("refuses a workspace without its market", async () => {
    const person = await account();
    await expect(db.query("select commerce.make_workspace($1, 'Solo', 'Norway', 'NOK', 'nb-NO')", [person])).rejects.toThrow(/needs a country, a currency and a language/);
  });
});
