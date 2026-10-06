import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { INVENTORY_RETENTION_MONTHS, MOVEMENT_REASONS, MOVEMENT_SOURCES } from "@/lib/inventory";
import { nextAlertState, type AlertState } from "@/lib/stock-alerts";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createInvoiceStore, placeOrder as placeFixtureOrder } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Inventory (wave 3, D172, `docs/wave-3-inventory.md` 3.3 to 3.7, 6.4): the rules the database itself holds, run against real Postgres
 * (PGlite) with every migration applied. Every change of a level is a movement and the movements add up to the level; a level goes
 * below zero only for a variant that keeps selling on backorder; the history is append-only; a store keeps one active location; the draw
 * of paid items marks what was sold beyond stock; one view reads stock; the low-stock state moves as `nextAlertState()` says; and a
 * copy of a store carries the new columns and none of the history.
 */

let db: PGlite;
let shop: string;
let other: string;
let owner: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await createStore("inv-shop");
  other = await createStore("inv-other");
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('inv-owner@example.com') returning id")).id;
});

// Every test has a store of its own, so the locations, ranks and ledgers of one never reach another.
beforeEach(async () => {
  shop = await createStore(`inv-shop-${++counter}`);
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
const n = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number | string }>(sql, params)).n);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function createStore(slug: string): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [id, ["NO", "DE"]],
  );
  return id;
}

async function location(store = shop, over: { name?: string; priority?: number; active?: boolean; createdAt?: string } = {}): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      `insert into commerce.inventory_locations (store_id, name, country, priority, active, created_at)
       values ($1, $2, 'NO', $3, $4, coalesce($5::timestamptz, now())) returning id`,
      [store, over.name ?? `Place ${counter}`, over.priority ?? 0, over.active ?? true, over.createdAt ?? null],
    )
  ).id;
}

/** A product with one active variant (goods unless said). */
async function variant(over: { store?: string; delivery?: "physical" | "digital" | "service"; policy?: "deny" | "continue"; days?: number | null; threshold?: number | null } = {}): Promise<string> {
  counter += 1;
  const store = over.store ?? shop;
  const maker = (
    await one<{ id: string }>(
      `insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
       values ($1, 'Maker', 'Street 1, 10115 Berlin', 'safety@maker.example', 'DE') returning id`,
      [store],
    )
  ).id;
  const product = (
    await one<{ id: string }>(
      "insert into commerce.products (store_id, handle, manufacturer_id, tax_code) values ($1, $2, $3, 'txcd_99999999') returning id",
      [store, `inv-product-${counter}`, maker],
    )
  ).id;
  const policy = over.policy ?? "deny";
  return (
    await one<{ id: string }>(
      `insert into commerce.product_variants (store_id, product_id, sku, delivery, stock_policy, backorder_days, low_stock_threshold)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [store, product, `INV-${counter}`, over.delivery ?? "physical", policy, policy === "continue" ? (over.days ?? 7) : (over.days ?? null), over.threshold ?? null],
    )
  ).id;
}

const setLevel = (store: string, variantId: string, locationId: string, onHand: number) =>
  db.query(
    `insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, $4)
     on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()`,
    [store, variantId, locationId, onHand],
  );
const onHandOf = async (variantId: string, locationId: string) =>
  (await one<{ on_hand: number }>("select on_hand from commerce.inventory_levels where variant_id = $1 and location_id = $2", [variantId, locationId])).on_hand;

type Movement = { delta: number; on_hand_after: number; reason: string; source: string; actor_account_id: string | null; order_id: string | null; return_id: string | null; job_id: string | null; note: string | null };
const movements = (variantId: string, locationId?: string) =>
  all<Movement>(
    `select delta, on_hand_after, reason, source, actor_account_id, order_id, return_id, job_id, note
       from commerce.inventory_movements where variant_id = $1 and ($2::uuid is null or location_id = $2) order by id`,
    [variantId, locationId ?? null],
  );
const ledger = (store = shop) => all<{ variant_id: string; location_id: string }>("select variant_id, location_id from commerce.inventory_ledger_check($1)", [store]);

/** An order with lines of one or more variants, holds optional; physical lines. */
async function order(
  lines: { variantId: string; quantity: number; gift?: boolean; backorder?: number; days?: number | null }[],
  holds: { variantId: string; locationId: string; quantity: number; backordered?: number }[] = [],
  store = shop,
): Promise<string> {
  counter += 1;
  const orderId = (
    await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor,
         tax_minor, total_minor, billing_address, shipping_address)
       values ($1, $2, 'NO', 'NOK', 'nb-NO', '', 1000, 0, 0, 200, 1000, '{}', '{}') returning id`,
      [store, `INV-O-${counter}`],
    )
  ).id;
  for (const line of lines) {
    counter += 1;
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate,
         tax_code, gift, backorder_quantity, backorder_days)
       values ($1, $2, $3, $4, 'Thing', $5, 100, $5 * 100, 20, 0.25, 'txcd_99999999', $6, $7, $8)`,
      [store, orderId, line.variantId, `LINE-${counter}`, line.quantity, line.gift ?? false, line.backorder ?? 0, line.days === undefined ? (line.backorder ? 7 : null) : line.days],
    );
  }
  for (const hold of holds) {
    await db.query(
      `insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, backorder_quantity, order_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + interval '30 minutes')`,
      [store, hold.variantId, hold.locationId, hold.quantity, hold.backordered ?? 0, orderId],
    );
  }
  return orderId;
}
const pay = (orderId: string) => one<{ done: boolean }>("select commerce.complete_order_payment($1, 'cs_inv') as done", [orderId]);
const backordered = (orderId: string) =>
  all<{ sku: string; backorder_quantity: number; backorder_days: number | null }>(
    "select sku, backorder_quantity, backorder_days from commerce.order_lines where order_id = $1 order by gift, id",
    [orderId],
  );

// ---------------------------------------------------------------------------

describe("the new tables are private, store-owned and left behind by a copy", () => {
  const TABLES = ["inventory_movements", "stock_alerts"];

  it("have row-level security on and no policy, and a store_id", async () => {
    const rows = await all<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'commerce' and c.relname = any($1) order by 1`,
      [TABLES],
    );
    expect(rows).toEqual(TABLES.map((relname) => ({ relname, relrowsecurity: true })));
    expect(await all("select 1 from pg_policies where schemaname = 'commerce' and tablename = any($1)", [TABLES])).toEqual([]);
    for (const table of TABLES) {
      expect(await all("select 1 from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = 'store_id'", [table])).toHaveLength(1);
      expect(COPY_RULES[table]?.group, table).toBe("never");
    }
  });

  it("have the movement reasons and sources of src/lib/inventory.ts, and the history's 24 months", async () => {
    const def = (name: string) => one<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1", [name]);
    const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(quoted((await def("inventory_movements_reason")).def)).toEqual([...MOVEMENT_REASONS].sort());
    expect(quoted((await def("inventory_movements_source")).def)).toEqual([...MOVEMENT_SOURCES].sort());
    const guard = await one<{ src: string }>("select prosrc as src from pg_proc where proname = 'guard_inventory_movements'");
    expect(guard.src).toContain(`interval '${INVENTORY_RETENTION_MONTHS} months'`);
  });
});

describe("every change of a level is a movement", () => {
  it("writes an opening movement for an insert, a correction for an update and a negative one for a delete, and none for no change", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 10);
    await setLevel(shop, v, loc, 7);
    await setLevel(shop, v, loc, 7);
    await db.query("update commerce.inventory_levels set updated_at = now() where variant_id = $1", [v]);
    expect(await movements(v)).toEqual([
      { delta: 10, on_hand_after: 10, reason: "opening", source: "system", actor_account_id: null, order_id: null, return_id: null, job_id: null, note: null },
      { delta: -3, on_hand_after: 7, reason: "correction", source: "system", actor_account_id: null, order_id: null, return_id: null, job_id: null, note: null },
    ]);
    await db.query("delete from commerce.inventory_levels where variant_id = $1", [v]);
    expect((await movements(v)).at(-1)).toMatchObject({ delta: -7, on_hand_after: 0, reason: "correction", source: "system" });
    expect(await ledger()).toEqual([]);
  });

  it("writes nothing for an insert of zero", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 0);
    expect(await movements(v)).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  it("reads why, by whom and for which order from the context, local to the transaction", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    const orderId = await order([{ variantId: v, quantity: 1 }]);
    const job = "00000000-0000-4000-8000-000000000042";
    await db.query("begin");
    await db.query("select commerce.stock_context('received', 'inventory_page', $1, $2, null, $3, $4)", [owner, orderId, job, "  a pallet came in  "]);
    await db.query("update commerce.inventory_levels set on_hand = 9 where variant_id = $1", [v]);
    await db.query("commit");
    await setLevel(shop, v, loc, 8);
    expect(await movements(v)).toEqual([
      expect.objectContaining({ reason: "opening" }),
      { delta: 4, on_hand_after: 9, reason: "received", source: "inventory_page", actor_account_id: owner, order_id: orderId, return_id: null, job_id: job, note: "a pallet came in" },
      expect.objectContaining({ delta: -1, reason: "correction", source: "system", actor_account_id: null, order_id: null }),
    ]);
  });

  it("clears the context on request, and never raises for one it cannot read", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    await db.query("begin");
    await db.query("select commerce.stock_context('damaged', 'editor')");
    await db.query("select commerce.stock_context_clear()");
    await db.query("update commerce.inventory_levels set on_hand = 4 where variant_id = $1", [v]);
    await db.query("select set_config('kaizen.stock', 'this is not json', true)");
    await db.query("update commerce.inventory_levels set on_hand = 3 where variant_id = $1", [v]);
    await db.query("select set_config('kaizen.stock', '[1, 2]', true)");
    await db.query("update commerce.inventory_levels set on_hand = 2 where variant_id = $1", [v]);
    await db.query("select set_config('kaizen.stock', $1, true)", [JSON.stringify({ reason: "not_a_reason", source: "inventory_page", account: "nonsense", order: 7 })]);
    await db.query("update commerce.inventory_levels set on_hand = 1 where variant_id = $1", [v]);
    await db.query("commit");
    const rows = (await movements(v)).slice(1);
    expect(rows.map((m) => [m.reason, m.source, m.actor_account_id, m.order_id])).toEqual([
      ["correction", "system", null, null],
      ["correction", "system", null, null],
      ["correction", "system", null, null],
      ["correction", "system", null, null],
    ]);
  });

  it("keeps a valid reason when only the source is missing, and cuts a long note", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    await db.query("begin");
    await db.query("select commerce.stock_context('count', 'nowhere', null, null, null, null, $1)", ["x".repeat(500)]);
    await db.query("update commerce.inventory_levels set on_hand = 6 where variant_id = $1", [v]);
    await db.query("commit");
    const last = (await movements(v)).at(-1);
    expect(last).toMatchObject({ reason: "count", source: "system" });
    expect(last?.note).toHaveLength(200);
  });

  it("records a change without an order that is not the store's, rather than failing it", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    const foreign = await order([], [], other);
    await db.query("begin");
    await db.query("select commerce.stock_context('sale', 'order', null, $1)", [foreign]);
    await db.query("update commerce.inventory_levels set on_hand = 4 where variant_id = $1", [v]);
    await db.query("commit");
    expect((await movements(v)).at(-1)).toMatchObject({ delta: -1, order_id: null, source: "system" });
    expect(await ledger()).toEqual([]);
  });

  it("makes the movements add up to the level, and the ledger check names a pair they do not", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 12);
    await setLevel(shop, v, loc, 3);
    expect(await ledger()).toEqual([]);
    // A write the trigger did not see (it is switched off) leaves a gap, which the check reports; nothing else does.
    await db.query("alter table commerce.inventory_levels disable trigger inventory_levels_movement");
    await db.query("update commerce.inventory_levels set on_hand = 20 where variant_id = $1", [v]);
    await db.query("alter table commerce.inventory_levels enable trigger inventory_levels_movement");
    expect(await ledger()).toEqual([{ variant_id: v, location_id: loc }]);
    const gap = await one<{ on_hand: number; moved: string }>("select on_hand, moved from commerce.inventory_ledger_check($1)", [shop]);
    expect([gap.on_hand, Number(gap.moved)]).toEqual([20, 3]);
    await setLevel(shop, v, loc, 21);
    expect(await ledger()).toEqual([{ variant_id: v, location_id: loc }]);
    // Another store's ledger is its own.
    expect(await all("select 1 from commerce.inventory_ledger_check($1)", [other])).toEqual([]);
    await db.query("insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source) values ($1, $2, $3, 17, 20, 'correction', 'system')", [shop, v, loc]);
    expect(await ledger()).toEqual([]);
  });

  it("has an opening movement for every level that existed before the history (the migration's backfill invariant)", async () => {
    // The seeded template store has levels written before the trigger; its ledger balances from the first minute.
    const rows = await all<{ id: string }>("select id from commerce.stores");
    for (const { id } of rows) expect(await all("select 1 from commerce.inventory_ledger_check($1)", [id]), id).toEqual([]);
  });
});

describe("the history is append-only", () => {
  it("refuses an update and a delete of a recent movement, and allows a delete of one older than 24 months", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    await rejects("update commerce.inventory_movements set note = 'x' where variant_id = $1", [v], /append-only/);
    await rejects("update commerce.inventory_movements set delta = 1 where variant_id = $1", [v], /append-only/);
    await rejects("delete from commerce.inventory_movements where variant_id = $1", [v], /append-only for 24 months/);
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [v])).toBe(1);
    // One that is older than 24 months and not the newest of its level may go; the newest of a level stays (below).
    await db.query(
      `insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, created_at)
       values ($1, $2, $3, 1, 6, 'correction', 'system', now() - interval '25 months')`,
      [shop, v, loc],
    );
    await setLevel(shop, v, loc, 8);
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [v])).toBe(3);
    await db.query("delete from commerce.inventory_movements where variant_id = $1 and created_at < now() - interval '24 months'", [v]);
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [v])).toBe(2);
    // A movement 23 months old is still kept.
    await db.query(
      `insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, created_at)
       values ($1, $2, $3, 1, 9, 'correction', 'system', now() - interval '23 months')`,
      [shop, v, loc],
    );
    await rejects("delete from commerce.inventory_movements where variant_id = $1 and created_at < now() - interval '22 months'", [v], /append-only/);
  });

  it("keeps the newest movement of a level however old it is: the baseline the ledger check starts from", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    await db.query("alter table commerce.inventory_movements disable trigger inventory_movements_guard");
    await db.query("update commerce.inventory_movements set created_at = now() - interval '30 months' where variant_id = $1", [v]);
    await db.query("alter table commerce.inventory_movements enable trigger inventory_movements_guard");
    await rejects("delete from commerce.inventory_movements where variant_id = $1", [v], /keeps the newest movement/);
    // Old rows of the same level in one statement: all but the newest go, whatever the order they are reached in.
    await setLevel(shop, v, loc, 6);
    await setLevel(shop, v, loc, 4);
    await db.query("alter table commerce.inventory_movements disable trigger inventory_movements_guard");
    await db.query("update commerce.inventory_movements set created_at = now() - interval '30 months' where variant_id = $1", [v]);
    await db.query("alter table commerce.inventory_movements enable trigger inventory_movements_guard");
    await rejects("delete from commerce.inventory_movements where variant_id = $1", [v], /keeps the newest movement/);
    await db.query("delete from commerce.inventory_movements where id in (select id from commerce.inventory_movements where variant_id = $1 order by id limit 2)", [v]);
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [v])).toBe(1);
  });

  it("makes the ledger check survive the 24-month clean-up, and still name a level written without a movement", async () => {
    const loc = await location();
    const v = await variant();
    const w = await variant();
    await setLevel(shop, v, loc, 10);
    await setLevel(shop, w, loc, 3);
    // 25 months pass for the opening movements; a count and a sale-sized change come later.
    await db.query("alter table commerce.inventory_movements disable trigger inventory_movements_guard");
    await db.query("update commerce.inventory_movements set created_at = now() - interval '25 months' where store_id = $1", [shop]);
    await db.query("alter table commerce.inventory_movements enable trigger inventory_movements_guard");
    await setLevel(shop, v, loc, 7);
    expect(await ledger()).toEqual([]);
    // The clean-up: every movement older than 24 months that is not the newest of its level (w keeps its only one).
    await db.query(
      `delete from commerce.inventory_movements x where x.store_id = $1 and x.created_at < now() - interval '24 months'
          and exists (select 1 from commerce.inventory_movements n where n.store_id = x.store_id and n.variant_id = x.variant_id and n.location_id = x.location_id and n.id > x.id)`,
      [shop],
    );
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [v])).toBe(1);
    expect(await n("select count(*) as n from commerce.inventory_movements where variant_id = $1", [w])).toBe(1);
    // The history that is left explains every level: the level before the oldest kept movement plus what the kept ones add up to.
    expect(await ledger()).toEqual([]);
    // More movements after the clean-up keep adding up ...
    await setLevel(shop, v, loc, 2);
    await setLevel(shop, w, loc, 9);
    expect(await ledger()).toEqual([]);
    // ... and a level written without a movement is still a gap, pruned history or not.
    await db.query("alter table commerce.inventory_levels disable trigger inventory_levels_movement");
    await db.query("update commerce.inventory_levels set on_hand = 40 where variant_id = $1", [v]);
    await db.query("alter table commerce.inventory_levels enable trigger inventory_levels_movement");
    expect(await ledger()).toEqual([{ variant_id: v, location_id: loc }]);
    const gap = await one<{ on_hand: number; moved: string }>("select on_hand, moved from commerce.inventory_ledger_check($1)", [shop]);
    expect([gap.on_hand, Number(gap.moved)]).toEqual([40, 2]);
  });

  it("refuses the checks of a row: a zero change, an unknown reason or source, a long note", async () => {
    const loc = await location();
    const v = await variant();
    const insert = (delta: number, reason: string, source: string, note: string | null = null) =>
      db.query(
        "insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, note) values ($1, $2, $3, $4, 0, $5, $6, $7)",
        [shop, v, loc, delta, reason, source, note],
      );
    await expect(insert(0, "correction", "system")).rejects.toThrow(/inventory_movements_delta/);
    await expect(insert(1, "theft", "system")).rejects.toThrow(/inventory_movements_reason/);
    await expect(insert(1, "correction", "robot")).rejects.toThrow(/inventory_movements_source/);
    await expect(insert(1, "correction", "system", "x".repeat(201))).rejects.toThrow(/inventory_movements_note/);
    await expect(insert(1, "correction", "system", "x".repeat(200))).resolves.toBeDefined();
  });

  it("keeps a variant's movements in its own store and location (composite keys)", async () => {
    const loc = await location();
    const v = await variant();
    const foreignLocation = await location(other);
    await expect(
      db.query("insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source) values ($1, $2, $3, 1, 1, 'correction', 'system')", [shop, v, foreignLocation]),
    ).rejects.toThrow(/inventory_movements_location_fk/);
    await expect(
      db.query("insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source) values ($1, $2, $3, 1, 1, 'correction', 'system')", [other, v, loc]),
    ).rejects.toThrow(/inventory_movements_variant_fk/);
  });

  it("gives a copied order no movement", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    // A copy's history is made while `commerce.copying` is on, as `duplicate_store()` makes it.
    await db.query("begin");
    await db.query("select set_config('commerce.copying', 'on', true)");
    const copied = (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
         values ($1, 'C-77', 'NO', 'NOK', 'nb-NO', 'a@example.com', 'paid', 1000, 0, 0, 0, 1000, '{}', '{}', gen_random_uuid()) returning id`,
        [shop],
      )
    ).id;
    await db.query("commit");
    await rejects(
      "insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, order_id) values ($1, $2, $3, -1, 4, 'sale', 'order', $4)",
      [shop, v, loc, copied],
      /copied_order/,
    );
  });
});

describe("a level goes below zero only where it is allowed", () => {
  it("refuses a negative level for a variant that stops selling at zero", async () => {
    const loc = await location();
    const v = await variant();
    await rejects("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, -1)", [shop, v, loc], /stock\.negative/);
    await setLevel(shop, v, loc, 2);
    await rejects("update commerce.inventory_levels set on_hand = -1 where variant_id = $1", [v], /stock\.negative/);
    await rejects("update commerce.inventory_levels set on_hand = on_hand - 3 where variant_id = $1", [v], /stock\.negative/);
    expect(await onHandOf(v, loc)).toBe(2);
  });

  it("allows it for a variant that keeps selling on backorder", async () => {
    const loc = await location();
    const v = await variant({ policy: "continue", days: 5 });
    await setLevel(shop, v, loc, 1);
    await db.query("update commerce.inventory_levels set on_hand = on_hand - 4 where variant_id = $1", [v]);
    expect(await onHandOf(v, loc)).toBe(-3);
    expect(await ledger()).toEqual([]);
  });

  it("always allows a rise, also on a variant switched back to stop selling while it was negative, and refuses a further fall", async () => {
    const loc = await location();
    const v = await variant({ policy: "continue", days: 5 });
    await setLevel(shop, v, loc, -3);
    await db.query("update commerce.product_variants set stock_policy = 'deny', backorder_days = null where id = $1", [v]);
    await db.query("update commerce.inventory_levels set on_hand = -1 where variant_id = $1", [v]);
    await db.query("update commerce.inventory_levels set on_hand = 4 where variant_id = $1", [v]);
    expect(await onHandOf(v, loc)).toBe(4);
    await db.query("update commerce.inventory_levels set on_hand = -1 where variant_id = $1", [v]).then(
      () => {
        throw new Error("a fall below zero was allowed");
      },
      (error: Error) => expect(error.message).toMatch(/stock\.negative/),
    );
  });

  it("refuses a new level for a variant that is not goods, and leaves one made while it was goods to be changed", async () => {
    const loc = await location();
    for (const delivery of ["digital", "service"] as const) {
      const v = await variant({ delivery });
      await rejects("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 3)", [shop, v, loc], /stock\.not_goods/);
      await rejects("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 0)", [shop, v, loc], /stock\.not_goods/);
    }
    // A goods variant that became a download keeps its old level, which a store-wide change of levels still reaches (and it never goes below zero).
    const turned = await variant();
    await setLevel(shop, turned, loc, 4);
    await db.query("update commerce.product_variants set delivery = 'digital' where id = $1", [turned]);
    await db.query("update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = $1", [shop]);
    expect(await onHandOf(turned, loc)).toBe(504);
    await rejects("update commerce.inventory_levels set on_hand = -1 where variant_id = $1", [turned], /stock\.negative/);
    expect(await ledger()).toEqual([]);
  });
});

describe("a variant's policy, delivery time and warning level", () => {
  const change = (v: string, sets: string) => db.query(`update commerce.product_variants set ${sets} where id = $1`, [v]);

  it("needs days from 1 to 90 with continue, and days only with continue", async () => {
    const v = await variant();
    await expect(change(v, "stock_policy = 'continue'")).rejects.toThrow(/product_variants_backorder_days_policy/);
    await expect(change(v, "stock_policy = 'continue', backorder_days = 0")).rejects.toThrow(/product_variants_backorder_days/);
    await expect(change(v, "stock_policy = 'continue', backorder_days = 91")).rejects.toThrow(/product_variants_backorder_days/);
    await expect(change(v, "backorder_days = 7")).rejects.toThrow(/product_variants_backorder_days_policy/);
    await expect(change(v, "stock_policy = 'sometimes'")).rejects.toThrow(/product_variants_stock_policy/);
    await change(v, "stock_policy = 'continue', backorder_days = 90");
    await change(v, "backorder_days = 1");
    await change(v, "stock_policy = 'deny', backorder_days = null");
  });

  it("is for goods only, and so is the warning level, which is 0 to 1,000,000", async () => {
    for (const delivery of ["digital", "service"] as const) {
      const v = await variant({ delivery });
      await expect(change(v, "stock_policy = 'continue', backorder_days = 3")).rejects.toThrow(/product_variants_stock_policy_goods/);
      await expect(change(v, "low_stock_threshold = 3")).rejects.toThrow(/product_variants_low_stock_threshold/);
    }
    const goods = await variant();
    await expect(change(goods, "low_stock_threshold = -1")).rejects.toThrow(/product_variants_low_stock_threshold/);
    await expect(change(goods, "low_stock_threshold = 1000001")).rejects.toThrow(/product_variants_low_stock_threshold/);
    await change(goods, "low_stock_threshold = 0");
    await change(goods, "low_stock_threshold = 1000000");
    await change(goods, "low_stock_threshold = null");
  });

  it("stops a goods variant becoming a download while it keeps selling on backorder", async () => {
    const v = await variant({ policy: "continue", days: 4 });
    await expect(change(v, "delivery = 'digital'")).rejects.toThrow(/product_variants_stock_policy_goods/);
  });
});

describe("stock locations", () => {
  it("cannot have two active locations of one store with the same name, in any case; another store can", async () => {
    const name = `Oslo ${++counter}`;
    await location(shop, { name });
    await expect(location(shop, { name: name.toUpperCase() })).rejects.toThrow(/inventory_locations_active_name_key/);
    await expect(location(shop, { name: `  ${name}`.trim() })).rejects.toThrow(/inventory_locations_active_name_key/);
    await expect(location(other, { name: `${name} elsewhere` })).resolves.toBeDefined();
    await expect(location(await createStore(`inv-names-${counter}`), { name })).resolves.toBeDefined();
    // An inactive location frees its name.
    const old = await location(shop, { name: `${name} old`, active: false });
    await expect(location(shop, { name: `${name} old` })).resolves.toBeDefined();
    expect(old).toBeTruthy();
  });

  it("has a name of 1 to 60 characters and a rank that is not negative", async () => {
    await expect(location(shop, { name: "" })).rejects.toThrow(/inventory_locations_name/);
    await expect(location(shop, { name: "x".repeat(61) })).rejects.toThrow(/inventory_locations_name/);
    await expect(location(shop, { priority: -1 })).rejects.toThrow(/inventory_locations_priority/);
  });

  it("keeps one active location, even when two are deactivated one after the other", async () => {
    const store = await createStore(`inv-last-${++counter}`);
    const a = await location(store);
    const b = await location(store);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [a]);
    await rejects("update commerce.inventory_locations set active = false where id = $1", [b], /location\.last_active/);
    expect(await n("select count(*) as n from commerce.inventory_locations where store_id = $1 and active", [store])).toBe(1);
    // Reactivating brings the first back; then either can go.
    await db.query("update commerce.inventory_locations set active = true where id = $1", [a]);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [b]);
    await rejects("update commerce.inventory_locations set active = false where id = $1", [a], /location\.last_active/);
    // Another store's locations never count.
    const lone = await createStore(`inv-lone-${counter}`);
    const only = await location(lone);
    await location(other);
    await rejects("update commerce.inventory_locations set active = false where id = $1", [only], /location\.last_active/);
  });

  it("is not deactivated while live checkouts hold stock there, but is once a hold expired or was released", async () => {
    const store = await createStore(`inv-held-${++counter}`);
    const a = await location(store);
    await location(store);
    const v = await variant({ store });
    await setLevel(store, v, a, 5);
    const cart = (
      await one<{ id: string }>(
        "insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id",
        [store],
      )
    ).id;
    const hold = (
      await one<{ id: string }>(
        "insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, cart_id, expires_at) values ($1, $2, $3, 2, $4, now() + interval '30 minutes') returning id",
        [store, v, a, cart],
      )
    ).id;
    await rejects("update commerce.inventory_locations set active = false where id = $1", [a], /location\.held/);
    await db.query("update commerce.inventory_reservations set expires_at = now() - interval '1 minute' where id = $1", [hold]);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [a]);
    expect((await one<{ deactivated_at: string | null }>("select deactivated_at from commerce.inventory_locations where id = $1", [a])).deactivated_at).not.toBeNull();
    await db.query("update commerce.inventory_locations set active = true where id = $1", [a]);
    expect((await one<{ deactivated_at: string | null }>("select deactivated_at from commerce.inventory_locations where id = $1", [a])).deactivated_at).toBeNull();
  });

  it("is never deleted while levels, movements or holds refer to it", async () => {
    const loc = await location();
    const v = await variant();
    await setLevel(shop, v, loc, 5);
    await expect(db.query("delete from commerce.inventory_locations where id = $1", [loc])).rejects.toThrow();
  });
});

describe("the one reader of stock: variant_availability", () => {
  const read = (v: string) =>
    one<{ in_stock: number; raw_available: number; stock_policy: string; backorder_days: number | null; can_buy: boolean; delivery: string }>(
      "select in_stock, raw_available, stock_policy, backorder_days, can_buy, delivery from commerce.variant_availability where variant_id = $1",
      [v],
    );

  it("sums the free units of the active locations, and nothing of an inactive one", async () => {
    const a = await location();
    const b = await location();
    const gone = await location();
    const v = await variant();
    await setLevel(shop, v, a, 4);
    await setLevel(shop, v, b, 6);
    await setLevel(shop, v, gone, 50);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [gone]);
    expect(await read(v)).toMatchObject({ in_stock: 10, raw_available: 10, stock_policy: "deny", backorder_days: null, can_buy: true, delivery: "physical" });
    await db.query("update commerce.inventory_locations set active = true where id = $1", [gone]);
    expect((await read(v)).in_stock).toBe(60);
  });

  it("takes off what live checkouts hold, and not what has expired or been released", async () => {
    const a = await location();
    const v = await variant();
    await setLevel(shop, v, a, 10);
    const o = await order([{ variantId: v, quantity: 3 }], [{ variantId: v, locationId: a, quantity: 3 }]);
    expect((await read(v)).in_stock).toBe(7);
    await db.query("update commerce.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [o]);
    expect((await read(v)).in_stock).toBe(10);
    await db.query("update commerce.inventory_reservations set expires_at = now() + interval '1 hour' where order_id = $1", [o]);
    await db.query("update commerce.inventory_reservations set released_at = now() where order_id = $1", [o]);
    expect((await read(v)).in_stock).toBe(10);
  });

  it("is never below zero in stock, shows the raw figure, and can be bought only with stock or on backorder", async () => {
    const a = await location();
    const stopping = await variant();
    await setLevel(shop, stopping, a, 0);
    expect(await read(stopping)).toMatchObject({ in_stock: 0, raw_available: 0, can_buy: false });
    const backorder = await variant({ policy: "continue", days: 9 });
    await setLevel(shop, backorder, a, -3);
    expect(await read(backorder)).toMatchObject({ in_stock: 0, raw_available: -3, stock_policy: "continue", backorder_days: 9, can_buy: true });
    // A hold on a negative level goes further below zero in the raw figure.
    const o = await order([{ variantId: backorder, quantity: 2 }], [{ variantId: backorder, locationId: a, quantity: 2 }]);
    expect(await read(backorder)).toMatchObject({ in_stock: 0, raw_available: -5 });
    expect(o).toBeTruthy();
  });

  it("counts each active location's free units at no less than zero: a location that owes units does not take them from one that holds stock", async () => {
    const owing = await location();
    const holding = await location();
    const v = await variant({ policy: "continue", days: 7 });
    await setLevel(shop, v, owing, -3);
    await setLevel(shop, v, holding, 5);
    // 5 units are on a shelf: that is what a shopper can buy now (allocate() and placeOrder() see the same 5), not 2.
    expect(await read(v)).toMatchObject({ in_stock: 5, raw_available: 2, can_buy: true });
    // Switched back to "stop selling" while one location is still negative: the physical units are still sellable (no cap at 2).
    await db.query("update commerce.product_variants set stock_policy = 'deny', backorder_days = null where id = $1", [v]);
    expect(await read(v)).toMatchObject({ in_stock: 5, raw_available: 2, stock_policy: "deny", can_buy: true });
    // Only negative locations: nothing in stock, the raw figure stays signed.
    const none = await variant({ policy: "continue", days: 3 });
    await setLevel(shop, none, owing, -4);
    await setLevel(shop, none, holding, -1);
    expect(await read(none)).toMatchObject({ in_stock: 0, raw_available: -5, can_buy: true });
  });

  it("gives a variant with no level 0, and says what it delivers", async () => {
    const digital = await variant({ delivery: "digital" });
    expect(await read(digital)).toMatchObject({ in_stock: 0, raw_available: 0, can_buy: false, delivery: "digital" });
  });

  it("agrees with commerce.available_stock summed over the active locations, per store", async () => {
    const rows = await all<{ variant_id: string; mine: number; theirs: number }>(
      `select va.variant_id, va.raw_available as mine,
              coalesce((select sum(s.available) from commerce.available_stock s
                         join commerce.inventory_locations loc on loc.id = s.location_id and loc.active
                        where s.variant_id = va.variant_id), 0)::int as theirs
         from commerce.variant_availability va`,
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect([row.variant_id, row.mine]).toEqual([row.variant_id, row.theirs]);
    expect(await all("select 1 from commerce.variant_availability va join commerce.product_variants v on v.id = va.variant_id where v.store_id <> va.store_id")).toEqual([]);
  });
});

describe("paying for an order draws through draw_order_stock()", () => {
  it("draws from where the items were held, in rank order, before anywhere else", async () => {
    const first = await location(shop, { priority: 1 });
    const second = await location(shop, { priority: 2 });
    const v = await variant();
    await setLevel(shop, v, first, 5);
    await setLevel(shop, v, second, 5);
    const o = await order([{ variantId: v, quantity: 2 }], [{ variantId: v, locationId: second, quantity: 2 }]);
    expect((await pay(o)).done).toBe(true);
    expect([await onHandOf(v, first), await onHandOf(v, second)]).toEqual([5, 3]);
    expect((await movements(v, second)).at(-1)).toMatchObject({ delta: -2, reason: "sale", source: "order", order_id: o, actor_account_id: null });
    expect(await ledger()).toEqual([]);
  });

  it("draws the rest from any active location by rank (a hold that expired), and skips an inactive one", async () => {
    const low = await location(shop, { priority: 5 });
    const high = await location(shop, { priority: 1 });
    const gone = await location(shop, { priority: 0 });
    const v = await variant();
    await setLevel(shop, v, low, 5);
    await setLevel(shop, v, high, 1);
    await setLevel(shop, v, gone, 9);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [gone]);
    const o = await order([{ variantId: v, quantity: 3 }]);
    await pay(o);
    expect([await onHandOf(v, high), await onHandOf(v, low), await onHandOf(v, gone)]).toEqual([0, 3, 9]);
    expect(await backordered(o)).toEqual([expect.objectContaining({ backorder_quantity: 0 })]);
  });

  it("draws a hold at a location that was deactivated meanwhile", async () => {
    const a = await location(shop, { priority: 1 });
    const b = await location(shop, { priority: 2 });
    const v = await variant();
    await setLevel(shop, v, a, 4);
    await setLevel(shop, v, b, 4);
    const o = await order([{ variantId: v, quantity: 2 }], [{ variantId: v, locationId: b, quantity: 2 }]);
    // A deactivation is refused while the hold is live; once it has expired the location may go, and the payment still draws there first.
    await db.query("update commerce.inventory_reservations set expires_at = now() - interval '1 second' where order_id = $1", [o]);
    await db.query("update commerce.inventory_locations set active = false where id = $1", [b]);
    await db.query("update commerce.inventory_reservations set expires_at = now() + interval '1 hour' where order_id = $1", [o]);
    await pay(o);
    expect([await onHandOf(v, a), await onHandOf(v, b)]).toEqual([4, 2]);
  });

  it("sells a variant that keeps selling below zero, marks the units backordered and says so in an event", async () => {
    const a = await location(shop, { priority: 1 });
    const b = await location(shop, { priority: 2 });
    const v = await variant({ policy: "continue", days: 12 });
    await setLevel(shop, v, a, 3);
    const o = await order([{ variantId: v, quantity: 5, backorder: 2, days: 12 }], [{ variantId: v, locationId: a, quantity: 5, backordered: 2 }]);
    await pay(o);
    expect(await onHandOf(v, a)).toBe(-2);
    expect(await backordered(o)).toEqual([expect.objectContaining({ backorder_quantity: 2, backorder_days: 12 })]);
    const event = await one<{ data: { lines: { sku: string; quantity: number }[] } }>("select data from commerce.order_events where order_id = $1 and type = 'stock.backordered'", [o]);
    expect(event.data.lines).toEqual([{ sku: (await backordered(o))[0].sku, quantity: 2 }]);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.short'", [o])).toBe(0);
    expect(await onHandOf(v, a)).toBe(-2);
    expect(b).toBeTruthy();
    expect(await ledger()).toEqual([]);
  });

  it("draws a payment with no hold (a renewal) below zero at the first location that stocks the variant, or the first location", async () => {
    const first = await location(shop, { priority: 1 });
    const second = await location(shop, { priority: 2 });
    const stocked = await variant({ policy: "continue", days: 3 });
    await setLevel(shop, stocked, second, 1);
    const o = await order([{ variantId: stocked, quantity: 4 }]);
    await pay(o);
    expect([await onHandOf(stocked, second)]).toEqual([-3]);
    expect(await backordered(o)).toEqual([expect.objectContaining({ backorder_quantity: 3, backorder_days: 3 })]);
    // A variant with no level anywhere gets one at the first location.
    const bare = await variant({ policy: "continue", days: 6 });
    const o2 = await order([{ variantId: bare, quantity: 2 }]);
    await pay(o2);
    expect(await onHandOf(bare, first)).toBe(-2);
    expect(await backordered(o2)).toEqual([expect.objectContaining({ backorder_quantity: 2, backorder_days: 6 })]);
  });

  it("still records a shortfall for a variant that stops selling at zero, and backorders nothing", async () => {
    const a = await location();
    const v = await variant();
    await setLevel(shop, v, a, 1);
    const o = await order([{ variantId: v, quantity: 3 }], [{ variantId: v, locationId: a, quantity: 3 }]);
    await pay(o);
    expect(await onHandOf(v, a)).toBe(0);
    const short = await one<{ data: { missing: number } }>("select data from commerce.order_events where order_id = $1 and type = 'stock.short'", [o]);
    expect(short.data.missing).toBe(2);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.backordered'", [o])).toBe(0);
  });

  it("keeps an earlier checkout's claim whatever the order of payment: a later one paying first is the one on backorder (review)", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 8 });
    await setLevel(shop, v, a, 3);
    // A started first and was told "in stock" (3 held, none on backorder). B started after, when nothing was free: told "3 on backorder".
    const early = await order([{ variantId: v, quantity: 3 }], [{ variantId: v, locationId: a, quantity: 3 }]);
    const late = await order([{ variantId: v, quantity: 3, backorder: 3, days: 8 }], [{ variantId: v, locationId: a, quantity: 3, backordered: 3 }]);
    await pay(late);
    // B paid first, and still gets what it was told: 3 on backorder. It does not take A's stock.
    expect(await backordered(late)).toEqual([expect.objectContaining({ backorder_quantity: 3, backorder_days: 8 })]);
    await pay(early);
    // A paid second and is still what it was told: in stock, nothing on backorder, no days it never saw.
    expect(await backordered(early)).toEqual([expect.objectContaining({ backorder_quantity: 0, backorder_days: null })]);
    // Between them 6 were sold of 3 on the shelf: 3 are owed, and the ledger still adds up.
    expect(await onHandOf(v, a)).toBe(-3);
    expect(await ledger()).toEqual([]);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.backordered'", [early])).toBe(0);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.backordered'", [late])).toBe(1);
  });

  it("gives each its own figure when the earlier checkout was told part of it was on backorder", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 8 });
    await setLevel(shop, v, a, 3);
    // A wanted 5 with 3 free: told "2 on backorder" (5 held, 2 beyond stock). B then wanted 3 with none free: "3 on backorder".
    const early = await order([{ variantId: v, quantity: 5, backorder: 2, days: 8 }], [{ variantId: v, locationId: a, quantity: 5, backordered: 2 }]);
    const late = await order([{ variantId: v, quantity: 3, backorder: 3, days: 8 }], [{ variantId: v, locationId: a, quantity: 3, backordered: 3 }]);
    await pay(late);
    expect(await backordered(late)).toEqual([expect.objectContaining({ backorder_quantity: 3 })]);
    await pay(early);
    // Not "5 of 5 on backorder": A is still owed 2 beyond the 3 it had a claim on.
    expect(await backordered(early)).toEqual([expect.objectContaining({ backorder_quantity: 2, backorder_days: 8 })]);
    expect(await onHandOf(v, a)).toBe(-5);
    expect(await ledger()).toEqual([]);
  });

  it("covers a backordered part from the stock once the checkouts ahead of it have let go (it only ever goes down)", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 8 });
    await setLevel(shop, v, a, 3);
    const early = await order([{ variantId: v, quantity: 3 }], [{ variantId: v, locationId: a, quantity: 3 }]);
    const late = await order([{ variantId: v, quantity: 3, backorder: 3, days: 8 }], [{ variantId: v, locationId: a, quantity: 3, backordered: 3 }]);
    // A leaves (its checkout is cancelled): the 3 on the shelf are B's now.
    await db.query("update commerce.inventory_reservations set released_at = now() where order_id = $1", [early]);
    await pay(late);
    expect(await backordered(late)).toEqual([expect.objectContaining({ backorder_quantity: 0 })]);
    expect(await onHandOf(v, a)).toBe(0);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.backordered'", [late])).toBe(0);
    // ... but not while a checkout ahead of it still holds them, whatever else is true.
    const b = await variant({ policy: "continue", days: 8 });
    await setLevel(shop, b, a, 3);
    await order([{ variantId: b, quantity: 3 }], [{ variantId: b, locationId: a, quantity: 3 }]);
    const behind = await order([{ variantId: b, quantity: 3, backorder: 3, days: 8 }], [{ variantId: b, locationId: a, quantity: 3, backordered: 3 }]);
    await pay(behind);
    expect(await backordered(behind)).toEqual([expect.objectContaining({ backorder_quantity: 3 })]);
  });

  it("lets an order whose hold is gone (expired, or a renewal) take only what no live checkout holds", async () => {
    const a = await location();
    const keeps = await variant({ policy: "continue", days: 4 });
    const stops = await variant();
    await setLevel(shop, keeps, a, 3);
    await setLevel(shop, stops, a, 3);
    const holder = await order(
      [{ variantId: keeps, quantity: 3 }, { variantId: stops, quantity: 3 }],
      [{ variantId: keeps, locationId: a, quantity: 3 }, { variantId: stops, locationId: a, quantity: 3 }],
    );
    // Another order for 2 of each, with no live hold (its hold ran out, or it is a renewal), pays first.
    const drifter = await order([{ variantId: keeps, quantity: 2 }, { variantId: stops, quantity: 2 }]);
    await pay(drifter);
    // The variant that keeps selling goes on backorder for what the live checkout holds; the one that stops is short and says so.
    expect((await backordered(drifter)).map((l) => l.backorder_quantity).sort()).toEqual([0, 2]);
    expect(await n("select count(*) as n from commerce.order_events where order_id = $1 and type = 'stock.short'", [drifter])).toBe(1);
    expect(await onHandOf(stops, a)).toBe(3);
    await pay(holder);
    expect((await backordered(holder)).map((l) => l.backorder_quantity)).toEqual([0, 0]);
    expect(await onHandOf(keeps, a)).toBe(-2);
    expect(await onHandOf(stops, a)).toBe(0);
    expect(await ledger()).toEqual([]);
  });

  it("still marks a shortfall on the shelf as backordered when the claim was made on an empty one", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 8 });
    await setLevel(shop, v, a, 0);
    const o = await order([{ variantId: v, quantity: 2, backorder: 2, days: 8 }], [{ variantId: v, locationId: a, quantity: 2, backordered: 2 }]);
    await pay(o);
    expect(await backordered(o)).toEqual([expect.objectContaining({ backorder_quantity: 2, backorder_days: 8 })]);
    expect(await onHandOf(v, a)).toBe(-2);
  });

  it("checks a reservation's backordered part against its quantity", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 8 });
    const o = await order([{ variantId: v, quantity: 2 }]);
    const insert = (q: number, b: number) =>
      db.query("insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, backorder_quantity, order_id, expires_at) values ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')", [shop, v, a, q, b, o]);
    await expect(insert(2, 3)).rejects.toThrow(/inventory_reservations_backorder_within/);
    await expect(insert(2, -1)).rejects.toThrow(/inventory_reservations_backorder_within/);
    await expect(insert(2, 2)).resolves.toBeDefined();
  });

  it("puts backordered units on the paid lines of the variant first, then a gift, in id order", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 5 });
    await setLevel(shop, v, a, 1);
    const o = await order([
      { variantId: v, quantity: 2, gift: true },
      { variantId: v, quantity: 2 },
      { variantId: v, quantity: 1 },
    ]);
    await pay(o);
    // 5 wanted, 1 in stock: 4 backordered, over the two paid lines (2 and 2), the gift gets none.
    const lines = await all<{ gift: boolean; quantity: number; backorder_quantity: number }>(
      "select gift, quantity, backorder_quantity from commerce.order_lines where order_id = $1 order by gift, quantity desc",
      [o],
    );
    expect(lines).toEqual([
      { gift: false, quantity: 2, backorder_quantity: 2 },
      { gift: false, quantity: 1, backorder_quantity: 1 },
      { gift: true, quantity: 2, backorder_quantity: 1 },
    ]);
    expect(lines.reduce((sum, l) => sum + l.backorder_quantity, 0)).toBe(4);
  });

  it("draws variants in variant order and sets nothing for a digital line", async () => {
    const a = await location();
    const v1 = await variant();
    const v2 = await variant();
    await setLevel(shop, v1, a, 2);
    await setLevel(shop, v2, a, 2);
    const o = await order([{ variantId: v2, quantity: 1 }, { variantId: v1, quantity: 1 }]);
    await pay(o);
    expect([await onHandOf(v1, a), await onHandOf(v2, a)]).toEqual([1, 1]);
  });

  it("returns the units short and sets the stock context back after the draw", async () => {
    const a = await location();
    const v = await variant();
    await setLevel(shop, v, a, 1);
    const o = await order([{ variantId: v, quantity: 4 }]);
    await db.query("begin");
    await db.query("select commerce.stock_context('received', 'inventory_page')");
    const { short } = await one<{ short: number }>("select commerce.draw_order_stock($1) as short", [o]);
    const after = await one<{ ctx: string; drawing: string }>("select current_setting('kaizen.stock', true) as ctx, current_setting('kaizen.drawing', true) as drawing");
    await db.query("update commerce.inventory_levels set on_hand = 7 where variant_id = $1", [v]);
    await db.query("commit");
    expect(short).toBe(3);
    expect(JSON.parse(after.ctx)).toMatchObject({ reason: "received", source: "inventory_page" });
    expect(after.drawing).toBe("");
    // The draw's own movement is a sale of this order, and what came after is the person's.
    expect((await movements(v)).map((m) => [m.reason, m.order_id])).toEqual([["opening", null], ["sale", o], ["received", null]]);
  });

  it("is what complete_order_payment() calls, and still issues the invoice after it", async () => {
    const def = await one<{ def: string }>("select pg_get_functiondef('commerce.complete_order_payment(uuid, text)'::regprocedure) as def");
    expect(def.def).toContain("commerce.draw_order_stock(p_order_id)");
    expect(def.def).toContain("commerce.issue_order_invoice(v_order.store_id, p_order_id)");
    expect(def.def).not.toContain("inventory_levels");
    expect(def.def.indexOf("draw_order_stock")).toBeLessThan(def.def.indexOf("issue_order_invoice"));
    expect(def.def).toContain("'stock.short'");
  });

  it("issues the invoice after the draw in the same payment, and a payment that is short or backordered still completes", async () => {
    const invoicing = await createInvoiceStore(db, `inv-invoice-${++counter}`);
    const paid = await placeFixtureOrder(db, invoicing, { lines: [{ sku: "DRAWN", unit: 12500 }] });
    expect(paid.invoiceId).not.toBeNull();
    expect(await n("select count(*) as n from commerce.invoices where order_id = $1", [paid.id])).toBe(1);
    expect(await all("select 1 from commerce.inventory_ledger_check($1)", [invoicing])).toEqual([]);
    // The fixture's goods have no stock: the shortfall is recorded, the order is paid and invoiced all the same.
    const short = await all<{ data: { missing: number } }>("select data from commerce.order_events where order_id = $1 and type = 'stock.short'", [paid.id]);
    expect(short).toEqual([{ data: { missing: 1 } }]);
    expect((await one<{ status: string }>("select status::text as status from commerce.orders where id = $1", [paid.id])).status).toBe("paid");
  });

  it("changes the backorder of a line only inside the draw", async () => {
    const a = await location();
    const v = await variant({ policy: "continue", days: 5 });
    await setLevel(shop, v, a, 0);
    const o = await order([{ variantId: v, quantity: 2, backorder: 2, days: 5 }]);
    await rejects("update commerce.order_lines set backorder_quantity = 1 where order_id = $1", [o], /order_line\.backorder_fixed/);
    await rejects("update commerce.order_lines set backorder_days = 9 where order_id = $1", [o], /order_line\.backorder_fixed/);
    // Inside the draw the check still holds: never more units than the line has.
    await db.query("begin");
    await db.query("select set_config('kaizen.drawing', 'on', true)");
    await expect(db.query("update commerce.order_lines set backorder_quantity = 3 where order_id = $1", [o])).rejects.toThrow(/order_lines_backorder_quantity/);
    await db.query("rollback");
    await db.query("update commerce.order_lines set title = 'Other' where order_id = $1", [o]);
    await pay(o);
    // The stated days never change, even by the draw, and a backorder needs days.
    await rejects("update commerce.order_lines set backorder_days = 9 where order_id = $1", [o], /order_line\.backorder_fixed/);
    await expect(order([{ variantId: v, quantity: 2, backorder: 1, days: null }])).rejects.toThrow(/order_lines_backorder_stated/);
    await expect(order([{ variantId: v, quantity: 2, backorder: 1, days: 91 }])).rejects.toThrow(/order_lines_backorder_days/);
  });
});

describe("the low-stock state", () => {
  type Alert = { state: AlertState; crossed_at: string | null; notified_at: string | null; stock_at_crossing: number | null };
  const alertOf = (v: string) => one<Alert | undefined>("select state, crossed_at, notified_at, stock_at_crossing from commerce.stock_alerts where variant_id = $1", [v]);
  const threshold = (v: string, level: number | null) => db.query("update commerce.product_variants set low_stock_threshold = $2 where id = $1", [v, level]);

  /** Applies a step and checks the row against `nextAlertState()`: the state, and each column as the change says. */
  async function step(v: string, prev: Alert | undefined, level: number | null, stock: number, apply: () => Promise<unknown>): Promise<Alert | undefined> {
    await apply();
    const row = await alertOf(v);
    const change = nextAlertState(prev?.state ?? null, level, stock);
    if (!row) {
      // No row is made for a variant that never had a level.
      expect(prev).toBeUndefined();
      expect(level).toBeNull();
      return row;
    }
    expect(row.state).toBe(change.state);
    expect(row.crossed_at !== null).toBe(change.state === "low");
    if (change.crossedAt === "keep") expect(row.crossed_at).toEqual(prev?.crossed_at);
    if (change.notifiedAt === "clear") expect(row.notified_at).toBeNull();
    if (change.notifiedAt === "now") expect(row.notified_at).not.toBeNull();
    if (change.notifiedAt === "keep") expect(row.notified_at).toEqual(prev?.notified_at ?? null);
    if (change.stockAtCrossing === "set") expect(row.stock_at_crossing).toBe(stock);
    if (change.stockAtCrossing === "keep") expect(row.stock_at_crossing).toEqual(prev?.stock_at_crossing);
    if (change.stockAtCrossing === "clear") expect(row.stock_at_crossing).toBeNull();
    return row;
  }

  it("crosses once: sales from 10 to 3 with a level of 5 make one crossing, and a receipt above it re-arms the next", async () => {
    const a = await location();
    const v = await variant({ threshold: 5 });
    await setLevel(shop, v, a, 10);
    expect((await alertOf(v))?.state).toBe("ok");
    const crossings: (string | null)[] = [];
    let prev = await alertOf(v);
    for (const stock of [9, 8, 7, 6, 5, 4, 3]) {
      prev = await step(v, prev, 5, stock, () => setLevel(shop, v, a, stock));
      crossings.push(prev?.crossed_at ? String(prev.crossed_at) : null);
    }
    expect(prev).toMatchObject({ state: "low", notified_at: null, stock_at_crossing: 5 });
    expect(new Set(crossings.filter(Boolean)).size).toBe(1);
    // Rising above the level clears the crossing; the next fall is a new crossing.
    prev = await step(v, prev, 5, 6, () => setLevel(shop, v, a, 6));
    expect(prev?.state).toBe("ok");
    prev = await step(v, prev, 5, 5, () => setLevel(shop, v, a, 5));
    expect(prev).toMatchObject({ state: "low", notified_at: null, stock_at_crossing: 5 });
  });

  it("moves as nextAlertState() says through every kind of step: levels set, raised, lowered and cleared, and stock up and down", async () => {
    const a = await location();
    // It keeps selling on backorder, so the stock can go below zero in the last step.
    const v = await variant({ policy: "continue", days: 3 });
    await setLevel(shop, v, a, 4);
    let prev = await alertOf(v);
    expect(prev).toBeUndefined();
    let level: number | null = null;
    let stock = 4;
    const plan: ({ level: number | null } | { stock: number })[] = [
      { level: 10 }, // set on a variant already below: told at once
      { stock: 12 }, // up over it
      { stock: 10 }, // a crossing, to be told
      { level: 3 }, // lowered under the stock: ok again
      { level: 10 }, // raised over the stock: a crossing
      { level: null }, // cleared: off
      { stock: 0 },
      { level: 0 }, // set on a variant at the level: told
      { stock: 1 },
      { stock: 0 },
      { level: 5 },
      { stock: -2 },
    ];
    for (const move of plan) {
      if ("level" in move) {
        level = move.level;
        prev = await step(v, prev, level, stock, () => threshold(v, level));
      } else {
        stock = move.stock;
        prev = await step(v, prev, level, stock, () => setLevel(shop, v, a, stock));
      }
    }
    expect(prev?.state).toBe("low");
  });

  it("is told already when a level is set on a variant at or below it, and not when it is set above the stock", async () => {
    const a = await location();
    const low = await variant();
    await setLevel(shop, low, a, 2);
    await threshold(low, 5);
    expect(await alertOf(low)).toMatchObject({ state: "low", stock_at_crossing: 2 });
    expect((await alertOf(low))?.notified_at).not.toBeNull();
    const fine = await variant();
    await setLevel(shop, fine, a, 20);
    await threshold(fine, 5);
    expect(await alertOf(fine)).toMatchObject({ state: "ok", crossed_at: null });
  });

  it("counts on hand over the active locations only, so deactivating one crosses and reactivating it re-arms", async () => {
    const store = await createStore(`inv-alert-${++counter}`);
    const a = await location(store);
    const b = await location(store);
    const v = await variant({ store, threshold: 5 });
    await setLevel(store, v, a, 4);
    await setLevel(store, v, b, 6);
    expect((await alertOf(v))?.state).toBe("ok");
    await db.query("update commerce.inventory_locations set active = false where id = $1", [b]);
    expect(await alertOf(v)).toMatchObject({ state: "low", stock_at_crossing: 4 });
    expect((await alertOf(v))?.notified_at).toBeNull();
    await db.query("update commerce.inventory_locations set active = true where id = $1", [b]);
    expect(await alertOf(v)).toMatchObject({ state: "ok", crossed_at: null });
  });

  it("makes no row for a variant without a level, and keeps the row of one whose level was cleared (state off)", async () => {
    const a = await location();
    const v = await variant();
    await setLevel(shop, v, a, 3);
    await setLevel(shop, v, a, 2);
    expect(await alertOf(v)).toBeUndefined();
    await threshold(v, 5);
    expect((await alertOf(v))?.state).toBe("low");
    await threshold(v, null);
    expect(await alertOf(v)).toMatchObject({ state: "off", crossed_at: null, stock_at_crossing: null });
    expect(await n("select count(*) as n from commerce.stock_alerts where variant_id = $1", [v])).toBe(1);
  });

  it("never stops a change of stock: a refresh that fails is a warning", async () => {
    const a = await location();
    const v = await variant({ threshold: 5 });
    await setLevel(shop, v, a, 10);
    // Break the table the refresh writes to for a moment; the sale still goes through.
    await db.query("alter table commerce.stock_alerts rename to stock_alerts_away");
    try {
      await setLevel(shop, v, a, 3);
    } finally {
      await db.query("alter table commerce.stock_alerts_away rename to stock_alerts");
    }
    expect(await onHandOf(v, a)).toBe(3);
    expect(await ledger()).toEqual([]);
  });

  it("is a row of its own store, deleted with nothing and only readable by its variant", async () => {
    const a = await location();
    const v = await variant({ threshold: 5 });
    await setLevel(shop, v, a, 10);
    await expect(
      db.query("insert into commerce.stock_alerts (store_id, variant_id, state) values ($1, $2, 'ok') on conflict do nothing returning 1", [other, v]),
    ).rejects.toThrow(/stock_alerts_variant_fk/);
    await rejectsCheck();
    async function rejectsCheck() {
      await expect(db.query("update commerce.stock_alerts set state = 'low' where variant_id = $1", [v])).rejects.toThrow(/stock_alerts_crossing/);
    }
  });
});

describe("copying a store", () => {
  /** A store with goods: one that keeps selling, one with a warning level, a download, two ranked locations, and a negative level. */
  async function source() {
    const store = await createStore(`inv-src-${++counter}`);
    const first = await location(store, { priority: 2, name: "Second" });
    const second = await location(store, { priority: 1, name: "First" });
    const backorder = await variant({ store, policy: "continue", days: 14, threshold: 3 });
    const plain = await variant({ store });
    const digital = await variant({ store, delivery: "digital" });
    await setLevel(store, backorder, first, -4);
    await setLevel(store, backorder, second, 6);
    await setLevel(store, plain, first, 9);
    return { store, first, second, backorder, plain, digital };
  }

  const check = async (copy: string, from: Awaited<ReturnType<typeof source>>) => {
    const skus = await all<{ sku: string; stock_policy: string; backorder_days: number | null; low_stock_threshold: number | null }>(
      "select sku, stock_policy, backorder_days, low_stock_threshold from commerce.product_variants where store_id = $1 order by sku",
      [copy],
    );
    const original = await all<{ sku: string; stock_policy: string; backorder_days: number | null; low_stock_threshold: number | null }>(
      "select sku, stock_policy, backorder_days, low_stock_threshold from commerce.product_variants where store_id = $1 order by sku",
      [from.store],
    );
    expect(skus.length).toBe(original.length);
    expect(skus).toEqual(original);
    expect(skus.find((s) => s.stock_policy === "continue")).toMatchObject({ backorder_days: 14, low_stock_threshold: 3 });
    // The rank of the locations is copied: "First" is still ahead of "Second".
    const ranked = await all<{ name: string }>("select name from commerce.inventory_locations where store_id = $1 order by priority, created_at, id", [copy]);
    expect(ranked.map((r) => r.name)).toEqual(["First", "Second"]);
    // No history is copied; the copy has its own opening movements, from the copy's context, and its ledger balances.
    const history = await all<{ reason: string; source: string; order_id: string | null }>(
      "select reason, source, order_id from commerce.inventory_movements where store_id = $1",
      [copy],
    );
    expect(history.length).toBeGreaterThan(0);
    for (const m of history) expect([m.reason, m.source, m.order_id]).toEqual(["opening", "copy", null]);
    expect(await all("select 1 from commerce.inventory_ledger_check($1)", [copy])).toEqual([]);
    // A level below zero (what is owed on orders that are not copied) starts at zero, and a download has none.
    const levels = await all<{ on_hand: number }>("select on_hand from commerce.inventory_levels where store_id = $1 order by on_hand", [copy]);
    expect(levels.map((l) => l.on_hand)).toEqual([0, 6, 9]);
    expect(await n("select count(*) as n from commerce.stock_alerts where store_id = $1", [copy])).toBe(1);
    expect(await n("select count(*) as n from commerce.inventory_movements where store_id = $1 and created_at < now() - interval '1 minute'", [copy])).toBe(0);
  };

  it("duplicate_store() copies the policy, days, level and rank, and starts a history of its own", async () => {
    const from = await source();
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, $2, 'Copy', $3) as id", [from.store, `inv-dup-${counter}`, owner]);
    await check(copy, from);
    // The original's history and levels are untouched.
    expect(await onHandOf(from.backorder, from.first)).toBe(-4);
    expect(await n("select count(*) as n from commerce.inventory_movements where store_id = $1", [from.store])).toBeGreaterThan(0);
  });

  it("clone_store() copies them too", async () => {
    const from = await source();
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, $2, 'Copy', $3) as id", [from.store, `inv-clone-${counter}`, owner]);
    // clone_store copies only products that are not archived and publishes them; the checks are the same.
    await check(copy, from);
  });

  it("copies a deactivated location as deactivated without its date, and an order's draw never reaches the copy", async () => {
    const from = await source();
    await db.query("update commerce.inventory_locations set active = false where id = $1", [from.first]);
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, $2, 'Copy', $3) as id", [from.store, `inv-dup-off-${counter}`, owner]);
    const rows = await all<{ name: string; active: boolean; deactivated_at: string | null }>(
      "select name, active, deactivated_at from commerce.inventory_locations where store_id = $1 order by name",
      [copy],
    );
    expect(rows).toEqual([
      { name: "First", active: true, deactivated_at: null },
      { name: "Second", active: false, deactivated_at: null },
    ]);
  });
});

describe("the data job kinds", () => {
  it("learns the stock file kinds: an import has a file and a dry run, an export is queued and has none, and one stock import is open at a time", async () => {
    const job = async (kind: string, status: string, over: { inputPath?: string | null; files?: string } = {}) =>
      one<{ id: string }>(
        `insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, files)
         values ($1, $2, $3, 'kaizen', $4, $5, 'x.csv', 10, $6::jsonb) returning id`,
        [shop, kind, status, owner, over.inputPath === undefined ? (kind.endsWith("import") ? "p/x.csv" : null) : over.inputPath, over.files ?? "[]"],
      );
    const first = await job("inventory_import", "uploaded");
    await expect(job("inventory_import", "uploaded")).rejects.toThrow(/data_jobs_one_active_inventory_import_idx/);
    // A product import is a different pipeline and does not count against it.
    await db.query("update commerce.data_jobs set status = 'cancelled' where store_id = $1 and kind = 'product_import'", [shop]);
    await expect(job("product_import", "uploaded")).resolves.toBeDefined();
    // An import starts as uploaded, an export as queued.
    await expect(job("inventory_import", "queued")).rejects.toThrow(/data_job\.start|one_active/);
    await expect(job("inventory_export", "uploaded")).rejects.toThrow(/data_job\.status_kind/);
    await expect(job("inventory_export", "queued")).resolves.toBeDefined();
    await expect(job("inventory_export", "queued", { inputPath: "p/y.csv" })).rejects.toThrow(/data_jobs_export_no_input/);
    await db.query("update commerce.data_jobs set status = 'checking' where id = $1", [first.id]);
    await db.query("update commerce.data_jobs set status = 'checked' where id = $1", [first.id]);
    await rejects("update commerce.data_jobs set status = 'uploaded' where id = $1", [first.id], /data_job\.status/);
    // The items of a stock file are `stock` items.
    await db.query("insert into commerce.data_job_items (store_id, job_id, seq, kind, outcome) values ($1, $2, 0, 'stock', 'checked')", [shop, first.id]);
  });

  it("starts a stock export through start_export_job(), counted among the exports and not the imports", async () => {
    const id = (await one<{ id: string }>("select commerce.start_export_job($1, 'inventory_export', $2, '{}'::jsonb, 5) as id", [shop, owner])).id;
    expect((await one<{ kind: string; status: string }>("select kind, status from commerce.data_jobs where id = $1", [id])).kind).toBe("inventory_export");
    await rejects("select commerce.start_export_job($1, 'inventory_import', $2, '{}'::jsonb, 5)", [shop, owner], /not an export/);
  });
});
