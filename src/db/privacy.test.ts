import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { areaOfAction } from "@/lib/audit";
import { detectorsOf, registerProblems, type Detector } from "@/lib/personal-data";
import { RETENTION_KINDS, RETENTION_SEED, periodFor, retentionCutoff } from "@/lib/retention";

import { createInvoiceStore, one as q1, placeOrder, refund, scalar as q0, type OrderSpec } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * GDPR export, erasure and retention (D162, docs/wave-1g-gdpr.md): the rules that live in SQL, against every migration applied to a real
 * Postgres (PGlite), and the register of personal data held against the schema.
 */

let db: PGlite;
let YEAR: number;

beforeAll(async () => {
  db = await createTestDatabase();
  YEAR = await q0<number>(db, "select extract(year from now())::int");
});

afterAll(async () => {
  await db.close();
});

const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

type SchemaMap = Record<string, { columns: string[]; detectors: Detector[] }>;

/** Every base table of the commerce schema with its columns and the tables its foreign keys point at, run through the detectors. */
async function schemaMap(): Promise<SchemaMap> {
  const cols = await db.query<{ t: string; c: string }>(
    `select c.table_name as t, c.column_name as c from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'commerce' and t.table_type = 'BASE TABLE' order by 1, c.ordinal_position`,
  );
  const fks = await db.query<{ t: string; r: string }>(
    `select cl.relname as t, rf.relname as r from pg_constraint k
       join pg_class cl on cl.oid = k.conrelid join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'commerce'
       join pg_class rf on rf.oid = k.confrelid
      where k.contype = 'f'`,
  );
  const map: SchemaMap = {};
  for (const { t, c } of cols.rows) (map[t] ??= { columns: [], detectors: [] }).columns.push(c);
  for (const [t, info] of Object.entries(map)) {
    info.detectors = detectorsOf(info.columns, fks.rows.filter((f) => f.t === t).map((f) => f.r));
  }
  return map;
}

describe("the register of personal data", () => {
  it("has every table the detectors match in exactly one of PERSONAL_DATA and NOT_PERSONAL, and no entry for a table that is gone", async () => {
    const map = await schemaMap();
    expect(registerProblems(map)).toEqual([]);
  });
});

describe("the register fails for a table nobody classified (the heart of the unit)", () => {
  it("reports a new table with a person's column or a free-text column, and passes it once it is classified", async () => {
    await db.exec("begin");
    try {
      await db.exec("create table commerce.zz_reviews (id uuid primary key, store_id uuid, customer_id uuid, body text)");
      await db.exec("create table commerce.zz_notes (id uuid primary key, store_id uuid, note text)");
      await db.exec("create table commerce.zz_numbers (id uuid primary key, store_id uuid, total integer)");
      // A person's name or postcode alone, with no customer id and no link to an anchor table, is enough (review: a future reviews table).
      await db.exec("create table commerce.zz_reviewers (id uuid primary key, store_id uuid, product_id uuid, reviewer_name text, rating integer)");
      await db.exec("create table commerce.zz_postcodes (id uuid primary key, store_id uuid, postal_code text)");
      await db.exec("create table commerce.zz_files (id uuid primary key, store_id uuid, file_name text)");
      await db.exec("create table commerce.zz_links (id uuid primary key, order_id uuid references commerce.orders (id))");
      const problems = registerProblems(await schemaMap());
      expect(problems.map((p) => p.table).sort()).toEqual(["zz_links", "zz_notes", "zz_postcodes", "zz_reviewers", "zz_reviews"]);
      expect(problems.find((p) => p.table === "zz_reviewers")?.problem).toContain("reviewer_name");
      expect(problems.find((p) => p.table === "zz_reviews")?.problem).toContain("A+C");
      expect(problems.find((p) => p.table === "zz_links")?.problem).toContain("B");
    } finally {
      await db.exec("rollback");
    }
    expect(registerProblems(await schemaMap())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The retention schedule
// ---------------------------------------------------------------------------------------------------------------------------------

describe("the retention rules", () => {
  it("are seeded exactly as RETENTION_SEED says, with a source, a basis and a date, all unverified", async () => {
    const { rows } = await db.query<Record<string, unknown>>("select * from commerce.retention_rules order by kind, coalesce(country, '__')");
    expect(rows).toHaveLength(RETENTION_SEED.length);
    const key = (r: { kind?: unknown; country?: unknown }) => `${String(r.kind)}|${String(r.country ?? "")}`;
    const byKey = new Map(rows.map((r) => [key(r), r]));
    for (const seed of RETENTION_SEED) {
      const row = byKey.get(key(seed))!;
      expect(row, key(seed)).toBeDefined();
      expect({
        period_value: row.period_value, period_unit: row.period_unit, counts_from: row.counts_from, source: row.source, source_url: row.source_url,
        basis: row.basis, enforced_by: row.enforced_by, note: row.note, verified_at: row.verified_at,
      }).toEqual({
        period_value: seed.periodValue, period_unit: seed.periodUnit, counts_from: seed.countsFrom, source: seed.source, source_url: seed.sourceUrl,
        basis: seed.basis, enforced_by: seed.enforcedBy, note: seed.note, verified_at: null,
      });
      expect(String(row.checked_on)).toContain("2026");
    }
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(RETENTION_KINDS));
  });

  it("answer through commerce.retention_rule() as the TypeScript does, with the safe fallback for an empty table", async () => {
    for (const kind of RETENTION_KINDS) {
      for (const country of ["NO", "SE", "DK", "DE", "FI", null]) {
        const row = await one<{ period_value: number; period_unit: string; counts_from: string }>("select * from commerce.retention_rule($1, $2, current_date)", [kind, country]);
        const ts = periodFor(kind, country, "2026-10-04");
        expect([kind, country, row.period_value, row.period_unit, row.counts_from]).toEqual([kind, country, ts.periodValue, ts.periodUnit, ts.countsFrom]);
      }
    }
    // A kind nobody wrote a rule for means the safe side, never "keep nothing" and never "delete everything".
    expect(await one("select * from commerce.retention_rule('no_such_kind', 'NO', current_date)")).toEqual({ period_value: 120, period_unit: "months", counts_from: "event" });
    expect(await one("select * from commerce.retention_rule('bookkeeping', 'NO', date '1999-01-01')")).toEqual({ period_value: 120, period_unit: "months", counts_from: "end_of_year" });
  });

  it("are never edited in place or deleted, only ended once and reviewed once", async () => {
    const id = await scalar<string>("select id from commerce.retention_rules where kind = 'carts'");
    await rejects("update commerce.retention_rules set period_value = 1 where id = $1", [id], /retention_rule_fixed/);
    await rejects("update commerce.retention_rules set source = 'a different source text' where id = $1", [id], /retention_rule_fixed/);
    await rejects("delete from commerce.retention_rules where id = $1", [id], /retention_rule_kept/);
    const admin = await scalar<string>("insert into commerce.accounts (email) values ('platform-admin@example.com') returning id");
    await db.query("select commerce.verify_retention_rule($1, $2)", [id, admin]);
    expect(await scalar("select verified_by = $2 and verified_at is not null from commerce.retention_rules where id = $1", [id, admin])).toBe(true);
    await rejects("select commerce.verify_retention_rule($1, $2)", [id, admin], /already reviewed/);
    await rejects("select commerce.verify_retention_rule($1, null)", [id], /names the person/);
    await rejects("update commerce.retention_rules set verified_at = null, verified_by = null where id = $1", [id], /retention_rule_fixed/);
    expect(await scalar("select count(*)::int from commerce.audit_log where action = 'retention.rule_verified' and area = 'platform'")).toBe(1);
  });

  it("change only through set_retention_rule(): history kept, the old row closed, a floor under bookkeeping, a ceiling, and an audit entry", async () => {
    const admin = await scalar<string>("insert into commerce.accounts (email) values ('platform-admin2@example.com') returning id");
    const set = (kind: string, country: string | null, value: number, unit: string, counts: string, from: string) =>
      db.query("select commerce.set_retention_rule($1, $2, $3, $4, $5, 'The accountant said so, 2026', null, 'read', date '2026-10-04', $6::date, null, 'note', $7)", [kind, country, value, unit, counts, from, admin]);
    await rejects("select commerce.set_retention_rule('bookkeeping', 'NO', 48, 'months', 'end_of_year', 'a source text', null, 'read', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rule_floor/);
    await rejects("select commerce.set_retention_rule('bookkeeping', 'NO', 30, 'days', 'event', 'a source text', null, 'read', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rule_floor/);
    await rejects("select commerce.set_retention_rule('carts', null, 700, 'months', 'event', 'a source text', null, 'policy', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rule_ceiling/);
    await rejects("select commerce.set_retention_rule('carts', null, 0, 'days', 'event', 'a source text', null, 'policy', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rule_period/);
    await rejects("select commerce.set_retention_rule('carts', 'ZZ', 10, 'days', 'event', 'a source text', null, 'policy', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rule_country/);
    await rejects("select commerce.set_retention_rule('carts', null, 10, 'days', 'event', 'a source text', null, 'policy', current_date, date '2000-01-01', null, '', $1)", [admin], /retention_rule_backdated/);
    // A year-end period must be whole years (the table's check), and a kind must be one of the kinds.
    await rejects("select commerce.set_retention_rule('bookkeeping', 'NO', 66, 'months', 'end_of_year', 'a source text', null, 'read', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rules_year_end/);
    await rejects("select commerce.set_retention_rule('nonsense', null, 10, 'days', 'event', 'a source text', null, 'policy', current_date, date '2030-01-01', null, '', $1)", [admin], /retention_rules_kind/);

    await set("bookkeeping", "NO", 72, "months", "end_of_year", "2030-01-01");
    const rows = (await db.query<{ period_value: number; valid_from: string; valid_to: string | null; enforced_by: string }>("select period_value, valid_from::text, valid_to::text, enforced_by from commerce.retention_rules where kind = 'bookkeeping' and country = 'NO' order by valid_from")).rows;
    expect(rows).toEqual([
      { period_value: 60, valid_from: "2000-01-01", valid_to: "2030-01-01", enforced_by: expect.any(String) },
      { period_value: 72, valid_from: "2030-01-01", valid_to: null, enforced_by: rows[0].enforced_by },
    ]);
    // The old one still answers for the old days, the new one from its day.
    expect(await scalar("select period_value from commerce.retention_rule('bookkeeping', 'NO', date '2029-12-31')")).toBe(60);
    expect(await scalar("select period_value from commerce.retention_rule('bookkeeping', 'NO', date '2030-01-01')")).toBe(72);
    expect(await scalar("select period_value from commerce.retention_rule('bookkeeping', 'NO', current_date)")).toBe(60);
    const log = await one<{ details: Record<string, unknown>; area: string }>("select details, area from commerce.audit_log where action = 'retention.rule_set'");
    expect(log.area).toBe("platform");
    expect(log.details).toMatchObject({ kind: "bookkeeping", country: "NO", period_value: 72, previous_value: 60 });
    // Two rows in force for one kind and country are impossible.
    await rejects("insert into commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, basis, checked_on, valid_from, enforced_by) values ('bookkeeping', 'NO', 60, 'months', 'end_of_year', 'a duplicate source', 'read', current_date, date '2031-01-01', 'x')", [], /retention_rules_current_key/);
    // Put the NO rule back for the tests that follow.
    await db.exec("alter table commerce.retention_rules disable trigger retention_rules_guard");
    await db.exec("delete from commerce.retention_rules where kind = 'bookkeeping' and country = 'NO' and valid_from = date '2030-01-01'");
    await db.exec("update commerce.retention_rules set valid_to = null where kind = 'bookkeeping' and country = 'NO'");
    await db.exec("alter table commerce.retention_rules enable trigger retention_rules_guard");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Privacy requests
// ---------------------------------------------------------------------------------------------------------------------------------

describe("privacy requests", () => {
  let shop: string;
  let staff: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "gdpr-requests");
    staff = await scalar<string>("insert into commerce.accounts (email) values ('gdpr-staff@example.com') returning id");
  });

  const open = (over: Record<string, unknown> = {}) => {
    const row = { kind: "export", channel: "staff", email: `p${Math.random().toString(36).slice(2)}@example.com`, received: "2026-10-01T00:00:00Z", ...over };
    return one<{ id: string; due_at: string }>(
      "insert into commerce.privacy_requests (store_id, kind, channel, subject_email, received_at, handled_by) values ($1, $2, $3, $4, $5, $6) returning id, due_at::text",
      [shop, row.kind, row.channel, row.email, row.received, staff],
    );
  };

  it("start the one-month clock at receipt, in the database too (the same day of the next month, clamped)", async () => {
    expect((await open()).due_at).toBe("2026-11-01 00:00:00+00");
    expect((await open({ received: "2026-01-31T12:00:00Z" })).due_at).toBe("2026-02-28 12:00:00+00");
    expect((await open({ received: "2028-01-31T12:00:00Z" })).due_at).toBe("2028-02-29 12:00:00+00");
  });

  it("are extended once, before the due date, with a reason, to at most three months from receipt", async () => {
    const r = await open({ received: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    await rejects("update commerce.privacy_requests set extended_until = due_at + interval '1 month' where id = $1", [r.id], /extension needs its reason/);
    await rejects("update commerce.privacy_requests set extended_until = received_at + interval '4 months', extension_reason = 'x' where id = $1", [r.id], /privacy_requests_extension/);
    await rejects("update commerce.privacy_requests set extended_until = due_at, extension_reason = 'x' where id = $1", [r.id], /privacy_requests_extension/);
    await db.query("update commerce.privacy_requests set extended_until = received_at + interval '3 months', extension_reason = 'A large account' where id = $1", [r.id]);
    await rejects("update commerce.privacy_requests set extended_until = due_at + interval '1 day', extension_reason = 'again' where id = $1", [r.id], /extended once/);
    // After the due date it is too late to extend.
    const late = await open({ received: new Date(Date.now() - 40 * 86_400_000).toISOString() });
    await rejects("update commerce.privacy_requests set extended_until = received_at + interval '3 months', extension_reason = 'x' where id = $1", [late.id], /within the first month/);
    // An extension cannot be set when the request is logged.
    await rejects("insert into commerce.privacy_requests (store_id, kind, channel, subject_email, received_at, extended_until, extension_reason) values ($1, 'export', 'staff', 'e@example.com', now(), now() + interval '2 months', 'x')", [shop], /extended after it is logged/);
  });

  it("keep their store, kind, channel and dates for good (a mistake is cancelled and logged again)", async () => {
    const r = await open();
    for (const set of ["received_at = received_at + interval '1 day'", "due_at = due_at + interval '1 day'", "kind = 'erasure'", "channel = 'shopper'"]) {
      await rejects(`update commerce.privacy_requests set ${set} where id = $1`, [r.id], /privacy_request_fixed/);
    }
  });

  it("need an outcome that fits the status, a reason to refuse, and an erased subject keeps no email", async () => {
    const r = await open({ kind: "erasure" });
    await rejects("update commerce.privacy_requests set status = 'done', completed_at = now(), subject_email = null where id = $1", [r.id], /privacy_requests_state/);
    await rejects("update commerce.privacy_requests set status = 'done', completed_at = now(), outcome = 'erased' where id = $1", [r.id], /privacy_requests_erased_email/);
    await rejects("update commerce.privacy_requests set status = 'refused', completed_at = now(), outcome = 'refused' where id = $1", [r.id], /privacy_requests_state/);
    await rejects("update commerce.privacy_requests set status = 'open', outcome = 'erased' where id = $1", [r.id], /privacy_requests_state/);
    await db.query("update commerce.privacy_requests set status = 'done', completed_at = now(), outcome = 'erased', subject_email = null, plan_summary = '{\"rows\":[]}' where id = $1", [r.id]);
    // An answered request is a record: its status and outcome never change, and only the address and the account id may be forgotten.
    await rejects("update commerce.privacy_requests set status = 'open', completed_at = null, outcome = null where id = $1", [r.id], /answered request is a record/);
    await rejects("update commerce.privacy_requests set outcome = 'no_data' where id = $1", [r.id], /answered request is a record/);
    await rejects("update commerce.privacy_requests set subject_email = 'new@example.com' where id = $1", [r.id], /answered request is a record/);
    const x = await open();
    await db.query("update commerce.privacy_requests set status = 'refused', completed_at = now(), outcome = 'refused', refusal_reason = 'excessive' where id = $1", [x.id]);
    await db.query("update commerce.privacy_requests set subject_email = null where id = $1", [x.id]);
    await rejects("update commerce.privacy_requests set refusal_reason = 'other' where id = $1", [x.id], /answered request is a record/);
    await rejects("update commerce.privacy_requests set refusal_reason = 'because' where id = $1", [(await open()).id], /privacy_requests_refusal_reason/);
  });

  it("allow one open erasure for an address, and as many exports as are asked", async () => {
    await open({ kind: "erasure", email: "same@example.com" });
    await rejects("insert into commerce.privacy_requests (store_id, kind, channel, subject_email, due_at) values ($1, 'erasure', 'staff', 'same@example.com', now() + interval '1 month')", [shop], /privacy_requests_open_erasure_key/);
    await open({ kind: "export", email: "same@example.com" });
    await open({ kind: "export", email: "same@example.com" });
  });

  it("are deleted only 24 months after they were answered", async () => {
    const r = await open();
    await db.query("update commerce.privacy_requests set status = 'cancelled', completed_at = now(), outcome = 'cancelled' where id = $1", [r.id]);
    await rejects("delete from commerce.privacy_requests where id = $1", [r.id], /kept for 24 months/);
    const openOne = await open();
    await rejects("delete from commerce.privacy_requests where id = $1", [openOne.id], /kept for 24 months/);
    const old = await one<{ id: string }>(
      `insert into commerce.privacy_requests (store_id, kind, channel, status, outcome, received_at, due_at, completed_at, subject_email)
       values ($1, 'export', 'staff', 'done', 'exported', now() - interval '26 months', now() - interval '25 months', now() - interval '25 months', null) returning id`,
      [shop],
    );
    await db.query("delete from commerce.privacy_requests where id = $1", [old.id]);
    expect(await scalar("select count(*)::int from commerce.privacy_requests where id = $1", [old.id])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Orders: restricted until their period ends, then anonymised; nothing is ever deleted
// ---------------------------------------------------------------------------------------------------------------------------------

type Shops = { NO: string; SE: string; DK: string; DE: string; FI: string };
let shops: Shops;
let customerCounter = 0;

async function customerIn(store: string, email: string): Promise<string> {
  customerCounter += 1;
  return scalar<string>("insert into commerce.customers (store_id, email, name) values ($1, $2, 'Kari Nordmann') returning id", [store, `${customerCounter}-${email}`]);
}

/** Moves everything that dates an order to a day in a year: placed, paid, refunded, and the documents' issue days (the guards are lifted as a migration could). */
async function age(orderId: string, year: number, month = 6) {
  await db.exec("alter table commerce.invoices disable trigger invoices_append_only");
  await db.exec("alter table commerce.credit_notes disable trigger credit_notes_append_only");
  try {
    const at = `${year}-${String(month).padStart(2, "0")}-15T12:00:00Z`;
    await db.query("update commerce.orders set placed_at = $2 where id = $1", [orderId, at]);
    await db.query("update commerce.payments set created_at = $2, updated_at = $2 where order_id = $1", [orderId, at]);
    await db.query("update commerce.refunds set created_at = $2 where payment_id in (select id from commerce.payments where order_id = $1)", [orderId, at]);
    await db.query("update commerce.invoices set issued_on = $2::date where order_id = $1", [orderId, at.slice(0, 10)]);
    await db.query("update commerce.credit_notes set issued_on = $2::date where invoice_id in (select id from commerce.invoices where order_id = $1)", [orderId, at.slice(0, 10)]);
  } finally {
    await db.exec("alter table commerce.invoices enable trigger invoices_append_only");
    await db.exec("alter table commerce.credit_notes enable trigger credit_notes_append_only");
  }
}

async function sale(store: string, year: number, over: Partial<OrderSpec> & { customer?: string } = {}): Promise<{ id: string; number: string }> {
  const { customer, ...spec } = over;
  const placed = await placeOrder(db, store, { lines: [{ sku: "TEA", unit: 10000 }], email: "kari@example.com", ...spec });
  if (customer) await db.query("update commerce.orders set customer_id = $2 where id = $1", [placed.id, customer]);
  await age(placed.id, year);
  return { id: placed.id, number: placed.number };
}

const erase = (store: string, order: string) => scalar<string>("select commerce.anonymise_order($1::uuid, $2::uuid, 'erasure')", [store, order]);
const retire = (store: string, order: string) => scalar<string>("select commerce.anonymise_order($1::uuid, $2::uuid, 'retention')", [store, order]);
const orderRow = (id: string) => one<Record<string, any>>("select * from commerce.orders where id = $1", [id]); // eslint-disable-line @typescript-eslint/no-explicit-any

describe("anonymising and restricting orders", () => {
  beforeAll(async () => {
    shops = {
      NO: await createInvoiceStore(db, "gdpr-no", { country: "NO" }),
      SE: await createInvoiceStore(db, "gdpr-se", { country: "SE" }),
      DK: await createInvoiceStore(db, "gdpr-dk", { country: "DK" }),
      DE: await createInvoiceStore(db, "gdpr-de", { country: "DE" }),
      FI: await createInvoiceStore(db, "gdpr-fi", { country: "FI" }),
    };
  });

  it("restricts a sale before the seller's country's period ends and anonymises it after: NO 5, SE 7, DK 5, DE 8, other 10 years from the end of the year", async () => {
    // The last year that is still inside the period is YEAR - years - 1 + ... : a sale of year Y goes on 1 January of Y + years + 1.
    for (const [country, years] of [["NO", 5], ["SE", 7], ["DK", 5], ["DE", 8], ["FI", 10]] as const) {
      const store = shops[country];
      const young = await sale(store, YEAR - years); // due 1 January of YEAR + 1
      const old = await sale(store, YEAR - years - 1); // due 1 January of YEAR
      expect([country, await erase(store, young.id)]).toEqual([country, "restricted"]);
      expect([country, await erase(store, old.id)]).toEqual([country, "anonymised"]);
      expect([country, String((await orderRow(young.id)).restricted_at !== null), (await orderRow(young.id)).anonymised_at]).toEqual([country, "true", null]);
      expect(String(await scalar("select commerce.order_anonymisable_on($1)", [young.id]))).toContain(`${YEAR + 1}`);
      expect(retentionCutoff(country, `${YEAR}-06-01`)).toBe(`${YEAR - years}-01-01`);
    }
  });

  it("restricts a sale: cut loose from the person, the personal fields still there, one event, and never twice", async () => {
    const customer = await customerIn(shops.NO, "restrict@example.com");
    const o = await sale(shops.NO, YEAR - 2, { customer, company: { name: "Muster AS", number: "123456789" } });
    expect(await erase(shops.NO, o.id)).toBe("restricted");
    const row = await orderRow(o.id);
    expect(row).toMatchObject({ customer_id: null, email: "kari@example.com", company_name: "Muster AS", anonymised_at: null });
    expect(row.restricted_at).not.toBeNull();
    expect(row.billing_address).toMatchObject({ name: "Kari Nordmann" });
    const events = (await db.query<{ data: { until: string } }>("select data from commerce.order_events where order_id = $1 and type = 'order.restricted'", [o.id])).rows;
    expect(events).toHaveLength(1);
    expect(events[0].data.until).toBe(`${YEAR - 2 + 5 + 1}-01-01`);
    expect(await erase(shops.NO, o.id)).toBe("already");
    expect((await db.query("select 1 from commerce.order_events where order_id = $1 and type = 'order.restricted'", [o.id])).rows).toHaveLength(1);
    // Restricting is not a status change: the sale is as it was.
    expect(row.status).toBe("paid");
  });

  it("refuses to anonymise a young sale by the schedule, and anonymises it the day its period ends, in the store's own time", async () => {
    const o = await sale(shops.NO, YEAR - 5);
    await rejects("select commerce.anonymise_order($1, $2, 'retention')", [shops.NO, o.id], /anonymise_not_due: the order is kept until/);
    await rejects("select commerce.anonymise_order($1, $2, 'weekly')", [shops.NO, o.id], /anonymise_mode/);
    const done = await sale(shops.NO, YEAR - 6);
    expect(await retire(shops.NO, done.id)).toBe("anonymised");
    expect(await retire(shops.NO, done.id)).toBe("already");
    // Another store's order is not found.
    await rejects("select commerce.anonymise_order($1, $2, 'retention')", [shops.SE, done.id], /no such order in this store/);
  });

  it("counts the period from the latest of placed, paid, refunded and the documents: a refund this year keeps an old sale", async () => {
    const o = await sale(shops.NO, YEAR - 9);
    expect(String(await scalar("select commerce.order_anchor($1)", [o.id]))).toContain(`${YEAR - 9}`);
    await refund(db, o.id, 2500);
    expect(String(await scalar("select commerce.order_anchor($1)", [o.id]))).toContain(`${YEAR}`);
    expect(await erase(shops.NO, o.id)).toBe("restricted");
    // The documents count too: a credit note issued late moves the anchor.
    const p = await sale(shops.NO, YEAR - 9);
    await refund(db, p.id, 1000);
    await age(p.id, YEAR - 9);
    await db.exec("alter table commerce.credit_notes disable trigger credit_notes_append_only");
    await db.query("update commerce.credit_notes set issued_on = make_date($2, 3, 1) where invoice_id in (select id from commerce.invoices where order_id = $1)", [p.id, YEAR - 1]);
    await db.exec("alter table commerce.credit_notes enable trigger credit_notes_append_only");
    expect(String(await scalar("select commerce.order_anchor($1)", [p.id]))).toContain(`${YEAR - 1}`);
  });

  it("anonymises an order that was never paid, or copied from another store, at once, and a cancelled order that was paid is a sale", async () => {
    const unpaid = await placeOrder(db, shops.NO, { lines: [{ sku: "U", unit: 5000 }], email: "unpaid@example.com", pay: false });
    expect(await scalar("select commerce.order_class($1)", [unpaid.id])).toBe("unpaid");
    expect(await erase(shops.NO, unpaid.id)).toBe("anonymised");
    expect(await orderRow(unpaid.id)).toMatchObject({ email: "[removed]", billing_address: {}, shipping_address: {}, company_name: null, status: "pending_payment" });

    const copied = await placeOrder(db, shops.NO, { lines: [{ sku: "C", unit: 5000 }], email: "copied@example.com", copied: true });
    expect(await scalar("select commerce.order_class($1)", [copied.id])).toBe("copied");
    expect(await erase(shops.NO, copied.id)).toBe("anonymised");
    expect((await orderRow(copied.id)).email).toBe("[removed]");
    // A copied order has no events of its own, so the function wrote none.
    expect((await db.query("select 1 from commerce.order_events where order_id = $1", [copied.id])).rows).toHaveLength(0);

    const cancelledUnpaid = await placeOrder(db, shops.NO, { lines: [{ sku: "X", unit: 5000 }], pay: false });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [cancelledUnpaid.id]);
    expect(await scalar("select commerce.order_class($1)", [cancelledUnpaid.id])).toBe("unpaid");

    const cancelledPaid = await sale(shops.NO, YEAR - 1);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [cancelledPaid.id]);
    expect(await scalar("select commerce.order_class($1)", [cancelledPaid.id])).toBe("sale");
    expect(await erase(shops.NO, cancelledPaid.id)).toBe("restricted");
  });

  it("schedules an unpaid order after thirty days, and a host's order by its own, longer period", async () => {
    const unpaid = await placeOrder(db, shops.NO, { lines: [{ sku: "U2", unit: 5000 }], pay: false });
    await rejects("select commerce.anonymise_order($1, $2, 'retention')", [shops.NO, unpaid.id], /anonymise_not_due/);
    await db.query("update commerce.orders set placed_at = now() - interval '31 days' where id = $1", [unpaid.id]);
    expect(await retire(shops.NO, unpaid.id)).toBe("anonymised");
    // Norway keeps a sale 5 years, a host's order 10: a host's sale of YEAR - 6 is still restricted, an ordinary one is anonymised.
    const plain = await sale(shops.NO, YEAR - 6);
    const host = await sale(shops.NO, YEAR - 6, { host: true });
    expect(await scalar("select commerce.order_anonymisable_on($1)", [plain.id])).not.toEqual(await scalar("select commerce.order_anonymisable_on($1)", [host.id]));
    expect(await erase(shops.NO, plain.id)).toBe("anonymised");
    expect(await erase(shops.NO, host.id)).toBe("restricted");
  });

  it("never lets a wrong rule go below five years: the floor is in the function, not only in the form", async () => {
    // A row written by hand with a one-year period for Finland (set_retention_rule() would refuse it).
    await db.query(
      `update commerce.retention_rules set valid_to = current_date - 1 where kind = 'bookkeeping' and country is null and valid_to is null`,
    ).catch(() => undefined);
    const o = await sale(shops.FI, YEAR - 3);
    await db.exec("alter table commerce.retention_rules disable trigger retention_rules_guard");
    await db.exec(
      `insert into commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, basis, checked_on, valid_from, enforced_by)
       values ('bookkeeping', 'FI', 12, 'months', 'end_of_year', 'a wrong rule typed by hand', 'read', current_date, current_date - 1, 'test')`,
    );
    await db.exec("alter table commerce.retention_rules enable trigger retention_rules_guard");
    expect(String(await scalar("select commerce.order_anonymisable_on($1)", [o.id]))).toContain(`${YEAR - 3 + 5 + 1}`);
    expect(await erase(shops.FI, o.id)).toBe("restricted");
    await db.exec("alter table commerce.retention_rules disable trigger retention_rules_guard");
    await db.exec("delete from commerce.retention_rules where kind = 'bookkeeping' and country = 'FI'");
    await db.exec("update commerce.retention_rules set valid_to = null where kind = 'bookkeeping' and country is null");
    await db.exec("alter table commerce.retention_rules enable trigger retention_rules_guard");
  });

  it("changes only the personal fields: numbers, dates, amounts, VAT, lines, payments, refunds and documents stay, and the order is never deleted", async () => {
    const o = await sale(shops.SE, YEAR - 9, {
      market: "DE", currency: "EUR", company: { name: "Muster GmbH", number: "HRB 1", vatNumber: "DE123456789" }, vatKind: "reverse_charge",
      lines: [{ sku: "EUR-1", unit: 12500 }], deliveryLabel: "Posten home", email: "buyer@muster.example",
    });
    await db.query(`update commerce.orders set delivery = jsonb_build_object('label', 'Posten home', 'serviceId', 'home', 'postalCode', '0182') where id = $1`, [o.id]).catch(() => undefined);
    await refund(db, o.id, 1000);
    await age(o.id, YEAR - 9);
    const before = await orderRow(o.id);
    const lines = (await db.query("select * from commerce.order_lines where order_id = $1 order by sku", [o.id])).rows;
    const payments = (await db.query("select id, amount_minor, currency, status from commerce.payments where order_id = $1", [o.id])).rows;
    const invoice = await one<Record<string, any>>("select id, document_number, total_minor, tax_minor, snapshot, issued_on from commerce.invoices where order_id = $1", [o.id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const credit = (await db.query("select id, document_number, total_minor, snapshot from commerce.credit_notes where invoice_id = $1", [invoice.id])).rows;
    expect(await retire(shops.SE, o.id)).toBe("anonymised");
    const after = await orderRow(o.id);
    const personal = ["email", "billing_address", "shipping_address", "company_name", "organisation_number", "vat_treatment", "delivery", "customer_id", "anonymised_at"];
    for (const col of Object.keys(before).filter((c) => !personal.includes(c))) expect([col, after[col]]).toEqual([col, before[col]]);
    expect(after).toMatchObject({ email: "[removed]", billing_address: {}, shipping_address: {}, company_name: null, organisation_number: null, customer_id: null });
    expect(after.anonymised_at).not.toBeNull();
    // The VAT treatment keeps its kind, reason, relief and the seller; the buyer's number and VIES's answer go.
    expect(before.vat_treatment.buyerVatNumber).toBe("DE123456789");
    expect(after.vat_treatment).toMatchObject({ kind: "reverse_charge", reason: "reverse_charge", buyerVatNumber: null, sellerVatNumber: before.vat_treatment.sellerVatNumber });
    expect(after.vat_treatment.vies).toMatchObject({ status: "valid", registeredName: null, registeredAddress: null });
    if (before.delivery?.postalCode) expect(after.delivery).toEqual({ label: "Posten home", serviceId: "home" });
    expect((await db.query("select * from commerce.order_lines where order_id = $1 order by sku", [o.id])).rows).toEqual(lines);
    expect((await db.query("select id, amount_minor, currency, status from commerce.payments where order_id = $1", [o.id])).rows).toEqual(payments);
    expect(await one("select id, document_number, total_minor, tax_minor, snapshot, issued_on from commerce.invoices where order_id = $1", [o.id])).toEqual(invoice);
    expect((await db.query("select id, document_number, total_minor, snapshot from commerce.credit_notes where invoice_id = $1", [invoice.id])).rows).toEqual(credit);
    // An invoice's own anonymising is the documents' function's, and an erasure leaves it alone.
    expect(invoice.snapshot.buyer.name).not.toBe("[removed]");
    expect((await db.query("select data from commerce.order_events where order_id = $1 and type = 'order.anonymised'", [o.id])).rows).toEqual([{ data: { mode: "retention", was_restricted: false } }]);
    // Never deleted (D141).
    await rejects("delete from commerce.orders where id = $1", [o.id], /order_number\.deleted/);
    await rejects("update commerce.orders set number = 'X-1' where id = $1", [o.id], /order_number\.changed/);
    // The marker and the date cannot disagree.
    await rejects("update commerce.orders set email = 'back@example.com' where id = $1", [o.id], /orders_anonymised/);
    await rejects("update commerce.orders set anonymised_at = now() where id = $1", [(await sale(shops.SE, YEAR - 1)).id], /orders_anonymised/);
  });

  it("removes the free text staff typed (a refund's reason, an event's reason or note) with the order, and still refuses every other change to an event", async () => {
    const o = await sale(shops.NO, YEAR - 9, { email: "kari@example.com" });
    const refundId = await refund(db, o.id, 500);
    await db.query("update commerce.refunds set reason = 'Kari Hansen phoned, wants money back' where id = $1", [refundId]);
    const stripeRefund = await refund(db, o.id, 100);
    await db.query("update commerce.refunds set reason = 'Refunded in Stripe' where id = $1", [stripeRefund]);
    await db.query(
      `insert into commerce.order_events (store_id, order_id, type, data, actor) values
        ($1, $2, 'order.cancelled_by_staff', '{"reason":"Kari Hansen asked us to","refunded":500}', 'staff'),
        ($1, $2, 'note.added', '{"note":"Kari is a friend of the owner","by":"someone"}', 'staff')`,
      [shops.NO, o.id],
    );
    await age(o.id, YEAR - 9);
    expect(await retire(shops.NO, o.id)).toBe("anonymised");
    expect(await scalar("select reason from commerce.refunds where id = $1", [refundId])).toBe("[removed]");
    expect(await scalar("select reason from commerce.refunds where id = $1", [stripeRefund])).toBe("Refunded in Stripe");
    const events = (await db.query<{ type: string; data: Record<string, unknown> }>("select type, data from commerce.order_events where order_id = $1 and type in ('order.cancelled_by_staff', 'note.added') order by id", [o.id])).rows;
    expect(events.map((e) => e.data)).toEqual([{ refunded: 500 }, { by: "someone" }]);
    expect(JSON.stringify(events)).not.toContain("Kari");
    // Outside the anonymising path an event is as append-only as before (the anonymising path itself may remove only those two keys).
    await rejects("update commerce.order_events set data = '{}' where order_id = $1 and type = 'note.added'", [o.id], /append-only/);
    await rejects("update commerce.order_events set type = 'note.edited' where order_id = $1", [o.id], /append-only/);
    await rejects("delete from commerce.order_events where order_id = $1", [o.id], /append-only/);
  });

  it("anonymises a restricted order's withdrawal, return notes and VAT check with it, and records that it was restricted", async () => {
    const o = await sale(shops.DK, YEAR - 7);
    const lineId = (await one<{ id: string }>("select id from commerce.order_lines where order_id = $1", [o.id])).id;
    const request = (
      await one<{ id: string }>("insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'Kari Nordmann', 'kari@example.com', 'web') returning id", [shops.DK, o.id])
    ).id;
    await db.query("insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shops.DK, request, lineId]);
    await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [request]);
    const ret = await one<{ id: string }>(
      "insert into commerce.returns (store_id, order_id, kind, status, reason_note, staff_note) values ($1, $2, 'return', 'requested', 'It was the wrong colour, call Kari', 'Kari phoned from 99887766') returning id",
      [shops.DK, o.id],
    );
    await db.query("update commerce.returns set status = 'declined', decision_note = 'Used goods, see mail with Kari' where id = $1", [ret.id]);
    expect(await erase(shops.DK, o.id)).toBe("anonymised"); // YEAR - 7 in Denmark is past its 5 years
    expect(await one("select name, email, status, confirmed_at is not null as confirmed from commerce.withdrawal_requests where id = $1", [request])).toEqual({ name: "[removed]", email: "[removed]", status: "confirmed", confirmed: true });
    expect(await one("select reason_note, decision_note, staff_note, status from commerce.returns where id = $1", [ret.id])).toEqual({ reason_note: "[removed]", decision_note: "[removed]", staff_note: "[removed]", status: "declined" });

    // A restricted order keeps them until the order is anonymised.
    const kept = await sale(shops.DK, YEAR - 2);
    const keptRet = await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status, reason_note) values ($1, $2, 'return', 'requested', 'Kari wrote this') returning id", [shops.DK, kept.id]);
    expect(await erase(shops.DK, kept.id)).toBe("restricted");
    expect(await scalar("select reason_note from commerce.returns where id = $1", [keptRet.id])).toBe("Kari wrote this");
    await db.query("update commerce.orders set placed_at = make_timestamptz($2, 3, 1, 0, 0, 0, 'UTC') where id = $1", [kept.id, YEAR - 9]);
    await db.query("update commerce.payments set created_at = make_timestamptz($2, 3, 1, 0, 0, 0, 'UTC'), updated_at = make_timestamptz($2, 3, 1, 0, 0, 0, 'UTC') where order_id = $1", [kept.id, YEAR - 9]);
    await db.exec("alter table commerce.invoices disable trigger invoices_append_only");
    await db.query("update commerce.invoices set issued_on = make_date($2, 3, 1) where order_id = $1", [kept.id, YEAR - 9]);
    await db.exec("alter table commerce.invoices enable trigger invoices_append_only");
    expect(await retire(shops.DK, kept.id)).toBe("anonymised");
    expect(await scalar("select reason_note from commerce.returns where id = $1", [keptRet.id])).toBe("[removed]");
    expect(await one("select data from commerce.order_events where order_id = $1 and type = 'order.anonymised'", [kept.id])).toEqual({ data: { mode: "retention", was_restricted: true } });
  });

  it("anonymises the check of a buyer's VAT number with its order, unless another order or cart still uses it", async () => {
    const o = await placeOrder(db, shops.DE, { lines: [{ sku: "VC", unit: 10000 }], market: "DE", currency: "EUR", pay: "pending-only", company: { name: "Muster GmbH", vatNumber: "DE123456789" } });
    const check = (
      await one<{ id: string }>(
        `insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source, name, address)
         values ($1, 'buyer', 'DE123456789', 'DE', 'valid', 'vies', 'Muster GmbH', 'Hauptstrasse 1, Berlin') returning id`,
        [shops.DE],
      )
    ).id;
    await db.query("update commerce.orders set vat_check_id = $2 where id = $1", [o.id, check]);
    await db.query("select commerce.complete_order_payment($1::uuid, 'cs_vc')", [o.id]);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [o.id]);
    await age(o.id, YEAR - 10);
    expect(await retire(shops.DE, o.id)).toBe("anonymised");
    expect(await one("select number, name, address, status, country_prefix from commerce.vat_checks where id = $1", [check])).toEqual({ number: "DE**", name: null, address: null, status: "valid", country_prefix: "DE" });
  });

  it("anonymises the due orders of a store by the schedule: oldest first, a batch at a time, never for a future day, and again does nothing", async () => {
    const store = await createInvoiceStore(db, "gdpr-batch", { country: "NO" });
    const dues = [await sale(store, YEAR - 8), await sale(store, YEAR - 7), await sale(store, YEAR - 6)];
    const young = await sale(store, YEAR - 2);
    const unpaid = await placeOrder(db, store, { lines: [{ sku: "B", unit: 100 }], pay: false });
    await db.query("update commerce.orders set placed_at = now() - interval '40 days' where id = $1", [unpaid.id]);
    // The store's own day, not the database's: in Oslo it is already tomorrow for the last hours of the UTC day.
    await rejects("select commerce.anonymise_expired_orders($1, commerce.store_day($1::uuid, now()) + 1)", [store], /anonymise_today/);
    await rejects("select commerce.anonymise_expired_orders($1, null)", [store], /anonymise_today/);
    expect(await scalar("select commerce.anonymise_expired_orders($1, current_date, 2)", [store])).toBe(2);
    expect((await orderRow(dues[0].id)).anonymised_at).not.toBeNull();
    expect((await orderRow(dues[1].id)).anonymised_at).not.toBeNull();
    expect((await orderRow(dues[2].id)).anonymised_at).toBeNull();
    expect(await scalar("select commerce.anonymise_expired_orders($1, current_date)", [store])).toBe(2);
    expect(await scalar("select commerce.anonymise_expired_orders($1, current_date)", [store])).toBe(0);
    expect((await orderRow(young.id)).email).toBe("kari@example.com");
    expect((await orderRow(unpaid.id)).email).toBe("[removed]");
    // An earlier day is allowed and anonymises less: a sale of YEAR - 6 is due on 1 January of YEAR only from then.
    const other = await createInvoiceStore(db, "gdpr-batch-2", { country: "NO" });
    const o = await sale(other, YEAR - 6);
    expect(await scalar("select commerce.anonymise_expired_orders($1, make_date($2, 12, 31))", [other, YEAR - 1])).toBe(0);
    expect(await scalar("select commerce.anonymise_expired_orders($1, current_date)", [other])).toBe(1);
    expect((await orderRow(o.id)).anonymised_at).not.toBeNull();
  });

  it("scales: a store with many old orders is scanned through its indexes and each run is bounded", async () => {
    const store = await createInvoiceStore(db, "gdpr-big", { country: "NO" });
    await db.query(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
       select $1, 'BIG-' || g, 'NO', 'NOK', 'nb-NO', 'big' || g || '@example.com', 'paid', 100, 0, 0, 20, 100, '{"a":1}', '{"a":1}', make_timestamptz($2, 6, 1, 0, 0, 0, 'UTC')
         from generate_series(1, 400) g`,
      [store, YEAR - 12],
    );
    const started = Date.now();
    expect(await scalar("select commerce.anonymise_expired_orders($1, current_date, 150)", [store])).toBe(150);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await scalar("select count(*)::int from commerce.orders where store_id = $1 and anonymised_at is null", [store])).toBe(250);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The immutability rules of other units give way to the anonymising path, and only to it
// ---------------------------------------------------------------------------------------------------------------------------------

describe("the rules other units wrote still hold outside the anonymising path", () => {
  let paid: { id: string; number: string };
  let copied: { id: string };
  let request: string;
  let ended: string;
  let live: string;
  let check: string;

  beforeAll(async () => {
    const store = shops.NO;
    paid = await sale(store, YEAR - 1, { market: "DE", currency: "EUR", company: { name: "Muster GmbH", vatNumber: "DE123456789" } });
    copied = await placeOrder(db, store, { lines: [{ sku: "COP", unit: 100 }], copied: true });
    const lineId = (await one<{ id: string }>("select id from commerce.order_lines where order_id = $1", [paid.id])).id;
    request = (await one<{ id: string }>("insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'Kari', 'kari@example.com', 'web') returning id", [store, paid.id])).id;
    await db.query("insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, 1)", [store, request, lineId]);
    await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [request]);
    ended = (await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status, reason_note) values ($1, $2, 'return', 'requested', 'a note') returning id", [store, paid.id])).id;
    await db.query("update commerce.returns set status = 'declined', decision_note = 'declined' where id = $1", [ended]);
    live = (await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status, reason_note) values ($1, $2, 'return', 'requested', 'a live note') returning id", [store, paid.id])).id;
    check = (await one<{ id: string }>("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source, name, address) values ($1, 'buyer', 'DE987654321', 'DE', 'valid', 'vies', 'N', 'A') returning id", [store])).id;
  });

  const on = () => db.exec("select set_config('commerce.anonymising', 'on', false)");
  const off = () => db.exec("select set_config('commerce.anonymising', '', false)");

  it("refuses the same changes outside the function: VAT treatment, a copied order, a withdrawal's name, a return's notes, a VAT check", async () => {
    await rejects("update commerce.orders set vat_treatment = '{}'::jsonb where id = $1", [paid.id], /order_vat_frozen/);
    await rejects("update commerce.orders set email = 'x@example.com' where id = $1", [copied.id], /copied_order/);
    await rejects("update commerce.withdrawal_requests set name = 'X' where id = $1", [request], /withdrawal_fixed/);
    await rejects("update commerce.withdrawal_requests set email = 'x@example.com' where id = $1", [request], /withdrawal_fixed/);
    await rejects("update commerce.returns set reason_note = 'x' where id = $1", [ended], /return_ended/);
    await rejects("update commerce.vat_checks set name = 'x' where id = $1", [check], /vat_check_immutable/);
  });

  it("lets only those fields change inside it, and still refuses everything else", async () => {
    await on();
    try {
      await db.query("update commerce.orders set vat_treatment = jsonb_set(coalesce(vat_treatment, '{}'::jsonb), '{buyerVatNumber}', 'null') where id = $1", [paid.id]);
      await db.query("update commerce.orders set email = '[removed]', billing_address = '{}', shipping_address = '{}', company_name = null, organisation_number = null, anonymised_at = now() where id = $1", [copied.id]);
      await db.query("update commerce.withdrawal_requests set name = '[removed]', email = '[removed]' where id = $1", [request]);
      await db.query("update commerce.returns set reason_note = '[removed]', decision_note = '[removed]', staff_note = '[removed]', refund_note = null, label_url = null where id = $1", [ended]);
      await db.query("update commerce.returns set reason_note = '[removed]' where id = $1", [live]);
      await db.query("update commerce.vat_checks set name = null, address = null, number = 'DE**' where id = $1", [check]);
      // Everything else is refused: the VAT kind and amounts, a copied order's money and origin, a withdrawal's channel and status, a return's status and refund, a check's answer.
      await rejects("update commerce.orders set vat_kind = 'ioss' where id = $1", [paid.id], /order_vat_frozen/);
      await rejects("update commerce.orders set vat_relief_minor = 5 where id = $1", [paid.id], /order_vat_frozen|orders_/);
      await rejects("update commerce.orders set total_minor = 1, subtotal_minor = 1 where id = $1", [copied.id], /copied_order/);
      await rejects("update commerce.orders set copied_from = null where id = $1", [copied.id], /copied_order/);
      await rejects("update commerce.withdrawal_requests set channel = 'email' where id = $1", [request], /withdrawal_fixed/);
      await rejects("update commerce.withdrawal_requests set status = 'expired' where id = $1", [request], /withdrawal_confirmed/);
      await rejects("update commerce.returns set status = 'closed' where id = $1", [ended], /return_fixed/);
      await rejects("update commerce.returns set refund_minor = 5 where id = $1", [live], /return_fixed/);
      await rejects("update commerce.vat_checks set status = 'invalid' where id = $1", [check], /vat_check_immutable/);
    } finally {
      await off();
    }
    // And the setting is off again, so the same change is refused once more.
    await rejects("update commerce.returns set reason_note = 'back' where id = $1", [ended], /return_ended/);
    expect(await scalar("select current_setting('commerce.anonymising', true)")).toBe("");
  });

  it("leaves the invoice rules as they were: only commerce.anonymise_expired_documents() anonymises a document", async () => {
    await rejects("update commerce.invoices set snapshot = '{}'::jsonb where order_id = $1", [paid.id], /append-only/);
    await off();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Copying a store leaves restricted and anonymised orders out
// ---------------------------------------------------------------------------------------------------------------------------------

describe("copying a store", () => {
  it("copies an ordinary order and leaves out a restricted one and an anonymised one", async () => {
    const owner = await scalar<string>("insert into commerce.accounts (email) values ('copy-owner-gdpr@example.com') returning id");
    const src = await createInvoiceStore(db, "gdpr-copy-src", { country: "NO" });
    const ordinary = await sale(src, YEAR - 1);
    const restricted = await sale(src, YEAR - 1);
    const anonymised = await sale(src, YEAR - 7);
    expect(await erase(src, restricted.id)).toBe("restricted");
    expect(await erase(src, anonymised.id)).toBe("anonymised");
    const copy = await scalar<string>("select commerce.duplicate_store($1, 'gdpr-copy-dst', 'Dst', $2)", [src, owner]);
    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    const result = await one<{ handled: number; copied: number }>("select handled::int, copied::int from commerce.copy_orders($1, $2, null, 10)", [src, copy]);
    expect(result).toEqual({ handled: 1, copied: 1 });
    expect((await db.query<{ number: string }>("select number from commerce.orders where store_id = $1", [copy])).rows).toEqual([{ number: `C-${ordinary.number}` }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// What the migrations say
// ---------------------------------------------------------------------------------------------------------------------------------

describe("what the migrations and the registries say", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => /_gdpr(_rules|_audit)?\.sql$/.test(f));

  it("has three migration files of this unit", () => {
    expect(files).toHaveLength(3);
  });

  it("has no DELETE, TRUNCATE or DROP in anything it adds (the production migration tool cancels them): deletion is application code", () => {
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect([file, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|TRIGGER|INDEX|COLUMN|CONSTRAINT|SCHEMA|POLICY|VIEW)\b/i.test(sql)]).toEqual([file, false]);
    }
  });

  it("gives every function it adds a fixed search path", async () => {
    const { rows } = await db.query<{ proname: string; config: string[] | null }>(
      `select p.proname, p.proconfig as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'commerce' and p.proname = any($1)`,
      [["retention_rules_guard", "retention_rule", "set_retention_rule", "verify_retention_rule", "privacy_requests_rules", "order_class", "order_anchor", "order_anonymisable_on", "anonymise_order", "anonymise_expired_orders"]],
    );
    expect(rows).toHaveLength(10);
    for (const r of rows) expect([r.proname, JSON.stringify(r.config)]).toEqual([r.proname, '["search_path=\\"\\""]']);
  });

  it("keeps the audit areas of the TypeScript and the database function equal for the new actions", async () => {
    for (const action of ["customer.data_exported", "customer.erased", "privacy.request_logged", "privacy.request_extended", "privacy.request_refused", "privacy.retention_applied", "retention.run", "retention.rule_set", "retention.rule_verified"]) {
      expect([action, await scalar("select commerce.audit_area_of($1)", [action])]).toEqual([action, areaOfAction(action)]);
    }
    expect(areaOfAction("privacy.request_logged")).toBe("customers");
    expect(areaOfAction("retention.rule_set")).toBe("platform");
    expect(areaOfAction("customer.erased")).toBe("customers");
  });

  it("has the plan comparison row, and no table or column of this unit is missing from the schema", async () => {
    expect(await scalar("select count(*)::int from commerce.plan_features where name = 'GDPR data export and erasure and a data retention schedule' and category = 'Operations' and position = 484")).toBe(1);
    for (const [table, column] of [["orders", "restricted_at"], ["orders", "anonymised_at"], ["customer_sessions", "verified_at"], ["privacy_requests", "plan_summary"], ["retention_rules", "verified_by"]]) {
      expect(await scalar("select count(*)::int from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = $2", [table, column])).toBe(1);
    }
    expect(await scalar("select is_nullable from information_schema.columns where table_schema = 'commerce' and table_name = 'customer_sessions' and column_name = 'verified_at'")).toBe("NO");
  });

  it("has row-level security on both new tables, like every commerce table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relnamespace = 'commerce'::regnamespace and relname in ('retention_rules', 'privacy_requests')");
    expect(rows.map((r) => [r.relname, r.relrowsecurity]).sort()).toEqual([["privacy_requests", true], ["retention_rules", true]]);
  });
});
