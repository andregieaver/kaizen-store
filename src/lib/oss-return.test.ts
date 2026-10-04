import { describe, expect, it } from "vitest";

import { buildReturn, iossState, registrationOf, type RateLookup, type ReturnInput } from "./oss-return";
import type { DocGroup } from "./tax-report";
import { monthPeriod, quarterPeriod } from "./tax-periods";

const registration = { ossScheme: "union" as const, iossNumber: null };

/** The ECB's rate of the last day of Q3 2026 (read 2026-10-04): DKK 7.4755. Q4's last day is made up for the books-mode case. */
const rates: Record<string, string> = { "DKK|2026-09-30": "7.4755", "SEK|2026-09-30": "11.331", "NOK|2026-09-30": "10.9015", "DKK|2026-12-31": "7.5" };
const rateFor: RateLookup = (currency, day) => (rates[`${currency}|${day}`] ? { rate: rates[`${currency}|${day}`], date: day, source: "ecb", reason: null } : null);

const g = (over: Partial<DocGroup> = {}): DocGroup => ({
  docKind: "invoice",
  taxDate: "2026-09-12",
  originalTaxDate: null,
  marketCode: "DE",
  marketInEu: true,
  currency: "EUR",
  mainCurrency: "SEK",
  fxState: "stored",
  fxRate: "11.2",
  vatKind: "standard",
  buyerType: "consumer",
  hasPhysical: true,
  hasDownload: false,
  hasService: false,
  dispatchCountry: "SE",
  dispatchSource: "order",
  sellerCountry: "SE",
  sellerOssMemberState: "SE",
  sellerSource: "order",
  rate: 0.19,
  basis: "standard",
  standardRate: 0.19,
  documents: 1,
  orders: 1,
  currencyOrders: 1,
  kindDocuments: 1,
  netMinor: 10000,
  vatMinor: 1900,
  grossMinor: 11900,
  netMainMinor: 0,
  vatMainMinor: 0,
  grossMainMinor: 0,
  ...over,
});
const dk = (over: Partial<DocGroup> = {}) => g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, ...over });
const credit = (over: Partial<DocGroup> = {}) => g({ docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", orders: 0, netMinor: 5000, vatMinor: 950, grossMinor: 5950, ...over });
const dkCredit = (over: Partial<DocGroup> = {}) => credit({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 50000, vatMinor: 12500, grossMinor: 62500, ...over });

const ret = (over: Partial<ReturnInput> & { groups: DocGroup[] }): ReturnType<typeof buildReturn> =>
  buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", registration, rateFor, ...over });

describe("the worked example of docs/wave-1c-reports.md 2.5", () => {
  const q3 = ret({ groups: [g(), dk()] });

  it("Q3 2026, filing: Part 2b DE 19 % and DK 25 % in euro at the ECB rate of 30 September", () => {
    expect(q3.part2).toEqual([
      { part: "2b", memberState: "DE", dispatchState: "SE", rate: 0.19, rateKind: "standard", taxableEur: 10000, vatEur: 1900, complete: true },
      { part: "2b", memberState: "DK", dispatchState: "SE", rate: 0.25, rateKind: "standard", taxableEur: 13377, vatEur: 3344, complete: true },
    ]);
    expect(q3.part3).toEqual([]);
    expect(q3.part4.map((b) => [b.memberState, b.balanceEur])).toEqual([["DE", 1900], ["DK", 3344]]);
    expect(q3.part5Eur).toBe(5244);
    expect(q3.totals).toMatchObject({ vatEur: 5244, taxableEur: 23377, documents: 2, creditNotes: 0 });
    expect(q3.incomplete).toBe(false);
    expect(q3.rates).toEqual([{ currency: "DKK", day: "2026-09-30", for: "period", choice: { rate: "7.4755", date: "2026-09-30", source: "ecb", reason: null } }]);
  });

  it("a euro group is not converted: no rate asked for", () => {
    const only = ret({ groups: [g()], rateFor: () => { throw new Error("no rate may be asked for euro"); } });
    expect(only.groups[0]).toMatchObject({ conversion: null, taxableEur: 10000, vatEur: 1900 });
    expect(only.rates).toEqual([]);
  });

  it("Q4 2026, filing: the half refund of the DK order is a Part 3 correction of Q3, at Q3's rate; Part 2 is empty; Part 4 DK is negative; Part 5 is 0", () => {
    const q4 = ret({ period: quarterPeriod(2026, 4), groups: [dkCredit()] });
    expect(q4.part2).toEqual([]);
    expect(q4.part3).toEqual([{ correctionPeriod: "2026-Q3", memberState: "DK", vatEur: -1672, complete: true, late: false }]);
    expect(q4.part4).toEqual([{ memberState: "DK", part2VatEur: 0, part3VatEur: -1672, balanceEur: -1672, complete: true, reimbursed: true }]);
    expect(q4.part5Eur).toBe(0);
    expect(q4.groups[0]).toMatchObject({ correctionPeriod: "2026-Q3", rateDay: "2026-09-30", taxableMinor: -50000, vatMinor: -12500, taxableEur: -6689, vatEur: -1672 });
    expect(q4.rates).toEqual([expect.objectContaining({ currency: "DKK", day: "2026-09-30", for: "correction" })]);
  });

  it("Q4 2026, books: the same credit is a negative DK line in Part 2 at Q4's own rate, and there is no Part 3", () => {
    const q4 = ret({ period: quarterPeriod(2026, 4), mode: "books", groups: [dkCredit()] });
    expect(q4.part3).toEqual([]);
    expect(q4.part2).toEqual([{ part: "2b", memberState: "DK", dispatchState: "SE", rate: 0.25, rateKind: "standard", taxableEur: -6667, vatEur: -1667, complete: true }]);
    expect(q4.part4[0].balanceEur).toBe(-1667);
    expect(q4.part5Eur).toBe(0);
  });

  it("Q3 opened again on 7 October gives the same figures (its document set is unchanged)", () => {
    expect(ret({ groups: [g(), dk()] })).toEqual(q3);
  });
});

describe("credit notes in the same period", () => {
  it("reduce Part 2 in both modes, converted once with the invoices", () => {
    for (const mode of ["filing", "books"] as const) {
      const r = ret({ mode, groups: [dk(), dkCredit({ taxDate: "2026-09-20" })] });
      expect(r.part3).toEqual([]);
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0]).toMatchObject({ taxableMinor: 50000, vatMinor: 12500, invoices: 1, creditNotes: 1, taxableEur: 6689, vatEur: 1672 });
    }
  });

  it("never make a Part 2 line negative in filing mode when the credit is no more than the invoice", () => {
    const r = ret({ groups: [dk(), dkCredit({ taxDate: "2026-09-20", netMinor: 100000, vatMinor: 25000, grossMinor: 125000 })] });
    expect(r.part2[0].vatEur).toBe(0);
    expect(r.part2[0].taxableEur).toBe(0);
  });
});

describe("conversion once per group", () => {
  it("sums the amounts of the group in the document currency and converts the sum, so rounding does not accumulate per document", () => {
    const two = (rate: string): RateLookup => (c, day) => ({ rate, date: day, source: "ecb", reason: null });
    const r = ret({ groups: [dk({ taxDate: "2026-09-10", netMinor: 1, vatMinor: 1 }), dk({ taxDate: "2026-09-11", netMinor: 1, vatMinor: 1 })], rateFor: two("2") });
    expect(r.groups).toHaveLength(1);
    // Each alone is 0.5 cent, rounded half up to 1; together 2 / 2 = 1: one cent, not two.
    expect(r.groups[0]).toMatchObject({ taxableMinor: 2, vatMinor: 2, taxableEur: 1, vatEur: 1 });
  });

  it("adds the euro of two currencies into one Part 2 line per part, Member State and rate", () => {
    const r = ret({ groups: [dk({ marketCode: "DE", rate: 0.19, standardRate: 0.19, netMinor: 100000, vatMinor: 19000 }), g({ currency: "SEK", netMinor: 11331, vatMinor: 2153 })] });
    expect(r.groups).toHaveLength(2);
    expect(r.part2).toEqual([{ part: "2b", memberState: "DE", dispatchState: "SE", rate: 0.19, rateKind: "standard", taxableEur: 13377 + 1000, vatEur: 2542 + 190, complete: true }]);
  });

  it("keeps rates apart: a reduced rate is its own line", () => {
    const r = ret({ groups: [g(), g({ rate: 0.07, standardRate: 0.19, netMinor: 1000, vatMinor: 70 })] });
    expect(r.part2.map((l) => [l.rate, l.rateKind])).toEqual([[0.19, "standard"], [0.07, "reduced"]]);
  });
});

describe("the parts", () => {
  it("2a for downloads to another member state, 2d for goods sent from another member state, 2b from the member state of identification", () => {
    const r = ret({ groups: [g(), g({ dispatchCountry: "DK" }), g({ hasPhysical: false, hasDownload: true })] });
    expect(r.part2.map((l) => l.part)).toEqual(["2a", "2b", "2d"]);
  });

  it("NU for a seller outside the EU selling services, with its own registration", () => {
    const r = ret({ registration: { ossScheme: "non_union", iossNumber: null }, groups: [g({ hasPhysical: false, hasDownload: true, dispatchCountry: "NO", sellerCountry: "NO", sellerOssMemberState: null })] });
    expect(r.part2.map((l) => l.part)).toEqual(["NU"]);
    expect(r.registration).toBe("non_union");
    expect(r.notes).toEqual([]);
  });
});

describe("what is left out and why", () => {
  const out = ret({
    groups: [
      g({ marketCode: "NO", marketInEu: false, currency: "NOK", rate: 0.25, standardRate: 0.25 }),
      g({ buyerType: "business" }),
      g({ vatKind: "reverse_charge", buyerType: "business", basis: "reverse_charge", rate: 0, vatMinor: 0, grossMinor: 10000 }),
      g({ dispatchCountry: "NO" }),
      g({ hasService: true }),
      g({ marketCode: "SE", currency: "SEK", dispatchCountry: "SE" }),
      g({ vatKind: "ioss", dispatchCountry: "NO" }),
      g({ basis: "exempt", rate: 0, vatMinor: 0, grossMinor: 10000 }),
    ],
  });

  it("lists the other places by reason, with their amounts and the sentence", () => {
    expect(out.notIncluded.map((n) => `${n.reason}:${n.currency}`).sort()).toEqual(
      ["business_buyer:EUR", "dispatch_outside_eu:EUR", "domestic:SEK", "exempt:EUR", "has_service:EUR", "ioss:EUR", "non_eu_market_foreign:NOK", "reverse_charge:EUR"].sort(),
    );
    const outside = out.notIncluded.find((n) => n.reason === "dispatch_outside_eu")!;
    expect(outside).toMatchObject({ place: "none", documentLines: 1, taxableMinor: 10000, vatMinor: 1900 });
    expect(outside.text).toContain("ask your accountant");
    expect(out.part2).toEqual([]);
  });

  it("subtracts credit notes from what is left out, whatever the mode", () => {
    const r = ret({ groups: [g({ dispatchCountry: "NO" }), credit({ dispatchCountry: "NO", netMinor: 4000, vatMinor: 760, grossMinor: 4760 })] });
    expect(r.notIncluded[0]).toMatchObject({ reason: "dispatch_outside_eu", taxableMinor: 6000, vatMinor: 1140, documentLines: 2 });
  });
});

describe("a missing rate", () => {
  it("makes the return incomplete: the group is left out of the euro totals and Part 5 is unknown", () => {
    const r = ret({ groups: [g(), dk()], rateFor: () => null });
    expect(r.incomplete).toBe(true);
    expect(r.missing).toEqual([{ currency: "DKK", day: "2026-09-30" }]);
    expect(r.groups.find((x) => x.currency === "DKK")).toMatchObject({ complete: false, taxableEur: null, vatEur: null, conversion: null });
    expect(r.part2.find((l) => l.memberState === "DK")).toMatchObject({ complete: false, taxableEur: null, vatEur: null });
    expect(r.part2.find((l) => l.memberState === "DE")).toMatchObject({ complete: true, vatEur: 1900 });
    expect(r.part4.find((b) => b.memberState === "DK")).toMatchObject({ complete: false, balanceEur: null });
    expect(r.part5Eur).toBeNull();
    expect(r.totals.vatEur).toBeNull();
    expect(r.rates[0].choice).toBeNull();
  });

  it("is incomplete for a correction too, naming the corrected period's last day", () => {
    const r = ret({ period: quarterPeriod(2026, 4), groups: [dkCredit()], rateFor: (c, day) => (day === "2026-12-31" ? { rate: "7.5", date: day, source: "ecb", reason: null } : null) });
    expect(r.missing).toEqual([{ currency: "DKK", day: "2026-09-30" }]);
    expect(r.part3[0]).toMatchObject({ vatEur: null, complete: false });
  });

  it("uses an owner's rate and says so", () => {
    const owner: RateLookup = (c, day) => ({ rate: "7.5", date: day, source: "owner", reason: "ECB feed down on the day" });
    const r = ret({ groups: [dk()], rateFor: owner });
    expect(r.groups[0].conversion).toEqual({ rate: "7.5", date: "2026-09-30", source: "owner", reason: "ECB feed down on the day" });
    expect(r.groups[0].vatEur).toBe(3333);
  });
});

describe("Part 4 and Part 5 (guide Q13)", () => {
  it("does not set a negative balance against another Member State's: only positive balances are summed", () => {
    const r = ret({ period: quarterPeriod(2026, 4), groups: [dkCredit(), g({ taxDate: "2026-11-02" })], rateFor });
    expect(r.part4.map((b) => [b.memberState, b.balanceEur, b.reimbursed])).toEqual([["DE", 1900, false], ["DK", -1672, true]]);
    expect(r.part5Eur).toBe(1900);
  });

  it("nets Part 2 and Part 3 of one Member State into its balance", () => {
    const r = ret({ period: quarterPeriod(2026, 4), groups: [dk({ taxDate: "2026-11-02", netMinor: 200000, vatMinor: 50000, grossMinor: 250000 }), dkCredit()], rateFor: (c, day) => ({ rate: day === "2026-09-30" ? "7.4755" : "7.5", date: day, source: "ecb", reason: null }) });
    expect(r.part2[0].vatEur).toBe(6667);
    expect(r.part3[0].vatEur).toBe(-1672);
    expect(r.part4).toEqual([{ memberState: "DK", part2VatEur: 6667, part3VatEur: -1672, balanceEur: 4995, complete: true, reimbursed: false }]);
    expect(r.part5Eur).toBe(4995);
  });

  it("books mode can have a negative Part 2 line and a negative balance, counted as zero in Part 5", () => {
    const r = ret({ period: quarterPeriod(2026, 4), mode: "books", groups: [credit({ taxDate: "2026-11-02" })], rateFor });
    expect(r.part2[0]).toMatchObject({ vatEur: -950, taxableEur: -5000 });
    expect(r.part5Eur).toBe(0);
  });
});

describe("corrections of an old period", () => {
  it("are flagged when the corrected period ended more than three years before the return", () => {
    const old = credit({ taxDate: "2026-10-06", originalTaxDate: "2023-05-02", currency: "EUR" });
    const r = ret({ period: quarterPeriod(2026, 4), groups: [old] });
    expect(r.part3).toEqual([{ correctionPeriod: "2023-Q2", memberState: "DE", vatEur: -950, complete: true, late: true }]);
    const recent = ret({ period: quarterPeriod(2026, 4), groups: [credit({ originalTaxDate: "2023-12-31" })] });
    expect(recent.part3[0].late).toBe(false);
    // Q3 2023 ended on 30 September 2023: more than three years before the end of Q4 2026; Q4 2023 ended exactly three years before it.
    expect(ret({ period: quarterPeriod(2026, 4), groups: [credit({ originalTaxDate: "2023-09-30" })] }).part3[0].late).toBe(true);
  });

  it("are one line per corrected period and Member State, summed over rates and currencies", () => {
    const r = ret({
      period: quarterPeriod(2026, 4),
      groups: [credit({ originalTaxDate: "2026-05-02" }), credit({ originalTaxDate: "2026-05-03", rate: 0.07, standardRate: 0.19, netMinor: 1000, vatMinor: 70, grossMinor: 1070 }), credit({ originalTaxDate: "2026-08-03" })],
    });
    expect(r.part3.map((l) => [l.correctionPeriod, l.memberState, l.vatEur])).toEqual([["2026-Q2", "DE", -1020], ["2026-Q3", "DE", -950]]);
    expect(r.groups).toHaveLength(3);
  });
});

describe("the sum of all periods", () => {
  it("is the invoices less the credit notes, per Member State, in a one-currency store (Part 2 plus Part 3 over every quarter)", () => {
    // A deterministic spread of invoices and credit notes over four quarters in EUR; a credit refers to an earlier or the same quarter.
    const invoices = [
      ["2026-02-10", "DE", 10000, 1900], ["2026-05-11", "DE", 20000, 3800], ["2026-08-12", "FR", 30000, 6000], ["2026-11-13", "DE", 5000, 950], ["2026-03-14", "FR", 7000, 1400],
    ] as const;
    const credits = [
      ["2026-02-20", "2026-02-10", "DE", 2500, 475], ["2026-06-02", "2026-02-10", "DE", 1000, 190], ["2026-09-09", "2026-05-11", "DE", 20000, 3800], ["2026-12-01", "2026-08-12", "FR", 4000, 800], ["2026-11-20", "2026-11-13", "DE", 5000, 950],
    ] as const;
    const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
    const total: Record<string, number> = {};
    for (let q = 1; q <= 4; q += 1) {
      const groups: DocGroup[] = [
        ...invoices.filter(([d]) => quarterOf(d) === q).map(([d, c, net, vat]) => g({ taxDate: d, marketCode: c, rate: c === "DE" ? 0.19 : 0.2, standardRate: c === "DE" ? 0.19 : 0.2, netMinor: net, vatMinor: vat, grossMinor: net + vat, dispatchCountry: "SE" })),
        ...credits.filter(([d]) => quarterOf(d) === q).map(([d, o, c, net, vat]) => credit({ taxDate: d, originalTaxDate: o, marketCode: c, rate: c === "DE" ? 0.19 : 0.2, standardRate: c === "DE" ? 0.19 : 0.2, netMinor: net, vatMinor: vat, grossMinor: net + vat })),
      ];
      const r = ret({ period: quarterPeriod(2026, q), groups });
      for (const l of r.part2) total[l.memberState] = (total[l.memberState] ?? 0) + (l.vatEur ?? 0);
      for (const l of r.part3) total[l.memberState] = (total[l.memberState] ?? 0) + (l.vatEur ?? 0);
      for (const l of r.part2) expect(l.vatEur).toBeGreaterThanOrEqual(0);
    }
    const expected: Record<string, number> = {};
    for (const [, c, , vat] of invoices) expected[c] = (expected[c] ?? 0) + vat;
    for (const [, , c, , vat] of credits) expected[c] = (expected[c] ?? 0) - vat;
    expect(total).toEqual(expected);
  });
});

describe("the IOSS return (monthly)", () => {
  const no = { sellerCountry: "NO", sellerOssMemberState: null };
  const iossReg = { ossScheme: "none" as const, iossNumber: "IM5780000001" };
  const sep = monthPeriod(2026, 9);
  const ioss = (over: Partial<DocGroup> = {}) => g({ vatKind: "ioss", dispatchCountry: "NO", currency: "EUR", ...no, ...over });

  it("lists the marked sales per Member State and rate for the month, and nothing else", () => {
    const r = buildReturn({
      scheme: "ioss", period: sep, mode: "filing", registration: iossReg, rateFor,
      groups: [
        ioss({ marketCode: "SE", currency: "SEK", rate: 0.25, standardRate: 0.25, netMinor: 22662, vatMinor: 5666 }),
        ioss({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000 }),
        ioss({}),
        g({ dispatchCountry: "NO" }), // above 150 EUR: not marked, so not an IOSS sale
        g({ vatKind: "ioss", buyerType: "business", dispatchCountry: "NO" }), // still an ioss order by its kind
      ],
    });
    expect(r.registration).toBe("ioss");
    expect(r.part2.map((l) => [l.part, l.memberState, l.rate, l.vatEur])).toEqual([["IOSS", "DE", 0.19, 3800], ["IOSS", "DK", 0.25, 3344], ["IOSS", "SE", 0.25, 500]]);
    expect(r.notIncluded.map((n) => n.reason)).toEqual(["dispatch_outside_eu"]);
    expect(r.part5Eur).toBe(3800 + 3344 + 500);
  });

  it("makes a credit note of the next month a Part 3 correction of the month of the sale", () => {
    const oct = buildReturn({ scheme: "ioss", period: monthPeriod(2026, 10), mode: "filing", registration: iossReg, rateFor, groups: [credit({ vatKind: "ioss", dispatchCountry: "NO", taxDate: "2026-10-06", originalTaxDate: "2026-09-12" })] });
    expect(oct.part2).toEqual([]);
    expect(oct.part3).toEqual([{ correctionPeriod: "2026-09", memberState: "DE", vatEur: -950, complete: true, late: false }]);
    expect(oct.part5Eur).toBe(0);
  });

  it("warns of IOSS sales with no number, and is off with no number and no sale", () => {
    const r = buildReturn({ scheme: "ioss", period: sep, mode: "filing", registration: { ossScheme: "none", iossNumber: null }, rateFor, groups: [ioss()] });
    expect(r.registration).toBe("none");
    expect(r.notes.map((n) => n.code)).toEqual(["ioss_sales_no_number"]);
    expect(iossState(null, false)).toBe("off");
    expect(iossState(null, true)).toBe("history");
    expect(iossState("IM5780000001", false)).toBe("on");
  });

  it("holds the OSS view apart: IOSS sales are listed there as not in that return", () => {
    const r = ret({ groups: [ioss()] });
    expect(r.part2).toEqual([]);
    expect(r.notIncluded[0]).toMatchObject({ reason: "ioss", place: "ioss" });
  });
});

describe("registration", () => {
  it("reads the profile for each scheme", () => {
    expect(registrationOf("oss", { ossScheme: "union", iossNumber: "IM5780000001" })).toBe("union");
    expect(registrationOf("oss", { ossScheme: "none", iossNumber: null })).toBe("none");
    expect(registrationOf("ioss", { ossScheme: "union", iossNumber: "IM5780000001" })).toBe("ioss");
    expect(registrationOf("ioss", { ossScheme: "union", iossNumber: null })).toBe("none");
  });

  it("warns when the sales fit a scheme the profile does not record, and still builds the figures", () => {
    const r = ret({ registration: { ossScheme: "none", iossNumber: null }, groups: [g()] });
    expect(r.registration).toBe("none");
    expect(r.notes.map((n) => n.code)).toEqual(["union_sales_no_registration"]);
    expect(r.part2).toHaveLength(1);
  });

  it("counts the notes on how documents were classed", () => {
    const r = ret({ groups: [g({ dispatchSource: "profile", documents: 2 })] });
    expect(r.flagCounts).toEqual({ mixed_goods_download: 0, dispatch_assumed: 2, seller_assumed: 0 });
  });
});

describe("the Member State of dispatch (Directive Art. 369g(2)): totals for goods are per dispatch state", () => {
  const dkFrom = (dispatch: string, over: Partial<DocGroup> = {}) => g({ marketCode: "DK", currency: "EUR", rate: 0.25, standardRate: 0.25, dispatchCountry: dispatch, netMinor: 10000, vatMinor: 2500, grossMinor: 12500, ...over });

  it("keeps goods sent to one Member State from two dispatch states on two Part 2d lines instead of merging them", () => {
    // A store identified in SE that changed its dispatch country from DE to PL during the quarter: two lines, not one 2d DK 25 % line.
    const r = ret({ groups: [dkFrom("DE"), dkFrom("PL"), dkFrom("PL", { netMinor: 4000, vatMinor: 1000, grossMinor: 5000 })] });
    expect(r.part2.map((l) => [l.part, l.memberState, l.dispatchState, l.rate, l.taxableEur, l.vatEur])).toEqual([
      ["2d", "DK", "DE", 0.25, 10000, 2500],
      ["2d", "DK", "PL", 0.25, 14000, 3500],
    ]);
    // Part 4 and 5 are per Member State of consumption and do not split.
    expect(r.part4.map((b) => [b.memberState, b.balanceEur])).toEqual([["DK", 6000]]);
  });

  it("names the Member State of identification as the dispatch state of a 2b line, and has none for services", () => {
    const r = ret({ groups: [dkFrom("SE"), g({ marketCode: "DK", hasPhysical: false, hasDownload: true, rate: 0.25, standardRate: 0.25 })] });
    expect(r.part2.map((l) => [l.part, l.dispatchState])).toEqual([["2a", null], ["2b", "SE"]]);
  });

  it("leaves a Part 3 correction and an IOSS line without a dispatch state", () => {
    const filing = ret({ period: quarterPeriod(2026, 4), groups: [dkFrom("PL", { docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", orders: 0 })] });
    expect(filing.groups[0].dispatchState).toBeNull();
    expect(filing.part3).toHaveLength(1);
  });
});

describe("the seller as the order froze it", () => {
  it("keeps a download in part 2a when the store's own country was edited afterwards (nothing reads the live store)", () => {
    // The group carries SE as it was frozen; buildReturn has no way to read the store's country today.
    const r = ret({ groups: [g({ hasPhysical: false, hasDownload: true })] });
    expect(r.part2.map((l) => [l.part, l.memberState])).toEqual([["2a", "DE"]]);
  });

  it("counts the documents of orders that froze no seller as assumed", () => {
    const r = ret({ groups: [g({ hasPhysical: false, hasDownload: true, sellerSource: "profile", documents: 3 })] });
    expect(r.flagCounts.seller_assumed).toBe(3);
  });
});
