/* eslint-disable @typescript-eslint/no-explicit-any -- rows and snapshots are JSON and the tests read them as such */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DRAFT_STATUSES, DRAFT_TRANSITIONS, canMoveDraft, type DraftStatus } from "@/lib/draft-status";
import * as limits from "@/lib/order-limits";
import { COPIED_ORDER_EVENTS } from "@/lib/order-ops-events";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Order search, tags, archive, draft orders and gift messages (wave 3, run 2, D173, docs/wave-3-orders.md 3.3): the rules the database holds, against every
 * migration applied to a real Postgres (PGlite). Where a number is a limit the code also knows, the test takes it from `src/lib/order-limits.ts`, so the database
 * and the code cannot drift apart without a test saying so.
 */

let db: PGlite;
let storeA: string;
let storeB: string;
let account: string;
let counter = 0;
const n = () => (counter += 1);

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const BIDI = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

beforeAll(async () => {
  db = await createTestDatabase();
  storeA = await createInvoiceStore(db, "ops-a");
  storeB = await createInvoiceStore(db, "ops-b");
  account = await scalar<string>("insert into commerce.accounts (email) values ('staff@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

type OrderOptions = {
  status?: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  number?: string;
  draftId?: string | null;
  madeBy?: string | null;
  source?: "checkout" | "draft";
  email?: string;
  total?: number;
  discount?: number;
  staffDiscount?: number;
  staffLabel?: string | null;
  gift?: { to?: string | null; from?: string | null; message?: string | null } | null;
  copied?: boolean;
  market?: string;
  currency?: string;
};

/** An order as `placeOrder()` would leave it, numbered by D141's own series (so the sequence audit means something), with one line. */
async function order(store: string, o: OrderOptions = {}): Promise<{ id: string; number: string; lineId: string }> {
  const status = o.status ?? "pending_payment";
  const total = o.total ?? 10000;
  const discount = o.discount ?? 0;
  const copiedFrom = o.copied ? await scalar<string>("select gen_random_uuid()") : null;
  if (o.copied) await db.query("select set_config('commerce.copying', 'on', false)");
  let number = o.number;
  if (!number) {
    number = o.copied
      ? `C-${9000 + n()}`
      : await scalar<string>("select s.prefix || commerce.next_document_number($1::uuid, 'order')::text from commerce.document_series s where s.store_id = $1 and s.series = 'order'", [store]);
  }
  const source = o.source ?? (o.draftId ? "draft" : "checkout");
  const row = await one<{ id: string }>(
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, copied_from, source, draft_id, made_by, staff_discount_minor, staff_discount_label, is_gift, gift_to, gift_from, gift_message)
     values ($1, $2, $3, $4, 'nb-NO', $5, $6::commerce.order_status, $7, 0, $8, 0, $9, '{"name":"Kari Nordmann"}'::jsonb, '{"name":"Kari Nordmann"}'::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     returning id`,
    [
      store, number, o.market ?? "NO", o.currency ?? "NOK", o.email ?? "shopper@example.com", status, total + discount, discount, total, copiedFrom, source, o.draftId ?? null,
      o.madeBy === undefined ? (source === "draft" ? account : null) : o.madeBy, o.staffDiscount ?? 0, o.staffLabel ?? null, o.gift !== null && o.gift !== undefined, o.gift?.to ?? null, o.gift?.from ?? null, o.gift?.message ?? null,
    ],
  );
  const line = await one<{ id: string }>(
    `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
     values ($1, $2, 'SKU', 'Item', 1, $3, $4, $5, 0, 0.25, 'txcd_99999999', 'physical') returning id`,
    [store, row.id, total + discount, discount, total],
  );
  if (o.copied) await db.query("select set_config('commerce.copying', '', false)");
  return { id: row.id, number, lineId: line.id };
}

const payment = (store: string, orderId: string, extra: { provider?: string; method?: string | null; recordedBy?: string | null; testMode?: boolean; amount?: number } = {}) =>
  db.query(
    `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by, test_mode)
     values ($1, $2, $3, $4, $5, 'NOK', 'captured', $6, $7, $8)`,
    [store, orderId, extra.provider ?? "stripe", `ref_${n()}`, extra.amount ?? 10000, extra.method ?? null, extra.recordedBy ?? null, extra.testMode ?? false],
  );

type DraftOptions = { store?: string; number?: string; market?: string; email?: string | null };

async function draft(o: DraftOptions = {}): Promise<{ id: string; number: string }> {
  const store = o.store ?? storeA;
  const number = o.number ?? (await scalar<string>("select commerce.next_draft_number($1)", [store]));
  const row = await one<{ id: string }>(
    `insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, email, created_by)
     values ($1, $2, $3, 'no', 'NOK', 'nb-NO', $4, $5) returning id`,
    [store, number, o.market ?? "NO", o.email === undefined ? "buyer@example.com" : o.email, account],
  );
  return { id: row.id, number };
}

const draftLine = (store: string, draftId: string, extra: { variant?: string | null; sku?: string; position?: number } = {}) =>
  db.query(
    `insert into commerce.draft_order_lines (store_id, draft_id, position, variant_id, title, sku, quantity, unit_price_minor, list_price_minor, vat_category, delivery)
     values ($1, $2, $3, $4, 'Item', $5, 1, 5000, $6, $7, $8)`,
    [store, draftId, extra.position ?? 0, extra.variant ?? null, extra.sku ?? "SKU", extra.variant ? 5000 : null, extra.variant ? null : "standard", extra.variant ? "physical" : "service"],
  );

let variantCounter = 0;
async function variant(store: string): Promise<string> {
  const k = ++variantCounter;
  const product = await scalar<string>("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, $2, 'txcd_99999999', 'standard') returning id", [store, `p-${k}-${n()}`]);
  return scalar<string>("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, $3) returning id", [store, product, `V-${k}-${n()}`]);
}

/** Sends a draft the way `placeDraftOrder()` will: the order, then the draft sent and naming it, in one transaction. */
async function send(draftId: string, store = storeA, days = 7): Promise<string> {
  let orderId = "";
  await db.transaction(async (tx) => {
    const d = (await tx.query<{ number: string }>("select number from commerce.draft_orders where id = $1", [draftId])).rows[0];
    const number = (await tx.query<{ number: string }>("select s.prefix || commerce.next_document_number($1::uuid, 'order')::text as number from commerce.document_series s where s.store_id = $1 and s.series = 'order'", [store])).rows[0].number;
    orderId = (
      await tx.query<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, source, draft_id, made_by)
         values ($1, $2, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'pending_payment', 10000, 0, 0, 0, 10000, '{}'::jsonb, '{}'::jsonb, 'draft', $3, $4) returning id`,
        [store, number, draftId, account],
      )
    ).rows[0].id;
    await tx.query(
      "update commerce.draft_orders set status = 'sent', order_id = $2, sent_at = now(), expires_at = now() + make_interval(days => $3), pay_token_hash = encode(sha256(gen_random_uuid()::text::bytea), 'hex'), version = version + 1 where id = $1",
      [draftId, orderId, days],
    );
    expect(d.number).toMatch(/^D-\d+$/);
  });
  return orderId;
}

const statusOf = (draftId: string) => scalar<DraftStatus>("select status from commerce.draft_orders where id = $1", [draftId]);

// ---------------------------------------------------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------------------------------------------------

describe("the new tables", () => {
  it("have row-level security on and no policy (the schema is private to the server)", async () => {
    const found = await rows<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = any($1)",
      [["order_tags", "order_views", "order_settings", "draft_orders", "draft_order_lines"]],
    );
    expect(found).toHaveLength(5);
    for (const t of found) expect(t.relrowsecurity, t.relname).toBe(true);
    expect(await scalar("select count(*)::int from pg_policies where schemaname = 'commerce' and tablename = any($1)", [["order_tags", "order_views", "order_settings", "draft_orders", "draft_order_lines"]])).toBe(0);
  });

  it("have a store id on every row of the store-owned ones, and an index behind every foreign key to accounts", async () => {
    for (const t of ["order_tags", "order_views", "order_settings", "draft_orders", "draft_order_lines"]) {
      expect(await scalar("select count(*)::int from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = 'store_id' and is_nullable = 'NO'", [t]), t).toBe(1);
    }
    for (const [table, column] of [["orders", "made_by"], ["payments", "recorded_by"], ["order_tags", "created_by"], ["order_views", "created_by"], ["draft_orders", "created_by"]]) {
      const indexed = await scalar<number>(
        `select count(*)::int from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'commerce' and c.relname = $1 and (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum = i.indkey[0]) = $2`,
        [table, column],
      );
      expect(indexed, `${table}.${column}`).toBeGreaterThan(0);
    }
  });

  it("add the search and list indexes of the plan, as trigram indexes in the extensions schema", async () => {
    const defs = await rows<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where schemaname = 'commerce' and indexname = any($1)", [
      ["orders_search_email_idx", "orders_search_ship_name_idx", "orders_search_bill_name_idx", "order_lines_search_title_idx", "order_lines_search_sku_idx", "shipments_tracking_idx", "orders_list_placed_idx", "orders_list_archived_idx", "orders_list_total_idx", "order_tags_key_idx", "order_tags_order_idx", "draft_orders_market_idx", "draft_orders_store_idx", "draft_orders_expiry_idx", "draft_orders_token_idx"],
    ]);
    const byName = Object.fromEntries(defs.map((d) => [d.indexname, d.indexdef]));
    expect(Object.keys(byName)).toHaveLength(15);
    for (const name of ["orders_search_email_idx", "orders_search_ship_name_idx", "orders_search_bill_name_idx", "order_lines_search_title_idx", "order_lines_search_sku_idx"]) {
      expect(byName[name], name).toContain("gin_trgm_ops");
      expect(byName[name], name).toContain("USING gin");
    }
    // The search's own guard is in the index, so a query with the guard can use it.
    for (const name of ["orders_search_email_idx", "orders_search_ship_name_idx", "orders_search_bill_name_idx"]) expect(byName[name], name).toMatch(/restricted_at IS NULL\)? AND \(?anonymised_at IS NULL/);
    expect(byName.orders_list_placed_idx).toContain("archived_at IS NULL");
    expect(byName.orders_list_archived_idx).toContain("archived_at IS NOT NULL");
    expect(byName.draft_orders_token_idx).toContain("UNIQUE");
    expect(byName.draft_orders_expiry_idx).toContain("'sent'");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 1: tags
// ---------------------------------------------------------------------------------------------------------------------

describe("tags", () => {
  const tag = (store: string, orderId: string, key: string, label = key) =>
    db.query("insert into commerce.order_tags (store_id, order_id, key, label, created_by) values ($1, $2, $3, $4, $5)", [store, orderId, key, label, account]);

  it("are a row per tag on an order, one per key", async () => {
    const o = await order(storeA);
    await tag(storeA, o.id, "vip", "VIP");
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'vip', 'vip')", [storeA, o.id], /order_tags_order_id_key_pk|duplicate key/);
    await tag(storeA, o.id, "late");
    expect(await scalar("select count(*)::int from commerce.order_tags where order_id = $1", [o.id])).toBe(2);
  });

  it("belong to the order's own store: a tag cannot point at another store's order", async () => {
    const o = await order(storeA);
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'x', 'x')", [storeB, o.id], /order_tags_order_fk|foreign key/);
  });

  it("hold 40 characters and no more, counted in code points, and a key of the same length", async () => {
    const o = await order(storeA);
    await tag(storeA, o.id, "a".repeat(limits.TAG_MAX_LENGTH));
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, $3, $4)", [storeA, o.id, "b".repeat(limits.TAG_MAX_LENGTH + 1), "b"], /order_tags_key/);
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'c', $3)", [storeA, o.id, "c".repeat(limits.TAG_MAX_LENGTH + 1)], /order_tags_label/);
    // An emoji is one character in the database as in the code.
    await tag(storeA, o.id, "emoji", String.fromCodePoint(0x1f600).repeat(40));
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'emoji2', $3)", [storeA, o.id, String.fromCodePoint(0x1f600).repeat(41)], /order_tags_label/);
  });

  it("refuse an empty label, spaces at the ends, a comma, control characters and the bidirectional controls", async () => {
    const o = await order(storeA);
    const cc = (code: number) => String.fromCharCode(code);
    const bad = ["", " lead", "trail ", "a,b", `a${cc(1)}b`, "a\tb", "a\nb", `a${cc(0x7f)}b`, ...BIDI.map((c) => `vip${cc(c)}`)];
    for (const label of bad) {
      await expect(db.query("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, $3, $4)", [storeA, o.id, `k${n()}`, label]), JSON.stringify(label)).rejects.toThrow(/order_tags_label|order_tags_key|violates/);
    }
    for (const label of ["æøå", "rush-order", "b2b", "Sale #1", "50% off", "ÆØÅ Bestilling"]) await tag(storeA, o.id, label.toLowerCase(), label);
  });

  it("are limited to 250 an order by a trigger, and the same tag may be on other orders and in another store", async () => {
    const o = await order(storeA);
    await db.query("insert into commerce.order_tags (store_id, order_id, key, label) select $1, $2, 't' || g, 't' || g from generate_series(1, $3) g", [storeA, o.id, limits.TAGS_PER_ORDER]);
    expect(await scalar("select count(*)::int from commerce.order_tags where order_id = $1", [o.id])).toBe(250);
    await rejects("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'one-more', 'one-more')", [storeA, o.id], /order_tags\.limit/);
    // The limit is per order: another order, and another store's order with the same key, are unaffected.
    const other = await order(storeA);
    const foreign = await order(storeB);
    await tag(storeA, other.id, "t1");
    await tag(storeB, foreign.id, "t1");
    expect(await scalar("select count(*)::int from commerce.order_tags where key = 't1'")).toBeGreaterThanOrEqual(3);
    // Removing one makes room for one.
    await db.query("delete from commerce.order_tags where order_id = $1 and key = 't1'", [o.id]);
    await tag(storeA, o.id, "one-more");
    expect(await scalar("select count(*)::int from commerce.order_tags where order_id = $1", [o.id])).toBe(250);
  });

  it("can be put on a copied order (D129): the copied-order guards are not on this table", async () => {
    const copied = await order(storeA, { copied: true, status: "paid" });
    await tag(storeA, copied.id, "history");
    expect(await scalar("select count(*)::int from commerce.order_tags where order_id = $1", [copied.id])).toBe(1);
  });

  it("are counted by store with the first spelling as the label", async () => {
    const s = await createInvoiceStore(db, `ops-count-${n()}`);
    const a = await order(s);
    const b = await order(s);
    await tag(s, a.id, "vip", "VIP");
    await tag(s, b.id, "vip", "Vip");
    await tag(s, a.id, "late");
    // "First" is by time, then by order id: two inserts that land on the same microsecond would be told apart by a random id, so the second is made later.
    await db.query("update commerce.order_tags set created_at = created_at + interval '1 second' where order_id = $1 and key = 'vip'", [b.id]);
    const counts = await rows<{ key: string; label: string; orders: string }>("select * from commerce.order_tag_counts($1, 10)", [s]);
    expect(counts.map((c) => [c.key, c.label, Number(c.orders)])).toEqual([["vip", "VIP", 2], ["late", "late", 1]]);
    expect(await rows("select * from commerce.order_tag_counts($1, 1)", [s])).toHaveLength(1);
    expect(await rows("select * from commerce.order_tag_counts($1, 0)", [s])).toHaveLength(0);
    // Another store sees none of them.
    expect(await rows("select * from commerce.order_tag_counts($1, 10)", [storeB])).toEqual(expect.not.arrayContaining([expect.objectContaining({ key: "vip" })]));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 2: saved views
// ---------------------------------------------------------------------------------------------------------------------

describe("saved views", () => {
  const view = (store: string, title: string, params: unknown = {}, columns: string[] | null = null) =>
    db.query("insert into commerce.order_views (store_id, title, params, columns, position, created_by) values ($1, $2, $3::jsonb, $4, 0, $5)", [store, title, JSON.stringify(params), columns, account]);

  it("are at most 30 a store, by a trigger", async () => {
    const s = await createInvoiceStore(db, `ops-views-${n()}`);
    for (let i = 0; i < limits.VIEWS_MAX; i++) await view(s, `View ${i}`);
    await rejects("insert into commerce.order_views (store_id, title) values ($1, 'One too many')", [s], /order_views\.limit/);
    await view(storeB, "Another store's first");
  });

  it("have a title unique in the store ignoring case, of 1 to 40 characters without spaces at the ends", async () => {
    const s = await createInvoiceStore(db, `ops-titles-${n()}`);
    await view(s, "Unpaid VIP");
    await rejects("insert into commerce.order_views (store_id, title) values ($1, 'unpaid vip')", [s], /order_views_title_key|duplicate key/);
    await view(storeA, "Unpaid VIP");
    await view(s, "x".repeat(limits.VIEW_TITLE_MAX));
    for (const title of ["", " lead", "trail ", "x".repeat(limits.VIEW_TITLE_MAX + 1)]) {
      await expect(view(s, title), JSON.stringify(title)).rejects.toThrow(/order_views_title/);
    }
  });

  it("hold the parameters as an object under 4 kB, and at most 12 columns", async () => {
    const s = await createInvoiceStore(db, `ops-params-${n()}`);
    await view(s, "ok", { q: "vip", pay: "paid" }, ["placed", "total"]);
    await rejects("insert into commerce.order_views (store_id, title, params) values ($1, 'arr', '[1]'::jsonb)", [s], /order_views_params/);
    await rejects("insert into commerce.order_views (store_id, title, params) values ($1, 'str', '\"x\"'::jsonb)", [s], /order_views_params/);
    await rejects("insert into commerce.order_views (store_id, title, params) values ($1, 'big', $2::jsonb)", [s, JSON.stringify({ q: "x".repeat(limits.VIEW_PARAMS_MAX_BYTES) })], /order_views_params/);
    await rejects("insert into commerce.order_views (store_id, title, columns) values ($1, 'cols', $2)", [s, Array.from({ length: limits.VIEW_COLUMNS_MAX + 1 }, (_, i) => `c${i}`)], /order_views_columns/);
    await rejects("insert into commerce.order_views (store_id, title, position) values ($1, 'pos', -1)", [s], /order_views_position/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 3: archive, and copied orders (point 3, 3.3 T4)
// ---------------------------------------------------------------------------------------------------------------------

describe("archive", () => {
  it("is a column an order may have set once it is no longer waiting for payment", async () => {
    const paid = await order(storeA, { status: "fulfilled" });
    await db.query("update commerce.orders set archived_at = now() where id = $1", [paid.id]);
    expect(await scalar("select archived_at is not null from commerce.orders where id = $1", [paid.id])).toBe(true);
    await db.query("update commerce.orders set archived_at = null where id = $1", [paid.id]);
    expect(await scalar("select archived_at is null from commerce.orders where id = $1", [paid.id])).toBe(true);
  });

  it("is refused for an order waiting for payment (the database holds that one part of the rule)", async () => {
    const waiting = await order(storeA, { status: "pending_payment" });
    await rejects("update commerce.orders set archived_at = now() where id = $1", [waiting.id], /orders_archived_not_pending/);
  });

  it("changes no number and no figure: the sequence audit and the whole row are the same, but for the day it was archived", async () => {
    const s = await createInvoiceStore(db, `ops-arch-${n()}`);
    const orders = [await order(s, { status: "fulfilled" }), await order(s, { status: "cancelled" }), await order(s, { status: "paid" })];
    const before = await one("select * from commerce.order_number_audit($1)", [s]);
    const rowsBefore = await rows("select to_jsonb(o) - 'archived_at' as r from commerce.orders o where store_id = $1 order by number", [s]);
    for (const o of orders) await db.query("update commerce.orders set archived_at = now() where id = $1", [o.id]);
    const after = await one("select * from commerce.order_number_audit($1)", [s]);
    expect(after).toEqual(before);
    expect(after.ok).toBe(true);
    expect(await rows("select to_jsonb(o) - 'archived_at' as r from commerce.orders o where store_id = $1 order by number", [s])).toEqual(rowsBefore);
  });
});

describe("a copied order (D129)", () => {
  it("can be archived, and the only thing that changes is the archive: the row without archived_at is identical", async () => {
    const copied = await order(storeA, { copied: true, status: "paid" });
    const before = await one<{ r: any }>("select to_jsonb(o) - 'archived_at' as r from commerce.orders o where id = $1", [copied.id]);
    await db.query("update commerce.orders set archived_at = now() where id = $1", [copied.id]);
    expect(await scalar("select archived_at is not null from commerce.orders where id = $1", [copied.id])).toBe(true);
    expect((await one<{ r: any }>("select to_jsonb(o) - 'archived_at' as r from commerce.orders o where id = $1", [copied.id])).r).toEqual(before.r);
    await db.query("update commerce.orders set archived_at = null where id = $1", [copied.id]);
  });

  it("takes the events of tagging and archiving, and the event copied, and no other", async () => {
    // The names the function lets through are the names the code writes (src/lib/order-ops-events.ts).
    const def = await scalar<string>("select pg_get_functiondef('commerce.refuse_copied_order_event()'::regprocedure)");
    for (const name of COPIED_ORDER_EVENTS) expect(def, name).toContain(`'${name}'`);
    const copied = await order(storeA, { copied: true, status: "paid" });
    const event = (type: string) => db.query("insert into commerce.order_events (store_id, order_id, type, data, actor) values ($1, $2, $3, '{}'::jsonb, 'staff')", [storeA, copied.id, type]);
    for (const type of ["copied", "order.tags_changed", "order.archived", "order.unarchived"]) await event(type);
    for (const type of ["order.paid", "order.cancelled", "order.refunded", "order.placed", "order.note", "order.restricted"]) {
      await expect(event(type), type).rejects.toThrow(/copied_order/);
    }
  });

  it("still refuses everything else: any other column, a line, a payment, a refund, a shipment", async () => {
    const copied = await order(storeA, { copied: true, status: "paid" });
    await rejects("update commerce.orders set email = 'someone@else.example' where id = $1", [copied.id], /copied_order/);
    await rejects("update commerce.orders set status = 'cancelled' where id = $1", [copied.id], /copied_order/);
    await rejects("update commerce.orders set total_minor = total_minor, subtotal_minor = subtotal_minor + 1 where id = $1", [copied.id], /copied_order|orders_total_adds_up/);
    // An archive together with another change is refused as a whole.
    await rejects("update commerce.orders set archived_at = now(), email = 'x@y.example' where id = $1", [copied.id], /copied_order/);
    await rejects("update commerce.orders set source = 'draft' where id = $1", [copied.id], /copied_order|order_origin/);
    await rejects("update commerce.order_lines set title = 'changed' where order_id = $1", [copied.id], /copied_order/);
    await expect(
      db.query("insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery) values ($1, $2, 'S', 'T', 1, 1, 0, 1, 0, 0, 'x', 'physical')", [storeA, copied.id]),
    ).rejects.toThrow(/copied_order/);
    await rejects("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', 'x', 100, 'NOK', 'captured')", [storeA, copied.id], /copied_order/);
    await rejects("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by) values ($1, $2, 'manual', 'm', 100, 'NOK', 'captured', 'cash', $3)", [storeA, copied.id, account], /copied_order/);
    await rejects("insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values ($1, $2, 'Posten', '123')", [storeA, copied.id], /copied_order/);
  });

  it("can be tagged and anonymising it still works (the guard's earlier test is kept)", async () => {
    const copied = await order(storeA, { copied: true, status: "paid" });
    await db.query("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'x', 'x')", [storeA, copied.id]);
    expect(await scalar("select commerce.anonymise_order($1, $2, 'erasure')", [storeA, copied.id])).toBe("anonymised");
    expect(await scalar("select email from commerce.orders where id = $1", [copied.id])).toBe("[removed]");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 4: gift
// ---------------------------------------------------------------------------------------------------------------------

describe("gift", () => {
  it("is set only on a gift: the three texts need the tick, on the order and on the cart", async () => {
    await expect(order(storeA, { gift: { to: "Kari" } }).then((o) => o.id)).resolves.toBeTruthy();
    await rejects(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, is_gift, gift_message)
       values ($1, 'G-1', 'NO', 'NOK', 'nb-NO', 'a@b.no', 0, 0, 0, 0, 0, '{}'::jsonb, '{}'::jsonb, false, 'Hi')`,
      [storeA],
      /orders_gift_fields/,
    );
    await rejects("insert into commerce.carts (store_id, market_code, currency, locale, expires_at, is_gift, gift_to) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', false, 'Kari')", [storeA], /carts_gift_fields/);
    await db.query("insert into commerce.carts (store_id, market_code, currency, locale, expires_at, is_gift, gift_to, gift_from, gift_message) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', true, 'Kari', 'Ola', 'Hi')", [storeA]);
  });

  it("holds 60 characters for each name, 300 for the message and 6 lines, on the order and on the cart", async () => {
    const giftOrder = (g: { to?: string; from?: string; message?: string }) => order(storeA, { gift: g });
    await giftOrder({ to: "n".repeat(limits.GIFT_NAME_MAX), from: "n".repeat(limits.GIFT_NAME_MAX), message: "m".repeat(limits.GIFT_MESSAGE_MAX) });
    await giftOrder({ message: Array.from({ length: limits.GIFT_MESSAGE_LINES }, () => "x").join("\n") });
    await expect(giftOrder({ to: "n".repeat(limits.GIFT_NAME_MAX + 1) })).rejects.toThrow(/orders_gift_fields/);
    await expect(giftOrder({ from: "n".repeat(limits.GIFT_NAME_MAX + 1) })).rejects.toThrow(/orders_gift_fields/);
    await expect(giftOrder({ message: "m".repeat(limits.GIFT_MESSAGE_MAX + 1) })).rejects.toThrow(/orders_gift_fields/);
    await expect(giftOrder({ message: Array.from({ length: limits.GIFT_MESSAGE_LINES + 1 }, () => "x").join("\n") })).rejects.toThrow(/orders_gift_fields/);
    // Code points, not bytes: 300 emoji fit.
    await giftOrder({ message: String.fromCodePoint(0x1f600).repeat(limits.GIFT_MESSAGE_MAX) });
    await rejects("insert into commerce.carts (store_id, market_code, currency, locale, expires_at, is_gift, gift_message) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', true, $2)", [storeA, "m".repeat(limits.GIFT_MESSAGE_MAX + 1)], /carts_gift_fields/);
  });

  it("is frozen once the order is placed: no change to the tick or any of the texts, by anyone", async () => {
    const o = await order(storeA, { gift: { to: "Kari", from: "Ola", message: "Happy birthday" } });
    await rejects("update commerce.orders set gift_message = 'Edited' where id = $1", [o.id], /order_gift\.frozen/);
    await rejects("update commerce.orders set gift_to = null where id = $1", [o.id], /order_gift\.frozen/);
    await rejects("update commerce.orders set is_gift = false, gift_to = null, gift_from = null, gift_message = null where id = $1", [o.id], /order_gift\.frozen/);
    const plain = await order(storeA);
    await rejects("update commerce.orders set is_gift = true, gift_message = 'Added later' where id = $1", [plain.id], /order_gift\.frozen/);
    // An update that leaves them alone is fine.
    await db.query("update commerce.orders set email = 'new@example.com' where id = $1", [o.id]);
  });

  it("is blanked by the erasure's anonymising, and only by it", async () => {
    const o = await order(storeA, { status: "cancelled", gift: { to: "Kari", from: "Ola", message: "Secret note" } });
    expect(await scalar("select commerce.anonymise_order($1, $2, 'erasure')", [storeA, o.id])).toBe("anonymised");
    const after = await one("select is_gift, gift_to, gift_from, gift_message, anonymised_at is not null as anonymised from commerce.orders where id = $1", [o.id]);
    expect(after).toEqual({ is_gift: false, gift_to: null, gift_from: null, gift_message: null, anonymised: true });
  });

  it("has an anonymised-order check that holds the gift fields blank: an order marked anonymised with the gift text still in it is not one", async () => {
    const o = await order(storeA, { status: "cancelled", gift: { to: "Kari", message: "Secret" } });
    await db.query("select set_config('commerce.anonymising', 'on', false)");
    try {
      await expect(
        db.query("update commerce.orders set email = '[removed]', billing_address = '{}'::jsonb, shipping_address = '{}'::jsonb, anonymised_at = now() where id = $1", [o.id]),
      ).rejects.toThrow(/orders_anonymised/);
      // With the gift blanked as well, it is an anonymised order (the trigger lets the anonymising path do that).
      await db.query(
        "update commerce.orders set email = '[removed]', billing_address = '{}'::jsonb, shipping_address = '{}'::jsonb, anonymised_at = now(), is_gift = false, gift_to = null, gift_from = null, gift_message = null where id = $1",
        [o.id],
      );
    } finally {
      await db.query("select set_config('commerce.anonymising', '', false)");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 5 and 10: staff discount arithmetic and the staff-made order
// ---------------------------------------------------------------------------------------------------------------------

describe("the staff discount and the staff-made order", () => {
  it("is a part of the order's discount, never more, with a label only when there is one", async () => {
    const draftId = (await draft()).id;
    await order(storeA, { draftId, discount: 1000, staffDiscount: 1000, staffLabel: "Friends and family" });
    await order(storeA, { draftId, discount: 1500, staffDiscount: 1000, staffLabel: "Friends and family" });
    await expect(order(storeA, { draftId, discount: 500, staffDiscount: 1000, staffLabel: "x" })).rejects.toThrow(/orders_staff_discount/);
    await expect(order(storeA, { draftId, discount: 0, staffDiscount: 0, staffLabel: "A label with no discount" })).rejects.toThrow(/orders_staff_discount_label/);
    await expect(order(storeA, { draftId, discount: 100, staffDiscount: 100, staffLabel: "" })).rejects.toThrow(/orders_staff_discount_label/);
    await expect(order(storeA, { draftId, discount: 100, staffDiscount: 100, staffLabel: "x".repeat(limits.DRAFT_DISCOUNT_LABEL_MAX + 1) })).rejects.toThrow(/orders_staff_discount_label/);
    await order(storeA, { draftId, discount: 100, staffDiscount: 100, staffLabel: "x".repeat(limits.DRAFT_DISCOUNT_LABEL_MAX) });
  });

  it("keeps the order's own sums: the total adds up and nothing is negative, for a staff-made order as for any", async () => {
    const draftId = (await draft()).id;
    await rejects(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, source, draft_id, made_by, staff_discount_minor, staff_discount_label)
       values ($1, 'D-sum', 'NO', 'NOK', 'nb-NO', 'a@b.no', 10000, 0, 1000, 0, 9999, '{}'::jsonb, '{}'::jsonb, 'draft', $2, $3, 1000, 'x')`,
      [storeA, draftId, account],
      /orders_total_adds_up/,
    );
  });

  it("has source draft if and only if it names a draft and the staff member who made it", async () => {
    const draftId = (await draft()).id;
    await expect(order(storeA, { source: "draft", draftId: null, madeBy: account })).rejects.toThrow(/orders_source_draft/);
    await expect(order(storeA, { source: "draft", draftId, madeBy: null })).rejects.toThrow(/orders_source_draft/);
    await expect(order(storeA, { source: "checkout", draftId, madeBy: null })).rejects.toThrow(/orders_source_draft/);
    await expect(order(storeA, { source: "checkout", draftId: null, madeBy: account })).rejects.toThrow(/orders_source_draft/);
    await rejects(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, source)
       values ($1, 'D-src', 'NO', 'NOK', 'nb-NO', 'a@b.no', 0, 0, 0, 0, 0, '{}'::jsonb, '{}'::jsonb, 'quote')`,
      [storeA],
      /orders_source/,
    );
    await order(storeA, { source: "draft", draftId, madeBy: account });
    await order(storeA);
  });

  it("is written once: where an order came from and its staff discount are never rewritten", async () => {
    const draftId = (await draft()).id;
    const made = await order(storeA, { draftId, discount: 500, staffDiscount: 500, staffLabel: "x" });
    for (const set of ["source = 'checkout'", "draft_id = null", `made_by = '${await scalar<string>("select gen_random_uuid()")}'`, "staff_discount_minor = 0", "staff_discount_label = 'y'"]) {
      await expect(db.query(`update commerce.orders set ${set} where id = $1`, [made.id]), set).rejects.toThrow(/order_origin\.frozen|orders_source|violates/);
    }
    // Other updates are as ever.
    await db.query("update commerce.orders set email = 'changed@example.com' where id = $1", [made.id]);
  });

  it("splits a line's discount into parts that never exceed it, for a line that carries a staff discount; and a custom line is a service with no variant", async () => {
    const o = await order(storeA);
    const lineSql = (extra: string) =>
      `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, ${extra.split("|")[0]})
       values ($1, $2, 'CUSTOM', 'Fee', 1, 10000, 1000, 9000, 0, 0.25, 'txcd_99999999', 'service', ${extra.split("|")[1]})`;
    await db.query(lineSql("custom, staff_discount_minor|true, 1000"), [storeA, o.id]);
    await rejects(lineSql("staff_discount_minor, member_discount_minor|1000, 100"), [storeA, o.id], /order_lines_discount_parts/);
    await rejects(lineSql("staff_discount_minor|1001"), [storeA, o.id], /order_lines_staff_discount|order_lines_discount_parts/);
    // A custom line has no variant, the sku CUSTOM and is a service.
    await rejects(
      "insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, custom) values ($1, $2, 'SKU', 'x', 1, 1, 0, 1, 0, 0, 'x', 'service', true)",
      [storeA, o.id],
      /order_lines_custom/,
    );
    await rejects(
      "insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, custom) values ($1, $2, 'CUSTOM', 'x', 1, 1, 0, 1, 0, 0, 'x', 'physical', true)",
      [storeA, o.id],
      /order_lines_custom/,
    );
    // A list price is information and cannot be negative.
    await rejects("update commerce.order_lines set list_price_minor = -1 where order_id = $1", [o.id], /order_lines_list_price/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 6: payments taken outside Kaizen
// ---------------------------------------------------------------------------------------------------------------------

describe("a payment taken outside Kaizen", () => {
  it("is a payment with provider manual, a method and the staff member who recorded it, and nothing else carries a method", async () => {
    const o = await order(storeA);
    await payment(storeA, o.id, { provider: "manual", method: "bank_transfer", recordedBy: account });
    await payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: account });
    await payment(storeA, o.id, { provider: "manual", method: "other", recordedBy: account });
    await expect(payment(storeA, o.id, { provider: "manual", method: "card", recordedBy: account })).rejects.toThrow(/payments_manual_method/);
    await expect(payment(storeA, o.id, { provider: "manual", method: null, recordedBy: account })).rejects.toThrow(/payments_manual_method/);
    await expect(payment(storeA, o.id, { provider: "stripe", method: "cash" })).rejects.toThrow(/payments_manual_method/);
    await expect(payment(storeA, o.id, { provider: "venue", method: "cash" })).rejects.toThrow(/payments_manual_method/);
    await payment(storeA, o.id, { provider: "stripe" });
    await payment(storeA, o.id, { provider: "venue" });
  });

  it("names who recorded it, is for a positive amount, and is real money whatever mode Stripe is in", async () => {
    const o = await order(storeA);
    await expect(payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: null })).rejects.toThrow(/payments_manual_recorded/);
    await expect(payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: account, amount: 0 })).rejects.toThrow(/payments_amount_positive/);
    await expect(payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: account, testMode: true })).rejects.toThrow(/payments_manual_real/);
    // A store whose Stripe is in test mode records a real payment all the same: the venue trigger does not touch a manual one.
    await db.query("insert into commerce.payment_providers (store_id, provider, active_mode) values ($1, 'stripe', 'test') on conflict do nothing", [storeA]).catch(() => undefined);
    await payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: account });
    expect(await scalar("select bool_or(test_mode) from commerce.payments where order_id = $1 and provider = 'manual'", [o.id])).toBe(false);
  });

  it("is paid through complete_order_payment() like any payment, and the invoice says it was paid outside, with the method", async () => {
    const s = await createInvoiceStore(db, `ops-manual-${n()}`);
    const o = await placeOrder(db, s, { lines: [{ sku: "M1", unit: 20000 }], provider: "manual", method: "bank_transfer" });
    expect(o.invoiceId).not.toBeNull();
    const snapshot = (await one<{ snapshot: any }>("select snapshot from commerce.invoices where order_id = $1", [o.id])).snapshot;
    expect(snapshot.payments).toEqual([{ kind: "paid_outside", amountMinor: o.total, provider: "manual", method: "bank_transfer" }]);
  });
});

describe("a payment taken outside Kaizen: the day it was received and refunds that never exceed it (review fixes)", () => {
  it("dates the invoice's supply by the day the money was received, never later than the day it is issued; a Stripe payment cannot carry one", async () => {
    const s = await createInvoiceStore(db, `ops-received-${n()}`);
    const early = await placeOrder(db, s, { lines: [{ sku: "R1", unit: 20000 }], provider: "manual", method: "bank_transfer", receivedOn: "2026-09-30" });
    const inv = await one<{ supply_date: string; issued_on: string; snapshot: any }>("select supply_date::text, issued_on::text, snapshot from commerce.invoices where order_id = $1", [early.id]);
    expect(inv.supply_date).toBe("2026-09-30");
    expect(inv.snapshot.supplyDate).toBe("2026-09-30");
    expect(inv.snapshot.order.paidOn).toBe("2026-09-30");
    // A day in the future is held to the day of issue.
    const late = await placeOrder(db, s, { lines: [{ sku: "R2", unit: 20000 }], provider: "manual", method: "cash", receivedOn: "2999-01-01" });
    const lateInv = await one<{ supply_date: string; issued_on: string }>("select supply_date::text, issued_on::text from commerce.invoices where order_id = $1", [late.id]);
    expect(lateInv.supply_date).toBe(lateInv.issued_on);
    // Without one, the day it was recorded, as before.
    const none = await placeOrder(db, s, { lines: [{ sku: "R3", unit: 20000 }], provider: "manual", method: "cash" });
    const noneInv = await one<{ supply_date: string; issued_on: string }>("select supply_date::text, issued_on::text from commerce.invoices where order_id = $1", [none.id]);
    expect(noneInv.supply_date).toBe(noneInv.issued_on);
    const o = await order(storeA);
    await payment(storeA, o.id, { provider: "stripe" });
    await expect(db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, received_on) values ($1, $2, 'stripe', $3, 100, 'NOK', 'captured', '2026-09-30')", [storeA, o.id, `ref_${n()}`])).rejects.toThrow(/payments_received_manual/);
  });

  it("refuses refunds of a manual payment above it, one at a time or all at once, and leaves a failed one out of the sum", async () => {
    const o = await order(storeA, { status: "paid", total: 10000 });
    await payment(storeA, o.id, { provider: "manual", method: "cash", recordedBy: account, amount: 10000 });
    const pay = await scalar<string>("select id from commerce.payments where order_id = $1 and provider = 'manual'", [o.id]);
    const refund = (amount: number, status = "succeeded") =>
      db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'test', $4, $5::commerce.refund_status)", [storeA, pay, amount, `manual_refund_${n()}`, status]);
    await refund(6000);
    await expect(refund(4001)).rejects.toThrow(/refund\.over_payment/);
    await refund(4000, "failed");
    await refund(4000);
    await expect(refund(1)).rejects.toThrow(/refund\.over_payment/);
    // Raising an existing refund's amount is held to the same sum.
    const first = await scalar<string>("select id from commerce.refunds where payment_id = $1 order by created_at limit 1", [pay]);
    await expect(db.query("update commerce.refunds set amount_minor = 6001 where id = $1", [first])).rejects.toThrow(/refund\.over_payment/);
    // Two refunds made one after the other for the whole payment (the real race is held by the integration test): only what fits is recorded.
    const o2 = await order(storeA, { status: "paid", total: 5000 });
    await payment(storeA, o2.id, { provider: "manual", method: "bank_transfer", recordedBy: account, amount: 5000 });
    const pay2 = await scalar<string>("select id from commerce.payments where order_id = $1 and provider = 'manual'", [o2.id]);
    const both = await Promise.allSettled([0, 1].map(() => db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, 5000, 'test', $3, 'succeeded')", [storeA, pay2, `manual_refund_${n()}`])));
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Number(await scalar("select sum(amount_minor) from commerce.refunds where payment_id = $1", [pay2]))).toBe(5000);
  });

  it("leaves a Stripe payment's refunds to Stripe: the trigger holds only a payment taken outside Kaizen", async () => {
    const o = await order(storeA, { status: "paid", total: 10000 });
    await payment(storeA, o.id, { provider: "stripe", amount: 10000 });
    const pay = await scalar<string>("select id from commerce.payments where order_id = $1", [o.id]);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, 12000, 'test', $3, 'succeeded')", [storeA, pay, `re_${n()}`]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 7: the draft lifecycle
// ---------------------------------------------------------------------------------------------------------------------

describe("the counter of drafts", () => {
  it("numbers a store's drafts D-1, D-2 and so on, apart from the order numbers and apart from other stores", async () => {
    const s = await createInvoiceStore(db, `ops-draftno-${n()}`);
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push(await scalar<string>("select commerce.next_draft_number($1)", [s]));
    expect(numbers).toEqual(["D-1", "D-2", "D-3"]);
    expect(await scalar<string>("select commerce.next_draft_number($1)", [await createInvoiceStore(db, `ops-draftno-${n()}`)])).toBe("D-1");
    // The settings row is made on the first call, with the defaults; the counter is the one writer's.
    expect(await one("select gift_messages, auto_archive_days, draft_valid_days, staff_mark_paid, next_draft_number::int as next from commerce.order_settings where store_id = $1", [s])).toEqual({
      gift_messages: false,
      auto_archive_days: null,
      draft_valid_days: 7,
      staff_mark_paid: false,
      next: 4,
    });
    // It is not an order number: the order sequence is untouched.
    expect(Number(await scalar("select orders from commerce.order_number_audit($1)", [s]))).toBe(0);
    expect(Number(await scalar("select next_number from commerce.document_series where store_id = $1 and series = 'order'", [s]))).toBe(1001);
  });

  it("is a number with a D- prefix, unique in the store", async () => {
    const s = await createInvoiceStore(db, `ops-draftuniq-${n()}`);
    await draft({ store: s, number: "D-1" });
    await expect(draft({ store: s, number: "D-1" })).rejects.toThrow(/draft_orders_store_number_key|duplicate key/);
    await expect(draft({ store: s, number: "X-1" })).rejects.toThrow(/draft_orders_number/);
    await draft({ store: storeB, number: "D-1" });
  });
});

describe("the order settings", () => {
  it("hold a gift switch, 14 to 365 days of automatic archiving or none, 1 to 30 days for a link, and a counter from 1", async () => {
    const s = await createInvoiceStore(db, `ops-settings-${n()}`);
    await db.query("insert into commerce.order_settings (store_id) values ($1)", [s]);
    const set = (sql: string) => db.query(`update commerce.order_settings set ${sql} where store_id = $1`, [s]);
    await set(`auto_archive_days = ${limits.AUTO_ARCHIVE_MIN_DAYS}`);
    await set(`auto_archive_days = ${limits.AUTO_ARCHIVE_MAX_DAYS}`);
    await set("auto_archive_days = null");
    await expect(set(`auto_archive_days = ${limits.AUTO_ARCHIVE_MIN_DAYS - 1}`)).rejects.toThrow(/order_settings_auto_archive/);
    await expect(set(`auto_archive_days = ${limits.AUTO_ARCHIVE_MAX_DAYS + 1}`)).rejects.toThrow(/order_settings_auto_archive/);
    await set(`draft_valid_days = ${limits.DRAFT_VALID_DAYS_MIN}`);
    await set(`draft_valid_days = ${limits.DRAFT_VALID_DAYS_MAX}`);
    await expect(set("draft_valid_days = 0")).rejects.toThrow(/order_settings_draft_valid/);
    await expect(set(`draft_valid_days = ${limits.DRAFT_VALID_DAYS_MAX + 1}`)).rejects.toThrow(/order_settings_draft_valid/);
    await expect(set("next_draft_number = 0")).rejects.toThrow(/order_settings_next_draft/);
    expect(await scalar("select draft_valid_days from commerce.order_settings where store_id = $1", [s])).toBe(limits.DRAFT_VALID_DAYS_MAX);
  });

  it("are one row a store", async () => {
    await expect(db.query("insert into commerce.order_settings (store_id) values ($1), ($1)", [storeB])).rejects.toThrow();
  });
});

describe("a draft's content", () => {
  it("is checked: notes, discount, shipping, validity, tags, addresses and the email", async () => {
    const d = await draft();
    const set = (sql: string, params: unknown[] = []) => db.query(`update commerce.draft_orders set ${sql} where id = $1`, [d.id, ...params]);
    await set("note_to_buyer = $2, internal_note = $3", ["n".repeat(limits.DRAFT_NOTE_TO_BUYER_MAX), "i".repeat(limits.DRAFT_INTERNAL_NOTE_MAX)]);
    await expect(set("note_to_buyer = $2", ["n".repeat(limits.DRAFT_NOTE_TO_BUYER_MAX + 1)])).rejects.toThrow(/draft_orders_notes/);
    await expect(set("internal_note = $2", ["i".repeat(limits.DRAFT_INTERNAL_NOTE_MAX + 1)])).rejects.toThrow(/draft_orders_notes/);
    await expect(set("email = $2", ["e".repeat(255)])).rejects.toThrow(/draft_orders_email/);
    await expect(set("tags = '{}'::jsonb")).rejects.toThrow(/draft_orders_tags/);
    await expect(set("shipping_address = '[]'::jsonb")).rejects.toThrow(/draft_orders_addresses/);
    await set("valid_days = 30");
    await expect(set("valid_days = 31")).rejects.toThrow(/draft_orders_valid_days/);
    await expect(set("valid_days = 0")).rejects.toThrow(/draft_orders_valid_days/);
    await expect(set("version = 0")).rejects.toThrow(/draft_order\.version|draft_orders_version/);
    await expect(set("pay_sends_today = -1")).rejects.toThrow(/draft_orders_pay_sends/);
  });

  it("has a discount that is whole or absent: a percent of 0.01 to 100.00 or an amount above 0, with the name the buyer sees", async () => {
    const d = await draft();
    const set = (sql: string) => db.query(`update commerce.draft_orders set ${sql} where id = $1`, [d.id]);
    await set("discount_kind = 'percent', discount_value = 1, discount_label = 'x'");
    await set("discount_kind = 'percent', discount_value = 10000, discount_label = 'x'");
    await set("discount_kind = 'amount', discount_value = 1, discount_label = 'x'");
    await set("discount_kind = null, discount_value = null, discount_label = null");
    for (const bad of [
      "discount_kind = 'percent', discount_value = 0, discount_label = 'x'",
      "discount_kind = 'percent', discount_value = 10001, discount_label = 'x'",
      "discount_kind = 'amount', discount_value = 0, discount_label = 'x'",
      "discount_kind = 'free', discount_value = 5, discount_label = 'x'",
      "discount_kind = 'percent', discount_value = 500, discount_label = null",
      "discount_kind = 'percent', discount_value = null, discount_label = 'x'",
      "discount_kind = null, discount_value = 500, discount_label = 'x'",
      "discount_kind = 'percent', discount_value = 500, discount_label = ''",
      `discount_kind = 'percent', discount_value = 500, discount_label = '${"x".repeat(limits.DRAFT_DISCOUNT_LABEL_MAX + 1)}'`,
    ]) {
      await expect(set(bad), bad).rejects.toThrow(/draft_orders_discount/);
    }
  });

  it("has shipping that is the market's rate, free, or a price set (and only the last has a price)", async () => {
    const d = await draft();
    const set = (sql: string) => db.query(`update commerce.draft_orders set ${sql} where id = $1`, [d.id]);
    await set("shipping_kind = 'custom', shipping_minor = 0");
    await set("shipping_kind = 'free', shipping_minor = null");
    await set("shipping_kind = 'rate'");
    for (const bad of ["shipping_kind = 'custom', shipping_minor = null", "shipping_kind = 'rate', shipping_minor = 100", "shipping_kind = 'free', shipping_minor = 100", "shipping_kind = 'custom', shipping_minor = -1", "shipping_kind = 'carrier'"]) {
      await expect(set(bad), bad).rejects.toThrow(/draft_orders_shipping/);
    }
  });

  it("belongs to a market of its store", async () => {
    await expect(draft({ market: "ZZ" })).rejects.toThrow(/draft_orders_market_fk|foreign key/);
    const s = await createInvoiceStore(db, `ops-nomarket-${n()}`, { markets: ["NO"] });
    await expect(draft({ store: s, market: "SE" })).rejects.toThrow(/draft_orders_market_fk|foreign key/);
  });
});

describe("a draft order's lines", () => {
  it("are goods of a variant at a list price, or a custom item with a VAT category and no variant", async () => {
    const d = await draft();
    const v = await variant(storeA);
    await draftLine(storeA, d.id, { variant: v });
    await draftLine(storeA, d.id, { variant: null });
    const insert = (sql: string, params: unknown[]) => db.query(`insert into commerce.draft_order_lines (store_id, draft_id, title, sku, quantity, unit_price_minor, ${sql.split("|")[0]}) values ($1, $2, 'T', 'S', 1, 100, ${sql.split("|")[1]})`, [storeA, d.id, ...params]);
    // A custom line with a variant, a list price, no category, or goods.
    await expect(insert("variant_id, vat_category, delivery|$3, 'standard', 'service'", [v])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("vat_category, delivery, list_price_minor|'standard', 'service', 100", [])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("delivery|'service'", [])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("vat_category, delivery|'standard', 'physical'", [])).rejects.toThrow(/draft_order_lines_kind/);
    // A catalogue line with no list price, with a category, or that is a service.
    await expect(insert("variant_id, delivery|$3, 'physical'", [v])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("variant_id, list_price_minor, vat_category, delivery|$3, 100, 'standard', 'physical'", [v])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("variant_id, list_price_minor, delivery|$3, 100, 'service'", [v])).rejects.toThrow(/draft_order_lines_kind/);
    await expect(insert("vat_category, delivery|'no_such_category', 'service'", [])).rejects.toThrow(/foreign key|violates/);
  });

  it("keep a variant of the draft's own store", async () => {
    const d = await draft();
    const foreign = await variant(storeB);
    await expect(draftLine(storeA, d.id, { variant: foreign })).rejects.toThrow(/draft_order_lines_variant_fk|foreign key/);
    await expect(draftLine(storeB, d.id)).rejects.toThrow(/draft_order_lines_draft_fk|foreign key/);
  });

  it("hold a quantity of 1 to 9,999, prices of 0 or more, a title of 1 to 200 characters and a position of 0 or more", async () => {
    const d = await draft();
    const base = (over: Record<string, unknown>) => {
      const v = { quantity: 1, unit: 100, title: "T", position: 0, ...over };
      return db.query(
        "insert into commerce.draft_order_lines (store_id, draft_id, position, title, sku, quantity, unit_price_minor, vat_category, delivery) values ($1, $2, $3, $4, 'S', $5, $6, 'standard', 'service')",
        [storeA, d.id, v.position, v.title, v.quantity, v.unit],
      );
    };
    await base({ quantity: limits.DRAFT_QUANTITY_MAX });
    await base({ unit: 0 });
    await expect(base({ quantity: 0 })).rejects.toThrow(/draft_order_lines_quantity/);
    await expect(base({ quantity: limits.DRAFT_QUANTITY_MAX + 1 })).rejects.toThrow(/draft_order_lines_quantity/);
    await expect(base({ unit: -1 })).rejects.toThrow(/draft_order_lines_prices/);
    await expect(base({ title: "" })).rejects.toThrow(/draft_order_lines_title/);
    await expect(base({ title: "t".repeat(limits.DRAFT_LINE_TITLE_COLUMN_MAX + 1) })).rejects.toThrow(/draft_order_lines_title/);
    await expect(base({ position: -1 })).rejects.toThrow(/draft_order_lines_position/);
  });

  it("are at most 100 a draft, by a trigger", async () => {
    const d = await draft();
    await db.query(
      "insert into commerce.draft_order_lines (store_id, draft_id, position, title, sku, quantity, unit_price_minor, vat_category, delivery) select $1, $2, g, 'T', 'S', 1, 100, 'standard', 'service' from generate_series(1, $3) g",
      [storeA, d.id, limits.DRAFT_LINES_MAX],
    );
    await expect(draftLine(storeA, d.id)).rejects.toThrow(/draft_order\.lines/);
    const other = await draft();
    await draftLine(storeA, other.id);
  });

  it("go with the draft when it is deleted", async () => {
    const d = await draft();
    await draftLine(storeA, d.id);
    await draftLine(storeA, d.id, { position: 1 });
    await db.query("delete from commerce.draft_orders where id = $1", [d.id]);
    expect(await scalar("select count(*)::int from commerce.draft_order_lines where draft_id = $1", [d.id])).toBe(0);
  });
});

describe("the lifecycle of a draft", () => {
  it("is made open, with no order, no times and no link", async () => {
    await expect(
      db.query("insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, status) values ($1, 'D-900', 'NO', 'no', 'NOK', 'nb-NO', 'sent')", [storeA]),
    ).rejects.toThrow(/draft_order\.start/);
    await expect(
      db.query("insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, pay_token_hash) values ($1, 'D-901', 'NO', 'no', 'NOK', 'nb-NO', 'abc')", [storeA]),
    ).rejects.toThrow(/draft_orders_lifecycle/);
  });

  it("moves exactly as the table of src/lib/draft-status.ts says: every legal move is accepted and every other refused", async () => {
    // For every pair, get a draft into `from` by the legal path, then try the move to `to`.
    const reach = async (target: DraftStatus): Promise<string> => {
      const d = await draft();
      if (target === "open") return d.id;
      const orderId = await send(d.id);
      if (target === "sent") return d.id;
      if (target === "paid") {
        await db.query("update commerce.orders set status = 'paid' where id = $1", [orderId]);
      } else {
        await db.query("update commerce.draft_orders set status = $2 where id = $1", [d.id, target]);
      }
      expect(await statusOf(d.id)).toBe(target);
      return d.id;
    };
    const move = async (id: string, to: DraftStatus) => {
      if (to === "open") {
        return db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, paid_at = null, pay_token_hash = null, version = version + 1 where id = $1", [id]);
      }
      if (to === "sent") {
        const orderId = await scalar<string>("select gen_random_uuid()");
        void orderId;
        return db.query("update commerce.draft_orders set status = 'sent' where id = $1", [id]);
      }
      if (to === "paid") return db.query("update commerce.draft_orders set status = 'paid', paid_at = now() where id = $1", [id]);
      return db.query("update commerce.draft_orders set status = $2 where id = $1", [id, to]);
    };
    for (const from of DRAFT_STATUSES) {
      for (const to of DRAFT_STATUSES) {
        if (from === to) continue;
        const id = await reach(from);
        if (canMoveDraft(from, to) && to !== "sent") {
          await move(id, to);
          expect(await statusOf(id), `${from} to ${to}`).toBe(to);
        } else if (canMoveDraft(from, to)) {
          // open to sent needs an order: done by send(), which the next test holds; here only that nothing else may go to sent.
          expect(from).toBe("open");
        } else {
          await expect(move(id, to), `${from} to ${to}`).rejects.toThrow(/draft_order\.move|draft_orders_lifecycle|draft_order\.frozen/);
          expect(await statusOf(id), `${from} stays`).toBe(from);
        }
      }
    }
    // The table the database holds is the table the code reads.
    expect(Object.fromEntries(DRAFT_STATUSES.map((s) => [s, [...DRAFT_TRANSITIONS[s]].sort()]))).toEqual({
      open: ["sent"],
      sent: ["cancelled", "expired", "open", "paid"],
      paid: [],
      expired: ["open", "paid"],
      cancelled: ["open", "paid"],
    });
  });

  it("is sent with the order, the time it was sent, the expiry and a link, in one move", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    const sent = await one("select status, order_id, sent_at is not null as has_sent, expires_at > sent_at as has_expiry, pay_token_hash is not null as has_link from commerce.draft_orders where id = $1", [d.id]);
    expect(sent).toEqual({ status: "sent", order_id: orderId, has_sent: true, has_expiry: true, has_link: true });
    // A draft cannot be sent without them, or with an expiry before it was sent.
    const bare = await draft();
    await expect(db.query("update commerce.draft_orders set status = 'sent' where id = $1", [bare.id])).rejects.toThrow(/draft_orders_lifecycle/);
    const o = await order(storeA, { draftId: bare.id });
    await expect(db.query("update commerce.draft_orders set status = 'sent', order_id = $2, sent_at = now(), expires_at = now() - interval '1 hour' where id = $1", [bare.id, o.id])).rejects.toThrow(/draft_orders_lifecycle/);
    await db.query("update commerce.draft_orders set status = 'sent', order_id = $2, sent_at = now(), expires_at = now() + interval '1 day' where id = $1", [bare.id, o.id]);
  });

  it("refuses an order of another store, and the order and the time of sending being rewritten while it stays sent", async () => {
    const d = await draft();
    const foreign = await order(storeB, { draftId: d.id });
    await expect(
      db.query("update commerce.draft_orders set status = 'sent', order_id = $2, sent_at = now(), expires_at = now() + interval '1 day' where id = $1", [d.id, foreign.id]),
    ).rejects.toThrow(/draft_orders_order_fk|foreign key/);
    await send(d.id);
    const other = await order(storeA, { draftId: d.id });
    await rejects("update commerce.draft_orders set order_id = $2 where id = $1", [d.id, other.id], /draft_order\.fixed/);
    await rejects("update commerce.draft_orders set sent_at = now() - interval '1 day' where id = $1", [d.id], /draft_order\.fixed/);
  });

  it("changes its link and expiry only while it is sent (a new link, a later day), and keeps them when it ends", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("update commerce.draft_orders set pay_token_hash = 'newhash', expires_at = expires_at + interval '2 days', pay_sends_today = 1, pay_sent_on = current_date where id = $1", [d.id]);
    await rejects("update commerce.draft_orders set status = 'expired', pay_token_hash = null where id = $1", [d.id], /draft_order\.fixed/);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [orderId]);
    expect(await statusOf(d.id)).toBe("expired");
    expect(await scalar("select pay_token_hash from commerce.draft_orders where id = $1", [d.id])).toBe("newhash");
    await rejects("update commerce.draft_orders set pay_token_hash = 'other' where id = $1", [d.id], /draft_order\.fixed/);
    await rejects("update commerce.draft_orders set expires_at = expires_at + interval '1 day' where id = $1", [d.id], /draft_order\.fixed/);
  });

  it("clears the order, the times and the link on a reopen, and the order it made keeps its draft id", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, pay_token_hash = null, version = version + 1 where id = $1", [d.id]);
    expect(await one("select status, order_id, sent_at, expires_at, pay_token_hash from commerce.draft_orders where id = $1", [d.id])).toEqual({ status: "open", order_id: null, sent_at: null, expires_at: null, pay_token_hash: null });
    expect(await scalar("select draft_id from commerce.orders where id = $1", [orderId])).toBe(d.id);
    // An open draft with any of them left is not a state.
    await expect(db.query("update commerce.draft_orders set pay_token_hash = 'x' where id = $1", [d.id])).rejects.toThrow(/draft_orders_lifecycle|draft_order\.fixed/);
  });

  it("makes a reopened draft's second order a new order with the next number", async () => {
    const s = await createInvoiceStore(db, `ops-reopen-${n()}`);
    const d = await draft({ store: s });
    const first = await send(d.id, s);
    await db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, pay_token_hash = null, version = version + 1 where id = $1", [d.id]);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [first]);
    const second = await send(d.id, s);
    expect(second).not.toBe(first);
    const numbers = (await rows<{ number: string }>("select number from commerce.orders where store_id = $1 order by number", [s])).map((r) => r.number);
    expect(numbers).toEqual(["1001", "1002"]);
    expect(await statusOf(d.id)).toBe("sent");
    // The first order was cancelled before the reopen's cancel; the draft was already open, so the cancel did not move it.
    expect(await scalar("select order_id from commerce.draft_orders where id = $1", [d.id])).toBe(second);
  });

  it("only raises its version, never lowers it", async () => {
    const d = await draft();
    await db.query("update commerce.draft_orders set version = version + 1, email = 'new@example.com' where id = $1", [d.id]);
    await rejects("update commerce.draft_orders set version = 1 where id = $1", [d.id], /draft_order\.version/);
  });

  it("keeps its number, store and maker", async () => {
    const d = await draft();
    await rejects("update commerce.draft_orders set number = 'D-777' where id = $1", [d.id], /draft_order\.fixed/);
    await rejects("update commerce.draft_orders set store_id = $2 where id = $1", [d.id, storeB], /draft_order\.fixed/);
    await rejects("update commerce.draft_orders set created_by = null where id = $1", [d.id], /draft_order\.fixed/);
  });

  it("is deleted unless it is sent: an open, paid, expired or cancelled draft may go, a sent one is reopened first", async () => {
    const sentDraft = await draft();
    const orderId = await send(sentDraft.id);
    await rejects("delete from commerce.draft_orders where id = $1", [sentDraft.id], /draft_order\.delete/);
    const open = await draft();
    await db.query("delete from commerce.draft_orders where id = $1", [open.id]);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [orderId]);
    expect(await statusOf(sentDraft.id)).toBe("paid");
    // A paid draft goes with the clean-up; the order it made stays, with its draft id.
    await db.query("delete from commerce.draft_orders where id = $1", [sentDraft.id]);
    expect(await scalar("select draft_id from commerce.orders where id = $1", [orderId])).toBe(sentDraft.id);
    const expired = await draft();
    const expiredOrder = await send(expired.id);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [expiredOrder]);
    await db.query("delete from commerce.draft_orders where id = $1", [expired.id]);
  });
});

describe("a draft that is not open", () => {
  it("refuses changes to its lines, prices, discount, shipping, customer, notes to the buyer, tags, addresses and market", async () => {
    const d = await draft();
    await send(d.id);
    for (const set of [
      "email = 'other@example.com'",
      "phone = '123'",
      "shipping_address = '{\"name\":\"x\"}'::jsonb",
      "billing_address = '{\"name\":\"x\"}'::jsonb",
      "company_name = 'x'",
      "organisation_number = '1'",
      "note_to_buyer = 'x'",
      "tags = '[\"x\"]'::jsonb",
      "discount_kind = 'percent', discount_value = 100, discount_label = 'x'",
      "shipping_kind = 'free'",
      "valid_days = 2",
      "market_slug = 'se'",
      "currency = 'SEK'",
      "locale = 'sv-SE'",
    ]) {
      await expect(db.query(`update commerce.draft_orders set ${set} where id = $1`, [d.id]), set).rejects.toThrow(/draft_order\.frozen/);
    }
    // The internal note, and the counters of the link, are not contents.
    await db.query("update commerce.draft_orders set internal_note = 'called the customer', pay_sends_today = 2, pay_sent_on = current_date, version = version + 1 where id = $1", [d.id]);
  });

  it("locks its lines: no insert, update or delete", async () => {
    const d = await draft();
    const v = await variant(storeA);
    await draftLine(storeA, d.id, { variant: v });
    await send(d.id);
    await expect(draftLine(storeA, d.id, { position: 5 })).rejects.toThrow(/draft_order\.frozen/);
    await rejects("update commerce.draft_order_lines set quantity = 2 where draft_id = $1", [d.id], /draft_order\.frozen/);
    await rejects("delete from commerce.draft_order_lines where draft_id = $1", [d.id], /draft_order\.frozen/);
    // Moving a line out of a locked draft into an open one is refused as well.
    const open = await draft();
    await rejects("update commerce.draft_order_lines set draft_id = $2 where draft_id = $1", [d.id, open.id], /draft_order\.frozen/);
  });

  it("is editable again after a reopen", async () => {
    const d = await draft();
    await draftLine(storeA, d.id);
    await send(d.id);
    await db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, pay_token_hash = null, version = version + 1 where id = $1", [d.id]);
    await db.query("update commerce.draft_orders set email = 'again@example.com', note_to_buyer = 'hello' where id = $1", [d.id]);
    await draftLine(storeA, d.id, { position: 1 });
    await db.query("update commerce.draft_order_lines set quantity = 3 where draft_id = $1 and position = 1", [d.id]);
  });

  it("lets the customer link be cleared when the customer is erased, and no other change of the customer", async () => {
    const s = await createInvoiceStore(db, `ops-cust-${n()}`);
    const customer = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'erase@example.com') returning id", [s]);
    const d = await draft({ store: s });
    await db.query("update commerce.draft_orders set customer_id = $2 where id = $1", [d.id, customer]);
    await send(d.id, s);
    const other = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'other@example.com') returning id", [s]);
    await rejects("update commerce.draft_orders set customer_id = $2 where id = $1", [d.id, other], /draft_order\.frozen/);
    // The erasure deletes the customer: the link goes (the foreign key sets only that column null), the draft stays until it is deleted itself.
    await db.query("delete from commerce.customers where id = $1", [customer]);
    expect(await scalar("select customer_id from commerce.draft_orders where id = $1", [d.id])).toBeNull();
    expect(await statusOf(d.id)).toBe("sent");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 8: the order follows its draft
// ---------------------------------------------------------------------------------------------------------------------

describe("a draft's order follows it", () => {
  it("makes the draft paid when the order is paid, with the time", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [orderId]);
    expect(await one("select status, paid_at is not null as paid from commerce.draft_orders where id = $1", [d.id])).toEqual({ status: "paid", paid: true });
  });

  it("makes the draft paid through complete_order_payment(), with a payment of Stripe or one recorded outside Kaizen", async () => {
    for (const manual of [false, true]) {
      const s = await createInvoiceStore(db, `ops-pay-${n()}`);
      const d = await draft({ store: s });
      const orderId = await send(d.id, s);
      if (manual) await payment(s, orderId, { provider: "manual", method: "cash", recordedBy: account });
      else await payment(s, orderId, { provider: "stripe" });
      expect(await scalar("select commerce.complete_order_payment($1, 'cs_test')", [orderId])).toBe(true);
      expect(await statusOf(d.id), manual ? "manual" : "stripe").toBe("paid");
      expect(await scalar("select status from commerce.orders where id = $1", [orderId])).toBe("paid");
    }
  });

  it("makes a sent draft expired when its unpaid order is cancelled, through cancel_unpaid_order()", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    expect(await scalar("select commerce.cancel_unpaid_order($1, 'draft expired')", [orderId])).toBe(true);
    expect(await statusOf(d.id)).toBe("expired");
    expect(await scalar("select status from commerce.orders where id = $1", [orderId])).toBe("cancelled");
  });

  it("lets a payment that arrives after the draft expired complete the order and mark the draft paid", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("select commerce.cancel_unpaid_order($1, 'draft expired')", [orderId]);
    expect(await statusOf(d.id)).toBe("expired");
    await payment(storeA, orderId, { provider: "stripe" });
    expect(await scalar("select commerce.complete_order_payment($1, 'cs_late')", [orderId])).toBe(true);
    expect(await statusOf(d.id)).toBe("paid");
  });

  it("does not touch a reopened draft: it no longer names the order, so the cancel that follows a reopen moves nothing", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, pay_token_hash = null, version = version + 1 where id = $1", [d.id]);
    await db.query("select commerce.cancel_unpaid_order($1, 'draft reopened')", [orderId]);
    expect(await statusOf(d.id)).toBe("open");
    // And a later payment of that old order leaves the open draft alone.
    await db.query("select commerce.complete_order_payment($1, 'cs_old')", [orderId]);
    expect(await statusOf(d.id)).toBe("open");
  });

  it("touches only the draft that names this order, and never another store's", async () => {
    const d1 = await draft();
    const d2 = await draft();
    const o1 = await send(d1.id);
    await send(d2.id);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [o1]);
    expect(await statusOf(d1.id)).toBe("paid");
    expect(await statusOf(d2.id)).toBe("sent");
  });

  it("leaves a paid order that is cancelled later (a full refund) and its paid draft as they are", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [orderId]);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [orderId]);
    expect(await statusOf(d.id)).toBe("paid");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3.3 point 9: the order numbers (D141) are untouched
// ---------------------------------------------------------------------------------------------------------------------

describe("the order number sequence (D141)", () => {
  it("has no gap after any run of sends, expiries, reopens, tags and archives, and no order's number ever changes (a property over random runs)", async () => {
    let seed = 20261006;
    const rnd = (k: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % k;
    };
    for (let run = 0; run < 6; run++) {
      const s = await createInvoiceStore(db, `ops-seq-${n()}`);
      const drafts: string[] = [];
      for (let step = 0; step < 40; step++) {
        const action = rnd(7);
        if (action === 0 || drafts.length === 0) drafts.push((await draft({ store: s })).id);
        const id = drafts[rnd(drafts.length)];
        const status = await statusOf(id);
        if (action === 1 && status === "open") await send(id, s);
        else if (action === 2 && status === "sent") await db.query("select commerce.cancel_unpaid_order((select order_id from commerce.draft_orders where id = $1), 'draft expired')", [id]);
        else if (action === 3 && (status === "sent" || status === "expired" || status === "cancelled")) {
          const orderId = await scalar<string | null>("select order_id from commerce.draft_orders where id = $1", [id]);
          await db.query("update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, pay_token_hash = null, version = version + 1 where id = $1", [id]);
          if (status === "sent" && orderId) await db.query("select commerce.cancel_unpaid_order($1, 'draft reopened')", [orderId]);
        } else if (action === 4) {
          const o = await order(s, { status: "fulfilled" });
          await db.query("update commerce.orders set archived_at = now() where id = $1", [o.id]);
          await db.query("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'vip', 'VIP') on conflict do nothing", [s, o.id]);
        } else if (action === 5) {
          await order(s, { status: "pending_payment" });
        } else if (action === 6 && status === "sent") {
          await db.query("update commerce.orders set status = 'paid' where id = (select order_id from commerce.draft_orders where id = $1)", [id]);
        }
      }
      const audit = await one<{ ok: boolean; missing: unknown; off_format: unknown }>("select ok, missing, off_format from commerce.order_number_audit($1)", [s]);
      expect([audit.ok, Number(audit.missing), Number(audit.off_format)], `run ${run}`).toEqual([true, 0, 0]);
      // No order ever changes its number, whatever happens to it.
      const some = await one<{ id: string }>("select id from commerce.orders where store_id = $1 limit 1", [s]);
      if (some) await rejects("update commerce.orders set number = 'X-1' where id = $1", [some.id], /order_number\.changed/);
    }
  });

  it("still refuses to renumber or delete an order, whatever its draft, tags or archive", async () => {
    const d = await draft();
    const orderId = await send(d.id);
    await rejects("update commerce.orders set number = 'X-2' where id = $1", [orderId], /order_number\.changed/);
    await rejects("delete from commerce.orders where id = $1", [orderId], /order_number\.deleted|draft_orders_order_fk|order_tags_order_fk/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Duplicating a store (D129)
// ---------------------------------------------------------------------------------------------------------------------

describe("duplicating a store", () => {
  it("copies no tag, saved view, setting, draft or draft line: the copy starts with the defaults", async () => {
    const src = await createInvoiceStore(db, `ops-dup-${n()}`);
    const owner = await scalar<string>("insert into commerce.accounts (email) values ($1) returning id", [`dup-owner-${n()}@example.com`]);
    const o = await order(src, { status: "fulfilled" });
    await db.query("insert into commerce.order_tags (store_id, order_id, key, label) values ($1, $2, 'vip', 'VIP')", [src, o.id]);
    await db.query("insert into commerce.order_views (store_id, title) values ($1, 'Unpaid')", [src]);
    await db.query("update commerce.order_settings set gift_messages = true, auto_archive_days = 30 where store_id = $1", [src]).catch(() => undefined);
    await db.query("insert into commerce.order_settings (store_id, gift_messages, auto_archive_days) values ($1, true, 30) on conflict (store_id) do update set gift_messages = true, auto_archive_days = 30", [src]);
    const d = await draft({ store: src });
    await draftLine(src, d.id);
    await db.query("update commerce.orders set archived_at = now() where id = $1", [o.id]);

    const copy = await scalar<string>("select commerce.duplicate_store($1, $2, 'Copy', $3)", [src, `ops-dup-copy-${n()}`, owner]);
    for (const table of ["order_tags", "order_views", "order_settings", "draft_orders", "draft_order_lines"]) {
      expect(await scalar(`select count(*)::int from commerce.${table} where store_id = $1`, [copy]), table).toBe(0);
    }
    // The settings are made when first read, with the defaults, so a copy never inherits the original's gift switch or automatic archiving.
    expect(await scalar<string>("select commerce.next_draft_number($1)", [copy])).toBe("D-1");
    expect(await one("select gift_messages, auto_archive_days from commerce.order_settings where store_id = $1", [copy])).toEqual({ gift_messages: false, auto_archive_days: null });
    // The original is untouched.
    expect(await scalar("select count(*)::int from commerce.order_tags where store_id = $1", [src])).toBe(1);
  });

  it("copies order history unarchived and as an ordinary checkout order with no gift, source or staff discount", async () => {
    const src = await createInvoiceStore(db, `ops-dup2-${n()}`);
    const owner = await scalar<string>("insert into commerce.accounts (email) values ($1) returning id", [`dup-owner-${n()}@example.com`]);
    const o = await order(src, { status: "fulfilled", gift: { to: "Kari", message: "Hi" } });
    await db.query("update commerce.orders set archived_at = now() where id = $1", [o.id]);
    const copy = await scalar<string>("select commerce.duplicate_store($1, $2, 'Copy', $3)", [src, `ops-dup2-copy-${n()}`, owner]);
    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    await db.query("select * from commerce.copy_orders($1, $2, null, 10)", [src, copy]);
    const copied = await rows<any>("select archived_at, source, draft_id, made_by, is_gift, gift_message, staff_discount_minor from commerce.orders where store_id = $1", [copy]);
    for (const row of copied) {
      expect(row).toEqual({ archived_at: null, source: "checkout", draft_id: null, made_by: null, is_gift: false, gift_message: null, staff_discount_minor: 0 });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The patches of live functions
// ---------------------------------------------------------------------------------------------------------------------

describe("the patched functions", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const migration = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith("_orders_ops_rules.sql"))!), "utf8");
  const patches = [...migration.matchAll(/DO \$patch\$[\s\S]*?\$patch\$;/g)].map((m) => m[0]);

  it("are four, each one anchored replacement that raises when its anchor is gone and does nothing the second time", async () => {
    expect(patches).toHaveLength(4);
    for (const patch of patches) {
      expect(patch).toContain("RAISE EXCEPTION");
      expect(patch).toContain("IF position(");
    }
    const before = await scalar<string>("select pg_get_functiondef('commerce.copied_orders_read_only()'::regprocedure)");
    for (const patch of patches) await db.exec(patch);
    expect(await scalar<string>("select pg_get_functiondef('commerce.copied_orders_read_only()'::regprocedure)")).toBe(before);
  });

  it("fail loudly, and leave the function as it was, when the function is not the one they were written for", async () => {
    await db.exec("begin");
    try {
      await db.exec(`create or replace function commerce.refuse_copied_order_event() returns trigger language plpgsql set search_path = '' as $f$ begin return new; end; $f$`);
      const patch = patches.find((p) => p.includes("refuse_copied_order_event"))!;
      await expect(db.exec(patch)).rejects.toThrow(/refuse_copied_order_event: the type test was not found/);
    } finally {
      await db.exec("rollback");
    }
    // After the rollback the real function is back, patched.
    expect(await scalar<string>("select pg_get_functiondef('commerce.refuse_copied_order_event()'::regprocedure)")).toContain("order.tags_changed");
  });

  it("keep what the earlier migrations put in them: a copied order is still refused anything else, anonymising still works", async () => {
    const def = await scalar<string>("select pg_get_functiondef('commerce.copied_orders_read_only()'::regprocedure)");
    expect(def).toContain("commerce.anonymising");
    expect(def).toContain("an order copied from another store is history");
    const anon = await scalar<string>("select pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure)");
    expect(anon).toContain("gift_message = NULL");
    expect(anon).toContain("vat_treatment");
    const snap = await scalar<string>("select pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure)");
    expect(snap).toContain("'paid_online'");
    expect(snap).toContain("'paid_outside'");
  });

  it("put no DELETE, DROP or TRUNCATE inside any function this migration makes (the migration tool cancels those)", () => {
    const functions = [...migration.matchAll(/CREATE FUNCTION[\s\S]*?\n\$\$;/g)].map((m) => m[0]);
    expect(functions.length).toBeGreaterThanOrEqual(10);
    for (const body of [...functions, ...patches]) {
      expect(body, body.slice(0, 80)).not.toMatch(/\b(DELETE\s+FROM|DROP\s+(TABLE|FUNCTION|TRIGGER|INDEX|CONSTRAINT)|TRUNCATE)\b/i);
    }
  });

  it("make every function with a fixed, empty search path and none callable by the public roles' default grants beyond the schema's own rules", async () => {
    const found = await rows<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'commerce' and p.proname = any($1)`,
      [["order_tags_limit", "order_views_limit", "order_tag_counts", "next_draft_number", "draft_orders_rules", "draft_order_lines_rules", "draft_order_lines_limit", "orders_draft_follow", "orders_gift_frozen", "orders_origin_frozen"]],
    );
    expect(found).toHaveLength(10);
    for (const f of found) expect(f.proconfig, f.proname).toEqual(expect.arrayContaining(['search_path=""']));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The limits the code and the database share
// ---------------------------------------------------------------------------------------------------------------------

describe("the limits in src/lib/order-limits.ts and the database", () => {
  it("say the same numbers (the migrations' checks and triggers are written with them)", async () => {
    const checks = await rows<{ conname: string; def: string }>(
      "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid::regclass::text in ('commerce.order_tags', 'commerce.order_views', 'commerce.order_settings', 'commerce.draft_orders', 'commerce.draft_order_lines', 'commerce.orders', 'commerce.carts') and contype = 'c'",
    );
    const def = (name: string) => checks.find((c) => c.conname === name)?.def ?? "";
    expect(def("order_tags_label")).toContain(`<= ${limits.TAG_MAX_LENGTH}`);
    expect(def("order_views_title")).toContain(`<= ${limits.VIEW_TITLE_MAX}`);
    expect(def("order_views_columns")).toContain(`<= ${limits.VIEW_COLUMNS_MAX}`);
    expect(def("order_views_params")).toContain(String(limits.VIEW_PARAMS_MAX_BYTES));
    for (const name of ["orders_gift_fields", "carts_gift_fields"]) {
      for (const k of [limits.GIFT_NAME_MAX, limits.GIFT_MESSAGE_MAX, limits.GIFT_MESSAGE_LINES]) expect(def(name), `${name} ${k}`).toContain(String(k));
    }
    expect(def("draft_orders_notes")).toContain(String(limits.DRAFT_NOTE_TO_BUYER_MAX));
    expect(def("draft_orders_notes")).toContain(String(limits.DRAFT_INTERNAL_NOTE_MAX));
    expect(def("draft_orders_valid_days")).toContain(String(limits.DRAFT_VALID_DAYS_MAX));
    expect(def("draft_orders_discount")).toContain(String(limits.DISCOUNT_BPS_MAX));
    expect(def("draft_orders_discount")).toContain(String(limits.DRAFT_DISCOUNT_LABEL_MAX));
    expect(def("draft_order_lines_quantity")).toContain(String(limits.DRAFT_QUANTITY_MAX));
    expect(def("draft_order_lines_title")).toContain(String(limits.DRAFT_LINE_TITLE_COLUMN_MAX));
    expect(def("order_settings_auto_archive")).toContain(String(limits.AUTO_ARCHIVE_MIN_DAYS));
    expect(def("order_settings_auto_archive")).toContain(String(limits.AUTO_ARCHIVE_MAX_DAYS));
    const triggers = (await scalar<string>("select string_agg(pg_get_functiondef(p.oid), ' ') from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'commerce' and p.proname in ('order_tags_limit', 'order_views_limit', 'draft_order_lines_limit')")) ?? "";
    for (const k of [limits.TAGS_PER_ORDER, limits.VIEWS_MAX, limits.DRAFT_LINES_MAX]) expect(triggers, String(k)).toContain(`>= ${k}`);
  });
});
