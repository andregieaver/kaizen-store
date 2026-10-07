import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FEATURE_IDS, FEATURES_BY_ID, featureOn } from "@/lib/store-features";

import { createTestDatabase } from "./testing";

/**
 * Store features (D178, docs/store-features.md): what the database holds. `feature_needs()` is the registry's needs, `feature_on()` the
 * effective rule; `stores.modules`' bookings and deliveries follow the features both ways (`stores_features_sync()`); a store made from the
 * template starts with the shop alone, a store template's copy and a duplicate keep the source's features.
 */
let db: PGlite;
let owner: string;
let template: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function createStore(slug: string, modules: string[] = []): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, modules) values ($1, $1, $2) returning id", [slug, modules]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [id],
  );
  return id;
}

const state = (id: string) => one<{ features: string[]; modules: string[] }>("select features, modules from commerce.stores where id = $1", [id]);
const setFeatures = (id: string, features: string[]) => db.query("update commerce.stores set features = $2 where id = $1", [id, features]);

beforeAll(async () => {
  db = await createTestDatabase();
  ({ id: owner } = await one<{ id: string }>("insert into commerce.accounts (email) values ('owner-features@example.com') returning id"));
  template = await createStore("tpl-features", ["bookings"]);
  await db.query("update commerce.stores set is_template = true where id = $1", [template]);
});

afterAll(async () => {
  await db.close();
});

describe("the features' rules in the database (D178)", () => {
  it("knows every feature's needs as the registry does, and allows exactly its ids", async () => {
    for (const id of FEATURE_IDS) {
      const { needs } = await one<{ needs: string[] }>("select commerce.feature_needs($1) as needs", [id]);
      expect([...needs].sort(), id).toEqual([...FEATURES_BY_ID[id].needs].sort());
    }
    const store = await createStore("features-check");
    await expect(setFeatures(store, ["shop", "work"])).rejects.toThrow(/stores_features/);
    await expect(setFeatures(store, ["nonsense"])).rejects.toThrow(/stores_features/);
  });

  it("says a feature is on only with what it needs, as the registry does", async () => {
    const store = await createStore("features-on");
    const sets = [["shop"], ["bonus", "referrals"], ["shop", "referrals"], ["shop", "bonus", "referrals"], ["countries", "languages"], []];
    for (const set of sets) {
      await setFeatures(store, set);
      for (const id of FEATURE_IDS) {
        const { on } = await one<{ on: boolean }>("select commerce.feature_on($1, $2) as on", [store, id]);
        expect([set.join(","), id, on]).toEqual([set.join(","), id, featureOn(set, id)]);
      }
    }
    expect((await one<{ on: boolean }>("select commerce.feature_on($1, 'shop') as on", [crypto.randomUUID()])).on).toBe(false);
  });

  it("starts a new store with the shop, and gives one inserted with a module its features", async () => {
    const plain = await createStore("features-plain");
    expect(await state(plain)).toEqual({ features: ["shop"], modules: [] });
    const booked = await createStore("features-booked", ["bookings", "deliveries", "work"]);
    expect(await state(booked)).toEqual({ features: ["appointments", "bookings", "boxes", "shop"], modules: ["bookings", "deliveries", "work"] });
  });

  it("keeps the modules in step with what is on, the shop's switch included, and leaves work alone", async () => {
    const store = await createStore("features-mirror", ["work"]);
    await setFeatures(store, ["shop", "appointments"]);
    expect(await state(store)).toEqual({ features: ["appointments", "shop"], modules: ["work", "bookings"] });
    await setFeatures(store, ["shop", "appointments", "boxes"]);
    expect((await state(store)).modules).toEqual(["work", "bookings", "deliveries"]);
    // The shop off: everything that needs it sleeps, its own switch kept.
    await setFeatures(store, ["appointments", "boxes"]);
    expect(await state(store)).toEqual({ features: ["appointments", "boxes"], modules: ["work"] });
    await setFeatures(store, ["appointments", "boxes", "shop"]);
    expect((await state(store)).modules).toEqual(["work", "bookings", "deliveries"]);
    await setFeatures(store, ["shop", "bookings"]);
    expect((await state(store)).modules).toEqual(["work", "bookings"]);
  });

  it("moves the features when code from before D178 writes a module", async () => {
    const store = await createStore("features-legacy");
    await db.query("update commerce.stores set modules = array['bookings'] where id = $1", [store]);
    expect(await state(store)).toEqual({ features: ["appointments", "bookings", "shop"], modules: ["bookings"] });
    await db.query("update commerce.stores set modules = modules || array['deliveries'] where id = $1", [store]);
    expect((await state(store)).features).toEqual(["appointments", "bookings", "boxes", "shop"]);
    await db.query("update commerce.stores set modules = array_remove(modules, 'bookings') where id = $1", [store]);
    expect(await state(store)).toEqual({ features: ["boxes", "shop"], modules: ["deliveries"] });
    // Work's switch moves nothing.
    await db.query("update commerce.stores set modules = modules || array['work'] where id = $1", [store]);
    expect(await state(store)).toEqual({ features: ["boxes", "shop"], modules: ["deliveries", "work"] });
  });
});

describe("new stores and copies (D178)", () => {
  it("gives a store made from the template the shop alone, whatever the template has on", async () => {
    expect((await state(template)).features).toEqual(["appointments", "bookings", "shop"]);
    const { id } = await one<{ id: string }>("select commerce.clone_store($1, 'features-new', 'New', $2) as id", [template, owner]);
    expect(await state(id)).toEqual({ features: ["shop"], modules: [] });
  });

  it("gives a store made from a store template the template's features", async () => {
    const { id: starter } = await one<{ id: string }>("select commerce.clone_store($1, 'features-starter', 'Spa', $2) as id", [template, owner]);
    await db.query("update commerce.stores set starter = true where id = $1", [starter]);
    await setFeatures(starter, ["shop", "appointments", "bonus", "languages"]);
    const { id } = await one<{ id: string }>("select commerce.clone_store($1, 'features-from-starter', 'Siri', $2) as id", [starter, owner]);
    expect(await state(id)).toEqual({ features: ["appointments", "bonus", "languages", "shop"], modules: ["bookings"] });
  });

  it("keeps the original's features in a duplicate, a sleeping switch included", async () => {
    const shop = await createStore("features-dup-src");
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [shop, owner]);
    await setFeatures(shop, ["subscriptions", "countries", "bonus"]);
    const { id } = await one<{ id: string }>("select commerce.duplicate_store($1, 'features-dup', 'Copy', $2) as id", [shop, owner]);
    expect(await state(id)).toEqual({ features: ["bonus", "countries", "subscriptions"], modules: [] });
  });
});
