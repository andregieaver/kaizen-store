import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The switch that serves Kaizena Flow's site from its own store (D474, `docs/platform-parity-plan.md` step 5), against real Postgres (PGlite)
 * with every migration applied: it turns on only while the store is open and public, makes the store public when it does and private again
 * when it goes off, keeps when and by whom, and the store cannot be made private while it is on.
 */

let db: PGlite;
let house: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  house = (await one<{ id: string }>("select commerce.house_store() as id")).id;
  admin = (await one<{ id: string }>("insert into commerce.accounts (email, platform_admin) values ('admin@example.com', true) returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const state = () =>
  one<{ on: boolean; at: string | null; by: string | null; private: boolean }>(
    "select p.site_from_store as on, p.site_from_store_at as at, p.site_from_store_by as by, s.private_mode as private from commerce.platform_settings p, commerce.stores s where s.house",
  );

describe("serving Kaizena Flow's site from its own store (D474)", () => {
  it("starts off, with the store private", async () => {
    expect(house).toBeTruthy();
    expect(await state()).toMatchObject({ on: false, at: null, private: true });
  });

  it("will not turn on by itself while the store is private", async () => {
    await expect(db.query("update commerce.platform_settings set site_from_store = true")).rejects.toThrow(/platform_settings.site_from_store/);
  });

  it("turns on through the switch, making the store public and keeping when and by whom", async () => {
    const { changed } = await one<{ changed: boolean }>("select commerce.set_site_from_store(true, $1) as changed", [admin]);
    expect(changed).toBe(true);
    const now = await state();
    expect(now).toMatchObject({ on: true, by: admin, private: false });
    expect(now.at).not.toBeNull();
    // Switched on again: nothing changes.
    expect((await one<{ changed: boolean }>("select commerce.set_site_from_store(true, $1) as changed", [admin])).changed).toBe(false);
  });

  it("keeps the store public while it is on", async () => {
    await expect(db.query("update commerce.stores set private_mode = true where house")).rejects.toThrow(/stores.house_public/);
    // Another store is made private as ever.
    const other = (await one<{ id: string }>("insert into commerce.stores (slug, name, private_mode) values ('other-shop', 'Other', false) returning id")).id;
    await db.query("update commerce.stores set private_mode = true where id = $1", [other]);
    expect((await one<{ p: boolean }>("select private_mode as p from commerce.stores where id = $1", [other])).p).toBe(true);
  });

  it("turns off through the switch, the store private again", async () => {
    expect((await one<{ changed: boolean }>("select commerce.set_site_from_store(false, $1) as changed", [admin])).changed).toBe(true);
    expect(await state()).toMatchObject({ on: false, by: admin, private: true });
  });

  it("is a function the app's roles cannot call", async () => {
    const { rows } = await db.query<{ granted: boolean }>(
      "select has_function_privilege('public', 'commerce.set_site_from_store(boolean, uuid)', 'execute') as granted",
    );
    expect(rows[0].granted).toBe(false);
  });
});
