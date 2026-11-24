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
const { closeSide, settled, side } = await import("./query-budget-test-support");
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

/** A store with only the shop on (D178), counting visits, its flat rate the template's (99 kr, free over 999 kr). */
async function shopOnlyStore(label: string) {
  const made = await fxStore(label);
  await db().execute(sql`update commerce.stores set features = array['shop'], visit_counting = true, time_zone = 'Europe/Oslo' where id = ${made.storeId}::uuid`);
  return made;
}

/** The store's active physical variants by SKU: of simple products (one variant each), or of any product with `simple` false. */
async function simpleSkus(storeId: string, simple = true): Promise<string[]> {
  const rows = await db().execute<{ sku: string }>(sql`
    select v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id and p.store_id = v.store_id
    where v.store_id = ${storeId}::uuid and v.active and p.status = 'active' and v.delivery = 'physical'
      and (not ${simple}::boolean or (select count(*) from commerce.product_variants w where w.product_id = v.product_id) = 1)
    order by v.sku
  `);
  return rows.map((r) => r.sku);
}

beforeAll(async () => {
  store = await shopOnlyStore("order-writes");
  skus = (await simpleSkus(store.storeId)).slice(0, 3);
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
    expect(outcome).toEqual({ recorded: true, company: null });
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

const NEVER_RAISE = "lower the cost or do code review step 3.7 for that part; never raise the ceiling";

/** Statements an order sends for each line past its first: today's figure (17 November 2026), so one more per line fails case 2. */
const PER_LINE = 2;

/**
 * A visitor's first page view of the day (as the file counts it): the store, whether the visitor is known today, the two rate-limit upserts
 * of takeNewVisit() (the address's ten minutes and the store's day, which protect the counts against a script and stay) and the visit's
 * upsert. Today's figure held, the owner's rule from step 0.43 (reviewer's decision for step 2.48): 5 statements, 3 rows written (3 inserted,
 * or 2 and 1 updated once the store's day counter exists, as after the case above). A repeat page view sends 3 and writes 1.
 */
const VISIT = { statements: 5, rows: 3 };

type FunctionTime = { calls: number; ms: number };

/** Trigger functions of `commerce` with the calls and total time Postgres has counted for them (track_functions on). */
async function triggerTimes(): Promise<Record<string, FunctionTime>> {
  await side()`select pg_stat_clear_snapshot()`;
  const rows = await side()`
    select f.funcname, f.calls, f.total_time from pg_stat_user_functions f join pg_proc p on p.oid = f.funcid
    where f.schemaname = 'commerce' and p.prorettype = 'pg_catalog.trigger'::regtype
  `;
  return Object.fromEntries(rows.map((r) => [String(r.funcname), { calls: Number(r.calls), ms: Number(r.total_time) }]));
}

/** What `run` sent and wrote (measureTables()), and each trigger function that ran during it with its calls and milliseconds. */
async function measureTriggers(run: () => Promise<unknown>): Promise<{ m: Measured; moved: Record<string, FunctionTime> }> {
  const before = await settled(triggerTimes);
  const m = await measureTables(run);
  const after = await settled(triggerTimes);
  const moved: Record<string, FunctionTime> = {};
  for (const [name, now] of Object.entries(after)) {
    const was = before[name] ?? { calls: 0, ms: 0 };
    if (now.calls > was.calls) moved[name] = { calls: now.calls - was.calls, ms: now.ms - was.ms };
  }
  return { m, moved };
}

/**
 * Optional features' trigger functions: each reads a table of a feature a shop-only store has switched off (bonus, gift cards, affiliates,
 * creators, bookings). Standing orders and suppliers have no trigger on the order's tables; payments_referral is Kaizena Flow's own fee and
 * orders_deal_win the CRM's. None returns early on the store's switch, and none may: with the feature off each still has work for a store
 * that had it on (D178).
 */
const OPTIONAL_TRIGGERS: Record<string, string> = {
  orders_bonus: "bonus: earns credits on payment, and gives held credits back on a cancel even with bonus off",
  orders_issue_gift_cards: "gift cards: issues the cards an order bought when it is paid",
  payments_issue_gift_cards: "gift cards: the same issue when a payment is captured",
  orders_gift_card_payments: "gift cards: captures or cancels the order's gift card payments (cards sold stay usable with the feature off)",
  payments_gift_card: "gift cards: holds, spends or releases a card's amount for a gift card payment",
  orders_gift_card_people: "gift cards: forgets a card's recipient with the order's anonymising",
  orders_affiliate: "affiliates (referrals): rewards an attributed order when due, even with the program off since",
  orders_creator: "creators: a creator's commission on a paid order (no store switch)",
  payments_creator: "creators: the same commission when a payment is written",
  order_bookings_follow: "bookings: confirms or cancels the order's bookings, appointments included",
};

/**
 * The optional features' trigger functions on a warm connection, of one paid order. The plan's line is 2 ms; today's figure is 1.44 to
 * 1.88 ms (six runs, 19 November 2026, the gift card issue 0.67 to 0.98 of it), over 1.5, so the ceiling held is today's worst plus a half
 * (1.88 x 1.5 = 2.82, rounded up to 2.9), the reviewer's rule for step 2.48.
 */
const OPTIONAL_MS = 2.9;

const sumMs = (times: { ms: number }[]) => times.reduce((sum, t) => sum + t.ms, 0);
const round = (ms: number) => Math.round(ms * 1000) / 1000;

/**
 * A placed order's ceilings (bloat review step 2.48, `docs/performance.md` What one placed order costs).
 */
describe("a placed order's ceilings", () => {
  // track_functions is a superuser setting, and the app's pool is another connection: set for the database, and the pool reconnects.
  let canTime = true;
  let whyNot = "";

  beforeAll(async () => {
    try {
      await side().unsafe(`alter database ${await currentDatabase()} set track_functions = 'all'`);
    } catch (error) {
      canTime = false;
      whyNot = `track_functions could not be set: ${(error as Error).message}`;
    }
    await closeDb();
  }, 60_000);

  afterAll(async () => {
    if (canTime) await side().unsafe(`alter database ${await currentDatabase()} reset track_functions`);
    await closeDb();
  }, 60_000);

  const currentDatabase = async () => {
    const [row] = await side()`select quote_ident(current_database()) as name`;
    return String(row.name);
  };

  /** Places an order of one of each SKU, inside measureTables() when `measured` is true. */
  const order = async (shop: Awaited<ReturnType<typeof fxStore>>, lineSkus: string[]) => {
    const cartId = await cartOf(shop, lineSkus.map((sku) => [sku, 1]));
    let placed: Awaited<ReturnType<typeof placeOrder>> | undefined;
    const m = await measureTables(async () => {
      placed = await placeOrder({ storeId: shop.storeId, market: NO }, cartId, {});
    });
    if (!placed?.ok) throw new Error(`the order was not placed: ${JSON.stringify(placed)}`);
    return { m, orderId: placed.order.orderId };
  };

  it("(1) sends the same statements with 10 and with 2,000 earlier orders", async () => {
    const [a, b] = await Promise.all([shopOnlyStore("ceiling-a"), shopOnlyStore("ceiling-b")]);
    const [skuA] = await simpleSkus(a.storeId);
    const [skuB] = await simpleSkus(b.storeId);
    const firstA = await order(a, [skuA]);
    const firstB = await order(b, [skuB]);
    // Copies of the first order, numbered 'C-…' outside the gap-free series as copied orders are (D384).
    const [cols] = await side()`
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols from information_schema.columns
      where table_schema = 'commerce' and table_name = 'orders' and is_generated = 'NEVER' and identity_generation is null
    `;
    const copy = async (orderId: string, count: number) => {
      await side().unsafe(
        `insert into commerce.orders (${cols.cols}) select ${cols.cols} from (
           select (jsonb_populate_record(null::commerce.orders, to_jsonb(o) || jsonb_build_object('id', gen_random_uuid(), 'number', 'C-' || n))).*
           from commerce.orders o, generate_series(1, $2::int) n where o.id = $1::uuid) x`,
        [orderId, count],
      );
    };
    await copy(firstA.orderId, 9);
    await copy(firstB.orderId, 1_999);
    const tenth = await order(a, [skuA]);
    const twoThousandth = await order(b, [skuB]);
    const differing = (x: Measured, y: Measured) => {
      const texts = (r: Measured) => r.records.filter((s) => !s.control).map((s) => s.text.replace(/\s+/g, " ").slice(0, 120));
      const left = texts(x);
      const right = texts(y);
      return [...left.filter((t) => !right.includes(t)), ...right.filter((t) => !left.includes(t))];
    };
    expect(
      twoThousandth.m.statements,
      `one order sends ${twoThousandth.m.statements} statements in a store with 2,000 earlier orders and ${tenth.m.statements} with 10 (${JSON.stringify(differing(tenth.m, twoThousandth.m))}): ${NEVER_RAISE}`,
    ).toBe(tenth.m.statements);
  }, 300_000);

  it("(2) sends at most 2 statements more for each added line", async () => {
    const shop = await shopOnlyStore("ceiling-lines");
    const lineSkus = (await simpleSkus(shop.storeId, false)).slice(0, 5);
    expect(lineSkus).toHaveLength(5);
    const one = await order(shop, lineSkus.slice(0, 1));
    for (const n of [2, 5]) {
      const more = await order(shop, lineSkus.slice(0, n));
      const added = more.m.statements - one.m.statements;
      expect(added, `an order of ${n} lines sends ${added} statements more than one of 1 line, ceiling ${PER_LINE * (n - 1)}: ${NEVER_RAISE}`).toBeLessThanOrEqual(PER_LINE * (n - 1));
    }
  }, 300_000);

  it("(3) spends under a fifth of the order's database time in triggers", async (ctx) => {
    if (!canTime) ctx.skip(whyNot);
    const shop = await shopOnlyStore("ceiling-triggers");
    const cartId = await cartOf(shop, (await simpleSkus(shop.storeId)).slice(0, 3).map((sku) => [sku, 1]));
    let placed: Awaited<ReturnType<typeof placeOrder>> | undefined;
    const { m, moved } = await measureTriggers(async () => {
      placed = await placeOrder({ storeId: shop.storeId, market: NO }, cartId, {});
    });
    expect(placed?.ok, JSON.stringify(placed)).toBe(true);
    const orderMs = sumMs(m.records);
    const triggerMs = sumMs(Object.values(moved));
    expect(
      triggerMs,
      `triggers took ${round(triggerMs)} ms of the order's ${round(orderMs)} ms (${JSON.stringify(moved)}), ceiling a fifth: ${NEVER_RAISE}`,
    ).toBeLessThan(orderMs / 5);
  }, 300_000);

  it("(4) counts a visitor's first page view of the day in at most 5 statements and 3 rows", async () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "x-forwarded-for": "203.0.113.10",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      referer: `http://localhost:3000/s/${store.slug}/no`,
    });
    let outcome: Awaited<ReturnType<typeof recordVisit>> | undefined;
    const m = await measureTables(async () => {
      outcome = await recordVisit({ headers, body: { store: store.slug, path: `/s/${store.slug}/no` } });
    });
    expect(outcome).toEqual({ recorded: true, company: null });
    const w = writesOf(m);
    expect(m.statements, `a counted visit sends ${m.statements} statements, ceiling ${VISIT.statements}: ${NEVER_RAISE}`).toBeLessThanOrEqual(VISIT.statements);
    expect(w.rowsInserted + w.rowsUpdated, `a counted visit writes ${w.rowsInserted + w.rowsUpdated} rows (${w.tables.join(", ")}), ceiling ${VISIT.rows}: ${NEVER_RAISE}`).toBeLessThanOrEqual(VISIT.rows);
  }, 120_000);
  it("(5) spends under 2.9 ms in optional features' triggers on a shop-only store's paid order, on a warm connection", async (ctx) => {
    if (!canTime) ctx.skip(whyNot);
    const shop = await shopOnlyStore("ceiling-optional");
    const lineSkus = (await simpleSkus(shop.storeId)).slice(0, 3);
    const placed = async () => {
      const cartId = await cartOf(shop, lineSkus.map((sku) => [sku, 1]));
      const result = await placeOrder({ storeId: shop.storeId, market: NO }, cartId, {});
      if (!result.ok) throw new Error(result.problem);
      return result.order.orderId;
    };
    const [first, second] = [await placed(), await placed()];
    // These functions run when an order is paid (placing it runs none of them: case 3's list). A fresh connection compiles each function
    // and plans its statements on its first call: a cold start of the connection, not a cost of each order (4.2 to 6.2 ms measured on a fresh
    // connection against 1.4 to 1.9 on a warm one, 19 November 2026). So both orders are paid on one connection, in one transaction, as the
    // checkout pays them (the payment row, then complete_order_payment()): the first not measured, the second measured, read from
    // pg_stat_xact_user_functions, which counts this transaction's calls. The checkout sends each statement as a transaction of its own, so
    // the deferred triggers (the gift card issue) run at its end: constraints are set immediate here to run them at the same point.
    type Times = Record<string, FunctionTime>;
    const { before, after } = await side().begin(async (tx) => {
      await tx`set local track_functions = 'all'`;
      await tx`set constraints all immediate`;
      const pay = async (orderId: string) => {
        const reference = `cs_${orderId}`;
        await tx`
          insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
          select store_id, id, 'stripe', ${reference}, ${shop.stripeAccount}, total_minor, currency, 'captured' from commerce.orders where id = ${orderId}::uuid
        `;
        const [row] = await tx`
          select commerce.complete_order_payment(o.id, ${reference}) as completed from commerce.orders o
          where o.store_id = ${shop.storeId}::uuid and o.id = ${orderId}::uuid
        `;
        expect(row?.completed).toBe(true);
      };
      const times = async (): Promise<Times> => {
        const rows = await tx`select funcname, calls, total_time from pg_stat_xact_user_functions where schemaname = 'commerce'`;
        return Object.fromEntries(rows.map((r) => [String(r.funcname), { calls: Number(r.calls), ms: Number(r.total_time) }]));
      };
      await pay(first);
      const was = await times();
      await pay(second);
      return { before: was, after: await times() };
    });
    const optional = Object.keys(OPTIONAL_TRIGGERS)
      .filter((name) => (after[name]?.calls ?? 0) > (before[name]?.calls ?? 0))
      .map((name) => [name, round((after[name]?.ms ?? 0) - (before[name]?.ms ?? 0))] as const);
    const ms = sumMs(optional.map(([, t]) => ({ ms: t })));
    expect(optional.length, "the optional features' trigger functions ran on the paid order").toBeGreaterThan(0);
    expect(ms, `optional features' triggers took ${round(ms)} ms of a paid order (${JSON.stringify(Object.fromEntries(optional))}), ceiling ${OPTIONAL_MS} ms: ${NEVER_RAISE}`).toBeLessThan(OPTIONAL_MS);
  }, 300_000);
});
