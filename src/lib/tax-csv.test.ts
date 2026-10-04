import { describe, expect, it } from "vitest";

import { buildReturn, type RateLookup } from "./oss-return";
import { DETAIL_CSV_HEADER, RECONCILIATION_CSV_HEADER, RETURN_CSV_HEADER, VAT_CSV_HEADER, detailCsv, incompleteReason, reconciliationCsv, reconciliationFileName, returnCsv, returnFileName, vatCsv, vatFileName } from "./tax-csv";
import { quarterPeriod } from "./tax-periods";
import { reconcile } from "./tax-reconciliation";
import { buildVatReport, type DocGroup } from "./tax-report";

const seller = { country: "SE", ossMemberState: "SE" };
const registration = { ossScheme: "union" as const, iossNumber: null };
const rates: Record<string, string> = { "DKK|2026-09-30": "7.4755" };
const rateFor: RateLookup = (c, day) => (rates[`${c}|${day}`] ? { rate: rates[`${c}|${day}`], date: day, source: "ecb", reason: null } : null);

const g = (over: Partial<DocGroup> = {}): DocGroup => ({
  docKind: "invoice", taxDate: "2026-09-12", originalTaxDate: null, marketCode: "DE", marketInEu: true, currency: "EUR", mainCurrency: "SEK", fxState: "stored", fxRate: "11.2",
  vatKind: "standard", buyerType: "consumer", hasPhysical: true, hasDownload: false, hasService: false, dispatchCountry: "SE", dispatchSource: "order", sellerCountry: "SE", sellerOssMemberState: "SE", sellerSource: "order", rate: 0.19, basis: "standard",
  standardRate: 0.19, documents: 1, orders: 1, currencyOrders: 1, kindDocuments: 1, netMinor: 10000, vatMinor: 1900, grossMinor: 11900, netMainMinor: 112000, vatMainMinor: 21280, grossMainMinor: 133280, ...over,
});
const dk = (over: Partial<DocGroup> = {}) => g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, netMainMinor: 150000, vatMainMinor: 37500, grossMainMinor: 187500, ...over });
const dkCredit = () => dk({ docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", orders: 0, netMinor: 50000, vatMinor: 12500, grossMinor: 62500, netMainMinor: 75000, vatMainMinor: 18750, grossMainMinor: 93750 });

const lines = (csv: string) => csv.split("\r\n");

describe("the layouts are the constants of the spec", () => {
  it("VAT by country and rate", () => {
    expect(VAT_CSV_HEADER.join(",")).toBe("period_from,period_to,country,vat_rate_percent,basis,reported_in,currency,invoices,orders,net,vat,gross,credit_notes,credit_net,credit_vat,credit_gross,net_after_credits,vat_after_credits,gross_after_credits,currency_main,net_after_credits_main,vat_after_credits_main,main_converted");
  });
  it("return data", () => {
    expect(RETURN_CSV_HEADER.join(",")).toBe("scheme,tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,taxable_amount_eur,vat_amount_eur,correction_period,mode,registration,currency");
  });
  it("conversion detail", () => {
    expect(DETAIL_CSV_HEADER.join(",")).toBe("tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,original_currency,taxable_amount_original,vat_amount_original,conversion_rate,rate_date,rate_source,taxable_amount_eur,vat_amount_eur,invoices,credit_notes,correction_period");
  });
  it("reconciliation", () => {
    expect(RECONCILIATION_CSV_HEADER.join(",")).toBe("period_from,period_to,currency,cause,direction,orders,vat_original");
  });
});

describe("vatCsv", () => {
  const report = buildVatReport([g(), dk(), dkCredit()], seller);
  const csv = vatCsv(report, { from: "2026-09-01", to: "2026-11-01" });

  it("has the header, one row per row of the report, CRLF, and no totals row", () => {
    const l = lines(csv);
    expect(l[0]).toBe(VAT_CSV_HEADER.join(","));
    expect(l.at(-1)).toBe("");
    expect(l).toHaveLength(1 + report.rows.length + 1);
    expect(csv).not.toMatch(/\btotal\b/i);
  });

  it("writes decimals with a point, credits negative, the period's last day included, and the main currency", () => {
    const row = lines(csv).find((x) => x.includes(",DK,"))!;
    expect(row).toBe("2026-09-01,2026-10-31,DK,25,standard,\"OSS Union scheme, part 2b\",DKK,1,1,1000.00,250.00,1250.00,1,-500.00,-125.00,-625.00,500.00,125.00,625.00,SEK,750.00,187.50,true");
  });

  it("leaves the main columns empty and false for a document with no stored rate", () => {
    const missing = buildVatReport([g({ currency: "GBP", fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null })], seller);
    const row = lines(vatCsv(missing, { from: "2026-09-01", to: "2026-10-01" }))[1];
    expect(row).toBe("2026-09-01,2026-09-30,DE,19,standard,\"OSS Union scheme, part 2b\",GBP,1,1,100.00,19.00,119.00,0,0.00,0.00,0.00,100.00,19.00,119.00,,,,false");
  });
});

describe("returnCsv: the worked example", () => {
  it("Q3 2026, filing: Part 2, Part 4 and Part 5 in euro", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [g(), dk()], registration, rateFor });
    const result = returnCsv(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toBe(
      [
        RETURN_CSV_HEADER.join(","),
        "union,2026-Q3,2b,DE,SE,19,standard,100.00,19.00,,filing,union,EUR",
        "union,2026-Q3,2b,DK,SE,25,standard,133.77,33.44,,filing,union,EUR",
        "union,2026-Q3,4,DE,,,,,19.00,,filing,union,EUR",
        "union,2026-Q3,4,DK,,,,,33.44,,filing,union,EUR",
        "union,2026-Q3,5,,,,,,52.44,,filing,union,EUR",
        "",
      ].join("\r\n"),
    );
    expect(result.rows).toBe(5);
  });

  it("Q4 2026, filing: a Part 3 row carries the corrected period and only the VAT; a negative Part 4 balance, Part 5 is 0.00", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 4), mode: "filing", groups: [dkCredit()], registration, rateFor });
    const result = returnCsv(data);
    expect(result.ok && result.csv).toBe(
      [
        RETURN_CSV_HEADER.join(","),
        "union,2026-Q4,3,DK,,,,,-16.72,2026-Q3,filing,union,EUR",
        "union,2026-Q4,4,DK,,,,,-16.72,,filing,union,EUR",
        "union,2026-Q4,5,,,,,,0.00,,filing,union,EUR",
        "",
      ].join("\r\n"),
    );
  });

  it("names the non-Union scheme for a part NU and IOSS for the monthly return", () => {
    const nu = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [g({ hasPhysical: false, hasDownload: true, dispatchCountry: "NO", sellerCountry: "NO", sellerOssMemberState: null })], registration: { ossScheme: "non_union", iossNumber: null }, rateFor });
    const out = returnCsv(nu);
    expect(out.ok && lines(out.csv)[1]).toBe("non_union,2026-Q3,NU,DE,,19,standard,100.00,19.00,,filing,non_union,EUR");
  });

  it("is refused while a rate is missing, naming the currency and the day", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [g(), dk()], registration, rateFor: () => null });
    const result = returnCsv(data);
    expect(result).toEqual({ ok: false, reason: incompleteReason(data) });
    expect(incompleteReason(data)).toContain("DKK on 2026-09-30");
  });
});

describe("detailCsv", () => {
  it("has one row per conversion group with the rate, its date and source, so the conversion can be reproduced", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [g(), dk()], registration, rateFor });
    const result = detailCsv(data);
    expect(result.ok && result.csv).toBe(
      [
        DETAIL_CSV_HEADER.join(","),
        "2026-Q3,2b,DE,SE,19,standard,EUR,100.00,19.00,1,,none (euro),100.00,19.00,1,0,",
        "2026-Q3,2b,DK,SE,25,standard,DKK,1000.00,250.00,7.4755,2026-09-30,ecb,133.77,33.44,1,0,",
        "",
      ].join("\r\n"),
    );
  });

  it("is allowed while incomplete and shows the gap with an empty rate and the word missing", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [dk()], registration, rateFor: () => null });
    const result = detailCsv(data);
    expect(result.ok).toBe(true);
    expect(result.ok && lines(result.csv)[1]).toBe("2026-Q3,2b,DK,SE,25,standard,DKK,1000.00,250.00,,,missing,,,1,0,");
  });

  it("marks a correction with part 3 and the period corrected, and an owner's rate with its reason", () => {
    const owner: RateLookup = (c, day) => ({ rate: "7.5", date: day, source: "owner", reason: "ECB down, rate from the bank" });
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 4), mode: "filing", groups: [dkCredit()], registration, rateFor: owner });
    const result = detailCsv(data);
    expect(result.ok && lines(result.csv)[1]).toBe('2026-Q4,3,DK,,25,standard,DKK,-500.00,-125.00,7.5,2026-09-30,"owner: ECB down, rate from the bank",-66.67,-16.67,0,1,2026-Q3');
  });

  it("quotes a reason with a comma, a quote or a line break, and cannot start a formula (the cell starts with the word owner)", () => {
    for (const reason of ["=HYPERLINK(\"http://x\")+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "tab\there", 'say "hi", please', "two\nlines"]) {
      const owner: RateLookup = (c, day) => ({ rate: "7.5", date: day, source: "owner", reason });
      const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [dk()], registration, rateFor: owner });
      const out = detailCsv(data);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const body = out.csv.slice(out.csv.indexOf("\r\n") + 2);
      expect(body).not.toMatch(/(^|,)[=+\-@]/);
      expect(body).toContain(reason.replace(/"/g, '""'));
    }
  });
});

describe("reconciliationCsv: the direction column makes the file add up", () => {
  it("lets a spreadsheet check finance + sum(direction * vat) = report for each currency", () => {
    const b = reconcile({
      currency: "NOK",
      finance: { orders: 12, taxMinor: 100000 },
      report: { orders: 10, taxMinor: 97500 },
      causes: { timing_in: { orders: 1, taxMinor: 500 }, timing_out: { orders: 2, taxMinor: 2000 }, test_mode: { orders: 1, taxMinor: 1000 } },
    });
    const rows = reconciliationCsv([b], { from: "2026-09-01", to: "2026-10-01" }).split("\r\n").filter(Boolean).slice(1).map((line) => line.split(","));
    const num = (x: string) => Number(x);
    const finance = num(rows.find((r) => r[3] === "finance")![6]);
    const report = num(rows.find((r) => r[3] === "report")![6]);
    const moved = rows.filter((r) => r[4] !== "").reduce((n, r) => n + num(r[4]) * num(r[6]), 0);
    expect(rows.find((r) => r[3] === "finance")![4]).toBe("");
    expect(rows.find((r) => r[3] === "report")![4]).toBe("");
    expect(rows.find((r) => r[3] === "timing_in")![4]).toBe("1");
    expect(rows.find((r) => r[3] === "timing_out")![4]).toBe("-1");
    expect(finance + moved).toBeCloseTo(report, 2);
    // Every amount in the file is positive: the direction carries the sign.
    for (const r of rows) expect(num(r[6])).toBeGreaterThanOrEqual(0);
  });
});

describe("reconciliationCsv", () => {
  it("has one row per cause, including finance and the report, unconverted, with no totals row", () => {
    const b = reconcile({ currency: "NOK", finance: { orders: 3, taxMinor: 5000 }, report: { orders: 2, taxMinor: 3000 }, causes: { invoicing_off: { orders: 1, taxMinor: 2000 } } });
    const csv = reconciliationCsv([b], { from: "2026-09-01", to: "2026-10-01" });
    expect(csv).toBe([RECONCILIATION_CSV_HEADER.join(","), "2026-09-01,2026-09-30,NOK,finance,,3,50.00", "2026-09-01,2026-09-30,NOK,invoicing_off,-1,1,20.00", "2026-09-01,2026-09-30,NOK,report,,2,30.00", ""].join("\r\n"));
  });
});

describe("file names", () => {
  it("name the store, the period and the mode", () => {
    expect(vatFileName("Kaffe Shop!", "2026-09-01", "2026-10-01")).toBe("vat-kaffe-shop-2026-09-01_2026-09-30.csv");
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [], registration, rateFor });
    expect(returnFileName("kaffe", data)).toBe("oss-kaffe-2026-Q3-filing.csv");
    expect(returnFileName("kaffe", data, true)).toBe("oss-detail-kaffe-2026-Q3-filing.csv");
    expect(reconciliationFileName("kaffe", "2026-09-01", "2026-10-01")).toBe("reconciliation-kaffe-2026-09-01_2026-09-30.csv");
    expect(vatFileName("../../etc/passwd", "2026-09-01", "2026-10-01")).toBe("vat-etc-passwd-2026-09-01_2026-09-30.csv");
    expect(vatFileName("", "2026-09-01", "2026-10-01")).toBe("vat-store-2026-09-01_2026-09-30.csv");
  });
});

describe("the Member State of dispatch in the files (Directive Art. 369g(2))", () => {
  it("gives a 2d row its dispatch state in the return data and in the detail, one row per dispatch state", () => {
    const fromDe = g({ marketCode: "DK", currency: "EUR", rate: 0.25, standardRate: 0.25, dispatchCountry: "DE", netMinor: 10000, vatMinor: 2500, grossMinor: 12500 });
    const fromPl = { ...fromDe, dispatchCountry: "PL" };
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [fromDe, fromPl], registration, rateFor });
    const out = returnCsv(data);
    expect(out.ok && lines(out.csv).slice(1, 3)).toEqual(["union,2026-Q3,2d,DK,DE,25,standard,100.00,25.00,,filing,union,EUR", "union,2026-Q3,2d,DK,PL,25,standard,100.00,25.00,,filing,union,EUR"]);
    const detail = detailCsv(data);
    expect(detail.ok && lines(detail.csv).slice(1, 3)).toEqual(["2026-Q3,2d,DK,DE,25,standard,EUR,100.00,25.00,1,,none (euro),100.00,25.00,1,0,", "2026-Q3,2d,DK,PL,25,standard,EUR,100.00,25.00,1,,none (euro),100.00,25.00,1,0,"]);
  });

  it("has the same number of cells in every row of the return data as in its header", () => {
    const data = buildReturn({ scheme: "oss", period: quarterPeriod(2026, 3), mode: "filing", groups: [g(), dk(), dkCredit()], registration, rateFor });
    const out = returnCsv(data);
    if (!out.ok) throw new Error("expected a file");
    for (const line of lines(out.csv).filter(Boolean)) expect(line.split(",").length).toBe(RETURN_CSV_HEADER.length);
  });
});
