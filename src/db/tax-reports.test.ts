/* eslint-disable @typescript-eslint/no-explicit-any -- a snapshot is JSON and the tests read it as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildReturn, type RateLookup } from "@/lib/oss-return";
import { returnCsv } from "@/lib/tax-csv";
import { quarterPeriod } from "@/lib/tax-periods";
import { buildVatReport, parseDocGroup, type DocGroup } from "@/lib/tax-report";

import { createInvoiceStore, creditNotesOf, invoiceOf, one, placeOrder, refund, scalar } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * The VAT, OSS and IOSS reports' rules that live in SQL (D161, docs/wave-1c-reports.md 3): the ECB's rates and the export log are
 * append-only, an owner's rate has a reason and a past day, and `commerce.tax_document_groups()` is the one reader of documents: it opens
 * a snapshot for its buckets, line kinds, buyer type and stored conversion, and nothing personal. Against every migration applied to a real
 * Postgres (PGlite).
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

const groupsOf = async (store: string, from: string, to: string): Promise<DocGroup[]> =>
  (await db.query<Record<string, unknown>>("select * from commerce.tax_document_groups($1::uuid, $2::date, $3::date)", [store, from, to])).rows.map(parseDocGroup);

const today = (store: string) => scalar<string>(db, "select commerce.store_day($1::uuid, now())::text", [store]);
const plusDays = (day: string, n: number) => scalar<string>(db, "select ($1::date + $2::int)::text", [day, n]);

/** Documents are immutable; a test that needs one dated otherwise lifts the guard for a moment, as a migration could. */
async function redate(orderId: string, supplyDate: string | null, issuedOn?: string) {
  await db.query("alter table commerce.invoices disable trigger invoices_append_only");
  if (supplyDate) await db.query("update commerce.invoices set supply_date = $2 where order_id = $1", [orderId, supplyDate]);
  await db.query("alter table commerce.invoices enable trigger invoices_append_only");
  if (issuedOn) {
    await db.query("alter table commerce.credit_notes disable trigger credit_notes_append_only");
    await db.query("update commerce.credit_notes set issued_on = $2 where invoice_id = (select id from commerce.invoices where order_id = $1)", [orderId, issuedOn]);
    await db.query("alter table commerce.credit_notes enable trigger credit_notes_append_only");
  }
}

const account = async (email: string) => (await one<{ id: string }>(db, "insert into commerce.accounts (email) values ($1) returning id", [email])).id;

describe("the ECB's rates", () => {
  it("are stored once and never changed or removed: a stored rate is part of what a filed return rested on", async () => {
    await db.query("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-30', 'DKK', 7.4755), ('2026-09-30', 'SEK', 11.331)");
    expect(await scalar(db, "select rate::text from commerce.ecb_reference_rates where currency = 'DKK' and rate_date = '2026-09-30'")).toBe("7.475500");
    await rejects("update commerce.ecb_reference_rates set rate = 7.5 where currency = 'DKK'", [], /append-only/);
    await rejects("delete from commerce.ecb_reference_rates where currency = 'DKK'", [], /append-only/);
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-30', 'DKK', 7.5)", [], /duplicate key|primary key/);
    const upsert = await db.query("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-30', 'DKK', 7.5) on conflict do nothing returning rate");
    expect(upsert.rows).toEqual([]);
    expect(await scalar(db, "select rate::text from commerce.ecb_reference_rates where currency = 'DKK'")).toBe("7.475500");
  });

  it("must be a positive rate for a currency other than the euro, from the ECB", async () => {
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-29', 'DKK', 0)", [], /ecb_reference_rates_rate/);
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-29', 'DKK', -1)", [], /ecb_reference_rates_rate/);
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-29', 'EUR', 1)", [], /ecb_reference_rates_currency/);
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-29', 'dkk', 7)", [], /ecb_reference_rates_currency/);
    await rejects("insert into commerce.ecb_reference_rates (rate_date, currency, rate, source) values ('2026-09-29', 'DKK', 7, 'me')", [], /ecb_reference_rates_source/);
  });
});

describe("an owner's rate", () => {
  let shop: string;
  let owner: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "tr-override");
    owner = await account("owner@tr-override.example");
  });

  const put = (over: { currency?: string; date?: string; rate?: number; reason?: string } = {}) =>
    db.query("insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values ($1, $2, $3, $4, $5, $6)", [
      shop, over.currency ?? "DKK", over.date ?? "2026-09-30", over.rate ?? 7.5, over.reason ?? "The ECB feed was down on the day", owner,
    ]);

  it("needs a reason of ten to 300 characters, a currency other than the euro, a positive rate and a day that has passed, since 1 July 2021", async () => {
    await put();
    await rejects("insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values ($1, 'SEK', '2026-09-30', 11.3, 'too short', $2)", [shop, owner], /tax_rate_overrides_reason/);
    await rejects("insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values ($1, 'SEK', '2026-09-30', 11.3, $3, $2)", [shop, owner, "x".repeat(301)], /tax_rate_overrides_reason/);
    await rejects("insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values ($1, 'SEK', '2026-09-30', 11.3, '          padded          ', $2)", [shop, owner], /tax_rate_overrides_reason/);
    await expect(put({ currency: "EUR" })).rejects.toThrow(/tax_rate_overrides_currency/);
    await expect(put({ currency: "SEK", rate: 0 })).rejects.toThrow(/tax_rate_overrides_rate/);
    await expect(put({ currency: "SEK", date: "2021-06-30" })).rejects.toThrow(/tax_rate_overrides_date/);
    await expect(put({ currency: "SEK", date: "2999-01-01" })).rejects.toThrow(/tax_rate_override.future/);
    await put({ currency: "SEK", date: "2021-07-01" });
  });

  it("is an upsert for one store, currency and day, and another store's is its own", async () => {
    await db.query(
      `insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values ($1, 'DKK', '2026-09-30', 7.6, 'A better source: the bank', $2)
         on conflict (store_id, currency, rate_date) do update set rate = excluded.rate, reason = excluded.reason`,
      [shop, owner],
    );
    expect(await scalar(db, "select rate::text from commerce.tax_rate_overrides where store_id = $1 and currency = 'DKK'", [shop])).toBe("7.600000");
    const other = await createInvoiceStore(db, "tr-override-2");
    expect(await scalar(db, "select count(*)::int from commerce.tax_rate_overrides where store_id = $1", [other])).toBe(0);
    await db.query("update commerce.tax_rate_overrides set rate = 7.7 where store_id = $1 and currency = 'DKK'", [shop]);
    await rejects("update commerce.tax_rate_overrides set rate_date = '2999-01-01' where store_id = $1 and currency = 'DKK'", [shop], /tax_rate_override.future/);
  });

  it("is checked against the store: an override of an unknown store is refused", async () => {
    await rejects("insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by) values (gen_random_uuid(), 'SEK', '2026-09-30', 11.3, 'A reason that is long enough', $1)", [owner], /foreign key/);
  });
});

describe("the export log", () => {
  it("keeps what was exported, with aggregate totals only, and is append-only", async () => {
    const shop = await createInvoiceStore(db, "tr-exports");
    const owner = await account("owner@tr-exports.example");
    const insert = (over: Record<string, unknown> = {}) =>
      db.query(
        "insert into commerce.tax_report_exports (store_id, report, scheme, period_key, mode, rows, totals, exported_by) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) returning id",
        [shop, over.report ?? "oss", over.scheme ?? "union", over.period ?? "2026-Q3", over.mode ?? "filing", over.rows ?? 5, JSON.stringify(over.totals ?? { currency: "EUR", vatMinor: 5244, taxableMinor: 23377, documents: 2, creditNotes: 0, incomplete: false }), owner],
      );
    const { rows } = await insert();
    expect(rows).toHaveLength(1);
    await insert({ report: "vat", scheme: null, mode: null, period: "2026-09-01..2026-09-30" });
    await rejects("update commerce.tax_report_exports set rows = 6", [], /append-only/);
    await rejects("delete from commerce.tax_report_exports", [], /append-only/);
    await expect(insert({ report: "invoices" })).rejects.toThrow(/tax_report_exports_report/);
    await expect(insert({ scheme: "other" })).rejects.toThrow(/tax_report_exports_scheme/);
    await expect(insert({ mode: "draft" })).rejects.toThrow(/tax_report_exports_mode/);
    await expect(insert({ rows: -1 })).rejects.toThrow(/tax_report_exports_rows/);
    await expect(insert({ totals: [1] })).rejects.toThrow(/tax_report_exports_totals/);
    expect(await scalar(db, "select count(*)::int from commerce.tax_report_exports where store_id = $1", [shop])).toBe(2);
  });
});

describe("what the migration says", () => {
  it("turns on row-level security with no policy on the three tables", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'commerce'::regnamespace and relname in ('ecb_reference_rates', 'tax_rate_overrides', 'tax_report_exports') order by relname",
    );
    expect(rows).toEqual([
      { relname: "ecb_reference_rates", relrowsecurity: true },
      { relname: "tax_rate_overrides", relrowsecurity: true },
      { relname: "tax_report_exports", relrowsecurity: true },
    ]);
    expect(await scalar(db, "select count(*)::int from pg_policy where polrelid in ('commerce.ecb_reference_rates'::regclass, 'commerce.tax_rate_overrides'::regclass, 'commerce.tax_report_exports'::regclass)")).toBe(0);
  });

  it("has a function that only reads: stable, a fixed search path, not security definer, and no removal, TRUNCATE or DROP in anything it adds", async () => {
    const fn = await one<{ provolatile: string; prosecdef: boolean; proconfig: string[] | null; src: string }>(
      db,
      "select provolatile, prosecdef, proconfig, prosrc as src from pg_proc where proname = 'tax_document_groups' and pronamespace = 'commerce'::regnamespace",
    );
    expect(fn.provolatile).toBe("s");
    expect(fn.prosecdef).toBe(false);
    expect((fn.proconfig ?? []).some((c) => c.startsWith("search_path="))).toBe(true);
    for (const name of ["tax_document_groups", "tax_rate_overrides_rules"]) {
      const { src } = await one<{ src: string }>(db, "select prosrc as src from pg_proc where proname = $1 and pronamespace = 'commerce'::regnamespace", [name]);
      expect([name, /delete|truncate|drop/i.test(src)]).toEqual([name, false]);
    }
    expect(await scalar(db, "select proconfig::text from pg_proc where proname = 'tax_rate_overrides_rules'")).toContain("search_path=");
    const forbid = await db.query("select tgname from pg_trigger where tgrelid in ('commerce.ecb_reference_rates'::regclass, 'commerce.tax_report_exports'::regclass) and not tgisinternal order by tgname");
    expect(forbid.rows.map((r: any) => r.tgname)).toEqual(["ecb_reference_rates_append_only", "tax_report_exports_append_only"]);
  });

  it("opens no personal field of a snapshot: the function names only buckets, line kinds, the buyer's type and the stored conversion", async () => {
    const { src } = await one<{ src: string }>(db, "select prosrc as src from pg_proc where proname = 'tax_document_groups' and pronamespace = 'commerce'::regnamespace");
    for (const word of ["name", "company", "address", "email", "vatNumber", "organisationNumber", "deliveryPlace", "phone", "postal"]) expect([word, src.toLowerCase().includes(word.toLowerCase())]).toEqual([word, false]);
    // The paths it reads: quoted keys, and the columns of the two `jsonb_to_record` calls that open each snapshot once.
    const records = [...src.matchAll(/jsonb_to_record\([^)]*\)\s+AS\s+\w+\(([^)]*)\)/g)].flatMap((m) => m[1].split(",").map((c) => c.trim().split(/\s+/)[0].replace(/"/g, "")));
    expect(records.sort()).toEqual(["buckets", "buyer", "lines", "vatMain"]);
    const paths = [...src.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).concat(records);
    for (const path of ["buckets", "vatMain", "fxRate", "buyer", "type", "lines", "kind", "rate", "basis", "netMinor", "vatMinor", "grossMinor", "dispatchCountry"]) expect(paths).toContain(path);
  });

  it("adds the plan comparison row once, listed in no plan", async () => {
    expect(await scalar(db, "select count(*)::int from commerce.plan_features where name = 'VAT, OSS and IOSS reports'")).toBe(1);
    expect(await scalar(db, "select category from commerce.plan_features where name = 'VAT, OSS and IOSS reports'")).toBe("Checkout and selling");
    expect(await scalar(db, "select count(*)::int from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = 'VAT, OSS and IOSS reports'")).toBe(0);
  });
});

describe("commerce.tax_document_groups(): every kind of order", () => {
  let shop: string;
  let day: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    shop = await createInvoiceStore(db, "tr-kinds");
    day = await today(shop);
    const place = async (key: string, spec: Parameters<typeof placeOrder>[2]) => {
      const o = await placeOrder(db, shop, spec);
      ids[key] = o.id;
      return o;
    };
    await place("no", { market: "NO", lines: [{ sku: "A", unit: 12500 }], shipping: 5900, dispatchCountry: "NO" });
    await place("se_goods", { market: "SE", lines: [{ sku: "B", unit: 25000 }, { sku: "B2", unit: 5000, rate: 0.12 }], shipping: 4900, dispatchCountry: "NO" });
    await place("de_two_rates", { market: "DE", lines: [{ sku: "C", unit: 11900, rate: 0.19 }, { sku: "C2", unit: 1070, rate: 0.07 }], shipping: 1190, shippingRate: 0.19, dispatchCountry: "NO" });
    await place("de_download", { market: "DE", lines: [{ sku: "D", unit: 4900, rate: 0.19, delivery: "digital" }], dispatchCountry: "NO" });
    await place("dk_mixed", { market: "DK", lines: [{ sku: "E", unit: 25000 }, { sku: "E2", unit: 12500, delivery: "digital" }], dispatchCountry: "SE" });
    await place("se_booking", { market: "SE", lines: [{ sku: "F", unit: 50000, delivery: "service", booking: { startsAt: "2026-10-12T10:00", endsAt: "2026-10-12T11:00" } }] });
    await place("renewal", { market: "NO", lines: [{ sku: "G", unit: 9900 }], noTreatment: true });
    await place("reverse", { market: "DE", lines: [{ sku: "H", unit: 11900, rate: 0.19 }], vatKind: "reverse_charge", company: { name: "Muster GmbH", number: "DE-HRB 1", vatNumber: "DE123456789" }, dispatchCountry: "SE" });
    await place("ioss", { market: "DE", lines: [{ sku: "I", unit: 11900, rate: 0.19 }], vatKind: "ioss", dispatchCountry: "NO" });
    await place("exempt", { market: "NO", lines: [{ sku: "J", unit: 10000, category: "exempt", rate: 0 }, { sku: "J2", unit: 12500 }], dispatchCountry: "NO" });
    await place("copied", { market: "NO", lines: [{ sku: "K", unit: 10000 }], copied: true });
    await place("host", { market: "NO", lines: [{ sku: "L", unit: 10000 }], host: true });
  });

  const from = () => plusDays(day, -1);
  const to = () => plusDays(day, 2);

  it("gives the buckets of every invoice, per rate and basis, exactly as the invoice froze them", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const key = (m: string, c: string, rate: number, basis: string) => `${m}|${c}|${rate}|${basis}`;
    const got = new Map<string, number[]>();
    for (const g of groups) {
      const k = key(g.marketCode, g.currency, g.rate, g.basis);
      const v = got.get(k) ?? [0, 0, 0];
      v[0] += g.netMinor;
      v[1] += g.vatMinor;
      v[2] += g.grossMinor;
      got.set(k, v);
    }
    const want = new Map<string, number[]>();
    let invoiceCount = 0;
    for (const [name, orderId] of Object.entries(ids)) {
      if (name === "copied" || name === "host") continue;
      const inv = await invoiceOf(db, orderId);
      expect(inv, name).toBeTruthy();
      invoiceCount += 1;
      const order = await one<{ market_code: string; currency: string }>(db, "select market_code, currency::text from commerce.orders where id = $1", [orderId]);
      for (const b of inv.snapshot.buckets) {
        const k = key(order.market_code, order.currency, Number(b.rate), b.basis);
        const v = want.get(k) ?? [0, 0, 0];
        v[0] += b.netMinor;
        v[1] += b.vatMinor;
        v[2] += b.grossMinor;
        want.set(k, v);
      }
    }
    expect(invoiceCount).toBe(10);
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(want));
    // Shipping sits in the bucket of its own rate: the German order's goods at 19 % and 7 % and shipping at 19 %.
    expect(got.get(key("DE", "EUR", 0.07, "standard"))![0]).toBeGreaterThan(0);
    expect([...got.keys()].some((k) => k.endsWith("|exempt"))).toBe(true);
    expect([...got.keys()].some((k) => k.endsWith("|reverse_charge"))).toBe(true);
  });

  it("has a VAT total equal to the orders' tax_minor, per currency, for the orders that have an invoice", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const byCurrency = new Map<string, number>();
    for (const g of groups) byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + g.vatMinor);
    const orders = await db.query<{ currency: string; tax: string }>(
      `select o.currency::text, sum(o.tax_minor)::text as tax from commerce.orders o join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id
        where o.store_id = $1 group by o.currency`,
      [shop],
    );
    expect(Object.fromEntries(byCurrency)).toEqual(Object.fromEntries(orders.rows.map((r) => [r.currency, Number(r.tax)])));
  });

  it("never lists a copied order or a host's order: they have no document", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const orders = (await db.query<{ n: string }>("select count(*)::text as n from commerce.invoices where store_id = $1", [shop])).rows[0].n;
    expect(Number(orders)).toBe(10);
    expect(await scalar(db, "select count(*)::int from commerce.invoices where order_id = any($1)", [[ids.copied, ids.host]])).toBe(0);
    expect(groups.reduce((s, g) => s + g.orders, 0)).toBeGreaterThanOrEqual(10);
    const report = buildVatReport(groups, { country: "NO" });
    expect(report.totals.orders).toBe(10);
    expect(report.totals.invoices).toBe(10);
  });

  it("reads the kinds of the invoice's lines as three facts, and the buyer's type", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const of = (market: string, pick: (g: DocGroup) => boolean) => groups.filter((g) => g.marketCode === market && pick(g));
    expect(of("DE", (g) => g.hasDownload && !g.hasPhysical).length).toBeGreaterThan(0); // the download order
    expect(of("DK", (g) => g.hasPhysical && g.hasDownload && !g.hasService).length).toBe(1); // goods and a download at one rate: one group, with both facts
    expect(of("SE", (g) => g.hasService).length).toBeGreaterThan(0);
    expect(groups.filter((g) => g.buyerType === "business").every((g) => g.vatKind === "reverse_charge")).toBe(true);
    expect(groups.filter((g) => g.buyerType === "business")).toHaveLength(1);
    expect(groups.filter((g) => g.vatKind === "ioss").length).toBeGreaterThan(0);
    expect(groups.every((g) => g.buyerType === "consumer" || g.buyerType === "business")).toBe(true);
  });

  it("counts a document with two rates once in kind_documents and once per row in documents, and orders per currency", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const de = groups.filter((g) => g.marketCode === "DE" && g.currency === "EUR" && g.docKind === "invoice");
    expect(new Set(de.map((g) => g.kindDocuments)).size).toBe(1);
    // The EUR invoices: the two-rate German order, the download, the reverse-charge one and the IOSS one: four documents.
    expect(de[0].kindDocuments).toBe(4);
    expect(de[0].currencyOrders).toBe(4);
    expect(de.reduce((s, g) => s + g.documents, 0)).toBeGreaterThan(4);
    const twoRates = de.filter((g) => g.rate === 0.19 || g.rate === 0.07);
    expect(twoRates.length).toBeGreaterThan(1);
  });

  it("gives the standard rate of the country on the tax date, through the one reader of rates", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    for (const g of groups) {
      const expected = await scalar<string>(db, "select commerce.vat_rate($1::char(2), 'standard', ($2::date::timestamp + interval '12 hours') at time zone 'UTC')::text", [g.marketCode, g.taxDate]);
      expect([g.marketCode, g.standardRate]).toEqual([g.marketCode, Number(expected)]);
    }
    expect(groups.find((g) => g.marketCode === "DE")!.standardRate).toBe(0.19);
  });

  it("takes the country from the order's market and the currency from the document", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    expect(new Set(groups.map((g) => `${g.marketCode}|${g.currency}|${g.marketInEu}`))).toEqual(new Set(["NO|NOK|false", "SE|SEK|true", "DE|EUR|true", "DK|DKK|true"]));
  });

  it("classifies a sale only by what the order froze, then by the live setting, and says which", async () => {
    const groups = await groupsOf(shop, await from(), await to());
    const sources = new Map<string, Set<string>>();
    for (const g of groups) {
      const s = sources.get(g.dispatchSource) ?? new Set<string>();
      s.add(`${g.dispatchCountry}`);
      sources.set(g.dispatchSource, s);
    }
    expect([...(sources.get("order") ?? [])].sort()).toEqual(["NO", "SE"]);
    // The renewal and the booking carry no frozen country: the store's own (NO) stands in and is marked as assumed.
    expect([...(sources.get("profile") ?? [])]).toEqual(["NO"]);
    expect(sources.has("unknown")).toBe(false);
  });
});

describe("commerce.tax_document_groups(): the frozen dispatch country", () => {
  it("is the order's own, and a later change of the store's setting reclassifies only orders that froze nothing", async () => {
    const shop = await createInvoiceStore(db, "tr-dispatch", { country: "SE", markets: ["SE", "DE"], rates: { SEK: 1 }, legalName: "Fixture AB", vatNumber: "SE556677889901" });
    const frozen = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19 }], dispatchCountry: "SE" });
    const older = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "B", unit: 11900, rate: 0.19 }] });
    expect(frozen.invoiceId).not.toBeNull();
    const day = await today(shop);
    const find = async () => {
      const groups = await groupsOf(shop, day, await plusDays(day, 1));
      return groups.map((g) => `${g.dispatchSource}:${g.dispatchCountry}`).sort();
    };
    expect(await find()).toEqual(["order:SE", "profile:SE"]);
    await db.query("insert into commerce.store_tax_profile (store_id, vat_registered, vat_number, dispatch_country) values ($1, true, 'SE556677889901', 'NO') on conflict (store_id) do update set dispatch_country = 'NO'", [shop]);
    expect(await find()).toEqual(["order:SE", "profile:NO"]);
    expect(older.id).toBeTruthy();
    // An empty live setting falls back to the store's own country.
    await db.query("update commerce.store_tax_profile set dispatch_country = null where store_id = $1", [shop]);
    expect(await find()).toEqual(["order:SE", "profile:SE"]);
  });
});

describe("commerce.tax_document_groups(): the seller as the order froze it", () => {
  it("returns the country and member state of identification the order froze, and the live ones, counted as assumed, for an order that froze none", async () => {
    const shop = await createInvoiceStore(db, "tr-seller", { country: "SE", markets: ["SE", "DE"], rates: { SEK: 1 }, legalName: "Fixture AB", vatNumber: "SE556677889901" });
    await db.query("insert into commerce.store_tax_profile (store_id, vat_registered, vat_number, oss_scheme, oss_member_state) values ($1, true, 'SE556677889901', 'union', 'SE') on conflict (store_id) do update set oss_scheme = 'union', oss_member_state = 'SE'", [shop]);
    await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19, delivery: "digital" }] });
    await placeOrder(db, shop, { market: "DE", lines: [{ sku: "B", unit: 11900, rate: 0.19, delivery: "digital" }], frozenSeller: false });
    const day = await today(shop);
    const find = async () => (await groupsOf(shop, day, await plusDays(day, 1))).map((g) => `${g.sellerSource}:${g.sellerCountry}:${g.sellerOssMemberState}`).sort();
    expect(await find()).toEqual(["order:SE:SE", "profile:SE:SE"]);
    // The store later moves to Norway and drops its Union registration: only the order that froze nothing follows the settings.
    await db.query("update commerce.store_tax_profile set vat_registered = false, vat_number = null, oss_scheme = 'none', oss_member_state = null where store_id = $1", [shop]);
    await db.query("update commerce.stores set country = 'NO' where id = $1", [shop]);
    expect(await find()).toEqual(["order:SE:SE", "profile:NO:null"]);
  });

  it("freezes a JSON null as a fact: a store with no member state of identification stays without one when the profile gains one", async () => {
    const shop = await createInvoiceStore(db, "tr-seller-null", { country: "SE", markets: ["SE", "DE"], rates: { SEK: 1 }, legalName: "Fixture AB", vatNumber: "SE556677889901" });
    await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19, delivery: "digital" }], frozenSeller: { ossMemberState: null } });
    await db.query("update commerce.store_tax_profile set oss_scheme = 'union', oss_member_state = 'DK' where store_id = $1", [shop]);
    const day = await today(shop);
    const groups = await groupsOf(shop, day, await plusDays(day, 1));
    expect(groups.map((g) => [g.sellerSource, g.sellerCountry, g.sellerOssMemberState])).toEqual([["order", "SE", null]]);
  });

  it("classes a download by the frozen seller, so editing the store's country afterwards moves nothing between parts", async () => {
    const shop = await createInvoiceStore(db, "tr-seller-class", { country: "SE", markets: ["SE", "DE"], rates: { SEK: 1 }, legalName: "Fixture AB", vatNumber: "SE556677889901" });
    await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19, delivery: "digital" }] });
    const day = await today(shop);
    const parts = async () => buildVatReport(await groupsOf(shop, day, await plusDays(day, 1)), { country: "NO" }).rows.map((r) => r.reportedIn);
    expect(await parts()).toEqual(["OSS Union scheme, part 2a"]);
    await db.query("update commerce.stores set country = 'NO' where id = $1", [shop]);
    expect(await parts()).toEqual(["OSS Union scheme, part 2a"]);
  });
});

describe("commerce.tax_document_groups(): dates", () => {
  it("takes an invoice by its supply date and a credit note by its issue day, in a half-open range", async () => {
    const shop = await createInvoiceStore(db, "tr-dates");
    const o = await placeOrder(db, shop, { lines: [{ sku: "A", unit: 12500 }], dispatchCountry: "NO" });
    await refund(db, o.id, 5000);
    await redate(o.id, "2026-09-30", "2026-10-06");
    const count = async (from: string, to: string) => {
      const groups = await groupsOf(shop, from, to);
      return { invoices: groups.filter((g) => g.docKind === "invoice").length, credits: groups.filter((g) => g.docKind === "credit_note").length };
    };
    expect(await count("2026-09-30", "2026-10-01")).toEqual({ invoices: 1, credits: 0 });
    expect(await count("2026-09-29", "2026-09-30")).toEqual({ invoices: 0, credits: 0 });
    expect(await count("2026-10-01", "2026-10-02")).toEqual({ invoices: 0, credits: 0 });
    expect(await count("2026-10-06", "2026-10-07")).toEqual({ invoices: 0, credits: 1 });
    expect(await count("2026-10-07", "2026-10-08")).toEqual({ invoices: 0, credits: 0 });
    expect(await count("2026-09-01", "2026-11-01")).toEqual({ invoices: 1, credits: 1 });
  });

  it("gives a credit note the supply date of its invoice as the original tax date, the invoice's kinds and dispatch country, and positive amounts", async () => {
    const shop = await createInvoiceStore(db, "tr-credits");
    const o = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19 }, { sku: "A2", unit: 2400, rate: 0.07, delivery: "digital" }], dispatchCountry: "NO", vatKind: "standard" });
    await refund(db, o.id, 4000);
    await redate(o.id, "2026-09-12", "2026-10-06");
    const credit = (await creditNotesOf(db, o.id))[0];
    const groups = await groupsOf(shop, "2026-10-01", "2026-11-01");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g).toMatchObject({ docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", dispatchCountry: "NO", hasPhysical: true, hasDownload: true, buyerType: "consumer", orders: 0 });
      expect(g.netMinor).toBeGreaterThanOrEqual(0);
      expect(g.vatMinor).toBeGreaterThanOrEqual(0);
    }
    expect(groups.reduce((s, g) => s + g.vatMinor, 0)).toBe(Number(credit.tax_minor));
    expect(groups.reduce((s, g) => s + g.netMinor, 0)).toBe(Number(credit.net_minor));
    expect(groups.reduce((s, g) => s + g.grossMinor, 0)).toBe(Number(credit.total_minor));
  });

  it("is empty for a store with no documents and never shows another store's", async () => {
    const empty = await createInvoiceStore(db, "tr-empty");
    expect(await groupsOf(empty, "2000-01-01", "2100-01-01")).toEqual([]);
    const a = await createInvoiceStore(db, "tr-iso-a");
    const b = await createInvoiceStore(db, "tr-iso-b");
    await placeOrder(db, a, { lines: [{ sku: "A", unit: 12500 }] });
    expect((await groupsOf(b, "2000-01-01", "2100-01-01")).length).toBe(0);
    expect((await groupsOf(a, "2000-01-01", "2100-01-01")).length).toBeGreaterThan(0);
  });
});

describe("commerce.tax_document_groups(): the main currency", () => {
  it("converts each bucket with the document's stored rate, so an invoice's converted VAT is its stored main-currency VAT exactly", async () => {
    const shop = await createInvoiceStore(db, "tr-main");
    const sek = await placeOrder(db, shop, { market: "SE", lines: [{ sku: "A", unit: 12599 }, { sku: "A2", unit: 3333, rate: 0.12 }], shipping: 4901, dispatchCountry: "NO" });
    const eur = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "B", unit: 11901, rate: 0.19 }, { sku: "B2", unit: 1071, rate: 0.07 }], shipping: 1191, shippingRate: 0.19, dispatchCountry: "NO" });
    const nok = await placeOrder(db, shop, { market: "NO", lines: [{ sku: "C", unit: 12500 }], dispatchCountry: "NO" });
    const day = await today(shop);
    const groups = await groupsOf(shop, day, await plusDays(day, 1));
    for (const [market, order] of [["SE", sek], ["DE", eur], ["NO", nok]] as const) {
      const inv = await invoiceOf(db, order.id);
      const rows = groups.filter((g) => g.marketCode === market);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((g) => g.fxState === (market === "NO" ? "same" : "stored"))).toBe(true);
      expect(rows.every((g) => g.mainCurrency === "NOK")).toBe(true);
      const converted = rows.reduce((s, g) => s + (g.vatMainMinor ?? 0), 0);
      expect(converted, market).toBe(inv.snapshot.vatMain.vatMinor);
      if (market !== "NO") expect(rows.every((g) => Number(g.fxRate) === Number(inv.snapshot.vatMain.fxRate))).toBe(true);
    }
    const no = groups.filter((g) => g.marketCode === "NO");
    expect(no.every((g) => g.fxRate === null && g.netMainMinor === g.netMinor && g.vatMainMinor === g.vatMinor && g.grossMainMinor === g.grossMinor)).toBe(true);
  });

  it("says a document has no stored conversion when its currency has no rate, and gives no main-currency figure for it", async () => {
    // A Danish store prices a German order in euro with no rate to kroner: the invoice needs no krone line (Directive Art. 230 excepts DK and EUR).
    const shop = await createInvoiceStore(db, "tr-norate", { country: "DK", markets: ["DK", "DE"], rates: {}, legalName: "Fixture ApS", vatNumber: "DK12345678" });
    const o = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19 }], dispatchCountry: "DK" });
    expect(o.invoiceId).not.toBeNull();
    const inv = await invoiceOf(db, o.id);
    expect(inv.snapshot.vatMain).toBeNull();
    const day = await today(shop);
    const groups = await groupsOf(shop, day, await plusDays(day, 1));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null, currency: "EUR", mainCurrency: "DKK", vatMinor: 1900 });
    const report = buildVatReport(groups, { country: "DK" });
    expect(report.notConverted).toEqual({ invoices: 1, creditNotes: 0, currencies: ["EUR"], leftOut: [{ currency: "EUR", invoices: 1, vatMinor: 1900 }] });
    expect(report.rows[0].mainConverted).toBe(false);
  });

  it("converts a credit note with its invoice's stored rate, within a minor unit per bucket of the credit note's own stored figure", async () => {
    const shop = await createInvoiceStore(db, "tr-main-credit");
    const o = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11901, rate: 0.19 }, { sku: "A2", unit: 1071, rate: 0.07 }], dispatchCountry: "NO" });
    await refund(db, o.id, 3333);
    await refund(db, o.id, 2222);
    const day = await today(shop);
    const groups = await groupsOf(shop, day, await plusDays(day, 1));
    const credits = await creditNotesOf(db, o.id);
    expect(credits).toHaveLength(2);
    const converted = groups.filter((g) => g.docKind === "credit_note").reduce((s, g) => s + (g.vatMainMinor ?? 0), 0);
    const stored = credits.reduce((s, c) => s + Number(c.snapshot.vatMain.vatMinor), 0);
    const buckets = credits.reduce((s, c) => s + c.snapshot.buckets.length, 0);
    expect(Math.abs(converted - stored)).toBeLessThanOrEqual(buckets);
    expect(groups.filter((g) => g.docKind === "credit_note").every((g) => g.fxState === "stored")).toBe(true);
  });
});

describe("commerce.tax_document_groups(): anonymised documents", () => {
  it("are unchanged in every figure: only personal fields are removed, never buckets, amounts, dates, kinds or the market", async () => {
    const shop = await createInvoiceStore(db, "tr-anon");
    const o = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19 }, { sku: "A2", unit: 2400, rate: 0.07, delivery: "digital" }], dispatchCountry: "SE", company: { name: "Muster GmbH", number: "DE-HRB 1", vatNumber: "DE123456789" }, vatKind: "reverse_charge" });
    const plain = await placeOrder(db, shop, { market: "DK", lines: [{ sku: "B", unit: 12500 }], dispatchCountry: "SE" });
    await refund(db, plain.id, 2500);
    for (const order of [o, plain]) await redate(order.id, "2019-03-01", "2019-04-01");
    await db.query("alter table commerce.invoices disable trigger invoices_append_only");
    await db.query("update commerce.invoices set issued_on = date '2019-03-01' where store_id = $1", [shop]);
    await db.query("alter table commerce.invoices enable trigger invoices_append_only");
    const before = await groupsOf(shop, "2019-01-01", "2020-01-01");
    expect(before.length).toBeGreaterThan(0);
    expect(await scalar(db, "select commerce.anonymise_expired_documents($1::uuid, date '2021-01-01')", [shop])).toBeGreaterThanOrEqual(2);
    const after = await groupsOf(shop, "2019-01-01", "2020-01-01");
    expect(after).toEqual(before);
    expect((await invoiceOf(db, o.id)).snapshot.buyer.name).toBe("[removed]");
    expect(before.filter((g) => g.buyerType === "business").length).toBeGreaterThan(0);
  });
});

describe("the worked example of docs/wave-1c-reports.md 2.5, from real documents", () => {
  it("a Swedish store: a German and a Danish order in Q3, the Danish one half refunded in Q4", async () => {
    const shop = await createInvoiceStore(db, "tr-worked", { country: "SE", markets: ["SE", "DE", "DK"], rates: { SEK: 11.2, DKK: 7.46 }, legalName: "Fixture AB", vatNumber: "SE556677889901" });
    const de = await placeOrder(db, shop, { market: "DE", lines: [{ sku: "A", unit: 11900, rate: 0.19 }], dispatchCountry: "SE" });
    const dk = await placeOrder(db, shop, { market: "DK", lines: [{ sku: "B", unit: 125000, rate: 0.25 }], dispatchCountry: "SE" });
    await refund(db, dk.id, 62500);
    await redate(de.id, "2026-09-12");
    await redate(dk.id, "2026-09-12", "2026-10-06");
    const seller = { country: "SE", ossMemberState: "SE" };
    const registration = { ossScheme: "union" as const, iossNumber: null };
    const rateFor: RateLookup = (currency, day) => (currency === "DKK" && day === "2026-09-30" ? { rate: "7.4755", date: day, source: "ecb", reason: null } : null);

    const q3 = quarterPeriod(2026, 3);
    const q3Return = buildReturn({ scheme: "oss", period: q3, mode: "filing", groups: await groupsOf(shop, q3.from, q3.to), registration, rateFor });
    expect(q3Return.part2.map((l) => [l.part, l.memberState, l.rate, l.taxableEur, l.vatEur])).toEqual([["2b", "DE", 0.19, 10000, 1900], ["2b", "DK", 0.25, 13377, 3344]]);
    expect(q3Return.part5Eur).toBe(5244);
    const csv = returnCsv(q3Return);
    expect(csv.ok && csv.csv.split("\r\n").slice(1, 3)).toEqual(["union,2026-Q3,2b,DE,SE,19,standard,100.00,19.00,,filing,union,EUR", "union,2026-Q3,2b,DK,SE,25,standard,133.77,33.44,,filing,union,EUR"]);

    const q4 = quarterPeriod(2026, 4);
    const q4Groups = await groupsOf(shop, q4.from, q4.to);
    const filing = buildReturn({ scheme: "oss", period: q4, mode: "filing", groups: q4Groups, registration, rateFor });
    expect(filing.part2).toEqual([]);
    expect(filing.part3).toEqual([{ correctionPeriod: "2026-Q3", memberState: "DK", vatEur: -1672, complete: true, late: false }]);
    expect(filing.part5Eur).toBe(0);

    // The sale and the credit note are one pair in the VAT view of their own periods, and reconcile to the invoice and credit note.
    const vat = buildVatReport(q4Groups, { country: seller.country });
    expect(vat.totals).toMatchObject({ invoices: 0, creditNotes: 1 });
    const credit = (await creditNotesOf(db, dk.id))[0];
    expect(vat.byCurrency[0]).toMatchObject({ currency: "DKK", creditVatMinor: Number(credit.tax_minor), creditNetMinor: Number(credit.net_minor) });
  });
});
