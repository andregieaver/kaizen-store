import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NO_STANDARD_ACCOUNTS, NO_STARTING_ACCOUNTS } from "./ledger";
import {
  NO_GROUPING_CODES,
  NO_GROUPING_RANGES,
  addressOfLine,
  contactNames,
  groupingOf,
  isCustomerAccount,
  isSupplierAccount,
  lineVat,
  partyBalances,
  saftAmount,
  saftBalances,
  saftFileName,
  saftVersion,
  saftXml,
  ungroupedAccounts,
  type SaftInput,
} from "./saft";

describe("each account's code in Skatteetaten's business statement (D497)", () => {
  it("covers 1000 to 8999 in order, without a gap, and only with codes the statement has", () => {
    let next = 1000;
    const codes = new Set(NO_GROUPING_CODES.map((g) => g.code));
    for (const [first, last, code] of NO_GROUPING_RANGES) {
      expect(first).toBe(next);
      expect(last).toBeGreaterThanOrEqual(first);
      expect(codes.has(String(code))).toBe(true);
      next = last + 1;
    }
    expect(next).toBe(9000);
  });

  it("gives every standard account a code", () => {
    expect(NO_STANDARD_ACCOUNTS.filter((a) => groupingOf(Number(a.id)) === null)).toEqual([]);
  });

  it("reports the accounts a new book starts with as an accountant would", () => {
    const of = (n: number) => groupingOf(n)?.code;
    expect(Object.fromEntries(NO_STARTING_ACCOUNTS.map((n) => [n, of(n)]))).toEqual({
      1500: "1500", 1579: "1570", 1900: "1900", 1920: "1920", 2000: "2000", 2050: "2050", 2400: "2400", 2700: "2740", 2701: "2740", 2703: "2740",
      2710: "2740", 2711: "2740", 2713: "2740", 2740: "2740", 2900: "2900", 2990: "2990", 3000: "3000", 3030: "3000", 3050: "3000", 3100: "3100",
      3105: "3100", 3125: "3100", 3200: "3200", 3900: "3900", 4300: "4005", 6300: "6300", 6700: "6700", 6705: "6700", 6800: "6995", 6900: "6995",
      7140: "7165", 7320: "7330", 7770: "7700", 8050: "8050", 8060: "8060", 8150: "8150", 8160: "8160", 8800: "8800",
    });
    expect(groupingOf(1500)).toEqual({ code: "1500", category: "balanseverdiForOmloepsmiddel", nb: "Kundefordringer", en: "Accounts receivable" });
    expect(groupingOf(2710)?.category).toBe("kortsiktigGjeld");
    expect(groupingOf(3000)?.category).toBe("salgsinntekt");
    expect(groupingOf(7770)?.category).toBe("annenDriftskostnad");
    expect(groupingOf(8800)?.category).toBe("resultatDisponeringForSAF-T");
  });

  it("reads a sub-account by its standard account, else by its first four digits; nothing outside the chart", () => {
    expect(groupingOf(15001)?.code).toBe("1500");
    expect(groupingOf(19201, "1920")?.code).toBe("1920");
    expect(groupingOf(1921, "1920")?.code).toBe("1920");
    expect(groupingOf(9100)).toBeNull();
    expect(ungroupedAccounts([{ number: 1920, standard: "1920" }, { number: 9100, standard: null }])).toEqual([9100]);
  });
});

describe("balances at the selection's start and end (D497)", () => {
  it("carries the balance sheet over, starts the result at nought each year, and puts an earlier year's uncarried result on other equity", () => {
    expect(
      saftBalances([
        { account: 1920, beforeYear: 500_000, inYearBefore: 100_000, inSelection: 50_000 },
        { account: 3000, beforeYear: -400_000, inYearBefore: -80_000, inSelection: -40_000 },
        { account: 6800, beforeYear: 100_000, inYearBefore: 0, inSelection: 0 },
        { account: 2000, beforeYear: -200_000, inYearBefore: 0, inSelection: 0 },
        { account: 2700, beforeYear: 0, inYearBefore: -20_000, inSelection: -10_000 },
      ]),
    ).toEqual([
      { account: 1920, opening: 600_000, closing: 650_000 },
      { account: 2000, opening: -200_000, closing: -200_000 },
      { account: 2050, opening: -300_000, closing: -300_000 },
      { account: 2700, opening: -20_000, closing: -30_000 },
      { account: 3000, opening: -80_000, closing: -120_000 },
      { account: 6800, opening: 0, closing: 0 },
    ]);
  });

  it("sums each customer's lines to what they owed at the start and the end", () => {
    const sums = partyBalances(
      [
        { party: "a", account: 1500, amount: 10_000, date: "2025-12-01" },
        { party: "a", account: 1500, amount: -10_000, date: "2026-01-05" },
        { party: "a", account: 1500, amount: 5_000, date: "2026-03-01" },
        { party: "b", account: 1500, amount: 7_000, date: "2027-01-01" },
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(Object.fromEntries(sums)).toEqual({ a: [{ account: 1500, opening: 10_000, closing: 5_000 }] });
    expect(isCustomerAccount(15001)).toBe(true);
    expect(isCustomerAccount(1530)).toBe(false);
    expect(isSupplierAccount(2400)).toBe(true);
    expect(isSupplierAccount(2460)).toBe(false);
  });
});

describe("the VAT on each line (D497)", () => {
  it("shares the entry's VAT for a code by the lines' bases, the rest on the last", () => {
    const line = (n: number, account: number, amount: number, vatCode: string | null) => ({ line: n, account, amount, vatCode, text: null, customerId: null, supplierId: null });
    expect(Object.fromEntries(lineVat([line(1, 6800, 50_000, "1"), line(2, 6800, 30_001, "1"), line(3, 2710, 20_000, "1"), line(4, 1920, -100_001, null)]))).toEqual({ 1: 12_500, 2: 7_500 });
    expect(Object.fromEntries(lineVat([line(1, 3000, -100, "3"), line(2, 3000, -100, "3"), line(3, 3000, -100, "3"), line(4, 2700, -75, "3"), line(5, 1500, 375, null)]))).toEqual({ 1: -25, 2: -25, 3: -25 });
    // Reverse charge: reckoned on the base, though the VAT accounts' halves net to nought.
    expect(Object.fromEntries(lineVat([line(1, 6700, 100_000, "86"), line(2, 2702, -25_000, "86"), line(3, 2712, 25_000, "86"), line(4, 2400, -100_000, null)]))).toEqual({ 1: 25_000 });
    // A sale without VAT: its line, with nought.
    expect(Object.fromEntries(lineVat([line(1, 3100, -50_000, "5"), line(2, 1500, 50_000, null)]))).toEqual({ 1: 0 });
  });
});

describe("the file (D497)", () => {
  it("writes amounts with two decimals, never negative, from minor units", () => {
    expect(saftAmount(125_000)).toBe("1250.00");
    expect(saftAmount(-5)).toBe("0.05");
    expect(saftAmount(0)).toBe("0.00");
    expect(saftAmount(123_456_789_012_345)).toBe("1234567890123.45");
  });

  it("names the version, the file and the contact as Skatteetaten does", () => {
    expect(saftVersion("2026-01-01")).toBe("1.30");
    expect(saftVersion("2027-01-01")).toBe("1.40");
    expect(saftFileName("913 238 254", "20261108143000")).toBe("SAF-T Financial_913238254_20261108143000.xml");
    expect(contactNames("Kari Anne Nordmann", null)).toEqual({ firstName: "Kari Anne", lastName: "Nordmann" });
    expect(contactNames("Kari", null)).toEqual({ firstName: "Kari", lastName: "-" });
    expect(contactNames(null, "kari@example.com")).toEqual({ firstName: "kari", lastName: "-" });
    expect(addressOfLine("Storgata 1, 0150 Oslo", "NO")).toEqual({ street: "Storgata 1", postalCode: "0150", city: "Oslo", country: "NO" });
    expect(addressOfLine("Postboks 12 Sentrum", "NO")).toEqual({ street: "Postboks 12 Sentrum", postalCode: null, city: null, country: "NO" });
    expect(addressOfLine("", null)).toBeNull();
  });

  it("puts the VAT on the base's line, the customer and supplier on theirs, and debits and credits that sum", () => {
    const xml = saftXml(SAMPLE);
    expect(xml).toContain('<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO">');
    expect(xml).toMatch(/<AccountID>7770<\/AccountID>\s*<AccountDescription>Bank- og kortgebyr<\/AccountDescription>\s*<GroupingCategory>annenDriftskostnad<\/GroupingCategory>\s*<GroupingCode>7700<\/GroupingCode>/);
    expect(xml).toMatch(/<AccountID>3000<\/AccountID>\s*<Description>Rådgivning<\/Description>\s*<CreditAmount>\s*<Amount>12000.00<\/Amount>\s*<\/CreditAmount>\s*<TaxInformation>\s*<TaxType>MVA<\/TaxType>\s*<TaxCode>3<\/TaxCode>\s*<TaxPercentage>25<\/TaxPercentage>\s*<Country>NO<\/Country>\s*<TaxBase>12000.00<\/TaxBase>\s*<CreditTaxAmount>\s*<Amount>3000.00<\/Amount>/);
    expect(xml).toMatch(/<AccountID>2700<\/AccountID>\s*<Description>[^<]*<\/Description>\s*<CreditAmount>\s*<Amount>3000.00<\/Amount>\s*<\/CreditAmount>\s*<\/Line>/);
    expect(xml).toMatch(/<AccountID>1500<\/AccountID>\s*<CustomerID>6f1c2a9e4b7d4e0f9a3b5c7d8e9f0a1b<\/CustomerID>/);
    expect(xml).toMatch(/<AccountID>2400<\/AccountID>\s*<SupplierID>0a1b2c3d4e5f60718293a4b5c6d7e8f9<\/SupplierID>/);
    expect(xml).toContain("<Name>Revisor &lt;Hansen&gt; AS</Name>");
    expect(xml).toContain("<OpeningCreditBalance>1000.00</OpeningCreditBalance>");
    expect(xml).toContain("<NumberOfEntries>9</NumberOfEntries>");
    expect(xml).toContain("<TotalDebit>64150.00</TotalDebit>");
    expect(xml).toContain("<TotalCredit>64150.00</TotalCredit>");
    expect(xml.indexOf("<JournalID>IB</JournalID>")).toBeLessThan(xml.indexOf("<JournalID>S</JournalID>"));
    expect(xml).toContain("<VoucherType>Tilbakeføring</VoucherType>");
    expect(() => saftXml({ ...SAMPLE, accounts: [{ number: 9100, name: "X", standard: null, createdOn: null, opening: 0, closing: 0 }] })).toThrow();
  });

  it("writes exactly the sample validated against Skatteetaten's schemas", () => {
    // `src/data/saft/saft-sample.xml` was validated with xmllint against `Norwegian_SAF-T_Financial_Schema_v_1.30.xsd` and `_v_1.40.xsd`
    // (github.com/Skatteetaten/saf-t) on 8 November 2026. A change to the file changes this sample, which is validated again first
    // (`WRITE_SAFT_SAMPLE=1` writes it).
    const file = path.resolve(__dirname, "../data/saft/saft-sample.xml");
    const xml = saftXml(SAMPLE);
    if (process.env.WRITE_SAFT_SAMPLE === "1") writeFileSync(file, xml);
    expect(xml).toBe(readFileSync(file, "utf8"));
  });
});

const SAMPLE: SaftInput = {
  company: {
    organisationNumber: "913 238 254",
    name: "Konsulent & Co AS",
    address: { street: "Storgata 1", postalCode: "0150", city: "Oslo", country: "NO" },
    contact: { firstName: "Kari", lastName: "Nordmann", email: "post@konsulent.no" },
  },
  currency: "NOK",
  createdOn: "2026-11-08",
  from: "2026-01-01",
  to: "2026-12-31",
  software: { name: "Kaizena Flow", version: "abc1234" },
  accounts: [
    { number: 1500, name: "Kundefordringer", standard: "1500", createdOn: "2026-11-01", opening: 0, closing: 0 },
    { number: 1579, name: "Andre kortsiktige fordringer", standard: "1579", createdOn: "2026-11-01", opening: 0, closing: 0 },
    { number: 1920, name: "Bankinnskudd", standard: "1920", createdOn: "2026-11-01", opening: 0, closing: 1_315_250 },
    { number: 2000, name: "Aksjekapital / Egenkapital, bundet", standard: "2000", createdOn: "2026-11-01", opening: 0, closing: -3_000_000 },
    { number: 2050, name: "Annen egenkapital", standard: "2050", createdOn: "2026-11-01", opening: -100_000, closing: -100_000 },
    { number: 2400, name: "Leverandørgjeld", standard: "2400", createdOn: "2026-11-01", opening: 0, closing: 0 },
    { number: 2700, name: "Utgående merverdiavgift, høy sats", standard: "2700", createdOn: "2026-11-01", opening: 0, closing: -300_000 },
    { number: 2710, name: "Inngående merverdiavgift, høy sats", standard: "2710", createdOn: "2026-11-01", opening: 0, closing: 45_000 },
    { number: 3000, name: "Salgsinntekt handelsvarer, avgiftspliktig, høy sats", standard: "3000", createdOn: "2026-11-01", opening: 0, closing: -1_200_000 },
    { number: 6800, name: "Kontorrekvisita", standard: "6800", createdOn: "2026-11-01", opening: 0, closing: 80_000 },
    { number: 6700, name: "Revisjonshonorar", standard: "6700", createdOn: "2026-11-01", opening: 0, closing: 100_000 },
    { number: 7770, name: "Bank- og kortgebyr", standard: "7770", createdOn: "2026-11-01", opening: 0, closing: 4_750 },
    { number: 15001, name: "Kundefordringer, utland", standard: "1500", createdOn: null, opening: 0, closing: 0 },
  ],
  customers: [
    {
      id: "6f1c2a9e4b7d4e0f9a3b5c7d8e9f0a1b",
      name: "Acme AS",
      registrationNumber: "987 654 321",
      address: { street: "Kirkeveien 1", postalCode: "0364", city: "Oslo", country: "NO" },
      balances: [{ account: 1500, opening: 0, closing: 0 }],
    },
    { id: "NETTBUTIKK", name: "Nettbutikkens kunder", registrationNumber: null, address: null, balances: [{ account: 1500, opening: 0, closing: 0 }] },
  ],
  suppliers: [
    {
      id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
      name: "Revisor <Hansen> AS",
      registrationNumber: "912345678",
      address: null,
      balances: [{ account: 2400, opening: 0, closing: 0 }],
    },
  ],
  entries: [
    {
      series: "IB",
      year: 2026,
      number: 1,
      date: "2026-11-01",
      postedOn: "2026-11-01",
      text: "Inngående balanse",
      sourceKind: "opening_balance",
      reversal: false,
      lines: [
        { line: 1, account: 1920, amount: 3_000_000, vatCode: null, text: null, customerId: null, supplierId: null },
        { line: 2, account: 2000, amount: -3_000_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "S",
      year: 2026,
      number: 1,
      date: "2026-11-03",
      postedOn: "2026-11-03",
      text: "Faktura 10001 Acme AS",
      sourceKind: "work_invoice",
      reversal: false,
      lines: [
        { line: 1, account: 1500, amount: 1_500_000, vatCode: null, text: null, customerId: "6f1c2a9e4b7d4e0f9a3b5c7d8e9f0a1b", supplierId: null },
        { line: 2, account: 3000, amount: -1_200_000, vatCode: "3", text: "Rådgivning", customerId: null, supplierId: null },
        { line: 3, account: 2700, amount: -300_000, vatCode: "3", text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "B",
      year: 2026,
      number: 1,
      date: "2026-11-05",
      postedOn: "2026-11-06",
      text: "Innbetaling faktura 10001",
      sourceKind: "work_payment",
      reversal: false,
      lines: [
        { line: 1, account: 1920, amount: 1_500_000, vatCode: null, text: null, customerId: null, supplierId: null },
        { line: 2, account: 1500, amount: -1_500_000, vatCode: null, text: null, customerId: "6f1c2a9e4b7d4e0f9a3b5c7d8e9f0a1b", supplierId: null },
      ],
    },
    {
      series: "L",
      year: 2026,
      number: 1,
      date: "2026-11-04",
      postedOn: "2026-11-04",
      text: "Revisor <Hansen> AS, faktura 77",
      sourceKind: "supplier_invoice",
      reversal: false,
      lines: [
        { line: 1, account: 6700, amount: 100_000, vatCode: "1", text: null, customerId: null, supplierId: null },
        { line: 2, account: 2710, amount: 25_000, vatCode: "1", text: null, customerId: null, supplierId: null },
        { line: 3, account: 2400, amount: -125_000, vatCode: null, text: null, customerId: null, supplierId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" },
      ],
    },
    {
      series: "B",
      year: 2026,
      number: 2,
      date: "2026-11-07",
      postedOn: "2026-11-07",
      text: "Betalt Revisor <Hansen> AS, faktura 77",
      sourceKind: "bank_line",
      reversal: false,
      lines: [
        { line: 1, account: 2400, amount: 125_000, vatCode: null, text: null, customerId: null, supplierId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" },
        { line: 2, account: 1920, amount: -125_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "M",
      year: 2026,
      number: 1,
      date: "2026-11-06",
      postedOn: "2026-11-06",
      text: "Kontorrekvisita",
      sourceKind: null,
      reversal: false,
      lines: [
        { line: 1, account: 6800, amount: 50_000, vatCode: "1", text: null, customerId: null, supplierId: null },
        { line: 2, account: 6800, amount: 30_000, vatCode: "1", text: "Papir", customerId: null, supplierId: null },
        { line: 3, account: 2710, amount: 20_000, vatCode: "1", text: null, customerId: null, supplierId: null },
        { line: 4, account: 1920, amount: -100_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "M",
      year: 2026,
      number: 2,
      date: "2026-11-06",
      postedOn: "2026-11-06",
      text: "Feilført",
      sourceKind: null,
      reversal: false,
      lines: [
        { line: 1, account: 6800, amount: 10_000, vatCode: null, text: null, customerId: null, supplierId: null },
        { line: 2, account: 1920, amount: -10_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "M",
      year: 2026,
      number: 3,
      date: "2026-11-06",
      postedOn: "2026-11-07",
      text: "Tilbakeføring av M2026-2: Feilført",
      sourceKind: null,
      reversal: true,
      lines: [
        { line: 1, account: 6800, amount: -10_000, vatCode: null, text: null, customerId: null, supplierId: null },
        { line: 2, account: 1920, amount: 10_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
    {
      series: "B",
      year: 2026,
      number: 3,
      date: "2026-11-08",
      postedOn: "2026-11-08",
      text: "Utbetaling fra Stripe",
      sourceKind: "payout",
      reversal: false,
      lines: [
        { line: 1, account: 1920, amount: 40_250, vatCode: null, text: null, customerId: null, supplierId: null },
        { line: 2, account: 7770, amount: 4_750, vatCode: null, text: "Gebyr", customerId: null, supplierId: null },
        { line: 3, account: 1579, amount: -45_000, vatCode: null, text: null, customerId: null, supplierId: null },
      ],
    },
  ],
};
