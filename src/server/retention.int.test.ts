import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { RETENTION_KINDS } from "@/lib/retention";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));

const fx = await import("./invoice-test-fixture");
const { ageOrder } = await import("./privacy-fixture");
const retention = await import("./retention");
const { sendEmail } = await import("./email");
const { auditRows } = await import("./trust-fixtures");
const { sha256 } = await import("./customers");

type Row = Record<string, unknown>;

/**
 * The retention schedule (D162, G11): for each rule one record just inside its period and one just outside, `runRetention()` removes or anonymises
 * exactly the outside ones, returns the counts, is idempotent, isolates a failing step and honours batches. The clock is the real one and the
 * data is made old: the database's own functions judge by its clock, which never runs ahead.
 */

const NOW = new Date();
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const monthsAgo = (months: number) => {
  const d = new Date(NOW.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
};

let main: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  main = await fx.makeStore("retention");
}, 60_000);

afterAll(async () => {
  await closeDb();
});

const anonymised = async (orderId: string): Promise<boolean> => Boolean((await db().execute<Row>(sql`select anonymised_at from commerce.orders where id = ${orderId}::uuid`))[0].anonymised_at);
const exists = async (query: ReturnType<typeof sql>) => (await db().execute(query)).length > 0;

describe("the seller's country's period decides when a sale's personal data goes (orders and documents)", () => {
  // A sale of year Y goes on 1 January of Y + years + 1: NO and DK five years, SE seven, DE eight, any other country ten.
  const cases: { country: string | null; years: number; outside: string; inside: string }[] = [
    { country: "NO", years: 5, outside: "2020-12-31", inside: "2021-01-01" },
    { country: "DK", years: 5, outside: "2020-12-31", inside: "2021-01-01" },
    { country: "SE", years: 7, outside: "2018-12-31", inside: "2019-01-01" },
    { country: "DE", years: 8, outside: "2017-12-31", inside: "2018-01-01" },
    { country: "FR", years: 10, outside: "2015-12-31", inside: "2016-01-01" },
  ];
  const made: { country: string | null; outside: string; inside: string; invoice: string; store: Awaited<ReturnType<typeof fx.makeStore>> }[] = [];

  beforeAll(async () => {
    for (const c of cases) {
      const store = await fx.makeStore(`ret-${c.country!.toLowerCase()}`);
      const outside = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `out-${fx.unique("o")}@example.com` });
      const inside = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `in-${fx.unique("i")}@example.com` });
      await ageOrder(outside.orderId, c.outside);
      await ageOrder(inside.orderId, c.inside);
      made.push({ country: c.country, outside: outside.orderId, inside: inside.orderId, invoice: (await fx.invoiceOf(store.storeId, outside.orderId))!.id, store });
      // The seller's country is what decides the period (the store was made, and its invoices issued, as a Norwegian seller).
      await db().execute(sql`update commerce.stores set country = ${c.country} where id = ${store.storeId}::uuid`);
    }
  }, 120_000);

  it("anonymises exactly the sales past the period, with their documents, and keeps the rest", async () => {
    const run = await retention.runRetention(NOW);
    expect(run.errors).toEqual([]);
    for (const m of made) {
      expect(await anonymised(m.outside), `${m.country} outside`).toBe(true);
      expect(await anonymised(m.inside), `${m.country} inside`).toBe(false);
      const [doc] = await db().execute<Row>(sql`select anonymised_at from commerce.invoices where id = ${m.invoice}::uuid`);
      expect(doc.anonymised_at, `${m.country} invoice`).not.toBeNull();
      const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where order_id = ${m.inside}::uuid and anonymised_at is not null`);
      expect(kept.n).toBe(0);
    }
    expect(run.counts.orders).toBeGreaterThanOrEqual(cases.length);
    expect(run.counts.documents).toBeGreaterThanOrEqual(cases.length);
  });

  it("is idempotent: a second run changes nothing, and nothing was deleted", async () => {
    const second = await retention.runRetention(NOW);
    expect(second.counts.orders).toBe(0);
    expect(second.counts.documents).toBe(0);
    for (const m of made) {
      expect(await exists(sql`select 1 from commerce.orders where id = ${m.outside}::uuid`)).toBe(true);
      expect(await exists(sql`select 1 from commerce.orders where id = ${m.inside}::uuid`)).toBe(true);
    }
  });

  it("keeps a host's order under its own, longer period, and an order never paid for 30 days", async () => {
    const store = made[0].store;
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${fx.unique("h")}@example.com`}, 'Host') returning id`);
    const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name, commission_bps) values (${store.storeId}::uuid, ${String(account.id)}::uuid, 'Host', 1000) returning id`);
    const hostOld = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const hostYoung = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    for (const o of [hostOld, hostYoung]) await db().execute(sql`update commerce.orders set host_id = ${String(host.id)}::uuid where id = ${o.orderId}::uuid`);
    // Norway's five years would let both go; a host's order is kept ten (DAC7).
    await ageOrder(hostOld.orderId, "2015-12-31");
    await ageOrder(hostYoung.orderId, "2016-01-01");
    const unpaidOld = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { pay: false });
    const unpaidYoung = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { pay: false });
    await db().execute(sql`update commerce.orders set placed_at = ${ago(31)}::timestamptz where id = ${unpaidOld.orderId}::uuid`);
    await db().execute(sql`update commerce.orders set placed_at = ${ago(29)}::timestamptz where id = ${unpaidYoung.orderId}::uuid`);
    await retention.runRetention(NOW);
    expect(await anonymised(hostOld.orderId)).toBe(true);
    expect(await anonymised(hostYoung.orderId)).toBe(false);
    expect(await anonymised(unpaidOld.orderId)).toBe(true);
    expect(await anonymised(unpaidYoung.orderId)).toBe(false);
    // An unpaid order's number and amounts stay (the sequence has no gaps).
    const [row] = await db().execute<Row>(sql`select number, total_minor from commerce.orders where id = ${unpaidOld.orderId}::uuid`);
    expect(row.number).toBe(unpaidOld.number);
    expect(Number(row.total_minor)).toBe(unpaidOld.total);
  });
});

describe("the small tables: one record inside the period, one outside", () => {
  it("blanks old email bodies (the row and its key stay), security emails after a week, and evidence emails wait for their order", async () => {
    const mail = async (kind: string, createdAt: string, orderId: string | null = null) => {
      const key = `ret-${randomUUID()}`;
      await db().execute(sql`
        insert into commerce.email_messages (store_id, kind, idempotency_key, to_address, subject, html, text, order_id, created_at)
        values (${main.storeId}::uuid, ${kind}, ${key}, 'someone@example.com', 'Hello Kari', '<p>Kari</p>', 'Kari', ${orderId}::uuid, ${createdAt}::timestamptz)`);
      return key;
    };
    const blank = async (key: string) => String((await db().execute<Row>(sql`select to_address from commerce.email_messages where idempotency_key = ${key}`))[0].to_address) === "[removed]";
    const old = await mail("order.confirmation", monthsAgo(13));
    const recent = await mail("order.confirmation", monthsAgo(11));
    const codeOld = await mail("account.code", ago(8));
    const codeRecent = await mail("account.code", ago(6));
    const order = await fx.paidOrder(main, [["DEMO-MUG-WHITE", 1]]);
    const evidence = await mail("return.acknowledgement", monthsAgo(14), order.orderId);
    const run = await retention.runRetention(NOW);
    expect(await blank(old)).toBe(true);
    expect(await blank(recent)).toBe(false);
    expect(await blank(codeOld)).toBe(true);
    expect(await blank(codeRecent)).toBe(false);
    // The evidence waits for its order: still there while the order is young.
    expect(await blank(evidence)).toBe(false);
    const [kept] = await db().execute<Row>(sql`select subject, html, text, idempotency_key from commerce.email_messages where idempotency_key = ${old}`);
    expect(kept).toMatchObject({ subject: "[removed]", html: "", text: "", idempotency_key: old });
    expect(run.counts.email_bodies + run.counts.security_emails).toBeGreaterThanOrEqual(2);
    // A blanked email is not blanked again (and the sent one still cannot be sent twice).
    expect(await sendEmail({ storeId: main.storeId, kind: "order.confirmation", to: "x@example.com", email: { subject: "again", html: "", text: "" }, fromName: "Shop", idempotencyKey: old })).toBe("duplicate");
    // When its order is anonymised the evidence goes too.
    await ageOrder(order.orderId, "2015-01-01");
    await retention.runRetention(NOW);
    expect(await blank(evidence)).toBe(true);
  });

  it("clears the person from carts 90 days after they ended, and the postal code from quotes 30 days after they expired", async () => {
    const cart = async (status: "open" | "converted", at: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, status, expires_at, updated_at, company_name, organisation_number, vat_number, affiliate_code)
        values (${main.storeId}::uuid, 'NO', 'NOK', 'nb-NO', ${status}, ${at}::timestamptz, ${at}::timestamptz, 'Fjord AS', '912345678', 'NO912345678MVA', 'abc123') returning id`);
      return String(row.id);
    };
    const quote = async (cartId: string, expires: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.delivery_quotes (store_id, cart_id, carrier, service_id, label, amount_minor, currency, country, postal_code, pickup_points, expires_at)
        values (${main.storeId}::uuid, ${cartId}::uuid, 'bring', 'home', 'Home', 5900, 'NOK', 'NO', '0368', '[{"name":"Kiosk"}]'::jsonb, ${expires}::timestamptz) returning id`);
      return String(row.id);
    };
    const oldOpen = await cart("open", ago(91));
    const youngOpen = await cart("open", ago(89));
    const oldDone = await cart("converted", ago(91));
    const qOld = await quote(oldOpen, ago(31));
    const qYoung = await quote(youngOpen, ago(29));
    const run = await retention.runRetention(NOW);
    const person = async (id: string) => (await db().execute<Row>(sql`select company_name, organisation_number, vat_number, affiliate_code from commerce.carts where id = ${id}::uuid`))[0];
    expect(await person(oldOpen)).toEqual({ company_name: null, organisation_number: null, vat_number: null, affiliate_code: null });
    expect(await person(oldDone)).toEqual({ company_name: null, organisation_number: null, vat_number: null, affiliate_code: null });
    expect(await person(youngOpen)).toMatchObject({ company_name: "Fjord AS", vat_number: "NO912345678MVA" });
    const postal = async (id: string) => (await db().execute<Row>(sql`select postal_code, pickup_points from commerce.delivery_quotes where id = ${id}::uuid`))[0];
    expect(await postal(qOld)).toEqual({ postal_code: "", pickup_points: [] });
    expect(await postal(qYoung)).toMatchObject({ postal_code: "0368" });
    expect(run.counts.carts).toBeGreaterThanOrEqual(2);
    expect(run.counts.delivery_quotes).toBeGreaterThanOrEqual(1);
    // The cart rows are all still there.
    expect(await exists(sql`select 1 from commerce.carts where id = ${oldOpen}::uuid`)).toBe(true);
  });

  it("deletes sign-in codes a week after they expired and sessions a month after, and empties payment payloads after 90 days (the row stays)", async () => {
    const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${main.storeId}::uuid, ${`sess-${fx.unique("c")}@example.com`}) returning id`);
    const code = async (expires: string, tag: string) => {
      await db().execute(sql`insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values (${main.storeId}::uuid, ${`${tag}-${fx.unique("k")}@example.com`}, 'h', ${expires}::timestamptz)`);
      return tag;
    };
    await code(ago(8), "codeold");
    await code(ago(6), "codeyoung");
    const session = async (expires: string) => {
      const hash = sha256(randomUUID());
      await db().execute(sql`insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at) values (${main.storeId}::uuid, ${String(c.id)}::uuid, ${hash}, ${expires}::timestamptz)`);
      return hash;
    };
    const sOld = await session(ago(31));
    const sYoung = await session(ago(29));
    const hook = async (processed: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.webhook_events (store_id, provider, event_id, type, payload, processed_at)
        values (${main.storeId}::uuid, 'stripe', ${`evt_${randomUUID()}`}, 'checkout.session.completed', ${JSON.stringify({ customer_details: { email: "person@example.com", name: "Kari" } })}::jsonb, ${processed}::timestamptz) returning id`);
      return String(row.id);
    };
    const hOld = await hook(ago(91));
    const hYoung = await hook(ago(89));
    const run = await retention.runRetention(NOW);
    expect(await exists(sql`select 1 from commerce.customer_codes where email like 'codeold-%'`)).toBe(false);
    expect(await exists(sql`select 1 from commerce.customer_codes where email like 'codeyoung-%'`)).toBe(true);
    expect(await exists(sql`select 1 from commerce.customer_sessions where token_hash = ${sOld}`)).toBe(false);
    expect(await exists(sql`select 1 from commerce.customer_sessions where token_hash = ${sYoung}`)).toBe(true);
    const payload = async (id: string) => (await db().execute<Row>(sql`select payload from commerce.webhook_events where id = ${id}::bigint`))[0].payload;
    expect(await payload(hOld)).toEqual({});
    expect(JSON.stringify(await payload(hYoung))).toContain("person@example.com");
    expect(run.counts.customer_codes).toBeGreaterThanOrEqual(1);
    expect(run.counts.customer_sessions).toBeGreaterThanOrEqual(1);
    expect(run.counts.webhook_payloads).toBeGreaterThanOrEqual(1);
  });

  it("deletes the cookie consent log after 12 months, forgets a finished request's address after 30 days and the request after 24 months", async () => {
    const consent = async (created: string) => {
      const [row] = await db().execute<Row>(sql`insert into commerce.consents (store_id, visitor, choices, version, created_at) values (${main.storeId}::uuid, ${randomUUID()}::uuid, '{}'::jsonb, 'v1', ${created}::timestamptz) returning id`);
      return String(row.id);
    };
    const cOld = await consent(monthsAgo(13));
    const cYoung = await consent(monthsAgo(11));
    const request = async (completed: string, email: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.privacy_requests (store_id, kind, channel, status, subject_email, received_at, due_at, completed_at, outcome)
        values (${main.storeId}::uuid, 'export', 'staff', 'done', ${email}, ${completed}::timestamptz - interval '2 days', ${completed}::timestamptz, ${completed}::timestamptz, 'exported') returning id`);
      return String(row.id);
    };
    const r31 = await request(ago(31), `old-${fx.unique("p")}@example.com`);
    const r29 = await request(ago(29), `young-${fx.unique("p")}@example.com`);
    const r25m = await request(monthsAgo(25), `ancient-${fx.unique("p")}@example.com`);
    const r23m = await request(monthsAgo(23), `kept-${fx.unique("p")}@example.com`);
    const run = await retention.runRetention(NOW);
    expect(await exists(sql`select 1 from commerce.consents where id = ${cOld}::uuid`)).toBe(false);
    expect(await exists(sql`select 1 from commerce.consents where id = ${cYoung}::uuid`)).toBe(true);
    const email = async (id: string) => (await db().execute<Row>(sql`select subject_email from commerce.privacy_requests where id = ${id}::uuid`))[0]?.subject_email;
    expect(await email(r31)).toBeNull();
    expect(await email(r29)).toEqual(expect.stringContaining("young-"));
    expect(await exists(sql`select 1 from commerce.privacy_requests where id = ${r25m}::uuid`)).toBe(false);
    expect(await exists(sql`select 1 from commerce.privacy_requests where id = ${r23m}::uuid`)).toBe(true);
    expect(run.counts.consents).toBeGreaterThanOrEqual(1);
    expect(run.counts.privacy_requests).toBeGreaterThanOrEqual(1);
    expect(run.counts.privacy_request_contact).toBeGreaterThanOrEqual(1);
  });
});

describe("a store with a great many old orders (the size guard)", () => {
  /** Old paid orders by direct insert (the number guard is lifted for the one transaction, as the 1b tests lift theirs). */
  async function manyOrders(storeId: string, n: number, year: number) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.orders disable trigger orders_number_guard`);
      await tx.execute(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
        select ${storeId}::uuid, ${`BULK-${year}-`} || g, 'NO', 'NOK', 'nb-NO', 'bulk' || g || '@example.com', 'paid', 10000, 0, 0, 2000, 10000, '{"name":"X"}', '{"name":"X"}',
               make_timestamptz(${year}, 3, 1, 12, 0, 0, 'UTC') + (g || ' minutes')::interval
        from generate_series(1, ${n}) g`);
      await tx.execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, created_at, updated_at)
        select o.store_id, o.id, 'stripe', 'bulk_' || o.number, o.total_minor, 'NOK', 'captured', o.placed_at, o.placed_at
        from commerce.orders o where o.store_id = ${storeId}::uuid and o.number like ${`BULK-${year}-%`}`);
      await tx.execute(sql`alter table commerce.orders enable trigger orders_number_guard`);
    });
  }

  it("asks the due-day function of only as many orders as the batch holds, and of none that cannot be due", async () => {
    const store = await fx.makeStore("bulk");
    const today = (await db().execute<Row>(sql`select commerce.store_day(${store.storeId}::uuid, now())::text as d`))[0].d as string;
    // Old enough to be due under Norway's five years: a batch of 50 is taken from thousands, quickly (the candidates are read in order and the
    // function stops being asked at the limit; asking it of all of them took seconds each).
    await manyOrders(store.storeId, 3000, 2012);
    const started = Date.now();
    const [first] = await db().execute<Row>(sql`select commerce.anonymise_expired_orders(${store.storeId}::uuid, ${today}::date, 50) as n`);
    expect(Number(first.n)).toBe(50);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await exists(sql`select 1 from commerce.orders where store_id = ${store.storeId}::uuid and number like 'BULK-2012-%' and anonymised_at is null`)).toBe(true);
    // Orders too young to be due are not even candidates: thousands of them cost one index range, not thousands of calls.
    const young = await fx.makeStore("bulk-young");
    await manyOrders(young.storeId, 6000, new Date().getUTCFullYear() - 2);
    const quick = Date.now();
    const [none] = await db().execute<Row>(sql`select commerce.anonymise_expired_orders(${young.storeId}::uuid, ${today}::date, 5000) as n`);
    expect(Number(none.n)).toBe(0);
    expect(Date.now() - quick).toBeLessThan(3_000);
  }, 120_000);
});

describe("the run itself", () => {
  it("isolates a failing step, honours batches and never throws", async () => {
    const codes = async (n: number) => {
      for (let i = 0; i < n; i++) await db().execute(sql`insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values (${main.storeId}::uuid, ${`batch-${i}-${fx.unique("b")}@example.com`}, 'h', ${ago(20)}::timestamptz)`);
    };
    await codes(7);
    // A broken step is logged and the next one runs; the failure is in the result and the run returns.
    const broken = await retention.runRetention(NOW, { steps: { carts: async () => { throw new Error("boom"); } }, batch: 3 });
    expect(broken.errors).toEqual([{ step: "carts", message: "boom" }]);
    expect(broken.counts.carts).toBe(0);
    // Batches of three: seven codes are all removed in one run (three rounds), none left behind.
    expect(broken.counts.customer_codes).toBe(7);
    expect(await exists(sql`select 1 from commerce.customer_codes where email like 'batch-%'`)).toBe(false);
  });

  it("writes one platform entry with counts only, and one per store with anything removed", async () => {
    const entries = await auditRows(null, "retention.run");
    expect(entries.length).toBeGreaterThan(0);
    const details = JSON.stringify(entries[0].details);
    expect(details).toMatch(/orders/);
    expect(details).not.toMatch(/@/);
    expect(entries[0]).toMatchObject({ area: "platform" });
    const applied = await auditRows(made0(), "privacy.retention_applied");
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]).toMatchObject({ area: "customers" });
    expect(JSON.stringify(applied[0].details)).not.toMatch(/@/);
  });

  it("shows the schedule: every kind, its source and basis, and what no accountant has read", async () => {
    const overview = await retention.retentionOverview();
    const kinds = new Set(overview.rules.map((r) => r.kind));
    for (const k of RETENTION_KINDS) expect(kinds.has(k), k).toBe(true);
    expect(overview.rules.every((r) => r.source.length > 0 && r.checkedOn.length === 10 && r.basis.length > 0)).toBe(true);
    // The seeded rows are what nobody has read yet; a rule a platform admin later added and reviewed (below, and in earlier runs) is another row.
    expect(overview.rules.filter((r) => r.validFrom === "2000-01-01").every((r) => r.verifiedAt === null)).toBe(true);
    expect(overview.unverified).toBeGreaterThan(0);
    expect(overview.lastRuns.length).toBeGreaterThan(0);
  });
});

// The platform's own store of a run: the first made above (the audit rows of a store are those of the store the order lived in).
function made0(): string {
  return main.storeId;
}

describe("changing a period (the platform admin's page)", () => {
  it("adds a new rule with the old one closed (history kept), refuses a bookkeeping period under five years, and marks a rule reviewed once", async () => {
    const [admin] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`pa-${fx.unique("a")}@example.com`}, 'Admin', true) returning id`);
    const accountId = String(admin.id);
    // Rules are history and the database persists: the new ones start after the latest Finland has, however many runs came before.
    const latest = (await retention.retentionRules()).filter((r) => r.kind === "bookkeeping" && r.country === "FI").map((r) => r.validFrom).sort().pop();
    const year = (latest ? Number(latest.slice(0, 4)) : 2100) + 1;
    const at = (n: number) => `${year + n}-01-01`;
    const input = { kind: "bookkeeping" as const, country: "FI", periodValue: 72, periodUnit: "months" as const, countsFrom: "end_of_year" as const, source: "An accountant's note", sourceUrl: null, basis: "secondary" as const, checkedOn: "2026-10-04", validFrom: at(0), note: "" };
    expect(await retention.changeRetentionRule(accountId, input)).toMatchObject({ ok: true });
    expect(await retention.changeRetentionRule(accountId, { ...input, periodValue: 84, validFrom: at(1) })).toMatchObject({ ok: true });
    const rows = (await retention.retentionRules()).filter((r) => r.kind === "bookkeeping" && r.country === "FI" && r.validFrom >= at(0));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.periodValue === 72)).toMatchObject({ validFrom: at(0), validTo: at(1) });
    expect(rows.find((r) => r.periodValue === 84)?.validTo).toBeNull();
    expect(await retention.changeRetentionRule(accountId, { ...input, periodValue: 48, validFrom: at(2) })).toMatchObject({ ok: false });
    expect(await retention.changeRetentionRule(accountId, { ...input, validFrom: at(0) })).toMatchObject({ ok: false, problem: expect.stringContaining("start after") });
    expect(await retention.changeRetentionRule(accountId, { ...input, source: "  ", validFrom: at(3) })).toMatchObject({ ok: false });
    // The period that applies in a country on a day is the database's answer (before any rule of its own, the default's ten years).
    expect(await retention.retentionRule("bookkeeping", "FI", "2026-10-04")).toMatchObject({ periodValue: 120, countsFrom: "end_of_year" });
    expect(await retention.retentionRule("bookkeeping", "FI", `${year}-06-01`)).toMatchObject({ periodValue: 72 });
    const id = rows.find((r) => r.periodValue === 84)!.id;
    expect(await retention.verifyRetentionRule(accountId, id)).toEqual({ ok: true });
    expect(await retention.verifyRetentionRule(accountId, id)).toMatchObject({ ok: false });
    const audit = await auditRows(null, "retention.rule_set");
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect((await auditRows(null, "retention.rule_verified")).length).toBeGreaterThanOrEqual(1);
  });
});
