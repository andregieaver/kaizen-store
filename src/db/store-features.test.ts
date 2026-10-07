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

describe("the Customers group in the database (D178 step 2)", () => {
  it("sells to the chosen audience only while Sell to businesses is on, and offers a product only to its kind", async () => {
    const audience = async (chosen: string, features: string[]) =>
      (await one<{ a: string }>("select commerce.store_audience($1, $2) as a", [chosen, features])).a;
    expect(await audience("both", ["shop", "business"])).toBe("both");
    expect(await audience("businesses", ["shop", "business"])).toBe("businesses");
    expect(await audience("both", ["shop"])).toBe("consumers");
    // Kept on but asleep: the shop is off.
    expect(await audience("both", ["business"])).toBe("consumers");

    const offered = async (store: string, product: string) =>
      (await one<{ o: boolean }>("select commerce.audience_offered($1, $2) as o", [store, product])).o;
    for (const product of ["all", "consumers", "businesses"]) expect(await offered("both", product)).toBe(true);
    expect(await offered("consumers", "all")).toBe(true);
    expect(await offered("consumers", "consumers")).toBe(true);
    expect(await offered("consumers", "businesses")).toBe(false);
    expect(await offered("businesses", "businesses")).toBe(true);
    expect(await offered("businesses", "consumers")).toBe(false);

    const store = await createStore("audience-offered");
    await db.query("update commerce.stores set audience = 'both', features = '{shop,business}' where id = $1", [store]);
    const productOffered = async (audience: string) =>
      (await one<{ o: boolean }>("select commerce.product_offered($1, $2) as o", [store, audience])).o;
    expect(await productOffered("businesses")).toBe(true);
    await setFeatures(store, ["shop"]);
    expect(await productOffered("businesses")).toBe(false);
    expect(await productOffered("all")).toBe(true);
  });

  it("clears the company and VAT number of open carts when Sell to businesses goes off, and only then", async () => {
    const store = await createStore("audience-carts");
    await db.query("update commerce.stores set audience = 'both', features = '{shop,business}' where id = $1", [store]);
    const cart = async (status: string) =>
      (await one<{ id: string }>(
        `insert into commerce.carts (store_id, market_code, currency, locale, status, company_name, organisation_number, vat_number, expires_at)
         values ($1, 'NO', 'NOK', 'nb-NO', $2, 'Firma AS', '123456785', 'SE556677889901', now() + interval '30 days') returning id`,
        [store, status],
      )).id;
    const open = await cart("open");
    const done = await cart("converted");
    const company = (id: string) => one<{ company_name: string | null; vat_number: string | null }>("select company_name, vat_number from commerce.carts where id = $1", [id]);
    // Another feature changing leaves them alone.
    await setFeatures(store, ["shop", "business", "bonus"]);
    expect(await company(open)).toEqual({ company_name: "Firma AS", vat_number: "SE556677889901" });
    await setFeatures(store, ["shop", "bonus"]);
    expect(await company(open)).toEqual({ company_name: null, vat_number: null });
    // A cart that became an order keeps what it had: history.
    expect(await company(done)).toEqual({ company_name: "Firma AS", vat_number: "SE556677889901" });
  });

  it("pauses the bonus program's expiry while it is off and moves the dates that passed when it comes back on", async () => {
    const store = await createStore("bonus-pause");
    await db.query("update commerce.stores set features = '{shop,bonus}' where id = $1", [store]);
    await db.query(
      `insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, expires_months, currency)
       values ($1, true, 500, 0, 50, 12, 'NOK')`,
      [store],
    );
    const paused = async () => (await one<{ p: string | null }>("select paused_at as p from commerce.bonus_settings where store_id = $1", [store])).p;
    expect(await paused()).toBeNull();
    const { id: customer } = await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, 'pause@example.com') returning id", [store]);
    // One lot that expires in a day, one in a year.
    const grant = (key: string, days: number) =>
      db.query(
        `select commerce.bonus_grant($1, $2, 'adjust', 1000, null, null, now() - interval '30 days', now() + make_interval(days => $3), 'test', null, $4)`,
        [store, customer, days, key],
      );
    await grant("soon", 1);
    await grant("later", 365);

    // Off by its store feature: paused, and nothing of it is expired or reminded.
    await setFeatures(store, ["shop"]);
    expect(await paused()).not.toBeNull();
    expect((await one<{ on: boolean }>("select commerce.bonus_program_on($1) as on", [store])).on).toBe(false);
    // Thirty days pass: the pause began thirty days ago, and the first lot's date passed meanwhile.
    await db.query("update commerce.bonus_settings set paused_at = paused_at - interval '30 days' where store_id = $1", [store]);
    await db.query("alter table commerce.bonus_entries disable trigger bonus_entries_immutable");
    await db.query("update commerce.bonus_entries set expires_at = expires_at - interval '30 days', created_at = created_at - interval '30 days' where customer_id = $1", [customer]);
    await db.query("alter table commerce.bonus_entries enable trigger bonus_entries_immutable");
    await db.query("select commerce.bonus_expire_due(1000)");
    expect((await db.query("select 1 from commerce.bonus_entries where customer_id = $1 and kind = 'expire'", [customer])).rows).toHaveLength(0);
    expect((await db.query("select * from commerce.bonus_expiring(400) where store_id = $1", [store])).rows).toHaveLength(0);
    // Using credits is refused while it is off.
    await expect(db.query("select commerce.bonus_redeem($1, $2, null, 100, 'redeem-paused')", [store, customer])).rejects.toThrow(/bonus\.off/);

    // Back on: the lot whose date passed is expired and granted again, its date moved by as long as the program was off; the other keeps its.
    await setFeatures(store, ["shop", "bonus"]);
    expect(await paused()).toBeNull();
    const lots = (
      await db.query<{ kind: string; amount_minor: string; days: number }>(
        `select l.kind, l.remaining as amount_minor, round(extract(epoch from (l.expires_at - now())) / 86400)::int as days
           from (select e.kind, e.expires_at, b.remaining from commerce.bonus_lots($1, $2) b join commerce.bonus_entries e on e.id = b.id) l
          where l.remaining > 0 order by l.expires_at`,
        [store, customer],
      )
    ).rows.map((r) => ({ kind: r.kind, amount: Number(r.amount_minor), days: r.days }));
    // The first had one day left when the program went off; thirty days later it has that day again.
    expect(lots).toEqual([
      { kind: "restore", amount: 1000, days: 1 },
      { kind: "adjust", amount: 1000, days: 335 },
    ]);
    const { available_minor } = await one<{ available_minor: string }>("select available_minor from commerce.bonus_balance($1, $2)", [store, customer]);
    expect(Number(available_minor)).toBe(2000);
    expect((await one<{ ok: boolean }>("select commerce.bonus_verify($1, $2) as ok", [store, customer])).ok).toBe(true);

    // The program's own switch pauses it the same way.
    await db.query("update commerce.bonus_settings set enabled = false where store_id = $1", [store]);
    expect(await paused()).not.toBeNull();
    await db.query("update commerce.bonus_settings set enabled = true where store_id = $1", [store]);
    expect(await paused()).toBeNull();
  });
});

describe("the Selling group in the database (D178 step 3)", () => {
  it("offers a kind of product only while its feature is on, and a product sold only as a subscription only with Subscriptions", async () => {
    const store = await createStore("kinds-offered");
    const offered = async (kind: string, subscriptionOnly = false) =>
      (await one<{ o: boolean }>("select commerce.kind_offered($1, $2, $3) as o", [store, kind, subscriptionOnly])).o;
    await setFeatures(store, ["shop"]);
    expect(await offered("goods")).toBe(true);
    expect(await offered("appointment")).toBe(false);
    expect(await offered("stay")).toBe(false);
    expect(await offered("rental")).toBe(false);
    expect(await offered("goods", true)).toBe(false);

    await setFeatures(store, ["shop", "appointments"]);
    expect(await offered("appointment")).toBe(true);
    expect(await offered("stay")).toBe(false);
    await setFeatures(store, ["shop", "bookings", "subscriptions"]);
    expect(await offered("appointment")).toBe(false);
    expect(await offered("stay")).toBe(true);
    expect(await offered("rental")).toBe(true);
    expect(await offered("goods", true)).toBe(true);

    // Kept on but asleep: the shop is off, so nothing of them is offered.
    await setFeatures(store, ["appointments", "bookings", "subscriptions"]);
    for (const kind of ["appointment", "stay", "rental"]) expect(await offered(kind), kind).toBe(false);
    expect(await offered("goods", true)).toBe(false);
    // A store that is not there offers nothing of a feature.
    expect((await one<{ o: boolean }>("select commerce.kind_offered($1, 'appointment', false) as o", [crypto.randomUUID()])).o).toBe(false);
  });
});
