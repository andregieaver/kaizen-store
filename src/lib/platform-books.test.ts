import { describe, expect, it } from "vitest";

import { entryProblems, isVatCode, standardAccount } from "./ledger";
import { entryOfPlatformCredit, entryOfPlatformPayout, entryOfPlatformSale, inBookOf, PLATFORM_INCOME, type BookedSale } from "./platform-books";

const plan: BookedSale = {
  id: "s1",
  number: "KF-0042",
  kind: "plan",
  paidOn: "2026-11-03",
  currency: "NOK",
  netMinor: 29_900,
  vatMinor: 7_475,
  totalMinor: 37_375,
  creditedMinor: 0,
  settledMinor: 37_375,
  settledCurrency: "NOK",
};

describe("Kaizena Flow's own money in the books (D508)", () => {
  it("names standard accounts and codes", () => {
    for (const a of [PLATFORM_INCOME.norway.account, PLATFORM_INCOME.norway.vatAccount, PLATFORM_INCOME.abroad.account, 1579, 7770, 1920]) expect(standardAccount(String(a))).toBeTruthy();
    expect(isVatCode(PLATFORM_INCOME.norway.code)).toBe(true);
    expect(isVatCode(PLATFORM_INCOME.abroad.code)).toBe(true);
  });

  it("posts a plan sold to a store in Norway: the Stripe balance against income and 25 % MVA", () => {
    const made = entryOfPlatformSale(plan, "NOK");
    expect(made).toEqual({
      ok: true,
      entry: {
        series: "S",
        date: "2026-11-03",
        text: "Kaizena Flow abonnement, faktura KF-0042",
        source: { kind: "platform_sale", id: "s1" },
        lines: [
          { account: 1579, amountMinor: 37_375, vatCode: null },
          { account: 3000, amountMinor: -29_900, vatCode: "3" },
          { account: 2700, amountMinor: -7_475, vatCode: "3" },
        ],
      },
    });
    if (made.ok) expect(entryProblems(made.entry)).toEqual([]);
  });

  it("posts a sale abroad in euros at what Stripe settled in kroner, as a service to a business abroad (52)", () => {
    const theme: BookedSale = { ...plan, id: "s2", kind: "theme", currency: "EUR", netMinor: 4_900, vatMinor: 0, totalMinor: 4_900, settledMinor: 57_330, settledCurrency: "NOK" };
    expect(entryOfPlatformSale(theme, "NOK")).toMatchObject({
      ok: true,
      entry: {
        text: "Kaizena Flow premiumtema, faktura KF-0042",
        lines: [
          { account: 1579, amountMinor: 57_330, vatCode: null },
          { account: 3200, amountMinor: -57_330, vatCode: "52" },
        ],
      },
    });
    // Not settled yet, or settled in another currency than the book's: it waits.
    expect(entryOfPlatformSale({ ...theme, settledMinor: null, settledCurrency: null }, "NOK")).toEqual({ ok: false, problem: "currency" });
    expect(entryOfPlatformSale({ ...theme, settledCurrency: "EUR", settledMinor: 4_900 }, "NOK")).toEqual({ ok: false, problem: "currency" });
    // VAT shared as sold when converted.
    expect(inBookOf({ currency: "EUR", netMinor: 8_000, vatMinor: 2_000, totalMinor: 10_000, settledMinor: 115_000, settledCurrency: "NOK" }, "NOK")).toEqual({ total: 115_000, net: 92_000, vat: 23_000 });
  });

  it("turns the credited share of a sale back on the day it is posted, and posts a payout with its fees", () => {
    const credit = entryOfPlatformCredit({ ...plan, creditedMinor: 37_375 }, "NOK", "2026-11-20");
    expect(credit).toMatchObject({
      ok: true,
      entry: {
        date: "2026-11-20",
        text: "Kreditnota: Kaizena Flow abonnement, faktura KF-0042",
        source: { kind: "platform_credit", id: "s1:37375" },
        lines: [
          { account: 1579, amountMinor: -37_375, vatCode: null },
          { account: 3000, amountMinor: 29_900, vatCode: "3" },
          { account: 2700, amountMinor: 7_475, vatCode: "3" },
        ],
      },
    });
    expect(entryOfPlatformCredit(plan, "NOK", "2026-11-20")).toEqual({ ok: false, problem: "nothing" });
    const payout = entryOfPlatformPayout({ id: "p1", arrivalOn: "2026-11-06", currency: "NOK", amountMinor: 36_100, feeMinor: 1_275 }, "NOK");
    expect(payout).toMatchObject({
      ok: true,
      entry: {
        series: "B",
        source: { kind: "platform_payout", id: "p1" },
        lines: [
          { account: 1920, amountMinor: 36_100, vatCode: null },
          { account: 7770, amountMinor: 1_275, vatCode: null },
          { account: 1579, amountMinor: -37_375, vatCode: null },
        ],
      },
    });
    expect(entryOfPlatformPayout({ id: "p2", arrivalOn: "2026-11-06", currency: "EUR", amountMinor: 100, feeMinor: 0 }, "NOK")).toEqual({ ok: false, problem: "currency" });
  });
});
