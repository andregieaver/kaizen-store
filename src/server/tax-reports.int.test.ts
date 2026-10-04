import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toEuroMinor } from "@/lib/ecb-history";
import { detailCsv, returnCsv, vatCsv } from "@/lib/tax-csv";
import { monthPeriod, monthOfDay, quarterOfDay, quarterPeriod } from "@/lib/tax-periods";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizen's platform Stripe client, faked: refunds made and retrievable. */
const fake = vi.hoisted(() => {
  type FakeRefund = { id: string; object: "refund"; status: string; amount: number; currency: string; created: number; payment_intent: string; metadata: Record<string, string> };
  const state = { refunds: new Map<string, FakeRefund>(), next: 0 };
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
        const id = `re_tax_${++state.next}_${Math.random().toString(36).slice(2, 8)}`;
        const refund: FakeRefund = { id, object: "refund", status: "succeeded", amount: params.amount, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: params.payment_intent, metadata: params.metadata };
        state.refunds.set(id, refund);
        return refund;
      },
      retrieve: async (id: string) => state.refunds.get(id),
    },
  };
  return { client, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
type Fixture = Awaited<ReturnType<typeof fx.makeStore>>;
type Placed = Awaited<ReturnType<typeof fx.paidOrder>>;
const t = await import("./tax-reports-fixture");
const { checkRange, documentGroups, returnView, storeToday, vatReport } = await import("./tax-reports");
const { reconciliation, taxSnapshot } = await import("./tax-reconciliation");
const { refundOrder } = await import("./order-admin");
const { issueWaitingInvoices } = await import("./invoice-issue");
const { periodTotals, setBasedSnapshot } = await import("./analytics-totals");
const { setRateOverride } = await import("./tax-rate-overrides");

type Row = Record<string, unknown>;

/**
 * The VAT, OSS and IOSS reports through the server (D161, docs/wave-1c-reports.md 2 to 4, 6): real orders placed by `placeOrder()`, paid on a
 * past day, invoiced and refunded by the database's own functions, read back by `commerce.tax_document_groups()` and the pure libraries.
 * The worked example of the spec's 2.5 end to end (52.44 euro in Q3, a Part 3 correction of -16.72 later), a refund in a later quarter in
 * both modes with the property that Part 2 plus Part 3 over all quarters is the invoices less the credit notes, the IOSS month of a Norwegian
 * store, every kind of order, the dispatch country frozen on the order, and one store never seeing another's documents. The ECB's rates are
 * the real ones of 30 September 2026. Nothing here reaches the network.
 */

afterAll(async () => {
  await closeDb();
});

const Q3 = quarterPeriod(2026, 3);
const Q3_RANGE = { from: Q3.from, to: Q3.to };

/** The numbers of the invoices and credit notes of a store read straight from the tables, to hold the reports against. */
async function sumsOf(storeId: string): Promise<{ invoicesVat: number; creditVat: number; invoicesNet: number; creditNet: number }> {
  const [i] = await db().execute<Row>(sql`select coalesce(sum(tax_minor), 0)::bigint as vat, coalesce(sum(net_minor), 0)::bigint as net from commerce.invoices where store_id = ${storeId}::uuid`);
  const [c] = await db().execute<Row>(sql`select coalesce(sum(tax_minor), 0)::bigint as vat, coalesce(sum(net_minor), 0)::bigint as net from commerce.credit_notes where store_id = ${storeId}::uuid`);
  return { invoicesVat: Number(i.vat), creditVat: Number(c.vat), invoicesNet: Number(i.net), creditNet: Number(c.net) };
}

const owner = async (own: Fixture) => fx.ownerOf(own);

beforeAll(async () => {
  await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
}, 30_000);

// ---------------------------------------------------------------------------

describe("the worked example of the spec (2.5), from real orders", () => {
  let own: Fixture;
  let de: Placed;
  let dk: Placed;
  let store: Awaited<ReturnType<typeof owner>>["store"];

  beforeAll(async () => {
    own = await t.sellerStore("tax-ex");
    de = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    dk = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    expect(await t.issueBackdated(own.storeId)).toBe(2);
    store = (await owner(own)).store;
  }, 60_000);

  it("is a Swedish store in SEK whose documents are 100.00 EUR + 19.00 VAT and 1000.00 DKK + 250.00 VAT, dated 12 September", async () => {
    expect(store.markets[0].nativeCurrency).toBe("SEK");
    const groups = await documentGroups(own.storeId, Q3);
    expect(groups.map((g) => [g.docKind, g.taxDate, g.marketCode, g.currency, g.rate, g.netMinor, g.vatMinor, g.grossMinor, g.dispatchCountry, g.dispatchSource])).toEqual([
      ["invoice", "2026-09-12", "DE", "EUR", 0.19, 10_000, 1_900, 11_900, "SE", "order"],
      ["invoice", "2026-09-12", "DK", "DKK", 0.25, 100_000, 25_000, 125_000, "SE", "order"],
    ]);
    expect(de.tax).toBe(1_900);
    expect(dk.tax).toBe(25_000);
  });

  it("gives OSS Q3 2026 in filing mode: Part 2b DE 100.00 + 19.00, DK 133.77 + 33.44 at the ECB's 7.4755, Part 5 52.44, and the CSV says so", async () => {
    const view = await returnView(store, "oss", Q3, "filing");
    expect(view.state).toBe("on");
    expect(view.data.incomplete).toBe(false);
    expect(view.data.part2).toMatchObject([
      { part: "2b", memberState: "DE", dispatchState: "SE", rate: 0.19, rateKind: "standard", taxableEur: 10_000, vatEur: 1_900 },
      { part: "2b", memberState: "DK", dispatchState: "SE", rate: 0.25, rateKind: "standard", taxableEur: 13_377, vatEur: 3_344 },
    ]);
    expect(view.data.part3).toEqual([]);
    expect(view.data.part4).toMatchObject([{ memberState: "DE", balanceEur: 1_900 }, { memberState: "DK", balanceEur: 3_344 }]);
    expect(view.data.part5Eur).toBe(5_244);
    expect(view.data.rates).toEqual([{ currency: "DKK", day: "2026-09-30", for: "period", choice: { rate: "7.4755", date: "2026-09-30", source: "ecb", reason: null } }]);
    const csv = returnCsv(view.data);
    expect(csv).toEqual({
      ok: true,
      rows: 5,
      csv: [
        "scheme,tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,taxable_amount_eur,vat_amount_eur,correction_period,mode,registration,currency",
        "union,2026-Q3,2b,DE,SE,19,standard,100.00,19.00,,filing,union,EUR",
        "union,2026-Q3,2b,DK,SE,25,standard,133.77,33.44,,filing,union,EUR",
        "union,2026-Q3,4,DE,,,,,19.00,,filing,union,EUR",
        "union,2026-Q3,4,DK,,,,,33.44,,filing,union,EUR",
        "union,2026-Q3,5,,,,,,52.44,,filing,union,EUR",
        "",
      ].join("\r\n"),
    });
    // The conversion detail shows each conversion, so the records of the return can be reproduced.
    const detail = detailCsv(view.data);
    expect(detail.ok && detail.csv.split("\r\n").slice(1, 3)).toEqual([
      "2026-Q3,2b,DE,SE,19,standard,EUR,100.00,19.00,1,,none (euro),100.00,19.00,1,0,",
      "2026-Q3,2b,DK,SE,25,standard,DKK,1000.00,250.00,7.4755,2026-09-30,ecb,133.77,33.44,1,0,",
    ]);
  });

  it("is the same in books mode while no credit note exists, and says where each sale is reported in the VAT table", async () => {
    const books = await returnView(store, "oss", Q3, "books");
    expect(books.data.part5Eur).toBe(5_244);
    const { report } = await vatReport(store, Q3_RANGE);
    expect(report.rows.map((r) => [r.country, r.rate, r.basis, r.currency, r.reportedIn, r.invoices, r.orders, r.netMinor, r.vatMinor, r.grossMinor, r.mainConverted])).toEqual([
      ["DK", 0.25, "standard", "DKK", "OSS Union scheme, part 2b", 1, 1, 100_000, 25_000, 125_000, true],
      ["DE", 0.19, "standard", "EUR", "OSS Union scheme, part 2b", 1, 1, 10_000, 1_900, 11_900, true],
    ]);
    expect(report.totals).toMatchObject({ invoices: 2, creditNotes: 0, orders: 2 });
    expect(report.notConverted).toEqual({ invoices: 0, creditNotes: 0, currencies: [], leftOut: [] });
    expect(vatCsv(report, Q3_RANGE).split("\r\n")[1]).toBe(
      "2026-07-01,2026-09-30,DK,25,standard,\"OSS Union scheme, part 2b\",DKK,1,1,1000.00,250.00,1250.00,0,0.00,0.00,0.00,1000.00,250.00,1250.00,SEK,1466.67,366.67,true",
    );
  });

  it("converts each invoice to the store's main currency at its own stored rate: the converted VAT is the invoice's stored main-currency VAT, to the unit", async () => {
    const { report } = await vatReport(store, Q3_RANGE);
    const stored = await db().execute<Row>(sql`
      select (snapshot -> 'vatMain' ->> 'vatMinor')::bigint as vat from commerce.invoices where store_id = ${own.storeId}::uuid
    `);
    const storedSum = stored.reduce((n, r) => n + Number(r.vat), 0);
    expect(storedSum).toBeGreaterThan(0);
    expect(report.totals.vatChargedMainMinor).toBe(storedSum);
    // 19.00 EUR at 11 SEK and 250.00 DKK at 11 / 7.5 = 1.4667.
    expect(report.totals.vatChargedMainMinor).toBe(20_900 + 36_667);
  });

  it("reconciles to the orders and to Finance's VAT card for the same store and period, in every currency and in the main one", async () => {
    const view = await reconciliation(store, Q3_RANGE);
    expect(view.balanced).toBe(true);
    expect(view.sentence).toBe("Equal: every difference is named.");
    expect(view.bridges.map((b) => [b.currency, b.financeMinor, b.reportMinor, b.differenceMinor])).toEqual([["DKK", 25_000, 25_000, 0], ["EUR", 1_900, 1_900, 0]]);
    expect(view.undocumented).toEqual({ orders: 0, byCause: {} });
    const finance = await periodTotals(store, { ...Q3_RANGE, days: 92, preset: "custom", label: "Q3 2026" });
    expect(view.main.financeMainMinor).toBe(finance.totals.vatMinor);
    expect(view.main.reportMainMinor).toBe(57_567);
    // Σ tax_minor of the paid orders, from the orders themselves.
    const [orders] = await db().execute<Row>(sql`select coalesce(sum(tax_minor), 0)::bigint as vat from commerce.orders where store_id = ${own.storeId}::uuid and copied_from is null`);
    expect(view.bridges.reduce((n, b) => n + b.financeMinor, 0)).toBe(Number(orders.vat));
  });

  it("makes the credit note of a half refund in October: Q3 stays 52.44 with nothing to say, and the quarter of the refund has a Part 3 correction of -16.72 and a Part 5 of 0", async () => {
    const refund = await refundOrder(own.storeId, dk.orderId, { amountMinor: 62_500, reason: "Skadet", restock: [] }, own.ownerId);
    expect(refund).toMatchObject({ ok: true });
    const [note] = await fx.notesOf(own.storeId, dk.orderId);
    expect(note).toMatchObject({ netMinor: 50_000, taxMinor: 12_500, totalMinor: 62_500, currency: "DKK" });
    const now = quarterOfDay(storeToday(store));
    expect(now.key > "2026-Q3").toBe(true);

    // The quarter of the sale is unchanged: the credit note is in the later quarter's window.
    const q3 = await returnView(store, "oss", Q3, "filing");
    expect(q3.data.part5Eur).toBe(5_244);
    expect(q3.data.totals.creditNotes).toBe(0);

    const filing = await returnView(store, "oss", now, "filing");
    expect(filing.data.incomplete).toBe(false);
    expect(filing.data.part2).toEqual([]);
    expect(filing.data.part3).toEqual([{ correctionPeriod: "2026-Q3", memberState: "DK", vatEur: -1_672, complete: true, late: false }]);
    expect(filing.data.part4).toMatchObject([{ memberState: "DK", part2VatEur: 0, part3VatEur: -1_672, balanceEur: -1_672, reimbursed: true }]);
    // A negative balance is the Member State's to reimburse and is not counted in the total.
    expect(filing.data.part5Eur).toBe(0);
    // The correction is converted at the rate of the quarter it corrects, once.
    expect(filing.data.groups).toMatchObject([{ correctionPeriod: "2026-Q3", currency: "DKK", vatMinor: -12_500, rateDay: "2026-09-30", conversion: { rate: "7.4755", source: "ecb" } }]);
    const csv = returnCsv(filing.data);
    expect(csv.ok && csv.csv.split("\r\n").slice(1, 4)).toEqual([
      `union,${now.key},3,DK,,,,,-16.72,2026-Q3,filing,union,EUR`,
      `union,${now.key},4,DK,,,,,-16.72,,filing,union,EUR`,
      `union,${now.key},5,,,,,,0.00,,filing,union,EUR`,
    ]);
  });

  it("in books mode counts the credit note in the quarter it was made, at that quarter's own rate: with none stored the return is incomplete, never estimated, and its CSV is refused", async () => {
    const now = quarterOfDay(storeToday(store));
    const books = await returnView(store, "oss", now, "books");
    expect(books.data.incomplete).toBe(true);
    expect(books.data.missing).toEqual([{ currency: "DKK", day: now.lastDay }]);
    expect(books.data.part2).toMatchObject([{ part: "2b", memberState: "DK", rate: 0.25, vatEur: null, complete: false }]);
    expect(books.data.part3).toEqual([]);
    expect(books.data.groups[0]).toMatchObject({ taxableMinor: -50_000, vatMinor: -12_500, correctionPeriod: null });
    const csv = returnCsv(books.data);
    expect(csv.ok).toBe(false);
    expect(!csv.ok && csv.reason).toContain(`DKK on ${now.lastDay}`);
    // The conversion detail is the file that shows the gap, so it is allowed: the rate columns are empty.
    const detail = detailCsv(books.data);
    expect(detail.ok && detail.csv.split("\r\n")[1]).toBe(`${now.key},2b,DK,SE,25,standard,DKK,-500.00,-125.00,,,missing,,,0,1,`);
  });

  it("uses the owner's own rate for a day instead of the ECB's, labelled with its reason, for this store only", async () => {
    const result = await setRateOverride(await owner(own), { currency: "DKK", day: "2026-09-30", rate: "7.5", reason: "The accountant's rate for the quarter" });
    expect(result).toMatchObject({ ok: true });
    const view = await returnView(store, "oss", Q3, "filing");
    expect(view.data.part2).toMatchObject([{ memberState: "DE", vatEur: 1_900 }, { memberState: "DK", taxableEur: toEuroMinor(100_000, "7.5"), vatEur: toEuroMinor(25_000, "7.5") }]);
    expect(view.data.part2[1]).toMatchObject({ taxableEur: 13_333, vatEur: 3_333 });
    expect(view.data.rates[0].choice).toEqual({ rate: "7.5", date: "2026-09-30", source: "owner", reason: "The accountant's rate for the quarter" });
    const detail = detailCsv(view.data);
    expect(detail.ok && detail.csv).toContain("DKK,1000.00,250.00,7.5,2026-09-30,owner: The accountant's rate for the quarter,133.33,33.33");
    // Another store with the same day is unaffected.
    const other = await t.sellerStore("tax-ex-other");
    const orderOther = await t.paidOn(other, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    expect(orderOther.tax).toBe(25_000);
    await t.issueBackdated(other.storeId);
    const otherView = await returnView((await owner(other)).store, "oss", Q3, "filing");
    expect(otherView.data.part2[0]).toMatchObject({ memberState: "DK", taxableEur: 13_377, vatEur: 3_344 });
    expect(otherView.data.rates[0].choice?.source).toBe("ecb");
  });
});

// ---------------------------------------------------------------------------

describe("a refund in a later quarter, in euro: books and filing, and the sums that must hold", () => {
  let own: Fixture;
  let store: Awaited<ReturnType<typeof owner>>["store"];
  const now = () => quarterOfDay(storeToday(store));

  beforeAll(async () => {
    own = await t.sellerStore("tax-eur");
    const o1 = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    const o2 = await t.paidOn(own, "2026-09-20", [["DEMO-MUG-WHITE", 2]], { market: t.markets.de });
    await t.issueBackdated(own.storeId);
    store = (await owner(own)).store;
    // Today's own order, invoiced at payment, refunded by half; the September order o2 refunded in full, in this quarter.
    const o3 = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    expect(await refundOrder(own.storeId, o2.orderId, { amountMinor: o2.total, reason: "Hele", restock: [] }, own.ownerId)).toMatchObject({ ok: true });
    expect(await refundOrder(own.storeId, o3.orderId, { amountMinor: 5_950, reason: "Halvparten", restock: [] }, own.ownerId)).toMatchObject({ ok: true });
    void o1;
  }, 60_000);

  it("filing: the credit note of the same quarter reduces Part 2, the one of a later quarter is a Part 3 correction, and a negative balance is not in Part 5", async () => {
    const q3 = await returnView(store, "oss", Q3, "filing");
    expect(q3.data.part2).toMatchObject([{ part: "2b", memberState: "DE", rate: 0.19, taxableEur: 30_000, vatEur: 5_700 }]);
    expect(q3.data.part5Eur).toBe(5_700);

    const cur = await returnView(store, "oss", now(), "filing");
    expect(cur.data.incomplete).toBe(false);
    expect(cur.data.part2).toMatchObject([{ part: "2b", memberState: "DE", taxableEur: 5_000, vatEur: 950 }]);
    expect(cur.data.part3).toEqual([{ correctionPeriod: "2026-Q3", memberState: "DE", vatEur: -3_800, complete: true, late: false }]);
    expect(cur.data.part4).toMatchObject([{ memberState: "DE", part2VatEur: 950, part3VatEur: -3_800, balanceEur: -2_850, reimbursed: true }]);
    expect(cur.data.part5Eur).toBe(0);
    // A credit never takes a filing's Part 2 below zero.
    expect(cur.data.part2.every((l) => (l.vatEur ?? 0) >= 0 && (l.taxableEur ?? 0) >= 0)).toBe(true);
  });

  it("books: every credit note is a negative line in the quarter it was made, with no Part 3, and the balance is the same", async () => {
    const cur = await returnView(store, "oss", now(), "books");
    expect(cur.data.part3).toEqual([]);
    expect(cur.data.part2).toMatchObject([{ part: "2b", memberState: "DE", taxableEur: -15_000, vatEur: -2_850 }]);
    expect(cur.data.part4).toMatchObject([{ memberState: "DE", balanceEur: -2_850 }]);
    expect(cur.data.part5Eur).toBe(0);
  });

  it("holds the property: over all quarters Part 2 plus Part 3 is the invoices less the credit notes, in both modes", async () => {
    const sums = await sumsOf(own.storeId);
    const expected = sums.invoicesVat - sums.creditVat;
    expect(expected).toBe(2_850);
    for (const mode of ["filing", "books"] as const) {
      let total = 0;
      for (const period of [Q3, now()]) {
        const v = await returnView(store, "oss", period, mode);
        total += v.data.part2.reduce((n, l) => n + (l.vatEur ?? 0), 0) + v.data.part3.reduce((n, l) => n + (l.vatEur ?? 0), 0);
      }
      expect(total, mode).toBe(expected);
    }
  });

  it("is in the VAT table as invoices and credit notes in the period they are dated, after credits below zero where the refund is bigger", async () => {
    const cur = now();
    const { report } = await vatReport(store, { from: cur.from, to: cur.to });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ country: "DE", currency: "EUR", invoices: 1, creditNotes: 2, vatMinor: 1_900, creditVatMinor: 4_750, vatAfterMinor: -2_850, netAfterMinor: -15_000 });
    expect(report.totals).toMatchObject({ vatChargedMainMinor: 20_900, vatCreditedMainMinor: 52_250, vatAfterMainMinor: -31_350, invoices: 1, creditNotes: 2 });
    const csv = vatCsv(report, cur).split("\r\n")[1];
    expect(csv).toContain(",EUR,1,1,100.00,19.00,119.00,2,-250.00,-47.50,-297.50,");
  });

  it("reconciles in the quarter of the refunds and shows the refunds line, the credit notes against Finance's refunds without VAT", async () => {
    const cur = now();
    const view = await reconciliation(store, { from: cur.from, to: cur.to });
    expect(view.balanced).toBe(true);
    expect(view.refunds).toHaveLength(1);
    expect(view.refunds[0]).toMatchObject({ currency: "EUR", refunds: 2, withinRounding: true });
    expect(view.refunds[0].creditNotesMinor).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------

describe("every kind of order, and where it is reported", () => {
  let own: Fixture;
  let store: Awaited<ReturnType<typeof owner>>["store"];

  beforeAll(async () => {
    own = await t.sellerStore("tax-kinds");
    await t.paidOn(own, "2026-09-05", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de }); // goods: 2b
    await t.paidOn(own, "2026-09-06", [["DEMO-LAMP", 1]], { market: t.markets.de }); // a download: 2a
    await t.paidOn(own, "2026-09-07", [["DEMO-MUG-WHITE", 1], ["DEMO-LAMP", 1]], { market: t.markets.de }); // goods and a download: 2b, with a note
    await t.paidOn(own, "2026-09-08", [["DEMO-MUG-WHITE", 1]], { market: t.markets.se }); // domestic: Swedish return
    await t.paidOn(own, "2026-09-09", [["DEMO-MUG-WHITE", 1]], { market: t.markets.no }); // Norway, for a store that is not established there: no return here
    await t.paidOn(own, "2026-09-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk, company: { name: "Kunde ApS", number: "12345678" } }); // a business, VAT charged
    await t.issueBackdated(own.storeId);
    store = (await owner(own)).store;
  }, 90_000);

  it("puts goods in 2b, a download in 2a and the rest where they belong, with a reason for everything left out of the return", async () => {
    const view = await returnView(store, "oss", Q3, "filing");
    expect(view.data.part2.map((l) => [l.part, l.memberState, l.rate])).toEqual([
      ["2a", "DE", 0.19],
      ["2b", "DE", 0.19],
    ]);
    // The download alone is 2a; the mug alone and the mug with a download are goods, so 2b (the download is carried with them, and noted).
    expect(view.data.partCounts).toEqual({ "2a": 1, "2b": 2 });
    expect(view.data.flagCounts.mixed_goods_download).toBe(1);
    expect(view.data.part2.find((l) => l.part === "2a")).toMatchObject({ taxableEur: 10_000, vatEur: 1_900 });
    expect(view.data.part2.find((l) => l.part === "2b")).toMatchObject({ taxableEur: 30_000, vatEur: 5_700 });
    const left = Object.fromEntries(view.data.notIncluded.map((n) => [`${n.reason}|${n.currency}`, n.documentLines]));
    expect(left["domestic|SEK"]).toBe(1);
    // The finding: Norwegian VAT of a Swedish store is not for the Swedish return.
    expect(left["non_eu_market_foreign|NOK"]).toBe(1);
    expect(left["non_eu_market|NOK"]).toBeUndefined();
    expect(left["business_buyer|DKK"]).toBe(1);
  });

  it("is the same table in the VAT view: each row says where it is reported, so the two views never disagree", async () => {
    const { report } = await vatReport(store, Q3_RANGE);
    const where = Object.fromEntries(report.rows.map((r) => [`${r.country}|${r.currency}|${r.reportedIn}`, r.invoices]));
    expect(where["SE|SEK|National return (domestic sale)"]).toBe(1);
    expect(where["NO|NOK|Not in a return: market outside the EU, store not established there"]).toBe(1);
    expect(where["NO|NOK|National return (market outside the EU)"]).toBeUndefined();
    expect(where["DK|DKK|Not in a return: business buyer"]).toBe(1);
    expect(where["DE|EUR|OSS Union scheme, part 2a"]).toBe(1);
    expect(where["DE|EUR|OSS Union scheme, part 2b"]).toBe(2);
    // Every document is somewhere: the places partition the documents.
    expect(report.totals.invoices).toBe(6);
    expect(report.rows.reduce((n, r) => n + r.invoices, 0)).toBe(6);
  });
});

describe("the VAT view and the reconciliation are read in one snapshot", () => {
  it("setBasedSnapshot does not see what another connection commits after its first read, where two reads would", async () => {
    const bucket = `snap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const count = sql`select count(*)::int as n from commerce.chat_usage where bucket = ${bucket}`;
    const insert = () => db().execute(sql`insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${bucket}, now(), 1)`);
    const seen = await setBasedSnapshot(async (read) => {
      const first = Number((await read<Row>(count))[0].n);
      await insert(); // committed by another connection while the snapshot is open: an invoice the cron issued between two reads
      const second = Number((await read<Row>(count))[0].n);
      return { first, second };
    });
    expect(seen).toEqual({ first: 0, second: 0 });
    // Outside a snapshot the same two reads disagree, which is the race the page used to have.
    expect(Number((await db().execute<Row>(count))[0].n)).toBe(1);
    await db().execute(sql`delete from commerce.chat_usage where bucket = ${bucket}`);
  });

  it("gives a bridge whose report line is the VAT table's own figure in every currency, and the same documents on both sides", async () => {
    const own = await t.sellerStore("tax-snapshot");
    await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    await t.paidOn(own, "2026-09-13", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    await t.issueBackdated(own.storeId);
    const store = (await owner(own)).store;
    const { view, reconciliation: recon } = await taxSnapshot(store, Q3_RANGE);
    expect(recon.balanced).toBe(true);
    for (const bridge of recon.bridges) {
      const table = view.report.byCurrency.find((c) => c.currency === bridge.currency);
      expect(bridge.reportMinor).toBe(table?.vatMinor);
    }
    expect(view.report.totals.orders).toBe(recon.bridges.reduce((n, b) => n + (b.lines.find((l) => l.kind === "report")?.orders ?? 0), 0));
    // The standalone reconciliation is the same figure.
    expect((await reconciliation(store, Q3_RANGE)).bridges.map((b) => [b.currency, b.reportMinor])).toEqual(recon.bridges.map((b) => [b.currency, b.reportMinor]));
  }, 90_000);
});

describe("a market outside the EU is the national return only of a store established there", () => {
  it("puts a Norwegian store's sale to Norway in its national return, and a Swedish store's in none of this report's returns", async () => {
    const norwegian = await t.sellerStore("tax-noneu-no", { country: "NO", oss: false });
    const swedish = await t.sellerStore("tax-noneu-se");
    for (const own of [norwegian, swedish]) {
      await t.paidOn(own, "2026-09-09", [["DEMO-MUG-WHITE", 1]], { market: t.markets.no });
      await t.issueBackdated(own.storeId);
    }
    const noStore = (await owner(norwegian)).store;
    const seStore = (await owner(swedish)).store;
    const no = await vatReport(noStore, Q3_RANGE);
    expect(no.report.rows.filter((r) => r.country === "NO").map((r) => [r.place, r.reason, r.reportedIn])).toEqual([["national", "non_eu_market", "National return (market outside the EU)"]]);
    const se = await vatReport(seStore, Q3_RANGE);
    expect(se.report.rows.filter((r) => r.country === "NO").map((r) => [r.place, r.reason, r.reportedIn])).toEqual([["none", "non_eu_market_foreign", "Not in a return: market outside the EU, store not established there"]]);
    // The OSS view's left-out table says whose VAT it is, in the Swedish store's words and not "your national VAT return".
    const view = await returnView(seStore, "oss", Q3, "filing");
    const left = view.data.notIncluded.find((n) => n.reason === "non_eu_market_foreign");
    expect(left?.text).toContain("not established");
    expect(left?.text).not.toContain("belongs in your national VAT return");
  }, 90_000);
});

// ---------------------------------------------------------------------------

describe("IOSS: a Norwegian store with an IOSS number, a month, and what is not marked", () => {
  let own: Fixture;
  let store: Awaited<ReturnType<typeof owner>>["store"];
  const SEPT = monthPeriod(2026, 9);
  let orders: Record<string, Placed> = {};

  beforeAll(async () => {
    own = await t.sellerStore("tax-ioss", { country: "NO", ioss: { number: "IM1234567890", markets: ["SE", "DK", "DE"] } });
    orders = {
      se: await t.paidOn(own, "2026-09-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.se }),
      dk: await t.paidOn(own, "2026-09-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk }),
      de: await t.paidOn(own, "2026-09-11", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de }),
      big: await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 4]], { market: t.markets.de }),
      biz: await t.paidOn(own, "2026-09-13", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk, company: { name: "Kunde ApS", number: "12345678" } }),
    };
    await t.issueBackdated(own.storeId);
    store = (await owner(own)).store;
  }, 90_000);

  const kinds = async () =>
    Object.fromEntries((await db().execute<Row>(sql`select o.id, o.vat_kind from commerce.orders o where o.store_id = ${own.storeId}::uuid`)).map((r) => [String(r.id), String(r.vat_kind)]));

  it("marks three consignments of at most 150 EUR to the registered markets, and not the one above the limit or the business", async () => {
    const k = await kinds();
    expect([k[orders.se.orderId], k[orders.dk.orderId], k[orders.de.orderId]]).toEqual(["ioss", "ioss", "ioss"]);
    expect(k[orders.big.orderId]).toBe("standard");
    expect(k[orders.biz.orderId]).toBe("standard");
  });

  it("gives the monthly IOSS data per Member State and rate in euro at the ECB's rates of 30 September, with the unmarked orders listed and the reason", async () => {
    const view = await returnView(store, "ioss", SEPT, "filing");
    expect(view.state).toBe("on");
    expect(view.data.registration).toBe("ioss");
    expect(view.data.incomplete).toBe(false);
    const groups = await documentGroups(own.storeId, SEPT);
    const ioss = groups.filter((g) => g.vatKind === "ioss");
    expect(ioss.map((g) => g.marketCode).sort()).toEqual(["DE", "DK", "SE"]);
    for (const g of ioss) {
      const rate = g.currency === "EUR" ? null : g.currency === "SEK" ? "11.331" : "7.4755";
      const line = view.data.part2.find((l) => l.memberState === g.marketCode && l.part === "IOSS")!;
      expect(line, g.marketCode).toBeDefined();
      expect(line.taxableEur).toBe(rate ? toEuroMinor(g.netMinor, rate) : g.netMinor);
      expect(line.vatEur).toBe(rate ? toEuroMinor(g.vatMinor, rate) : g.vatMinor);
    }
    // 17 900 DKK incl. VAT at 25 %: 3 580 VAT = 4.79 EUR; the German mug 119.00 EUR has 19.00 VAT.
    expect(view.data.part2.find((l) => l.memberState === "DE")).toMatchObject({ part: "IOSS", rate: 0.19, taxableEur: 10_000, vatEur: 1_900 });
    expect(view.data.part2.find((l) => l.memberState === "DK")).toMatchObject({ part: "IOSS", rate: 0.25, vatEur: toEuroMinor(orders.dk.tax, "7.4755") });
    expect(view.data.part5Eur).toBe(view.data.part2.reduce((n, l) => n + (l.vatEur ?? 0), 0));
    // The order above 150 EUR is an import with VAT charged: said, not hidden, and in no IOSS data.
    const left = Object.fromEntries(view.data.notIncluded.map((n) => [`${n.reason}|${n.currency}`, n]));
    expect(left["dispatch_outside_eu|EUR"]).toMatchObject({ documentLines: 1, vatMinor: orders.big.tax });
    expect(left["business_buyer|DKK"]).toMatchObject({ documentLines: 1, vatMinor: orders.biz.tax });
    const csv = returnCsv(view.data);
    expect(csv.ok && csv.csv.split("\r\n")[1]).toBe(`ioss,2026-09,IOSS,DE,,19,standard,100.00,19.00,,filing,ioss,EUR`);
  });

  it("leaves the OSS view with none of the IOSS consignments, and says each is marked IOSS", async () => {
    const view = await returnView(store, "oss", Q3, "filing");
    expect(view.data.registration).toBe("none");
    expect(view.data.part2).toEqual([]);
    expect(view.data.notIncluded.filter((n) => n.reason === "ioss").reduce((n, l) => n + l.documentLines, 0)).toBe(3);
    expect(view.data.notes).toEqual([]);
  });

  it("makes a refund of the Swedish consignment next month a Part 3 correction of September, converted at September's rate, and the month of the refund's own books incomplete", async () => {
    expect(await refundOrder(own.storeId, orders.se.orderId, { amountMinor: orders.se.total, reason: "Retur", restock: [] }, own.ownerId)).toMatchObject({ ok: true });
    const month = monthOfDay(storeToday(store));
    expect(month.key > SEPT.key).toBe(true);
    const filing = await returnView(store, "ioss", month, "filing");
    expect(filing.data.part3).toEqual([{ correctionPeriod: "2026-09", memberState: "SE", vatEur: -toEuroMinor(orders.se.tax, "11.331"), complete: true, late: false }]);
    expect(filing.data.part5Eur).toBe(0);
    const books = await returnView(store, "ioss", month, "books");
    expect(books.data.incomplete).toBe(true);
    expect(books.data.missing[0]).toEqual({ currency: "SEK", day: month.lastDay });
    // September itself is unchanged by a refund made in October.
    const sept = await returnView(store, "ioss", SEPT, "filing");
    expect(sept.data.totals.creditNotes).toBe(0);
  });

  it("is off with its reason when there is no number and no marked sale, and shows the history when the number was taken away", async () => {
    const bare = await t.sellerStore("tax-ioss-off", { country: "NO" });
    const off = await returnView((await owner(bare)).store, "ioss", SEPT, "filing");
    expect(off.state).toBe("off");
    expect(off.data.part2).toEqual([]);
    // The history: the same store as above with its number removed.
    await db().execute(sql`update commerce.store_tax_profile set ioss_number = null where store_id = ${own.storeId}::uuid`);
    const history = await returnView((await owner(own)).store, "ioss", SEPT, "filing");
    expect(history.state).toBe("history");
    expect(history.data.registration).toBe("none");
    expect(history.data.notes.map((n) => n.code)).toEqual(["ioss_sales_no_number"]);
    expect(history.data.part2.length).toBeGreaterThan(0);
    await db().execute(sql`update commerce.store_tax_profile set ioss_number = 'IM1234567890' where store_id = ${own.storeId}::uuid`);
  });

  it("refuses an OSS return for a month and an IOSS return for a quarter", async () => {
    await expect(returnView(store, "oss", SEPT, "filing")).rejects.toThrow(RangeError);
    await expect(returnView(store, "ioss", Q3, "filing")).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------

describe("the reconciliation: every difference has a name", () => {
  let own: Fixture;
  let store: Awaited<ReturnType<typeof owner>>["store"];
  const ids: Record<string, Placed> = {};
  const Q4 = quarterPeriod(2026, 4);
  const NOW = Q3_RANGE;

  /** Moves an order's placing and payment to given moments in the store's time zone, as the order's story needs. */
  async function atTimes(storeId: string, orderId: string, placed: string, paid: string) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.order_events disable trigger order_events_append_only`);
      await tx.execute(sql`
        update commerce.order_events set created_at = (${paid}::timestamp at time zone (select time_zone from commerce.stores where id = ${storeId}::uuid))
        where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = 'order.paid'
      `);
      await tx.execute(sql`alter table commerce.order_events enable trigger order_events_append_only`);
      await tx.execute(sql`update commerce.orders set placed_at = (${placed}::timestamp at time zone (select time_zone from commerce.stores where id = ${storeId}::uuid)) where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
    });
  }

  beforeAll(async () => {
    own = await t.sellerStore("tax-recon");
    const id = own.storeId;
    const testAccount = `acct_${own.slug.replace(/[^a-z0-9]/gi, "")}test`;
    // A second Stripe account, in test mode, for the order paid with test cards.
    await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${id}::uuid, 'test', ${testAccount}, 'active', false)`);

    // All of these are paid while invoicing is off (the invoice of each is made, or not, afterwards, as the story needs).
    ids.normal = await t.paidOn(own, "2026-09-20", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    ids.normalDk = await t.paidOn(own, "2026-09-21", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    // Placed and paid on 1 July, before invoicing comes on (2 July): it never gets an invoice.
    ids.off = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { market: t.markets.de });
    await atTimes(id, ids.off.orderId, "2026-07-01 10:00", "2026-07-01 10:30");
    // Placed on the last evening and paid after midnight.
    ids.late = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 3]], { market: t.markets.de });
    await atTimes(id, ids.late.orderId, "2026-09-30 23:50", "2026-10-01 00:10");
    // Placed on the last evening of June and paid in July.
    ids.early = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 4]], { market: t.markets.de });
    await atTimes(id, ids.early.orderId, "2026-06-30 22:00", "2026-07-02 09:00");
    // Paid with test cards: placed, its payment moved to the test account, then paid.
    ids.test = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 5]], { market: t.markets.de, pay: false });
    await db().execute(sql`update commerce.payments set provider_account = ${testAccount} where store_id = ${id}::uuid and order_id = ${ids.test.orderId}::uuid`);
    await fx.payPlaced(own, ids.test);
    await t.backdate(id, ids.test.orderId, "2026-09-22");
    // Confirmed at the venue: invoiced, but no captured payment.
    ids.venue = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 6]], { market: t.markets.de, provider: "venue" });
    await db().execute(sql`update commerce.payments set status = 'pending' where store_id = ${id}::uuid and order_id = ${ids.venue.orderId}::uuid`);
    await t.backdate(id, ids.venue.orderId, "2026-09-24");
    // A copied order and a host's order that were paid: nobody's invoice, nobody's Finance.
    ids.copied = await t.paidOn(own, "2026-09-26", [["DEMO-MUG-WHITE", 7]], { market: t.markets.de });
    ids.host = await t.paidOn(own, "2026-09-26", [["DEMO-MUG-WHITE", 8]], { market: t.markets.de });
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-${own.slug}@example.com`}, 'Host') returning id`);
    const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set number = 'C-' || number, copied_from = ${ids.normal.orderId}::uuid where id = ${ids.copied.orderId}::uuid`);
      await tx.execute(sql`update commerce.orders set host_id = ${String(host.id)}::uuid where id = ${ids.host.orderId}::uuid`);
    });

    // Invoicing comes on from 2 July, and the invoices that can be made are made.
    await db().execute(sql`update commerce.invoice_settings set enabled = true where store_id = ${id}::uuid`);
    await db().execute(sql`update commerce.invoice_settings set enabled_from = '2026-07-02T00:00:00Z' where store_id = ${id}::uuid`);
    expect(await issueWaitingInvoices(id, 500)).toBe(5);
    // Then the seller's details are taken away, and the next order paid waits for them for good.
    await db().execute(sql`update commerce.stores set legal_name = null where id = ${id}::uuid`);
    ids.waiting = await t.paidOn(own, "2026-09-23", [["DEMO-MUG-WHITE", 9]], { market: t.markets.de });
    store = (await owner(own)).store;
  }, 120_000);

  afterAll(async () => {
    // This store keeps a waiting order and a test-mode order for good; the job that issues waiting invoices must not count it as work.
    await db().execute(sql`update commerce.invoice_settings set enabled = false where store_id = ${own.storeId}::uuid`);
  });

  it("is set up: an order that will never be invoiced, a waiting one, a test order, a copied and a host's order", async () => {
    const held = await db().execute<Row>(sql`select o.id, commerce.invoice_eligibility(o.id) as e from commerce.orders o where o.store_id = ${own.storeId}::uuid`);
    const byId = new Map(held.map((r) => [String(r.id), String(r.e)]));
    expect(byId.get(ids.off.orderId)).toBe("disabled");
    expect(byId.get(ids.test.orderId)).toBe("test_mode");
    expect(byId.get(ids.copied.orderId)).toBe("copied");
    expect(byId.get(ids.host.orderId)).toBe("host");
    expect(byId.get(ids.waiting.orderId)).toBe("ok");
  });

  it("has the invoices that could be made, with their supply dates, and none for the order from before invoicing, the test order, the copied and the host's order", async () => {
    const have = await db().execute<Row>(sql`select o.id, i.supply_date::text as d from commerce.orders o join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id where o.store_id = ${own.storeId}::uuid`);
    const dates = Object.fromEntries(have.map((r) => [String(r.id), String(r.d)]));
    expect(dates[ids.normal.orderId]).toBe("2026-09-20");
    expect(dates[ids.late.orderId]).toBe("2026-10-01");
    expect(dates[ids.early.orderId]).toBe("2026-07-02");
    expect(dates[ids.venue.orderId]).toBe("2026-09-24");
    for (const none of [ids.off, ids.test, ids.copied, ids.host, ids.waiting]) expect(dates[none.orderId], none.number).toBeUndefined();
  });

  it("names every difference in Q3 in each currency: the bridge is exact, with each cause once and counted", async () => {
    const view = await reconciliation(store, NOW);
    expect(view.balanced).toBe(true);
    expect(view.sentence).toBe("Equal: every difference is named.");
    const eur = view.bridges.find((b) => b.currency === "EUR")!;
    const line = (cause: string) => eur.lines.find((l) => l.cause === cause);
    expect(line("timing_in")).toMatchObject({ orders: 1, taxMinor: ids.early.tax });
    expect(line("not_captured")).toMatchObject({ orders: 1, taxMinor: ids.venue.tax });
    expect(line("timing_out")).toMatchObject({ orders: 1, taxMinor: ids.late.tax });
    expect(line("invoicing_off")).toMatchObject({ orders: 1, taxMinor: ids.off.tax });
    expect(line("waiting")).toMatchObject({ orders: 1, taxMinor: ids.waiting.tax });
    expect(line("test_mode")).toMatchObject({ orders: 1, taxMinor: ids.test.tax });
    expect(line("other")).toBeUndefined();
    // Finance: the paid orders placed in the quarter (not the copied one, not the host's, not the early one placed in June, not the venue's).
    expect(eur.financeMinor).toBe([ids.normal, ids.off, ids.late, ids.test, ids.waiting].reduce((n, o) => n + o.tax, 0));
    // The report: the invoices dated in the quarter (not the one dated 1 October).
    expect(eur.reportMinor).toBe([ids.normal, ids.early, ids.venue].reduce((n, o) => n + o.tax, 0));
    expect(eur.differenceMinor).toBe(0);
    const dkk = view.bridges.find((b) => b.currency === "DKK")!;
    expect(dkk.lines.map((l) => l.kind)).toEqual(["finance", "report"]);
    expect(dkk.balanced).toBe(true);
  });

  it("counts the paid orders with no invoice by cause, which is the header line of the page, and leaves out the copied and the host's", async () => {
    const view = await reconciliation(store, NOW);
    expect(view.undocumented.byCause).toEqual({ invoicing_off: 1, test_mode: 1, waiting: 1 });
    expect(view.undocumented.orders).toBe(3);
    const finance = view.bridges.find((b) => b.currency === "EUR")!.lines[0];
    expect(finance.orders).toBe(5);
  });

  it("ties Finance's line in the main currency to the Finance page's VAT card, and closes with the named exchange-rate and rounding lines", async () => {
    const view = await reconciliation(store, NOW);
    const finance = await periodTotals(store, { ...NOW, days: 92, preset: "custom", label: "Q3 2026" });
    expect(view.main.financeMainMinor).toBe(finance.totals.vatMinor);
    const lines = view.main.lines;
    const sum = (kinds: string[]) => lines.filter((l) => kinds.includes(l.kind) || (l.kind === "cause")).reduce((n, l) => n + (l.kind === "cause" ? l.sign * l.taxMinor : l.taxMinor), 0);
    void sum;
    // The identity of the main bridge: Finance, plus each cause with its sign, plus the named closing lines, is the report's figure.
    const closing = lines.filter((l) => l.kind === "rounding" || l.kind === "exchange_rate").reduce((n, l) => n + l.taxMinor, 0);
    const causes = lines.filter((l) => l.kind === "cause").reduce((n, l) => n + l.sign * l.taxMinor, 0);
    expect(view.main.financeMainMinor + causes + closing).toBe(view.main.reportMainMinor);
  });

  it("shows the next quarter's other half of the timing: the invoice dated 1 October is an invoice of orders placed before it", async () => {
    const view = await reconciliation(store, { from: Q4.from, to: Q4.to });
    expect(view.balanced).toBe(true);
    const eur = view.bridges.find((b) => b.currency === "EUR")!;
    expect(eur.lines.find((l) => l.cause === "timing_in")).toMatchObject({ orders: 1, taxMinor: ids.late.tax });
    expect(eur.financeMinor).toBe(0);
  });

  it("says plainly when it does not reconcile: an order whose VAT was changed after its invoice was made", async () => {
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set tax_minor = tax_minor + 7 where id = ${ids.normal.orderId}::uuid`);
    });
    const view = await reconciliation(store, NOW);
    expect(view.balanced).toBe(false);
    expect(view.sentence).toBe("Does not reconcile");
    expect(view.bridges.find((b) => b.currency === "EUR")!.differenceMinor).toBe(-7);
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set tax_minor = tax_minor - 7 where id = ${ids.normal.orderId}::uuid`);
    });
    expect((await reconciliation(store, NOW)).balanced).toBe(true);
  });

  it("never shows another store's orders or documents", async () => {
    const other = await t.sellerStore("tax-recon-other");
    const otherStore = (await owner(other)).store;
    expect(await documentGroups(other.storeId, NOW)).toEqual([]);
    const view = await reconciliation(otherStore, NOW);
    expect(view.bridges).toEqual([]);
    expect(view.balanced).toBe(true);
    expect(view.undocumented.orders).toBe(0);
    expect((await vatReport(otherStore, NOW)).report.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("a document with no stored conversion to the store's main currency", () => {
  it("is counted and left out of the main-currency figures, never converted at today's rate, and present in its own currency", async () => {
    const own = await t.sellerStore("tax-nofx");
    const order = await t.paidOn(own, "2026-09-15", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    expect(await t.issueBackdated(own.storeId)).toBe(1);
    // The invoice keeps its conversion to kronor (the main currency when it was made). The store then moves its home to Norway: the main
    // currency is now the Norwegian krone, and no document holds a conversion to it.
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${own.storeId}::uuid`);
    const store = (await owner(own)).store;
    expect(store.markets[0].nativeCurrency).toBe("NOK");
    const { report } = await vatReport(store, Q3_RANGE);
    expect(report.mainCurrency).toBe("NOK");
    expect(report.notConverted).toEqual({ invoices: 1, creditNotes: 0, currencies: ["DKK"], leftOut: [{ currency: "DKK", invoices: 1, vatMinor: order.tax }] });
    expect(report.totals).toMatchObject({ invoices: 1, vatChargedMainMinor: 0 });
    expect(report.rows[0]).toMatchObject({ currency: "DKK", vatMinor: order.tax, mainConverted: false, vatMainMinor: null });
    const row = vatCsv(report, Q3_RANGE).split("\r\n")[1];
    expect(row.endsWith(",1250.00,,,,false")).toBe(true);
    // The own-currency figures are there, and the OSS data (which converts from the document's own currency at the ECB's rate) is complete.
    expect(row).toContain(",DKK,1,1,1000.00,250.00,1250.00,");
    expect((await returnView(store, "oss", Q3, "filing")).data.part5Eur).toBe(3_344);
    const view = await reconciliation(store, Q3_RANGE);
    expect(view.balanced).toBe(true);
    expect(view.main.currency).toBe("NOK");
    expect(view.main.reportMainMinor).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("the dispatch country is frozen on the order", () => {
  it("is written by placeOrder(), and a later change of the store's setting never reclassifies a placed order", async () => {
    const own = await t.sellerStore("tax-frozen");
    const before = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    const [row] = await db().execute<Row>(sql`select vat_treatment ->> 'dispatchCountry' as d from commerce.orders where id = ${before.orderId}::uuid`);
    expect(row.d).toBe("SE");
    await t.issueBackdated(own.storeId);
    const store = (await owner(own)).store;
    const reportBefore = (await vatReport(store, Q3_RANGE)).report.rows.map((r) => r.reportedIn);
    expect(reportBefore).toEqual(["OSS Union scheme, part 2b"]);

    // The store now says it dispatches from Germany: new orders are domestic there, the placed one is as it was.
    await db().execute(sql`update commerce.store_tax_profile set dispatch_country = 'DE' where store_id = ${own.storeId}::uuid`);
    const [group] = await documentGroups(own.storeId, Q3);
    expect(group).toMatchObject({ dispatchCountry: "SE", dispatchSource: "order" });
    expect((await vatReport(store, Q3_RANGE)).report.rows.map((r) => r.reportedIn)).toEqual(reportBefore);
    const after = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    const [fresh] = await db().execute<Row>(sql`select vat_treatment ->> 'dispatchCountry' as d from commerce.orders where id = ${after.orderId}::uuid`);
    expect(fresh.d).toBe("DE");

    // An order from before the field existed has none: the live setting is used and the group says so.
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set vat_treatment = vat_treatment - 'dispatchCountry' where id = ${before.orderId}::uuid`);
    });
    const [legacy] = await documentGroups(own.storeId, Q3);
    expect(legacy).toMatchObject({ dispatchCountry: "DE", dispatchSource: "profile" });
    const view = await returnView(store, "oss", Q3, "filing");
    expect(view.data.notIncluded.map((n) => n.reason)).toEqual(["domestic"]);
  });
});

// ---------------------------------------------------------------------------

describe("what the functions refuse", () => {
  it("reads only a range of real days in order, and a period of the kind the scheme has", () => {
    expect(() => checkRange({ from: "2026-07-01", to: "2026-07-01" })).toThrow(RangeError);
    expect(() => checkRange({ from: "2026-07-01", to: "2026-06-30" })).toThrow(RangeError);
    expect(() => checkRange({ from: "2026-7-1", to: "2026-10-01" })).toThrow(RangeError);
    expect(() => checkRange({ from: "2020-01-01", to: "2026-10-01" })).toThrow(RangeError);
    expect(() => checkRange({ from: "2026-07-01", to: "2026-10-01" })).not.toThrow();
  });
});
