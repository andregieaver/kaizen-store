import { describe, expect, it } from "vitest";

import { buildVatReport, classOfGroup, parseDocGroup, ratePercent, type DocGroup } from "./tax-report";

const seller = { country: "SE", ossMemberState: "SE" };

/** An invoice group of a Swedish store (main currency SEK) in Germany: EUR, 19 %, sent from Sweden, converted at 11.2. */
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
  netMainMinor: 112000,
  vatMainMinor: 21280,
  grossMainMinor: 133280,
  ...over,
});

const credit = (over: Partial<DocGroup> = {}): DocGroup =>
  g({ docKind: "credit_note", taxDate: "2026-09-20", originalTaxDate: "2026-09-12", documents: 1, orders: 0, netMinor: 5000, vatMinor: 950, grossMinor: 5950, netMainMinor: 56000, vatMainMinor: 10640, grossMainMinor: 66640, kindDocuments: 1, ...over });

describe("the VAT table", () => {
  it("has one row per country, rate, basis and currency, with net, VAT and gross", () => {
    const report = buildVatReport(
      [
        g(),
        g({ marketCode: "DE", rate: 0.07, standardRate: 0.19, netMinor: 2000, vatMinor: 140, grossMinor: 2140, netMainMinor: 22400, vatMainMinor: 1568, grossMainMinor: 23968 }),
        g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, fxRate: "1.5", netMainMinor: 150000, vatMainMinor: 37500, grossMainMinor: 187500, orders: 1, currencyOrders: 1, kindDocuments: 1 }),
      ],
      seller,
    );
    expect(report.rows.map((r) => [r.country, r.rate, r.basis, r.currency])).toEqual([
      ["DK", 0.25, "standard", "DKK"], // the largest VAT after credits first (no row of Sweden itself)
      ["DE", 0.19, "standard", "EUR"],
      ["DE", 0.07, "standard", "EUR"],
    ]);
    const de19 = report.rows.find((r) => r.country === "DE" && r.rate === 0.19)!;
    expect([de19.netMinor, de19.vatMinor, de19.grossMinor, de19.invoices, de19.orders]).toEqual([10000, 1900, 11900, 1, 1]);
    expect(de19.rateKind).toBe("standard");
    expect(report.rows.find((r) => r.rate === 0.07)!.rateKind).toBe("reduced");
  });

  it("counts an order with two rates once in the total and once in each row, and a document once too", () => {
    const report = buildVatReport([g(), g({ rate: 0.07, netMinor: 2000, vatMinor: 140, grossMinor: 2140, netMainMinor: 22400, vatMainMinor: 1568, grossMainMinor: 23968 })], seller);
    expect(report.rows.map((r) => r.orders)).toEqual([1, 1]);
    expect(report.rows.map((r) => r.invoices)).toEqual([1, 1]);
    expect(report.totals.orders).toBe(1);
    expect(report.totals.invoices).toBe(1);
    expect(report.byCurrency).toEqual([expect.objectContaining({ currency: "EUR", invoices: 1, orders: 1, vatMinor: 2040 })]);
  });

  it("sums orders over days, countries and currencies (each order has one currency and one country)", () => {
    const report = buildVatReport(
      [
        g({ taxDate: "2026-09-10", currencyOrders: 3, kindDocuments: 3, orders: 1 }),
        g({ taxDate: "2026-09-11", currencyOrders: 3, kindDocuments: 3, orders: 2 }),
        g({ marketCode: "DK", currency: "DKK", currencyOrders: 4, kindDocuments: 4, orders: 4, rate: 0.25, standardRate: 0.25, fxRate: "1.5" }),
      ],
      seller,
    );
    expect(report.totals.orders).toBe(7);
    expect(report.totals.invoices).toBe(7);
    const de = report.rows.find((r) => r.country === "DE")!;
    expect(de.orders).toBe(3);
    expect(de.invoices).toBe(2); // documents on the two days: the rows' own `documents` are summed
  });

  it("puts shipping inside the rate it was charged at, as its own row when the rate differs from the goods'", () => {
    const report = buildVatReport([g({ rate: 0.07, standardRate: 0.19 }), g({ rate: 0.19, standardRate: 0.19, netMinor: 840, vatMinor: 160, grossMinor: 1000 })], seller);
    expect(report.rows.map((r) => [r.rate, r.rateKind])).toEqual(expect.arrayContaining([[0.07, "reduced"], [0.19, "standard"]]));
  });

  it("shows reverse charge at 0 with its basis, and says where it is reported", () => {
    const report = buildVatReport([g({ vatKind: "reverse_charge", buyerType: "business", basis: "reverse_charge", rate: 0, vatMinor: 0, grossMinor: 10000, vatMainMinor: 0, grossMainMinor: 112000 })], seller);
    expect(report.rows[0]).toMatchObject({ basis: "reverse_charge", rate: 0, vatMinor: 0, place: "none", reason: "reverse_charge", reportedIn: "Not in a return: reverse charge" });
  });

  it("says where each place is reported: the Union scheme with its part, IOSS, the national return, nothing", () => {
    const rows = buildVatReport(
      [
        g(), // 2b: sent from SE to DE
        g({ dispatchCountry: "DK" }), // 2d
        g({ hasPhysical: false, hasDownload: true }), // 2a
        g({ marketCode: "NO", marketInEu: false, currency: "NOK", rate: 0.25, standardRate: 0.25 }),
        g({ marketCode: "NO", marketInEu: false, currency: "NOK", rate: 0.25, standardRate: 0.25, sellerCountry: "NO", sellerOssMemberState: null, dispatchCountry: "NO" }),
        g({ marketCode: "SE", currency: "SEK", dispatchCountry: "SE", fxState: "same", fxRate: null }),
        g({ vatKind: "ioss", dispatchCountry: "NO" }),
        g({ dispatchCountry: "NO", rate: 0.2, standardRate: 0.19 }),
      ],
      seller,
    ).rows;
    const labels = rows.map((r) => r.reportedIn).sort();
    expect(labels).toEqual(
      [
        "IOSS return",
        "National return (domestic sale)",
        "National return (market outside the EU)",
        "Not in a return: dispatch outside the EU",
        "Not in a return: market outside the EU, store not established there",
        "OSS Union scheme, part 2a",
        "OSS Union scheme, part 2b",
        "OSS Union scheme, part 2d",
      ].sort(),
    );
  });

  it("splits a country, rate and currency by where its sales are reported, so no row straddles two returns", () => {
    const rows = buildVatReport([g(), g({ buyerType: "business" })], seller).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason).sort()).toEqual(["business_buyer", "union_goods_msi"]);
  });

  it("lists the store's own country first", () => {
    const rows = buildVatReport([g({ marketCode: "DE", vatMainMinor: 999999 }), g({ marketCode: "SE", currency: "SEK", fxState: "same", fxRate: null, vatMainMinor: 5, netMainMinor: 20, grossMainMinor: 25 })], seller).rows;
    expect(rows.map((r) => r.country)).toEqual(["SE", "DE"]);
  });
});

describe("credit notes", () => {
  it("reduce the VAT after credits, never the VAT charged", () => {
    const report = buildVatReport([g(), credit()], seller);
    const r = report.rows[0];
    expect([r.vatMinor, r.creditVatMinor, r.vatAfterMinor]).toEqual([1900, 950, 950]);
    expect([r.netMinor, r.creditNetMinor, r.netAfterMinor]).toEqual([10000, 5000, 5000]);
    expect([r.invoices, r.creditNotes]).toEqual([1, 1]);
    expect([r.vatMainMinor, r.creditVatMainMinor, r.vatAfterMainMinor]).toEqual([21280, 10640, 10640]);
    expect(report.totals).toMatchObject({ vatChargedMainMinor: 21280, vatCreditedMainMinor: 10640, vatAfterMainMinor: 10640, invoices: 1, creditNotes: 1 });
  });

  it("can stand alone in a period (a refund of an earlier month's sale)", () => {
    const report = buildVatReport([credit({ originalTaxDate: "2026-08-02" })], seller);
    expect(report.rows[0]).toMatchObject({ invoices: 0, creditNotes: 1, vatMinor: 0, vatAfterMinor: -950, vatAfterMainMinor: -10640 });
    expect(report.totals).toMatchObject({ vatAfterMainMinor: -10640, invoices: 0, creditNotes: 1 });
  });

  it("is classed like its invoice: the same reason, so a refund never lands in another return than its sale", () => {
    const report = buildVatReport([g({ dispatchCountry: "DK" }), credit({ dispatchCountry: "DK" })], seller);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].reportedIn).toBe("OSS Union scheme, part 2d");
  });
});

describe("main currency", () => {
  it("is the sum of what the database converted per bucket with each document's stored rate", () => {
    const report = buildVatReport([g(), g({ currency: "DKK", marketCode: "DK", rate: 0.25, standardRate: 0.25, vatMainMinor: 37500, netMainMinor: 150000, grossMainMinor: 187500, netMinor: 100000, vatMinor: 25000, grossMinor: 125000 })], seller);
    expect(report.totals.vatChargedMainMinor).toBe(21280 + 37500);
    expect(report.totals.vatAfterMainMinor).toBe(21280 + 37500);
    expect(report.mainCurrency).toBe("SEK");
  });

  it("leaves a document with no stored rate out of the main figures, counts it, and keeps its own currency", () => {
    const report = buildVatReport(
      [g(), g({ currency: "GBP", marketCode: "GB", marketInEu: false, fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null, kindDocuments: 2, currencyOrders: 2, documents: 2, orders: 2 }), credit({ currency: "GBP", marketCode: "GB", marketInEu: false, fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null })],
      seller,
    );
    const gb = report.rows.find((r) => r.currency === "GBP")!;
    expect(gb.mainConverted).toBe(false);
    expect([gb.vatMainMinor, gb.vatAfterMainMinor, gb.creditVatMainMinor]).toEqual([null, null, null]);
    expect(gb.vatAfterMinor).toBe(1900 - 950);
    expect(report.notConverted).toMatchObject({ invoices: 2, creditNotes: 1, currencies: ["GBP"] });
    expect(report.notConverted.leftOut).toEqual([{ currency: "GBP", invoices: 2, vatMinor: 1900 }]);
    expect(report.totals.vatAfterMainMinor).toBe(21280);
    expect(report.byCurrency.map((c) => c.currency)).toEqual(["EUR", "GBP"]);
    expect(report.byCurrency.find((c) => c.currency === "GBP")).toMatchObject({ vatMinor: 1900, creditVatMinor: 950, invoices: 2, creditNotes: 1 });
  });

  it("does not convert a document in the main currency", () => {
    const report = buildVatReport([g({ currency: "SEK", fxState: "same", fxRate: null, marketCode: "SE", netMainMinor: 10000, vatMainMinor: 1900, grossMainMinor: 11900 })], seller);
    expect(report.rows[0]).toMatchObject({ vatMainMinor: 1900, mainConverted: true });
  });
});

describe("the whole report", () => {
  it("has totals equal to the sum of its rows, in the main currency and per currency", () => {
    const groups = [g(), credit(), g({ rate: 0.07, netMinor: 2000, vatMinor: 140, grossMinor: 2140, netMainMinor: 22400, vatMainMinor: 1568, grossMainMinor: 23968 }), g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, netMainMinor: 150000, vatMainMinor: 37500, grossMainMinor: 187500 })];
    const report = buildVatReport(groups, seller);
    const sum = (pick: (r: (typeof report.rows)[number]) => number | null) => report.rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
    expect(report.totals.vatAfterMainMinor).toBe(sum((r) => r.vatAfterMainMinor));
    expect(report.totals.vatChargedMainMinor).toBe(sum((r) => r.vatMainMinor));
    expect(report.totals.netAfterMainMinor).toBe(sum((r) => r.netAfterMainMinor));
    for (const c of report.byCurrency) {
      const rows = report.rows.filter((r) => r.currency === c.currency);
      expect(c.vatMinor).toBe(rows.reduce((s, r) => s + r.vatMinor, 0));
      expect(c.creditVatMinor).toBe(rows.reduce((s, r) => s + r.creditVatMinor, 0));
    }
    expect(report.byCountry.reduce((s, c) => s + c.vatAfterMainMinor, 0)).toBe(report.totals.vatAfterMainMinor);
  });

  it("is empty for a period with no documents", () => {
    const report = buildVatReport([], seller, { mainCurrency: "SEK" });
    expect(report).toMatchObject({ rows: [], mainCurrency: "SEK", notConverted: { invoices: 0, creditNotes: 0, currencies: [] } });
    expect(report.totals).toMatchObject({ vatAfterMainMinor: 0, invoices: 0, creditNotes: 0, orders: 0 });
  });

  it("counts the documents per part of a return and the notes on how they were classed", () => {
    const report = buildVatReport([g({ documents: 3 }), g({ hasDownload: true, dispatchSource: "profile", documents: 2, rate: 0.07 })], seller);
    expect(report.partCounts).toEqual({ "2b": 5 });
    expect(report.flagCounts).toEqual({ mixed_goods_download: 2, dispatch_assumed: 2, seller_assumed: 0 });
  });

  it("lists what the main-currency figures leave out, per currency: the whole row when one of its documents has no stored rate", () => {
    const missing = { currency: "DKK", marketCode: "DK", rate: 0.25, standardRate: 0.25, vatMinor: 25000, netMinor: 100000, grossMinor: 125000 };
    const report = buildVatReport(
      [g({ ...missing, fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null }), g({ ...missing, fxState: "stored", fxRate: "1.5", vatMainMinor: 37500, netMainMinor: 150000, grossMainMinor: 187500 }), g()],
      seller,
    );
    expect(report.notConverted.leftOut).toEqual([{ currency: "DKK", invoices: 2, vatMinor: 50000 }]);
    // The main-currency card holds only the row that could be converted.
    expect(report.totals.vatChargedMainMinor).toBe(21280);
    expect(buildVatReport([g()], seller).notConverted.leftOut).toEqual([]);
  });

  it("classes a sale by the seller its order froze, never by the store's country today, and counts the orders that froze none", () => {
    // The store has since moved to Norway: the live country is NO, the document froze SE.
    const moved = { country: "NO" };
    const report = buildVatReport([g({ hasPhysical: false, hasDownload: true }), g({ hasPhysical: false, hasDownload: true, sellerSource: "profile", documents: 2, rate: 0.07 })], moved);
    expect(report.rows.every((r) => r.part === "2a")).toBe(true);
    expect(report.partCounts).toEqual({ "2a": 3 });
    expect(report.flagCounts.seller_assumed).toBe(2);
  });
});

describe("parseDocGroup", () => {
  it("reads a row as the driver gives it: bigint columns as strings, dates as strings or Dates, numerics as strings", () => {
    const row = parseDocGroup({
      doc_kind: "credit_note", tax_date: new Date("2026-10-06T00:00:00Z"), original_tax_date: "2026-09-12", market_code: "DK", market_in_eu: true, currency: "DKK", main_currency: "SEK",
      fx_state: "stored", fx_rate: "1.50000000", vat_kind: "standard", buyer_type: "consumer", has_physical: true, has_download: false, has_service: false,
      dispatch_country: "SE", dispatch_source: "order", seller_country: "SE", seller_oss_member_state: "SE", seller_source: "order", rate: "0.2500", basis: "standard", standard_rate: "0.2500", documents: "1", orders: "0", currency_orders: "3", kind_documents: "1",
      net_minor: "50000", vat_minor: "12500", gross_minor: "62500", net_main_minor: "75000", vat_main_minor: "18750", gross_main_minor: "93750",
    });
    expect(row).toMatchObject({ docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", rate: 0.25, vatMinor: 12500, vatMainMinor: 18750, orders: 0, currencyOrders: 3 });
    expect(parseDocGroup({ ...rowBase(), fx_state: "missing", net_main_minor: null, vat_main_minor: null, gross_main_minor: null, fx_rate: null })).toMatchObject({ fxState: "missing", netMainMinor: null, fxRate: null });
  });

  it("refuses an amount that is not a safe whole number", () => {
    expect(() => parseDocGroup({ ...rowBase(), net_minor: "9007199254740993" })).toThrow(RangeError);
    expect(() => parseDocGroup({ ...rowBase(), vat_minor: "1.5" })).toThrow(RangeError);
  });

  it("classifies a group through the same call the returns use", () => {
    expect(classOfGroup(g())).toMatchObject({ place: "union", part: "2b" });
  });
});

function rowBase(): Record<string, unknown> {
  return {
    doc_kind: "invoice", tax_date: "2026-09-12", original_tax_date: null, market_code: "DE", market_in_eu: true, currency: "EUR", main_currency: "SEK", fx_state: "stored", fx_rate: "11.2",
    vat_kind: "standard", buyer_type: "consumer", has_physical: true, has_download: false, has_service: false, dispatch_country: "SE", dispatch_source: "order", seller_country: "SE", seller_oss_member_state: "SE", seller_source: "order", rate: "0.19", basis: "standard",
    standard_rate: "0.19", documents: "1", orders: "1", currency_orders: "1", kind_documents: "1", net_minor: "10000", vat_minor: "1900", gross_minor: "11900",
    net_main_minor: "112000", vat_main_minor: "21280", gross_main_minor: "133280",
  };
}

describe("ratePercent", () => {
  it("writes a rate in percent without trailing zeros", () => {
    expect([0.25, 0.19, 0.07, 0.075, 0.125, 0, 0.2].map(ratePercent)).toEqual(["25", "19", "7", "7.5", "12.5", "0", "20"]);
  });
});
