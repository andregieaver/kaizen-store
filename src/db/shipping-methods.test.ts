/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { distanceKm } from "@/lib/local-delivery";
import { tierProblems, type TierRow } from "@/lib/shipping-methods";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Shipping methods, zones and profiles, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md` 3.3): every rule the database holds,
 * against every migration applied to a real Postgres (PGlite), and the store copies (3.4). The tiers' check is held equal to the editor's
 * (`tierProblems()`).
 */

let db: PGlite;
let store: string;
let other: string;
let owner: string;
let counter = 0;
const next = () => (counter += 1);

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "ship-a");
  other = await createInvoiceStore(db, "ship-b");
  owner = await scalar<string>("insert into commerce.accounts (email) values ('ship-owner@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

/** A store with room for another method in Norway (10 a market): the rate tests make many. */
let roomy: { id: string; used: number } | null = null;
async function methodStore(): Promise<string> {
  if (!roomy || roomy.used >= 10) roomy = { id: await createInvoiceStore(db, `ship-m${next()}`), used: 0 };
  roomy.used += 1;
  return roomy.id;
}

const newMethod = async (s?: string, market = "NO", o: { name?: string } = {}) =>
  scalar<string>(
    "insert into commerce.shipping_methods (store_id, market_code, currency, name) select $1, code, currency, $3 from commerce.markets where store_id = $1 and code = $2 returning id",
    [s ?? (await methodStore()), market, o.name ?? `Method ${next()}`],
  );

const storeOf = (method: string) => scalar<string>("select store_id from commerce.shipping_methods where id = $1", [method]);

const newZone = async (patterns: string[], s = store, market = "NO") =>
  scalar<string>("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, $2, $3, $4) returning id", [s, market, `Zone ${next()}`, patterns]);

const newProfile = async (s = store) => scalar<string>("insert into commerce.shipping_profiles (store_id, name) values ($1, $2) returning id", [s, `Profile ${next()}`]);

type Tier = { basis: "flat" | "weight" | "value"; min?: number; max?: number | null; amount?: number };

/** Writes a group's rows in one transaction, as the editor saves them; the tiers' check runs at its commit. */
async function writeGroup(method: string, tiers: Tier[], o: { zone?: string | null; profile?: string | null; s?: string; replace?: boolean } = {}) {
  const s = o.s ?? (await storeOf(method));
  await db.transaction(async (tx) => {
    if (o.replace) {
      await tx.query("delete from commerce.shipping_method_rates where store_id = $1 and method_id = $2 and zone_id is not distinct from $3 and profile_id is not distinct from $4", [
        s,
        method,
        o.zone ?? null,
        o.profile ?? null,
      ]);
    }
    for (const t of tiers) {
      await tx.query(
        "insert into commerce.shipping_method_rates (store_id, method_id, zone_id, profile_id, basis, min_value, max_value, amount_minor) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [s, method, o.zone ?? null, o.profile ?? null, t.basis, t.min ?? 0, t.max === undefined ? null : t.max, t.amount ?? 100],
      );
    }
  });
}

const place = async (o: { kind?: string; country?: string; lat?: number | null; lon?: number | null; s?: string } = {}) =>
  scalar<string>(
    "insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, latitude, longitude) values ($1, $2, $3, 'Storgata 1', '0155', 'Oslo', $4, $5, $6) returning id",
    [o.s ?? store, o.kind ?? "shop", `Place ${next()}`, o.country ?? "NO", o.lat === undefined ? 59.9127 : o.lat, o.lon === undefined ? 10.7461 : o.lon],
  );

const pickupOption = async (location: string, o: { market?: string; s?: string } = {}) =>
  scalar<string>(
    "insert into commerce.pickup_options (store_id, location_id, market_code, currency) select $1, $2, code, currency from commerce.markets where store_id = $1 and code = $3 returning id",
    [o.s ?? store, location, o.market ?? "NO"],
  );

const postalArea = async (patterns: string[], o: { location?: string | null; s?: string; market?: string } = {}) =>
  scalar<string>(
    `insert into commerce.local_delivery_areas (store_id, location_id, market_code, currency, name, kind, patterns, amount_minor)
     select $1, $2, code, currency, $3, 'postal', $4, 9900 from commerce.markets where store_id = $1 and code = $5 returning id`,
    [o.s ?? store, o.location ?? null, `Area ${next()}`, patterns, o.market ?? "NO"],
  );

const radiusArea = async (location: string, o: { active?: boolean; radius?: number } = {}) =>
  scalar<string>(
    `insert into commerce.local_delivery_areas (store_id, location_id, market_code, currency, name, kind, radius_km, amount_minor, active)
     select $1, $2, code, currency, $3, 'radius', $4, 9900, $5 from commerce.markets where store_id = $1 and code = 'NO' returning id`,
    [store, location, `Ring ${next()}`, o.radius ?? 10, o.active ?? true],
  );

const newCart = async (s = store) =>
  scalar<string>("insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id", [s]);

/** An order placed as `placeOrder()` places it, with its delivery method set while it waits for payment, then paid. */
async function order(method: "ship" | "pickup" | "local", o: { location?: string; note?: string; pay?: boolean; s?: string } = {}) {
  const s = o.s ?? store;
  const placed = await placeOrder(db, s, { lines: [{ sku: "A", quantity: 2, unit: 10_000 }], pay: false });
  await db.query("update commerce.orders set delivery_method = $2, pickup_location_id = $3, delivery_note = $4 where id = $1", [
    placed.id,
    method,
    method === "pickup" ? (o.location ?? (await place({ s }))) : null,
    o.note ?? null,
  ]);
  if (o.pay !== false) {
    const n = next();
    await db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, $4, 'NOK', 'pending')", [
      s,
      placed.id,
      `pi_ship_${n}`,
      placed.total,
    ]);
    await db.query("select commerce.complete_order_payment($1::uuid, $2)", [placed.id, `cs_ship_${n}`]);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [placed.id]);
  }
  return placed;
}

/** A handover or parcel with every unit of the order, written as `markSent()` writes it (the shipment and its lines in one transaction). */
async function handOver(orderId: string, method: "parcel" | "pickup" | "local", o: { tracking?: string; s?: string; lines?: boolean } = {}) {
  await db.transaction(async (tx) => {
    const id = (
      await tx.query<{ id: string }>("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, method) values ($1, $2, $3, $4, $5) returning id", [
        o.s ?? store,
        orderId,
        method === "parcel" ? "posten" : "",
        o.tracking ?? "",
        method,
      ])
    ).rows[0].id;
    if (o.lines !== false) {
      await tx.query(
        "insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) select store_id, $2, id, quantity from commerce.order_lines where order_id = $1",
        [orderId, id],
      );
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------

describe("rates: tiers that meet (3.3 point 1)", () => {
  it("takes one flat price, tiers from 0 that meet, and nothing (Not offered)", async () => {
    const m = await newMethod();
    const s = await storeOf(m);
    await writeGroup(m, [{ basis: "flat", amount: 9900 }]);
    const p = await newProfile(s);
    await writeGroup(m, [{ basis: "weight", min: 0, max: 2000 }, { basis: "weight", min: 2000, max: 10_000 }, { basis: "weight", min: 10_000, max: null }], { profile: p });
    const z = await newZone(["9*"], s);
    await writeGroup(m, [{ basis: "value", min: 0, max: 50_000 }, { basis: "value", min: 50_000, max: 100_000 }], { zone: z });
    expect(await scalar<number>("select count(*)::int from commerce.shipping_method_rates where method_id = $1", [m])).toBe(6);
  });

  it("refuses at commit a gap, an overlap, a tier after an open one, two flat prices, mixed measures and more than 10 tiers, as the editor does", async () => {
    const cases: [Tier[], RegExp, TierRow[]][] = [];
    const add = (tiers: Tier[], pattern: RegExp) =>
      cases.push([tiers, pattern, tiers.map((t) => ({ basis: t.basis, minValue: t.min ?? 0, maxValue: t.max === undefined ? null : t.max, amountMinor: t.amount ?? 100 }))]);
    add([{ basis: "weight", min: 0, max: 2000 }, { basis: "weight", min: 2500, max: null }], /shipping_rates\.gap/);
    add([{ basis: "weight", min: 100, max: null }], /shipping_rates\.gap/);
    add([{ basis: "weight", min: 0, max: 2000 }, { basis: "weight", min: 1500, max: null }], /shipping_rates\.overlap/);
    add([{ basis: "weight", min: 0, max: null }, { basis: "weight", min: 2000, max: 3000 }], /shipping_rates\.overlap/);
    add([{ basis: "flat" }, { basis: "flat" }], /shipping_rates\.two_flat/);
    add([{ basis: "flat" }, { basis: "weight", min: 0, max: null }], /shipping_rates\.mixed_basis/);
    add(Array.from({ length: 11 }, (_, i) => ({ basis: "value" as const, min: i * 10, max: i === 10 ? null : (i + 1) * 10 })), /shipping_rates\.too_many/);
    for (const [tiers, pattern, editor] of cases) {
      const m = await newMethod();
      await expect(writeGroup(m, tiers), String(pattern)).rejects.toThrow(pattern);
      expect(tierProblems(editor).length, String(pattern)).toBeGreaterThan(0);
      expect(await scalar<number>("select count(*)::int from commerce.shipping_method_rates where method_id = $1", [m])).toBe(0);
    }
  });

  it("refuses a flat row with bounds, a maximum not above the minimum and a negative amount at once (row checks)", async () => {
    const m = await newMethod();
    await expect(writeGroup(m, [{ basis: "flat", min: 5 }])).rejects.toThrow(/shipping_method_rates_flat/);
    await expect(writeGroup(m, [{ basis: "weight", min: 10, max: 10 }])).rejects.toThrow(/shipping_method_rates_range/);
    await expect(writeGroup(m, [{ basis: "flat", amount: -1 }])).rejects.toThrow(/shipping_method_rates_amount/);
  });

  it("lets an editor replace a group inside its transaction, and checks the group it leaves when a row moves", async () => {
    const m = await newMethod();
    await writeGroup(m, [{ basis: "weight", min: 0, max: 1000 }, { basis: "weight", min: 1000, max: null }]);
    await writeGroup(m, [{ basis: "value", min: 0, max: 5000 }, { basis: "value", min: 5000, max: null }], { replace: true });
    expect(await rows("select basis, min_value::int as min from commerce.shipping_method_rates where method_id = $1 order by min_value", [m])).toEqual([
      { basis: "value", min: 0 },
      { basis: "value", min: 5000 },
    ]);
    // Moving the first tier to another profile leaves the Rest-of-country group starting at 5000: a gap, at commit.
    const p = await newProfile(await storeOf(m));
    await expect(
      db.query("update commerce.shipping_method_rates set profile_id = $2 where method_id = $1 and min_value = 0", [m, p]),
    ).rejects.toThrow(/shipping_rates\.gap/);
  });

  it("refuses a zone of another market, and another store's method, zone or profile", async () => {
    const m = await newMethod(store, "NO");
    const se = await newZone(["1*"], store, "SE");
    await expect(writeGroup(m, [{ basis: "flat" }], { zone: se })).rejects.toThrow(/shipping_rates\.zone_market/);
    const theirs = await newProfile(other);
    await expect(writeGroup(m, [{ basis: "flat" }], { profile: theirs })).rejects.toThrow(/foreign key/);
  });

  it("goes with its method, zone or profile", async () => {
    const m = await newMethod();
    const z = await newZone(["8*"], await storeOf(m));
    const p = await newProfile(await storeOf(m));
    await writeGroup(m, [{ basis: "flat" }], { zone: z });
    await writeGroup(m, [{ basis: "flat" }], { profile: p });
    await db.query("delete from commerce.shipping_zones where id = $1", [z]);
    await db.query("delete from commerce.shipping_profiles where id = $1", [p]);
    expect(await scalar<number>("select count(*)::int from commerce.shipping_method_rates where method_id = $1", [m])).toBe(0);
  });
});

describe("zones: patterns in one zone of a market (3.3 point 2)", () => {
  it("refuses a malformed pattern, a repeat inside a zone and more than 3,000 characters", async () => {
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Bad', $2)", [store, ["01 50"]], /postal_patterns\.malformed/);
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Bad', $2)", [store, ["0*1"]], /postal_patterns\.malformed/);
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Bad', $2)", [store, ["1050", "1050"]], /postal_patterns\.duplicate/);
    const long = Array.from({ length: 1000 }, (_, i) => String(i).padStart(4, "0"));
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Bad', $2)", [store, long], /postal_patterns\.too_long/);
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Bad', $2)", [store, []], /shipping_zones_patterns_count/);
  });

  it("refuses a pattern another zone of the market holds, naming the zone; another market or store may hold it", async () => {
    await newZone(["40*", "4100"], store, "DK");
    await rejects("insert into commerce.shipping_zones (store_id, market_code, name, patterns) values ($1, 'DK', 'Second', $2)", [store, ["4100"]], /shipping_zones\.taken: 4100 is already in the zone/);
    // A more specific pattern than another zone's prefix is allowed: the most specific wins.
    await newZone(["4000", "41*"], store, "DK");
    await newZone(["40*"], other, "DK");
    await newZone(["40*"], store, "SE");
    const z = await newZone(["42*"], store, "DK");
    await rejects("update commerce.shipping_zones set patterns = $2 where id = $1", [z, ["42*", "40*"]], /shipping_zones\.taken/);
    await db.query("update commerce.shipping_zones set patterns = $2 where id = $1", [z, ["42*", "43*"]]);
  });

  it("keeps a zone in its market, and a market to 20 zones", async () => {
    const z = await newZone(["7*"], store, "FI");
    await rejects("update commerce.shipping_zones set market_code = 'SE' where id = $1", [z], /shipping_zones\.market_fixed/);
    for (let i = 1; i < 20; i += 1) await newZone([`${i + 10}*`], store, "FI");
    await expect(newZone(["99*"], store, "FI")).rejects.toThrow(/shipping_zones\.limit/);
  });
});

describe("limits (3.3 point 7)", () => {
  it("holds 20 profiles a store, with unique names whatever the case", async () => {
    const s = await createInvoiceStore(db, "ship-limits");
    await db.query("insert into commerce.shipping_profiles (store_id, name) values ($1, 'Bulky')", [s]);
    await rejects("insert into commerce.shipping_profiles (store_id, name) values ($1, 'BULKY')", [s], /shipping_profiles_name_key/);
    await rejects("insert into commerce.shipping_profiles (store_id, name) values ($1, ' Padded ')", [s], /shipping_profiles_name/);
    for (let i = 1; i < 20; i += 1) await newProfile(s);
    await expect(newProfile(s)).rejects.toThrow(/shipping_profiles\.limit/);
  });

  it("holds 10 methods a market, and keeps a method in its market and currency", async () => {
    const s = await createInvoiceStore(db, "ship-methods");
    const first = await newMethod(s, "SE");
    for (let i = 1; i < 10; i += 1) await newMethod(s, "SE");
    await expect(newMethod(s, "SE")).rejects.toThrow(/shipping_methods\.limit/);
    await newMethod(s, "DK");
    await rejects("update commerce.shipping_methods set market_code = 'DK', currency = 'DKK' where id = $1", [first], /shipping_methods\.market_fixed/);
    await rejects(
      "insert into commerce.shipping_methods (store_id, market_code, currency, name, estimate_min_days, estimate_max_days) values ($1, 'DK', 'DKK', 'Slow', 5, 2)",
      [s],
      /shipping_methods_estimate/,
    );
    await rejects("insert into commerce.shipping_methods (store_id, market_code, currency, name) values ($1, 'DK', 'EUR', 'Euro')", [s], /foreign key/);
  });

  it("holds 10 local areas a place and 30 a store", async () => {
    const s = await createInvoiceStore(db, "ship-areas");
    const l = await place({ s });
    for (let i = 0; i < 10; i += 1) await postalArea([`${i}*`], { s, location: l });
    await expect(postalArea(["0150"], { s, location: l })).rejects.toThrow(/local_delivery_areas\.place_limit/);
    for (let i = 0; i < 20; i += 1) await postalArea([`${i}*`], { s });
    await expect(postalArea(["0150"], { s })).rejects.toThrow(/local_delivery_areas\.limit/);
  });

  it("holds 20 pickup places a store", async () => {
    const s = await createInvoiceStore(db, "ship-pickups");
    for (let i = 0; i < 20; i += 1) await pickupOption(await place({ s }), { s });
    const extra = await place({ s });
    await expect(pickupOption(extra, { s })).rejects.toThrow(/pickup_options\.limit/);
  });
});

describe("pickup places and local areas (3.3 point 6)", () => {
  it("refuses a pickup option at the office or at a place in another country than its market, and one per place", async () => {
    const office = await place({ kind: "office", s: other });
    await expect(pickupOption(office, { s: other })).rejects.toThrow(/pickup_options\.place_kind/);
    const swedish = await place({ country: "SE" });
    await expect(pickupOption(swedish, { market: "NO" })).rejects.toThrow(/pickup_options\.place_country/);
    await pickupOption(swedish, { market: "SE" });
    const shop = await place({ kind: "pickup" });
    await pickupOption(shop);
    await expect(pickupOption(shop)).rejects.toThrow(/pickup_options_location_key/);
  });

  it("keeps a pickup place a shop or pickup place in its country", async () => {
    const shop = await place();
    await pickupOption(shop);
    await rejects("update commerce.store_locations set kind = 'office' where id = $1", [shop], /store_locations\.pickup_option/);
    await rejects("update commerce.store_locations set country = 'SE' where id = $1", [shop], /store_locations\.pickup_option/);
    await db.query("update commerce.store_locations set kind = 'pickup', name = 'Depot' where id = $1", [shop]);
    // Deleting the place takes its pickup option (the server refuses while orders wait for it, `pickupBlockers()`).
    await db.query("delete from commerce.store_locations where id = $1", [shop]);
    expect(await scalar<number>("select count(*)::int from commerce.pickup_options where location_id = $1", [shop])).toBe(0);
  });

  it("refuses an active radius area at a place without a position, and taking a position from a place an active one uses", async () => {
    const nowhere = await place({ lat: null, lon: null });
    await expect(radiusArea(nowhere)).rejects.toThrow(/local_delivery_areas\.no_position/);
    const off = await radiusArea(nowhere, { active: false });
    await rejects("update commerce.local_delivery_areas set active = true where id = $1", [off], /local_delivery_areas\.no_position/);
    const shop = await place();
    await radiusArea(shop, { radius: 160 });
    await rejects("update commerce.store_locations set latitude = null, longitude = null where id = $1", [shop], /store_locations\.radius_area/);
    await rejects("update commerce.store_locations set country = 'SE' where id = $1", [shop], /store_locations\.local_area/);
    await rejects("insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, latitude) values ($1, 'shop', 'Half', 's', '0150', 'Oslo', 'NO', 59.9)", [store], /store_locations_position/);
  });

  it("refuses an area of the wrong shape: a radius with codes or out of range, postal codes with a radius, an area at a place of another country", async () => {
    const shop = await place();
    await rejects(
      "insert into commerce.local_delivery_areas (store_id, location_id, market_code, currency, name, kind, radius_km, amount_minor) values ($1, $2, 'NO', 'NOK', 'Far', 'radius', 161, 0)",
      [store, shop],
      /local_delivery_areas_kind/,
    );
    await rejects(
      "insert into commerce.local_delivery_areas (store_id, location_id, market_code, currency, name, kind, radius_km, patterns, amount_minor) values ($1, $2, 'NO', 'NOK', 'Both', 'radius', 10, '{01*}', 0)",
      [store, shop],
      /local_delivery_areas_kind/,
    );
    await rejects(
      "insert into commerce.local_delivery_areas (store_id, market_code, currency, name, kind, radius_km, amount_minor) values ($1, 'NO', 'NOK', 'No place', 'radius', 10, 0)",
      [store],
      /local_delivery_areas_kind/,
    );
    await rejects(
      "insert into commerce.local_delivery_areas (store_id, market_code, currency, name, kind, patterns, radius_km, amount_minor) values ($1, 'NO', 'NOK', 'Codes', 'postal', '{01*}', 5, 0)",
      [store],
      /local_delivery_areas_kind/,
    );
    await rejects(
      "insert into commerce.local_delivery_areas (store_id, market_code, currency, name, kind, patterns, amount_minor, min_basket_minor) values ($1, 'NO', 'NOK', 'Zero', 'postal', '{01*}', 0, 0)",
      [store],
      /local_delivery_areas_amounts/,
    );
    await expect(postalArea(["1*"], { location: shop, market: "SE" })).rejects.toThrow(/local_delivery_areas\.place_country/);
    await expect(postalArea(["01 5"])).rejects.toThrow(/postal_patterns\.malformed/);
    // Two areas may cover the same code: the cheapest is offered (4.5).
    await postalArea(["01*"]);
    await postalArea(["01*"]);
  });
});

describe("carts (3.3 point 3)", () => {
  it("hold one choice at most, and a note only with a local area", async () => {
    const cart = await newCart();
    const m = await newMethod(store);
    const area = await postalArea(["05*"]);
    const pickup = await pickupOption(await place());
    await db.query("update commerce.carts set shipping_method_id = $2, delivery_postal_code = '0150' where id = $1", [cart, m]);
    await rejects("update commerce.carts set pickup_option_id = $2 where id = $1", [cart, pickup], /carts_one_delivery/);
    await rejects("update commerce.carts set delivery_note = 'Ring twice' where id = $1", [cart], /carts_delivery_note/);
    await db.query("update commerce.carts set shipping_method_id = null, local_area_id = $2, delivery_note = 'Ring twice' where id = $1", [cart, area]);
    await rejects("update commerce.carts set delivery_postal_code = '01 50' where id = $1", [cart], /carts_delivery_postal_code/);
    await rejects("update commerce.carts set delivery_note = $2 where id = $1", [cart, "x".repeat(501)], /carts_delivery_note/);
  });

  it("let the note go with the area, chosen away or deleted", async () => {
    const cart = await newCart();
    const area = await postalArea(["06*"]);
    await db.query("update commerce.carts set local_area_id = $2, delivery_note = 'Back door' where id = $1", [cart, area]);
    await db.query("update commerce.carts set local_area_id = null where id = $1", [cart]);
    expect(await one("select local_area_id, delivery_note from commerce.carts where id = $1", [cart])).toEqual({ local_area_id: null, delivery_note: null });
    await db.query("update commerce.carts set local_area_id = $2, delivery_note = 'Back door' where id = $1", [cart, area]);
    await db.query("delete from commerce.local_delivery_areas where id = $1", [area]);
    expect(await one("select local_area_id, delivery_note from commerce.carts where id = $1", [cart])).toEqual({ local_area_id: null, delivery_note: null });
  });

  it("lose the choice when the method or pickup place goes", async () => {
    const cart = await newCart();
    const m = await newMethod(store);
    await db.query("update commerce.carts set shipping_method_id = $2 where id = $1", [cart, m]);
    await db.query("delete from commerce.shipping_methods where id = $1", [m]);
    expect(await scalar("select shipping_method_id from commerce.carts where id = $1", [cart])).toBeNull();
  });
});

describe("orders (3.3 point 4)", () => {
  it("are shipped by default, and refuse pickup without a place, a place without pickup, ready without pickup, a note without local delivery", async () => {
    const o = await order("ship", { pay: false });
    expect(await scalar("select delivery_method from commerce.orders where id = $1", [o.id])).toBe("ship");
    await rejects("update commerce.orders set delivery_method = 'pickup' where id = $1", [o.id], /orders_pickup_location/);
    await rejects("update commerce.orders set pickup_location_id = gen_random_uuid() where id = $1", [o.id], /orders_pickup_location/);
    await rejects("update commerce.orders set ready_for_pickup_at = now() where id = $1", [o.id], /orders_ready_for_pickup/);
    await rejects("update commerce.orders set delivery_note = 'Gate code 1234' where id = $1", [o.id], /orders_delivery_note/);
    await rejects("update commerce.orders set delivery_method = 'drone' where id = $1", [o.id], /orders_delivery_method/);
  });

  it("may change how they are delivered while they wait for payment, and never after", async () => {
    const o = await order("ship", { pay: false });
    const shop = await place();
    await db.query("update commerce.orders set delivery_method = 'pickup', pickup_location_id = $2, delivery = '{\"kind\":\"pickup\"}' where id = $1", [o.id, shop]);
    await db.query("update commerce.orders set delivery_method = 'local', pickup_location_id = null, delivery_note = 'Ring' where id = $1", [o.id]);
    const paid = await order("pickup");
    await rejects("update commerce.orders set delivery_method = 'ship', pickup_location_id = null where id = $1", [paid.id], /order_delivery\.frozen/);
    await rejects("update commerce.orders set pickup_location_id = gen_random_uuid() where id = $1", [paid.id], /order_delivery\.frozen/);
    await rejects("update commerce.orders set delivery = '{\"kind\":\"flat\",\"label\":\"x\"}' where id = $1", [paid.id], /order_delivery\.frozen/);
    // Other columns are not held by it.
    await db.query("update commerce.orders set email = 'new@example.com' where id = $1", [paid.id]);
  });

  it("are marked ready for pickup once", async () => {
    const o = await order("pickup");
    await db.query("update commerce.orders set ready_for_pickup_at = now() where id = $1", [o.id]);
    await rejects("update commerce.orders set ready_for_pickup_at = now() + interval '1 hour' where id = $1", [o.id], /order_delivery\.ready_once/);
    await rejects("update commerce.orders set ready_for_pickup_at = null where id = $1", [o.id], /order_delivery\.ready_once/);
  });

  it("lose the note for the driver when anonymised (3.3 point 8), which takes only the postal code out of the delivery", async () => {
    const o = await order("local", { note: "Gate code 1234, ring Kari", pay: false });
    await db.query("update commerce.orders set delivery = $2::jsonb, status = 'cancelled' where id = $1", [
      o.id,
      JSON.stringify({ kind: "local", label: "Local delivery", areaId: "a", name: "Oslo", postalCode: "0150", info: "" }),
    ]);
    expect(await scalar("select commerce.anonymise_order($1, $2, 'erasure')", [store, o.id])).toBe("anonymised");
    expect(await one("select delivery_note, delivery, delivery_method from commerce.orders where id = $1", [o.id])).toEqual({
      delivery_note: null,
      delivery: { kind: "local", label: "Local delivery", areaId: "a", name: "Oslo", info: "" },
      delivery_method: "local",
    });
  });

  it("lose the two postal codes of a delivery-mismatch event when anonymised (2.7, review), keeping the event and other events' data", async () => {
    const o = await order("local", { pay: false });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o.id]);
    await db.query(
      "insert into commerce.order_events (store_id, order_id, type, data, actor) values ($1, $2, 'order.delivery_mismatch', $3::jsonb, 'system'), ($1, $2, 'order.other', $4::jsonb, 'system')",
      [store, o.id, JSON.stringify({ priced: "0150", address: "5003" }), JSON.stringify({ address: "kept: not a mismatch event" })],
    );
    expect(await scalar("select commerce.anonymise_order($1, $2, 'erasure')", [store, o.id])).toBe("anonymised");
    expect(await one("select data from commerce.order_events where order_id = $1 and type = 'order.delivery_mismatch'", [o.id])).toEqual({ data: {} });
    expect(await one("select data from commerce.order_events where order_id = $1 and type = 'order.other'", [o.id])).toEqual({ data: { address: "kept: not a mismatch event" } });
    const events = await db.query<{ data: unknown }>("select data from commerce.order_events where order_id = $1", [o.id]);
    expect(JSON.stringify(events.rows)).not.toMatch(/0150|5003/);
  });

  it("are not anonymised with the note still in them (the check)", async () => {
    const o = await order("local", { note: "Secret", pay: false });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o.id]);
    await db.query("select set_config('commerce.anonymising', 'on', false)");
    try {
      await rejects(
        `update commerce.orders set email = '[removed]', billing_address = '{}', shipping_address = '{}', company_name = null, organisation_number = null, anonymised_at = now() where id = $1`,
        [o.id],
        /orders_anonymised/,
      );
    } finally {
      await db.query("select set_config('commerce.anonymising', '', false)");
    }
  });

  it("never change a copied order's delivery or readiness", async () => {
    const placed = await placeOrder(db, store, { lines: [{ sku: "A", unit: 1000 }], copied: true });
    await rejects("update commerce.orders set ready_for_pickup_at = now() where id = $1", [placed.id], /copied_order|orders_ready_for_pickup/);
    await rejects("update commerce.orders set delivery_mismatch_at = now() where id = $1", [placed.id], /copied_order/);
  });
});

describe("handovers (3.3 point 5)", () => {
  it("record a pickup or local handover with every unit, which fulfils the order as a parcel does", async () => {
    const p = await order("pickup");
    await handOver(p.id, "pickup");
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, p.id])).toBe(true);
    expect(await scalar("select status::text from commerce.orders where id = $1", [p.id])).toBe("fulfilled");
    const l = await order("local", { note: "Ring" });
    await handOver(l.id, "local");
    expect(await scalar("select commerce.order_fulfilment($1)", [l.id])).toBe("sent");
  });

  it("refuse a tracking number or carrier on a handover, a handover without lines, and the wrong method for the order", async () => {
    const p = await order("pickup");
    await expect(handOver(p.id, "pickup", { tracking: "TRACK1" })).rejects.toThrow(/shipments_handover_bare/);
    await expect(handOver(p.id, "pickup", { lines: false })).rejects.toThrow(/shipment/);
    await expect(handOver(p.id, "parcel", { tracking: "T" })).rejects.toThrow(/shipment\.pickup_order/);
    await expect(handOver(p.id, "local")).rejects.toThrow(/shipment\.method/);
    const s = await order("ship");
    await expect(handOver(s.id, "pickup")).rejects.toThrow(/shipment\.method/);
    await expect(handOver(s.id, "local")).rejects.toThrow(/shipment\.method/);
    // A parcel for a local order is allowed (a store may post it after all), and every parcel before D237 is a parcel.
    const l = await order("local");
    await handOver(l.id, "parcel", { tracking: "T2" });
    expect(await scalar("select count(*)::int from commerce.shipments where method <> 'parcel' and tracking_number <> ''")).toBe(0);
  });
});

describe("the store copies (3.4)", () => {
  async function setUp(slug: string) {
    const s = await createInvoiceStore(db, slug);
    await db.query("insert into commerce.shipping_settings (store_id, default_weight_grams) values ($1, 750)", [s]);
    const profile = await newProfile(s);
    const product = await scalar<string>("insert into commerce.products (store_id, handle, tax_code, shipping_profile_id) values ($1, $2, 'txcd_99999999', $3) returning id", [
      s,
      `bulky-${next()}`,
      profile,
    ]);
    await db.query("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, $3)", [s, product, `BULK-${next()}`]);
    const zone = await newZone(["9*"], s);
    const m = await newMethod(s, "NO", { name: "Express" });
    await writeGroup(m, [{ basis: "flat", amount: 9900 }], { s });
    await writeGroup(m, [{ basis: "weight", min: 0, max: 5000, amount: 19_900 }, { basis: "weight", min: 5000, max: null, amount: 29_900 }], { s, zone, profile });
    const shop = await place({ s });
    await pickupOption(shop, { s });
    await postalArea(["01*"], { s });
    await postalArea(["02*"], { s, location: shop });
    return { s, profile, product, zone, m, shop };
  }

  const shape = async (s: string) => ({
    weight: await scalar("select default_weight_grams from commerce.shipping_settings where store_id = $1", [s]),
    profiles: await rows("select name from commerce.shipping_profiles where store_id = $1", [s]),
    products: await rows("select p.handle, sp.name as profile from commerce.products p join commerce.shipping_profiles sp on sp.id = p.shipping_profile_id where p.store_id = $1", [s]),
    zones: await rows("select market_code, patterns from commerce.shipping_zones where store_id = $1", [s]),
    methods: await rows("select name, market_code from commerce.shipping_methods where store_id = $1", [s]),
    rates: await rows(
      `select m.name as method, z.patterns, p.name as profile, r.basis, r.min_value::int as min, r.max_value::int as max, r.amount_minor::int as amount
         from commerce.shipping_method_rates r join commerce.shipping_methods m on m.id = r.method_id
         left join commerce.shipping_zones z on z.id = r.zone_id left join commerce.shipping_profiles p on p.id = r.profile_id
        where r.store_id = $1 order by r.min_value, r.amount_minor`,
      [s],
    ),
  });

  it("duplicate_store() copies the shipping set-up with new ids, the places' positions, the pickup places and every local area", async () => {
    const src = await setUp("ship-dup-src");
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'ship-dup-copy', 'Copy', $2) as id", [src.s, owner]);
    const original = await shape(src.s);
    expect(await shape(copy)).toEqual({ ...original, products: original.products });
    expect(original.rates).toHaveLength(3);
    expect(await scalar("select id from commerce.shipping_methods where store_id = $1", [copy])).not.toBe(src.m);
    expect(await one("select latitude::text, longitude::text from commerce.store_locations where store_id = $1 and id = commerce.clone_id($1, $2)", [copy, src.shop])).toEqual({
      latitude: "59.912700",
      longitude: "10.746100",
    });
    expect(await scalar<number>("select count(*)::int from commerce.pickup_options where store_id = $1 and location_id = commerce.clone_id($1, $2)", [copy, src.shop])).toBe(1);
    expect(await scalar<number>("select count(*)::int from commerce.local_delivery_areas where store_id = $1", [copy])).toBe(2);
  });

  it("clone_store() copies the set-up but no pickup place and no area measured from a place (it copies no places)", async () => {
    const src = await setUp("ship-tpl");
    await db.query("update commerce.products set status = 'active' where store_id = $1", [src.s]).catch(() => undefined);
    const { id: made } = await one<{ id: string }>("select commerce.clone_store($1, 'ship-tpl-made', 'Made', $2) as id", [src.s, owner]);
    const original = await shape(src.s);
    const copy = await shape(made);
    expect(copy.weight).toBe(750);
    expect(copy.zones).toEqual(original.zones);
    expect(copy.methods).toEqual(original.methods);
    expect(copy.rates).toEqual(original.rates);
    expect(copy.profiles).toEqual(original.profiles);
    expect(await scalar<number>("select count(*)::int from commerce.pickup_options where store_id = $1", [made])).toBe(0);
    expect(await rows("select patterns, location_id from commerce.local_delivery_areas where store_id = $1", [made])).toEqual([{ patterns: ["01*"], location_id: null }]);
  });

  it("copy_orders() copies how an order was delivered as history, never the alert or the note", async () => {
    const src = await createInvoiceStore(db, "ship-ord-src");
    const shop = await place({ s: src });
    const p = await order("pickup", { s: src, location: shop });
    await db.query("update commerce.orders set ready_for_pickup_at = '2026-10-10T10:00:00Z', delivery_mismatch_at = now() where id = $1", [p.id]);
    const l = await order("local", { s: src, note: "Gate code" });
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'ship-ord-copy', 'Copy', $2) as id", [src, owner]);
    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    await db.query("select * from commerce.copy_orders($1, $2, null, 10)", [src, copy]);
    const copied = await rows<any>(
      "select copied_from, delivery_method, pickup_location_id, ready_for_pickup_at, delivery_note, delivery_mismatch_at from commerce.orders where store_id = $1 order by delivery_method",
      [copy],
    );
    expect(copied.map((o) => [o.copied_from, o.delivery_method, o.delivery_note, o.delivery_mismatch_at])).toEqual([
      [l.id, "local", null, null],
      [p.id, "pickup", null, null],
    ]);
    expect(copied[1].pickup_location_id).toBe(await scalar("select commerce.clone_id($1, $2)", [copy, shop]));
    expect(new Date(copied[1].ready_for_pickup_at).toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });

  it("classifies every new table as settings", () => {
    for (const table of ["shipping_settings", "shipping_profiles", "shipping_zones", "shipping_methods", "shipping_method_rates", "pickup_options", "local_delivery_areas"]) {
      expect(COPY_RULES[table]?.group, table).toBe("settings");
    }
    expect(COPY_RULES.postal_points).toBeUndefined();
  });
});

describe("postal-code centres (4.6)", () => {
  it("are loaded for Norway, Sweden, Denmark and Finland as the countries write their codes, readable without a store", async () => {
    const counts = await rows<{ country: string; n: number }>("select country::text, count(*)::int as n from commerce.postal_points group by 1 order by 1");
    expect(counts.map((c) => c.country)).toEqual(["DK", "FI", "NO", "SE"]);
    for (const c of counts) expect(c.n, c.country).toBeGreaterThan(1000);
    expect(await scalar<number>("select count(*)::int from commerce.postal_points where (country in ('NO', 'DK') and postal_code !~ '^\\d{4}$') or (country in ('SE', 'FI') and postal_code !~ '^\\d{5}$')")).toBe(0);
  });

  it("put Oslo and Bergen about 305 km apart, and Copenhagen and Stockholm about 521 km", async () => {
    const at = async (country: string, code: string) => {
      const p = await one<{ lat: string; lon: string }>("select latitude::text as lat, longitude::text as lon from commerce.postal_points where country = $1 and postal_code = $2", [country, code]);
      return { lat: Number(p.lat), lon: Number(p.lon) };
    };
    expect(distanceKm(await at("NO", "0150"), await at("NO", "5003"))).toBeGreaterThan(295);
    expect(distanceKm(await at("NO", "0150"), await at("NO", "5003"))).toBeLessThan(315);
    expect(distanceKm(await at("DK", "1050"), await at("SE", "11120"))).toBeGreaterThan(510);
    expect(distanceKm(await at("DK", "1050"), await at("SE", "11120"))).toBeLessThan(530);
  });
});

describe("the plan comparison's rows (2.6)", () => {
  const NAMES = ["Shipping methods, zones and profiles", "Local pickup", "Local delivery"];

  it("are listed once each in Operations after the inventory rows, in no plan, saying only what is built", async () => {
    const found = await rows<{ name: string; category: string; position: number; description: string }>(
      "select name, category, position, description from commerce.plan_features where name = any($1) order by position",
      [NAMES],
    );
    expect(found.map((r) => r.name)).toEqual(NAMES);
    for (const r of found) {
      expect(r.category).toBe("Operations");
      expect(r.description.length).toBeLessThanOrEqual(300);
    }
    const inventory = await scalar<number>("select max(position)::int from commerce.plan_features where name like 'Inventory page%'");
    expect(found[0].position).toBeGreaterThan(inventory);
    expect(
      await scalar<number>("select count(*)::int from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = any($1)", [NAMES]),
    ).toBe(0);
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261014230237_shipping_plan_features.sql"), "utf8");
    expect(sql).toMatch(/160 km/);
    expect(sql).not.toMatch(/delete|drop/i);
  });
});

describe("the rules migration", () => {
  it("has no DELETE, TRUNCATE or DROP in a function, and every new function sets its search path", async () => {
    const fns = await rows<{ name: string; def: string; config: string[] | null }>(
      `select p.proname as name, pg_get_functiondef(p.oid) as def, p.proconfig as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'commerce' and p.proname = any($1)`,
      [
        [
          "postal_patterns_problem",
          "shipping_profiles_rules",
          "shipping_zones_rules",
          "shipping_methods_rules",
          "shipping_rate_group_problem",
          "shipping_rates_tiers",
          "pickup_options_rules",
          "local_delivery_areas_rules",
          "store_locations_shipping_rules",
          "carts_delivery_note_follows",
          "orders_delivery_frozen",
          "shipments_method_rules",
        ],
      ],
    );
    expect(fns).toHaveLength(12);
    for (const f of fns) {
      expect(f.config, f.name).toContain("search_path=\"\"");
      expect(f.def, f.name).not.toMatch(/\bdelete\s+from\b|\btruncate\s|\bdrop\s/i);
    }
  });

  it("enables row-level security on the eight new tables", async () => {
    const tables = ["shipping_settings", "shipping_profiles", "shipping_zones", "shipping_methods", "shipping_method_rates", "pickup_options", "local_delivery_areas", "postal_points"];
    const on = await rows<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = any($1)",
      [tables],
    );
    expect(on).toHaveLength(8);
    expect(on.every((t) => t.relrowsecurity)).toBe(true);
  });
});
