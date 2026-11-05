import { describe, expect, it } from "vitest";

import { BOOKING_KEYS, defaultSettings, readSettings, standardKeyOf, type BookingKey } from "./tripletex-settings";
import { accountTakesVat, checkSettings, planSetup, type Chart, type ChartAccount, type ChartVatType } from "./tripletex-setup";

const VAT: ChartVatType[] = [
  { id: 100, number: "0", name: "Ingen avgiftsbehandling", percentage: 0 },
  { id: 103, number: "3", name: "Utgående avgift, høy sats", percentage: 25 },
  { id: 131, number: "31", name: "Utgående avgift, middels sats", percentage: 15 },
  { id: 133, number: "33", name: "Utgående avgift, lav sats", percentage: 12 },
  { id: 105, number: "5", name: "Ingen utgående avgift (innenfor mva-loven)", percentage: 0 },
  { id: 106, number: "6", name: "Ingen utgående avgift (utenfor mva-loven)", percentage: 0 },
  { id: 152, number: "52", name: "Avgiftsfri utførsel", percentage: 0 },
];

const income = (number: number, name: string, legal: number[], extra: Partial<ChartAccount> = {}): ChartAccount => ({
  id: number * 10,
  number,
  name,
  ledgerType: "GENERAL",
  legalVatTypes: legal.map((id) => ({ id })),
  ...extra,
});

/** A company as Tripletex sets one up: Norway's standard chart. */
const STANDARD: Chart = {
  vatTypes: VAT,
  accounts: [
    { id: 15000, number: 1500, name: "Kundefordringer", ledgerType: "CUSTOMER" },
    income(2900, "Forskudd fra kunder", [100]),
    income(3000, "Salgsinntekt, avgiftspliktig", [103, 131, 133, 100]),
    income(3100, "Salgsinntekt, avgiftsfri", [105]),
    income(3200, "Salgsinntekt, utenfor avgiftsområdet", [106, 152]),
  ],
};

const ALL: BookingKey[] = [...BOOKING_KEYS];

describe("setting up from the company's own chart (D453)", () => {
  it("takes Norway's standard accounts and codes when the company has them", () => {
    const plan = planSetup(STANDARD, ["standard_25", "exempt", "outside_scope", "reverse_charge"]);
    expect(plan.questions).toEqual([]);
    expect(plan.receivableAccount).toBe(1500);
    expect(plan.bookings).toEqual({
      standard_25: { account: 3000, vatCode: "3" },
      exempt: { account: 3100, vatCode: "5" },
      outside_scope: { account: 3200, vatCode: "6" },
      reverse_charge: { account: 3200, vatCode: "6" },
    });
    expect(plan.picks.every((p) => p.how === "standard")).toBe(true);
  });

  it("chooses only the buckets the store needs", () => {
    expect(Object.keys(planSetup(STANDARD, ["standard_25"]).bookings)).toEqual(["standard_25"]);
  });

  it("finds the nearest account when the standard one is locked to another code", () => {
    const chart: Chart = {
      vatTypes: VAT,
      accounts: [
        ...STANDARD.accounts.filter((a) => a.number !== 3000),
        income(3000, "Salgsinntekt, høy sats", [], { vatLocked: true, vatType: { id: 103 } }),
        income(3010, "Salgsinntekt, middels sats", [], { vatLocked: true, vatType: { id: 131 } }),
        income(3020, "Salgsinntekt, diverse", [131, 133]),
      ],
    };
    const plan = planSetup(chart, ["standard_25", "standard_15", "standard_12"]);
    expect(plan.bookings).toEqual({
      standard_25: { account: 3000, vatCode: "3" },
      standard_15: { account: 3010, vatCode: "31" },
      standard_12: { account: 3020, vatCode: "33" },
    });
    expect(plan.picks.find((p) => p.key === "standard_15")?.how).toBe("nearest");
  });

  it("never picks an account that wants a department, a project or a dimension, or one switched off", () => {
    const chart: Chart = {
      vatTypes: VAT,
      accounts: [
        ...STANDARD.accounts.filter((a) => a.number !== 3000),
        income(3000, "Salgsinntekt", [103], { requiresDepartment: true }),
        income(3001, "Salgsinntekt prosjekt", [103], { requiresProject: true }),
        income(3002, "Salgsinntekt dimensjon", [103], { requiresFreeDimension2: true }),
        income(3003, "Salgsinntekt gammel", [103], { isInactive: true }),
        income(3004, "Salgsinntekt nettbutikk", [103]),
      ],
    };
    expect(planSetup(chart, ["standard_25"]).bookings.standard_25).toEqual({ account: 3004, vatCode: "3" });
  });

  it("asks a person when no account takes the code (one must be made or opened in Tripletex)", () => {
    const chart: Chart = { vatTypes: VAT, accounts: STANDARD.accounts.filter((a) => a.number !== 3100) };
    const plan = planSetup(chart, ["exempt"]);
    expect(plan.bookings.exempt).toBeUndefined();
    expect(plan.questions).toEqual([{ key: "exempt", problem: "no_account", options: [] }]);
  });

  it("offers the debt accounts that would do for gift cards, rather than guessing one", () => {
    const chart: Chart = {
      vatTypes: VAT,
      accounts: [...STANDARD.accounts.filter((a) => a.number !== 2900), income(2400, "Leverandørgjeld", [100], { ledgerType: "VENDOR" }), income(2990, "Annen kortsiktig gjeld", [100])],
    };
    expect(planSetup(chart, ["gift_card"]).questions).toEqual([{ key: "gift_card", problem: "no_account", options: [{ number: 2990, name: "Annen kortsiktig gjeld" }] }]);
  });

  it("asks when the company lacks a VAT code", () => {
    const chart: Chart = { vatTypes: VAT.filter((v) => v.number !== "33"), accounts: STANDARD.accounts };
    expect(planSetup(chart, ["standard_12"]).questions).toEqual([{ key: "standard_12", problem: "vat_code_missing", vatCode: "33" }]);
  });

  it("puts gift cards on an account named for them, and never guesses an income account for a debt", () => {
    expect(planSetup(STANDARD, ["gift_card"]).bookings.gift_card).toEqual({ account: 2900, vatCode: "0" });
    const named: Chart = { vatTypes: VAT, accounts: [...STANDARD.accounts.filter((a) => a.number !== 2900), income(2950, "Gavekort solgt", [100])] };
    expect(planSetup(named, ["gift_card"]).bookings.gift_card).toEqual({ account: 2950, vatCode: "0" });
    const none: Chart = { vatTypes: VAT, accounts: STANDARD.accounts.filter((a) => a.number !== 2900) };
    expect(planSetup(none, ["gift_card"]).questions[0]).toMatchObject({ key: "gift_card", problem: "no_account" });
  });

  it("finds another customer ledger account for receivables, or asks", () => {
    const moved: Chart = { vatTypes: VAT, accounts: [...STANDARD.accounts.filter((a) => a.number !== 1500), { id: 1, number: 1510, name: "Kunder", ledgerType: "CUSTOMER" }] };
    expect(planSetup(moved, []).receivableAccount).toBe(1510);
    const none: Chart = { vatTypes: VAT, accounts: STANDARD.accounts.filter((a) => a.number !== 1500) };
    expect(planSetup(none, []).questions).toEqual([{ key: "receivable", problem: "no_account", options: [] }]);
  });
});

describe("checking settings against the company", () => {
  it("passes the plan it made", () => {
    const plan = planSetup(STANDARD, ALL);
    expect(plan.questions).toEqual([]);
    expect(checkSettings({ bookings: plan.bookings, receivableAccount: plan.receivableAccount! }, STANDARD, ALL)).toEqual([]);
  });

  it("names what Tripletex would refuse", () => {
    const problems = checkSettings(
      {
        receivableAccount: 3000,
        bookings: { standard_25: { account: 3100, vatCode: "3" }, exempt: { account: 4000, vatCode: "5" }, outside_scope: { account: 1500, vatCode: "6" }, reverse_charge: { account: 3200, vatCode: "99" } },
      },
      STANDARD,
      ["standard_25", "standard_15"],
    );
    expect(problems.map((p) => [p.key, p.problem])).toEqual([
      ["receivable", "not_customer_ledger"],
      ["standard_25", "vat_code_not_allowed"],
      ["standard_15", "missing"],
      ["exempt", "missing"],
      ["outside_scope", "is_customer_ledger"],
      ["reverse_charge", "vat_code_missing"],
    ]);
  });

  it("lets a VAT-locked account take only its own code", () => {
    const locked: ChartAccount = { id: 1, number: 3000, name: "x", vatLocked: true, vatType: { id: 103 }, legalVatTypes: [{ id: 131 }] };
    expect(accountTakesVat(locked, VAT[1])).toBe(true);
    expect(accountTakesVat(locked, VAT[2])).toBe(false);
  });
});

describe("the settings", () => {
  it("start from Norway's standard for the buckets asked, sending nothing personal", () => {
    const settings = defaultSettings(["standard_25"], { work: true, shop: true });
    expect(settings).toMatchObject({ receivableAccount: 1500, bookings: { standard_25: { account: 3000, vatCode: "3" } }, sendContactEmail: false, language: "nb" });
    expect(readSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("refuse what does not fit, so a page never works from broken settings", () => {
    expect(readSettings({ ...defaultSettings([], { work: true, shop: false }), receivableAccount: 15 })).toBeNull();
    expect(readSettings({ ...defaultSettings([], { work: true, shop: false }), bookings: { standard_25: { account: 3000, vatCode: "three" } } })).toBeNull();
    expect(readSettings(null)).toBeNull();
  });

  it("know Norway's rates and nothing else", () => {
    expect(standardKeyOf(0.25)).toBe("standard_25");
    expect(standardKeyOf("0.2500")).toBe("standard_25");
    expect(standardKeyOf("0.1500")).toBe("standard_15");
    expect(standardKeyOf(0.12)).toBe("standard_12");
    expect(standardKeyOf(0)).toBe("standard_0");
    expect(standardKeyOf(0.21)).toBeNull();
  });
});
