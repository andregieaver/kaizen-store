import { describe, expect, it } from "vitest";

import { financeEn } from "./admin-messages/finance.en";
import { financeNb } from "./admin-messages/finance.nb";
import { financeStatement } from "./analytics-finance";
import { PAYOUT_LINE_KIND_WORDS, PAYOUT_STATE_WORDS, PAYOUT_STATUS_WORDS } from "./payouts";
import { decimalComma, financeNumbers, withDecimals } from "./finance-words";

/** Every string of a catalogue with its path, so the Norwegian can be held to the English's placeholders. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the finance words (D312 A9)", () => {
  it("has every English text in Norwegian, with the same placeholders", () => {
    const nb = new Map(strings(financeNb));
    for (const [path, en] of strings(financeEn)) {
      expect(nb.has(path), path).toBe(true);
      expect(placeholders(nb.get(path) ?? ""), path).toEqual(placeholders(en));
    }
  });

  it("says the payouts' states, statuses and lines as the library does", () => {
    expect(financeEn.payouts.status).toEqual(PAYOUT_STATUS_WORDS);
    expect(financeEn.payouts.kinds).toEqual(PAYOUT_LINE_KIND_WORDS);
    expect(financeEn.payouts.states).toEqual(PAYOUT_STATE_WORDS);
  });

  it("writes the bridge in Norwegian when given its words, and the same amounts", () => {
    const totals = { orders: 2, revenueMinor: 10_000, grossSalesMinor: 10_000, discountsMinor: 0, shippingMinor: 0, refundsMinor: 0, cogsMinor: 4_000, knownCostRevenueMinor: 10_000, paymentFeesMinor: 0, platformFeesMinor: 0, shippingCostsMinor: 0, marketingMinor: 0, vatMinor: 2_500 } as unknown as Parameters<typeof financeStatement>[0];
    const settings = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 0, fixedCostsMonthlyMinor: 0 } as unknown as Parameters<typeof financeStatement>[1];
    const en = financeStatement(totals, settings, 30);
    const nb = financeStatement(totals, settings, 30, financeNb.statement);
    expect(en.lines.find((l) => l.key === "netRevenue")?.label).toBe("Net revenue");
    expect(nb.lines.find((l) => l.key === "netRevenue")?.label).toBe("Netto salgsinntekt");
    expect(nb.lines.find((l) => l.key === "cogs")?.label).toBe("Varekostnad");
    expect(nb.lines.map((l) => l.amountMinor)).toEqual(en.lines.map((l) => l.amountMinor));
  });

  it("writes a decimal comma in Norwegian and a point in English", () => {
    expect(decimalComma(financeNb)).toBe(true);
    expect(decimalComma()).toBe(false);
    expect(withDecimals("+12.4 %", true)).toBe("+12,4 %");
    expect(financeNumbers(financeNb).days(1)).toBe("1 dag");
    expect(financeNumbers(financeNb).days(2.5)).toBe("2,5 dager");
    expect(financeNumbers().days(0.2)).toBe("under a day");
  });
});
