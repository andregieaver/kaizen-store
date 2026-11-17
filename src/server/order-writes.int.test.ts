import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * What one guest order of three lines and one counted visit write (bloat review step 1.12, GAP-database-3): their statements, the rows
 * inserted and updated over every table, and the tables written, held in the key `orderWrites` of `src/server/ratchet.baseline.json`.
 * A number above its baseline fails naming it and the tables newly written; one below asks for UPDATE_BASELINE=1, which raises a number
 * or adds a table only with FIRST=1 too. A trigger that writes a row, or a new table written, is what this sees.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { closeSide, side } = await import("./query-budget-test-support");
const { measureTables, readKey, writeKey } = await import("./table-stats-test-support");
const { fxStore, NO } = await import("./fulfilment-test-fixture");
const { cartOf } = await import("./shipping-test-fixture");
const { placeOrder } = await import("./checkout");
const { recordVisit } = await import("./analytics-visits");

type Writes = { statements: number; rowsInserted: number; rowsUpdated: number; tables: string[] };
type Held = Partial<Record<"order" | "visit", Writes>>;
type Measured = Awaited<ReturnType<typeof measureTables>>;

const WRITE = process.env.UPDATE_BASELINE === "1";
const RAISE = process.env.FIRST === "1";
const FIX = "UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/order-writes.int.test.ts";

const writesOf = (m: Measured): Writes => {
  const tables = Object.entries(m.tables);
  return {
    statements: m.statements,
    rowsInserted: tables.reduce((sum, [, t]) => sum + t.inserted, 0),
    rowsUpdated: tables.reduce((sum, [, t]) => sum + t.updated, 0),
    tables: tables.filter(([, t]) => t.inserted || t.updated || t.deleted).map(([name]) => name).sort(),
  };
};

/** What differs from the baseline, each a sentence; empty when it matches. */
function compareWrites(name: string, now: Writes, held: Writes | undefined): string[] {
  if (!held) return [`${name} is not in the baseline: write it with FIRST=1 ${FIX}`];
  const problems: string[] = [];
  const added = now.tables.filter((t) => !held.tables.includes(t));
  for (const t of added) problems.push(`${name} now writes commerce.${t}, which the baseline does not list: a trigger or a new write; accept it with FIRST=1 ${FIX} and say why`);
  for (const key of ["statements", "rowsInserted", "rowsUpdated"] as const) {
    if (now[key] > held[key]) problems.push(`${name} now has ${now[key]} ${key}, baseline ${held[key]}${added.length ? ` (newly written: ${added.join(", ")})` : ""}: write less, or accept it with FIRST=1 ${FIX}`);
    // A fall is a note, never a failure, so the other work's improvements do not hold back a release (reviewed 17 November 2026).
    if (now[key] < held[key]) console.warn(`order writes: ${name} now has ${now[key]} ${key}, baseline ${held[key]}: lower the baseline with ${FIX}`);
  }
  const gone = held.tables.filter((t) => !now.tables.includes(t));
  if (gone.length > 0) console.warn(`order writes: ${name} no longer writes ${gone.join(", ")}: lower the baseline with ${FIX}`);
  return problems;
}

let store: Awaited<ReturnType<typeof fxStore>>;
let skus: string[] = [];
const measured: Held = {};

beforeAll(async () => {
  store = await fxStore("order-writes");
  // A store with only the shop on (D178), counting visits, its flat rate the template's (99 kr, free over 999 kr).
  await db().execute(sql`update commerce.stores set features = array['shop'], visit_counting = true, time_zone = 'Europe/Oslo' where id = ${store.storeId}::uuid`);
  const rows = await db().execute<{ sku: string }>(sql`
    select v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id and p.store_id = v.store_id
    where v.store_id = ${store.storeId}::uuid and v.active and p.status = 'active' and v.delivery = 'physical'
      and (select count(*) from commerce.product_variants w where w.product_id = v.product_id) = 1
    order by v.sku limit 3
  `);
  skus = rows.map((r) => r.sku);
}, 120_000);

afterAll(async () => {
  if (WRITE) {
    const held = readKey<Held>("orderWrites") ?? {};
    const raised = (["order", "visit"] as const).filter((k) => {
      const now = measured[k];
      const was = held[k];
      return now && was && (now.statements > was.statements || now.rowsInserted > was.rowsInserted || now.rowsUpdated > was.rowsUpdated || now.tables.some((t) => !was.tables.includes(t)));
    });
    if (raised.length > 0 && !RAISE) throw new Error(`Not written: ${raised.join(", ")} rose; with FIRST=1 the rise is accepted.`);
    writeKey("orderWrites", { ...held, ...measured });
  }
  await closeDb();
  await closeSide();
});

const guestCart = () => cartOf(store, skus.map((sku) => [sku, 1]));

describe("what one order and one visit write", () => {
  it("finds three simple products in stock", () => {
    expect(skus).toHaveLength(3);
  });

  it("one guest order of three lines", async () => {
    const cartId = await guestCart();
    let placed: Awaited<ReturnType<typeof placeOrder>> | undefined;
    const m = await measureTables(async () => {
      placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {});
    });
    expect(placed?.ok, JSON.stringify(placed)).toBe(true);
    measured.order = writesOf(m);
    if (!WRITE) expect(compareWrites("order", measured.order, readKey<Held>("orderWrites")?.order)).toEqual([]);
  }, 120_000);

  it("one counted visit", async () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "x-forwarded-for": "203.0.113.9",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      referer: `http://localhost:3000/s/${store.slug}/no`,
    });
    let outcome: Awaited<ReturnType<typeof recordVisit>> | undefined;
    const m = await measureTables(async () => {
      outcome = await recordVisit({ headers, body: { store: store.slug, path: `/s/${store.slug}/no` } });
    });
    expect(outcome).toEqual({ recorded: true });
    measured.visit = writesOf(m);
    if (!WRITE) expect(compareWrites("visit", measured.visit, readKey<Held>("orderWrites")?.visit)).toEqual([]);
  }, 120_000);

  it("would notice a trigger on commerce.orders that writes a row", async () => {
    const held = readKey<Held>("orderWrites")?.order ?? measured.order;
    expect(held, "the order was measured or is in the baseline").toBeDefined();
    const cartId = await guestCart();
    // A real trigger, made on the side connection: the app's pool is another connection and would not see one made in a test's own
    // transaction.
    try {
      await side()`create table commerce.order_probe (id uuid)`;
      await side().unsafe(`create function commerce.order_probe_fn() returns trigger language plpgsql as $$ begin insert into commerce.order_probe (id) values (new.id); return new; end $$`);
      await side()`create trigger order_probe after insert on commerce.orders for each row execute function commerce.order_probe_fn()`;
      const m = await measureTables(() => placeOrder({ storeId: store.storeId, market: NO }, cartId, {}));
      const now = writesOf(m);
      expect(now.rowsInserted).toBe(held!.rowsInserted + 1);
      expect(compareWrites("order", now, held).some((p) => p.includes("commerce.order_probe"))).toBe(true);
    } finally {
      await side().unsafe("drop trigger if exists order_probe on commerce.orders; drop function if exists commerce.order_probe_fn(); drop table if exists commerce.order_probe;");
    }
  }, 120_000);
});
