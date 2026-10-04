import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { returnCsv, vatCsv } from "@/lib/tax-csv";
import { longDate, monthPeriod, quarterOfDay, quarterPeriod } from "@/lib/tax-periods";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizen's platform Stripe client, faked: refunds made. */
const fake = vi.hoisted(() => {
  const refunds = new Map<string, { id: string; object: "refund"; status: string; amount: number; currency: string; created: number; payment_intent: string; metadata: Record<string, string> }>();
  let next = 0;
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }),
        list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }),
      },
    },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    refunds: {
      create: async (params: { amount: number; payment_intent: string; metadata: Record<string, string> }) => {
        const id = `re_exp_${++next}_${Math.random().toString(36).slice(2, 8)}`;
        const refund = { id, object: "refund" as const, status: "succeeded", amount: params.amount, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: params.payment_intent, metadata: params.metadata };
        refunds.set(id, refund);
        return refund;
      },
      retrieve: async (id: string) => refunds.get(id),
    },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
type Fixture = Awaited<ReturnType<typeof fx.makeStore>>;
type Placed = Awaited<ReturnType<typeof fx.paidOrder>>;
const t = await import("./tax-reports-fixture");
const x = await import("./tax-report-exports");
const { returnView, vatReport, storeToday } = await import("./tax-reports");
const { reconciliation } = await import("./tax-reconciliation");
const { refundOrder } = await import("./order-admin");
const { setRateOverride } = await import("./tax-rate-overrides");

type Row = Record<string, unknown>;

/**
 * Exporting the reports (D161, docs 2.2.2): the files are the report's own CSV, an export needs analytics write access, every one is logged
 * with aggregate totals only (and in the activity log without amounts) before the file is handed back, a period that changed after it was
 * exported says so, an incomplete return is refused as a file while its conversion detail is allowed, and one store never sees another's log.
 */

afterAll(async () => {
  await closeDb();
});

const Q3 = quarterPeriod(2026, 3);
const Q3_RANGE = { from: Q3.from, to: Q3.to };

let own: Fixture;
let other: Fixture;
let admin: Awaited<ReturnType<typeof fx.ownerOf>>;
let readOnly: Awaited<ReturnType<typeof fx.ownerOf>>;
let owner: Awaited<ReturnType<typeof fx.ownerOf>>;
let dk: Placed;

const logRows = (storeId: string) =>
  db().execute<Row>(sql`select report, scheme, period_key, mode, rows, totals from commerce.tax_report_exports where store_id = ${storeId}::uuid order by exported_at, id`);

beforeAll(async () => {
  await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
  own = await t.sellerStore("tax-exp");
  await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
  dk = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
  await t.issueBackdated(own.storeId);
  other = await t.sellerStore("tax-exp-other");
  owner = await fx.ownerOf(own, "owner");
  admin = await fx.ownerOf(own, "admin");
  readOnly = { ...(await fx.ownerOf(own, "admin")), permissions: ["analytics:read"] };
}, 90_000);

describe("who may export", () => {
  it("needs analytics write access: a member who may only read is refused, and nothing is logged or written", async () => {
    expect(await x.exportVatReport(readOnly, Q3_RANGE)).toEqual({ ok: false, reason: "forbidden", message: "Exports need the analytics role with write access." });
    expect(await x.exportReturnData(readOnly, "oss", Q3, "filing")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await x.exportReconciliation(readOnly, Q3_RANGE)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await logRows(own.storeId)).toEqual([]);
    const audits = await db().execute<Row>(sql`select 1 from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'analytics.tax_report_exported'`);
    expect(audits).toEqual([]);
  });
});

describe("the files", () => {
  it("is the VAT report's CSV in a file named by store and range, logged with its totals and its row count and nothing a person could be found from", async () => {
    const result = await x.exportVatReport(admin, Q3_RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { report } = await vatReport(admin.store, Q3_RANGE);
    expect(result.csv).toBe(vatCsv(report, Q3_RANGE));
    expect(result.rows).toBe(2);
    expect(result.filename).toBe(`vat-${own.slug}-2026-07-01_2026-09-30.csv`);
    const [row] = await logRows(own.storeId);
    expect(row).toMatchObject({ report: "vat", scheme: null, period_key: "2026-07-01..2026-09-30", mode: null, rows: 2 });
    expect(row.totals).toEqual({ currency: "SEK", vatMinor: 57_567, taxableMinor: 256_667, documents: 2, creditNotes: 0, incomplete: false });
    const [audit] = await db().execute<Row>(sql`select details, area from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'analytics.tax_report_exported'`);
    expect(audit.area).toBe("analytics");
    expect(audit.details).toEqual({ view: "vat", period: "2026-07-01..2026-09-30", mode: null, rows: 2 });
    expect(JSON.stringify(audit.details)).not.toMatch(/\d{4,}\.\d{2}|57567/);
  });

  it("is the OSS return data as the CSV of the worked example, and its conversion detail, each logged as what it is", async () => {
    const data = await x.exportReturnData(admin, "oss", Q3, "filing");
    expect(data).toMatchObject({ ok: true, rows: 5, filename: `oss-${own.slug}-2026-Q3-filing.csv` });
    const view = await returnView(admin.store, "oss", Q3, "filing");
    const expected = returnCsv(view.data);
    expect(data.ok && expected.ok && data.csv).toBe(expected.ok ? expected.csv : "");
    const detail = await x.exportReturnData(admin, "oss", Q3, "filing", true);
    expect(detail).toMatchObject({ ok: true, rows: 2, filename: `oss-detail-${own.slug}-2026-Q3-filing.csv` });
    const rows = await logRows(own.storeId);
    expect(rows.map((r) => [r.report, r.scheme, r.period_key, r.mode, r.rows])).toEqual([
      ["vat", null, "2026-07-01..2026-09-30", null, 2],
      ["oss", "union", "2026-Q3", "filing", 5],
      ["oss_detail", "union", "2026-Q3", "filing", 2],
    ]);
    expect(rows[1].totals).toEqual({ currency: "EUR", vatMinor: 5_244, taxableMinor: 23_377, documents: 2, creditNotes: 0, incomplete: false });
  });

  it("is the reconciliation's CSV, one row per line of each currency's bridge", async () => {
    const result = await x.exportReconciliation(admin, Q3_RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe(`reconciliation-${own.slug}-2026-07-01_2026-09-30.csv`);
    expect(result.csv.split("\r\n")).toEqual([
      "period_from,period_to,currency,cause,direction,orders,vat_original",
      "2026-07-01,2026-09-30,DKK,finance,,1,250.00",
      "2026-07-01,2026-09-30,DKK,report,,1,250.00",
      "2026-07-01,2026-09-30,EUR,finance,,1,19.00",
      "2026-07-01,2026-09-30,EUR,report,,1,19.00",
      "",
    ]);
    const rows = await logRows(own.storeId);
    expect(rows.at(-1)).toMatchObject({ report: "reconciliation", rows: 4 });
    expect(rows.at(-1)?.totals).toMatchObject({ currency: "SEK", vatMinor: 57_567, incomplete: false });
    const view = await reconciliation(admin.store, Q3_RANGE);
    expect(x.reconciliationTotals(view).vatMinor).toBe(57_567);
  });
});

describe("a period that changed after it was exported", () => {
  it("is quiet while nothing changed, and says what changed, from when, once the figures are different", async () => {
    const view = await returnView(admin.store, "oss", Q3, "filing");
    const last = await x.lastExport(own.storeId, "oss", "2026-Q3", "filing");
    expect(last?.totals.vatMinor).toBe(5_244);
    expect(x.driftOf(last, x.returnTotals(view.data))).toBeNull();
    expect(await x.driftFor(own.storeId, "oss", "2026-Q3", "filing", x.returnTotals(view.data))).toBeNull();

    // The owner's accountant uses another rate for the quarter: the figures move by 0.11 euro.
    expect(await setRateOverride(owner, { currency: "DKK", day: "2026-09-30", rate: "7.5", reason: "The accountant's rate for the quarter" })).toMatchObject({ ok: true });
    const changed = await returnView(admin.store, "oss", Q3, "filing");
    const drift = await x.driftFor(own.storeId, "oss", "2026-Q3", "filing", x.returnTotals(changed.data));
    expect(drift).toMatchObject({ currency: "EUR", previousVatMinor: 5_244, currentVatMinor: 5_233, differenceMinor: -11 });
    expect(x.driftSentence(drift!)).toBe(
      `Changed since you exported this on ${longDate(drift!.exportedAt.slice(0, 10))}: VAT -€0.11. If you have already filed it, the difference belongs in your next return as a correction.`,
    );
    // Exported again, the new figures are the ones the next change is compared with.
    expect((await x.exportReturnData(admin, "oss", Q3, "filing")).ok).toBe(true);
    expect(await x.driftFor(own.storeId, "oss", "2026-Q3", "filing", x.returnTotals(changed.data))).toBeNull();
    // Books mode is its own period of its own: nothing was exported in it.
    expect(await x.lastExport(own.storeId, "oss", "2026-Q3", "books")).toBeNull();
  });

  it("is never worked out from an unknown figure", () => {
    const base = { currency: "EUR", vatMinor: 100, taxableMinor: 500, documents: 1, creditNotes: 0, incomplete: false };
    const last = { id: "x", report: "oss" as const, scheme: "union" as const, periodKey: "2026-Q3", mode: "filing" as const, rows: 1, totals: base, exportedAt: "2026-10-04T10:00:00.000Z" };
    expect(x.driftOf(last, { ...base, vatMinor: null, incomplete: true })).toBeNull();
    expect(x.driftOf({ ...last, totals: { ...base, vatMinor: null } }, base)).toBeNull();
    expect(x.driftOf(last, { ...base, currency: "SEK", vatMinor: 999 })).toBeNull();
    expect(x.driftOf(null, base)).toBeNull();
    expect(x.driftOf(last, { ...base, vatMinor: 150 })).toMatchObject({ differenceMinor: 50 });
  });
});

describe("an incomplete return", () => {
  it("is refused as a file with the reason, while its conversion detail, which shows the gap, is allowed and logged", async () => {
    // Half of the Danish order is refunded now: in books mode it is a credit of this quarter, converted at a rate that is not stored.
    expect(await refundOrder(own.storeId, dk.orderId, { amountMinor: 62_500, reason: "Skadet", restock: [] }, own.ownerId)).toMatchObject({ ok: true });
    const now = quarterOfDay(storeToday(admin.store));
    const before = (await logRows(own.storeId)).length;
    const refused = await x.exportReturnData(admin, "oss", now, "books");
    expect(refused).toMatchObject({ ok: false, reason: "incomplete" });
    expect(!refused.ok && refused.message).toContain(`DKK on ${now.lastDay}`);
    expect((await logRows(own.storeId)).length).toBe(before);
    const detail = await x.exportReturnData(admin, "oss", now, "books", true);
    expect(detail).toMatchObject({ ok: true, rows: 1 });
    const rows = await logRows(own.storeId);
    expect(rows.at(-1)).toMatchObject({ report: "oss_detail", mode: "books" });
    expect(rows.at(-1)?.totals).toMatchObject({ incomplete: true, vatMinor: null });
    // The filing return of the same quarter is complete: its correction is converted at the rate of the quarter it corrects.
    expect(await x.exportReturnData(admin, "oss", now, "filing")).toMatchObject({ ok: true });
  });

  it("is, for the VAT report, never refused for a missing main-currency rate: it leaves those columns empty and says so in its totals", async () => {
    const result = await x.exportVatReport(admin, { from: quarterOfDay(storeToday(admin.store)).from, to: quarterOfDay(storeToday(admin.store)).to });
    expect(result.ok).toBe(true);
  });
});

describe("the log", () => {
  it("serves no file when it cannot be written: an export that is not logged would defeat the drift line", async () => {
    // A member whose account is not in the accounts' table: the log's foreign key refuses the row.
    const ghost = { ...admin, account: { ...admin.account, id: "00000000-0000-4000-8000-000000000001" } };
    const before = (await logRows(own.storeId)).length;
    expect(await x.exportVatReport(ghost, Q3_RANGE)).toEqual({ ok: false, reason: "failed", message: "The export could not be logged, so no file was made. Try again." });
    expect((await logRows(own.storeId)).length).toBe(before);
  });

  it("is append-only, and the store's own: another store's owner sees an empty log, and the keys for the attention item are per store", async () => {
    await expect(db().execute(sql`update commerce.tax_report_exports set rows = 0 where store_id = ${own.storeId}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.tax_report_exports where store_id = ${own.storeId}::uuid`)).rejects.toThrow();
    expect(await logRows(other.storeId)).toEqual([]);
    expect(await x.exportsOf(other.storeId)).toEqual([]);
    expect(await x.lastExport(other.storeId, "oss", "2026-Q3", "filing")).toBeNull();
    const mine = await x.exportsOf(own.storeId, { periodKey: "2026-Q3" });
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((e) => e.periodKey === "2026-Q3")).toBe(true);
    const keys = await x.returnExportKeys([own.storeId, other.storeId]);
    expect(keys.get(own.storeId)).toContain("oss:2026-Q3");
    expect(keys.has(other.storeId)).toBe(false);
    expect(await x.returnExportKeys([])).toEqual(new Map());
  });

  it("is made by the store's own member only: a member of another store exports that store's figures into that store's log", async () => {
    const theirs = await fx.ownerOf(other, "owner");
    expect(await x.exportVatReport(theirs, Q3_RANGE)).toMatchObject({ ok: true, rows: 0 });
    expect((await logRows(other.storeId)).length).toBe(1);
    // Nothing of the first store reached it.
    expect((await logRows(other.storeId))[0].totals).toMatchObject({ documents: 0, vatMinor: 0 });
    expect(await x.lastExport(own.storeId, "vat", "2026-07-01..2026-09-30")).not.toBeNull();
  });
});

describe("the IOSS month", () => {
  it("is exported as the monthly return data of a store with an IOSS number, logged as `ioss` with the `ioss` scheme", async () => {
    const seller = await t.sellerStore("tax-exp-ioss", { country: "NO", ioss: { number: "IM1234567890", markets: ["DK"] } });
    await t.paidOn(seller, "2026-09-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    await t.issueBackdated(seller.storeId);
    const member = await fx.ownerOf(seller, "owner");
    const sept = monthPeriod(2026, 9);
    const result = await x.exportReturnData(member, "ioss", sept, "filing");
    expect(result).toMatchObject({ ok: true, rows: 3, filename: `ioss-${seller.slug}-2026-09-filing.csv` });
    expect(result.ok && result.csv.split("\r\n")[1]).toMatch(/^ioss,2026-09,IOSS,DK,,25,standard,\d+\.\d{2},\d+\.\d{2},,filing,ioss,EUR$/);
    const [row] = await logRows(seller.storeId);
    expect(row).toMatchObject({ report: "ioss", scheme: "ioss", period_key: "2026-09", mode: "filing", rows: 3 });
    // A month that has nothing in it is still a return, with a Part 5 of zero.
    const empty = await x.exportReturnData(member, "ioss", monthPeriod(2026, 8), "filing");
    expect(empty).toMatchObject({ ok: true, rows: 1 });
  });
});
