import { describe, expect, it } from "vitest";

import { allBalanced, bridgeSentence, reconcile, reconcileMain, refundsLine, type CurrencySums } from "./tax-reconciliation";

const sums = (over: Partial<CurrencySums> = {}): CurrencySums => ({
  currency: "NOK",
  finance: { orders: 10, taxMinor: 100000 },
  report: { orders: 10, taxMinor: 100000 },
  causes: {},
  ...over,
});

describe("reconcile", () => {
  it("balances when Finance and the report are equal and nothing differs", () => {
    const b = reconcile(sums());
    expect(b.balanced).toBe(true);
    expect(b.differenceMinor).toBe(0);
    expect(b.lines.map((l) => l.kind)).toEqual(["finance", "report"]);
    expect(bridgeSentence([b])).toBe("Equal: every difference is named.");
  });

  it("names every difference and closes exactly: R = F + timing_in + not_captured - timing_out - invoicing_off - test_mode - waiting - other", () => {
    const b = reconcile(
      sums({
        finance: { orders: 12, taxMinor: 100000 },
        report: { orders: 8, taxMinor: 100000 + 5000 + 2000 - 3000 - 4000 - 1500 - 2500 - 500 },
        causes: {
          timing_in: { orders: 1, taxMinor: 5000 },
          not_captured: { orders: 1, taxMinor: 2000 },
          timing_out: { orders: 1, taxMinor: 3000 },
          invoicing_off: { orders: 2, taxMinor: 4000 },
          test_mode: { orders: 1, taxMinor: 1500 },
          waiting: { orders: 1, taxMinor: 2500 },
          other: { orders: 1, taxMinor: 500 },
        },
      }),
    );
    expect(b.balanced).toBe(true);
    expect(b.computedMinor).toBe(b.reportMinor);
    expect(b.lines.filter((l) => l.kind === "cause").map((l) => [l.cause, l.sign])).toEqual([
      ["timing_in", 1], ["not_captured", 1], ["timing_out", -1], ["invoicing_off", -1], ["test_mode", -1], ["waiting", -1], ["other", -1],
    ]);
    expect(b.lines[0]).toMatchObject({ kind: "finance", taxMinor: 100000 });
    expect(b.lines.at(-1)).toMatchObject({ kind: "report" });
  });

  it("says plainly when it does not balance, and never hides the difference", () => {
    const b = reconcile(sums({ report: { orders: 10, taxMinor: 99999 } }));
    expect(b.balanced).toBe(false);
    expect(b.differenceMinor).toBe(-1);
    expect(bridgeSentence([b])).toBe("Does not reconcile");
    expect(allBalanced([b, reconcile(sums())])).toBe(false);
  });

  it("skips a cause with nothing in it", () => {
    const b = reconcile(sums({ causes: { test_mode: { orders: 0, taxMinor: 0 } } }));
    expect(b.lines).toHaveLength(2);
  });

  it("is exact in each currency on its own", () => {
    const sek = reconcile(sums({ currency: "SEK", finance: { orders: 3, taxMinor: 5000 }, report: { orders: 2, taxMinor: 3000 }, causes: { invoicing_off: { orders: 1, taxMinor: 2000 } } }));
    const eur = reconcile(sums({ currency: "EUR", finance: { orders: 1, taxMinor: 1900 }, report: { orders: 1, taxMinor: 1900 } }));
    expect(allBalanced([sek, eur])).toBe(true);
  });
});

describe("reconcileMain", () => {
  const rates: Record<string, number> = { SEK: 1, EUR: 11.2, DKK: 1.5 };
  const toMain = (currency: string, minor: number) => (rates[currency] === undefined ? null : Math.floor(minor * rates[currency] + 0.5));

  it("converts each line at today's rates and closes with an exchange-rate difference and rounding, both named", () => {
    const eur = sums({ currency: "EUR", finance: { orders: 2, taxMinor: 2000 }, report: { orders: 2, taxMinor: 2000 } });
    const dkk = sums({ currency: "DKK", finance: { orders: 1, taxMinor: 1001 }, report: { orders: 1, taxMinor: 1001 } });
    // The report's stored rates were a little different from today's.
    const stored = 22400 + 1500;
    const b = reconcileMain("SEK", [eur, dkk], stored, toMain);
    expect(b.financeMainMinor).toBe(22400 + 1502);
    expect(b.reportMainMinor).toBe(stored);
    expect(b.lines.map((l) => l.kind)).toEqual(["finance", "exchange_rate", "report"]);
    const exchange = b.lines.find((l) => l.kind === "exchange_rate")!;
    expect(exchange.taxMinor).toBe(stored - (22400 + 1502));
    // The bridge closes: Finance + named lines = report.
    const sum = b.lines.filter((l) => l.kind !== "report").reduce((s, l) => s + l.taxMinor, 0);
    expect(sum).toBe(b.reportMainMinor);
  });

  it("carries a cause in the main currency and keeps the identity, with rounding named", () => {
    const eur = sums({ currency: "EUR", finance: { orders: 3, taxMinor: 3335 }, report: { orders: 2, taxMinor: 2222 }, causes: { invoicing_off: { orders: 1, taxMinor: 1113 } } });
    const b = reconcileMain("SEK", [eur], Math.floor(2222 * 11.2 + 0.5), toMain);
    const sum = b.lines.filter((l) => l.kind !== "report").reduce((s, l) => s + (l.kind === "cause" ? l.sign * l.taxMinor : l.taxMinor), 0);
    expect(sum).toBe(b.reportMainMinor);
    expect(b.lines.some((l) => l.kind === "cause" && l.cause === "invoicing_off")).toBe(true);
  });

  it("leaves a currency with no rate today out of the bridge and says which", () => {
    const gbp = sums({ currency: "GBP" });
    const b = reconcileMain("SEK", [sums({ currency: "SEK", finance: { orders: 1, taxMinor: 100 }, report: { orders: 1, taxMinor: 100 } }), gbp], 100, toMain);
    expect(b.notConverted).toEqual(["GBP"]);
    expect(b.financeMainMinor).toBe(100);
  });

  it("names invoices with no stored rate on a line of their own instead of calling their whole VAT an exchange-rate difference", () => {
    // The finding: a DKK invoice whose snapshot holds no conversion to the main currency is left out of the report's main figure (0), and
    // the whole of its VAT used to come out as "Exchange-rate difference".
    const dkk = sums({ currency: "DKK", finance: { orders: 1, taxMinor: 25000 }, report: { orders: 1, taxMinor: 25000 } });
    const b = reconcileMain("SEK", [dkk], 0, toMain, [{ currency: "DKK", invoices: 1, vatMinor: 25000 }]);
    const noRate = b.lines.find((l) => l.kind === "no_stored_rate");
    expect(noRate).toMatchObject({ label: "Invoices with no stored rate", orders: 1, taxMinor: 37500, sign: -1 });
    expect(b.lines.some((l) => l.kind === "exchange_rate")).toBe(false);
    expect(b.lines.some((l) => l.kind === "rounding")).toBe(false);
    // Finance + the named lines, with the no-rate line taken away, is the report's figure.
    const sum = b.lines.filter((l) => l.kind !== "report").reduce((n, l) => n + (l.kind === "no_stored_rate" ? -l.taxMinor : l.taxMinor), 0);
    expect(sum).toBe(b.reportMainMinor);
  });

  it("keeps the exchange-rate difference for the documents that have a stored rate when others have none", () => {
    const dkk = sums({ currency: "DKK", finance: { orders: 2, taxMinor: 2000 }, report: { orders: 2, taxMinor: 2000 } });
    // One invoice (VAT 1000) has no stored rate; the other (1000 DKK) was converted at 1.4 when issued, today's rate is 1.5.
    const b = reconcileMain("SEK", [dkk], 1400, toMain, [{ currency: "DKK", invoices: 1, vatMinor: 1000 }]);
    expect(b.lines.find((l) => l.kind === "no_stored_rate")?.taxMinor).toBe(1500);
    expect(b.lines.find((l) => l.kind === "exchange_rate")?.taxMinor).toBe(-100);
  });

  it("has no such line when every document has a stored rate", () => {
    const eur = sums({ currency: "EUR", finance: { orders: 1, taxMinor: 1000 }, report: { orders: 1, taxMinor: 1000 } });
    expect(reconcileMain("SEK", [eur], 11200, toMain, []).lines.some((l) => l.kind === "no_stored_rate")).toBe(false);
  });

  it("does not convert the main currency itself", () => {
    const b = reconcileMain("SEK", [sums({ currency: "SEK", finance: { orders: 1, taxMinor: 123 }, report: { orders: 1, taxMinor: 123 } })], 123, () => { throw new Error("no"); });
    expect(b.lines.map((l) => l.kind)).toEqual(["finance", "report"]);
  });
});

describe("refundsLine", () => {
  it("agrees to within one minor unit per refund", () => {
    expect(refundsLine(10000, 10002, 3)).toMatchObject({ differenceMinor: 2, withinRounding: true });
    expect(refundsLine(10000, 10004, 3)).toMatchObject({ differenceMinor: 4, withinRounding: false });
    expect(refundsLine(0, 0, 0).withinRounding).toBe(true);
  });

  it("names the usual reasons when it does not", () => {
    expect(refundsLine(10000, 5000, 1).text).toContain("no invoice");
  });
});

describe("order changes in the bridge (D174)", () => {
  it("adds edit_in and edit_credited, takes away edit_out and edit_waiting, and closes exactly", () => {
    // Finance has the edited orders at their amounts now; the report has the original invoices and the additional invoices dated in the period.
    const b = reconcile(
      sums({
        finance: { orders: 4, taxMinor: 10000 },
        report: { orders: 4, taxMinor: 10000 + 300 + 200 - 150 - 50 },
        causes: { edit_in: { orders: 1, taxMinor: 300 }, edit_credited: { orders: 1, taxMinor: 200 }, edit_out: { orders: 1, taxMinor: 150 }, edit_waiting: { orders: 1, taxMinor: 50 } },
      }),
    );
    expect(b.balanced).toBe(true);
    expect(b.lines.filter((l) => l.kind === "cause").map((l) => [l.cause, l.sign])).toEqual([
      ["edit_in", 1],
      ["edit_credited", 1],
      ["edit_out", -1],
      ["edit_waiting", -1],
    ]);
    for (const l of b.lines.filter((x) => x.kind === "cause")) {
      expect(l.label.length).toBeGreaterThan(10);
      expect(l.text).toMatch(/change/);
    }
  });

  it("keeps a change whose documents wait apart from orders with no invoice, and carries the causes into the main-currency bridge", () => {
    const nok = sums({ finance: { orders: 1, taxMinor: 1000 }, report: { orders: 1, taxMinor: 1200 }, causes: { edit_credited: { orders: 1, taxMinor: 200 } } });
    const main = reconcileMain("NOK", [nok], 1200, () => null);
    expect(main.lines.find((l) => l.cause === "edit_credited")).toMatchObject({ sign: 1, taxMinor: 200 });
    expect(main.lines.some((l) => l.kind === "rounding" || l.kind === "exchange_rate")).toBe(false);
  });
});
