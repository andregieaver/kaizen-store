import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { lossMakers, orderProfit, type OrderProfitInput } from "./order-profit";

/** Profit per order (D415): the Finance page's definitions for one order. */

const rates = toRates([
  { currency: "NOK", rate: 11.5, roundTo: 100 },
  { currency: "SEK", rate: 11.2, roundTo: 100 },
]);
const main = { currency: "NOK", rates };
const settings = { paymentFeeBps: 150, paymentFeeFixedMinor: 200, shippingCostMinor: 6900 };

// 1 250,00 NOK with 25 % VAT: 1 000,00 without it.
const order = (extra: Partial<OrderProfitInput> = {}): OrderProfitInput => ({
  currency: "NOK",
  totalMinor: 125_000,
  taxMinor: 25_000,
  voucherMinor: 0,
  refundsMinor: 0,
  lines: [{ quantity: 2, unitCostMinor: 20_000, needsCost: true }],
  payments: [{ provider: "stripe", amountMinor: 125_000, kaizenFeeMinor: 1_250, providerFeeMinor: 2_100, feeCurrency: "NOK" }],
  physical: true,
  parcels: [7_400],
  lostDisputes: [],
  ...extra,
});
const line = (p: ReturnType<typeof orderProfit>, key: string) => p.lines.find((l) => l.key === key);

describe("profit per order", () => {
  it("takes the cost of goods, Stripe's own fee, Kaizena Flow's fee and the label's own price off revenue without VAT", () => {
    const p = orderProfit(order(), settings, main);
    expect(p.netMinor).toBe(100_000);
    expect(p.lines.map((l) => [l.key, l.amountMinor, l.estimated])).toEqual([
      ["revenue", 100_000, false],
      ["refunds", 0, false],
      ["cogs", -40_000, false],
      ["paymentFee", -2_100, false],
      ["platformFee", -1_250, false],
      ["shipping", -7_400, false],
    ]);
    expect(p.profitMinor).toBe(49_250);
    expect(p.margin).toBeCloseTo(0.4925);
    expect(p.estimated).toBe(false);
  });

  it("estimates the fee and the parcel from the store's settings where nothing is recorded, and says so", () => {
    const p = orderProfit(order({ payments: [{ provider: "stripe", amountMinor: 125_000, kaizenFeeMinor: 0, providerFeeMinor: null, feeCurrency: null }], parcels: [] }), settings, main);
    // 1.5 % of 1 250,00 + 2,00 and one parcel at 69,00 (not sent yet).
    expect(line(p, "paymentFee")).toEqual({ key: "paymentFee", amountMinor: -(1_875 + 200), estimated: true });
    expect(line(p, "shipping")).toEqual({ key: "shipping", amountMinor: -6_900, estimated: true });
    expect(p.estimated).toBe(true);
    expect(p.profitMinor).toBe(100_000 - 40_000 - 2_075 - 6_900);
  });

  it("takes refunds and a lost dispute off without VAT, and has no shipping for an order with nothing to send", () => {
    const p = orderProfit(order({ refundsMinor: 25_000, physical: false, parcels: [], lostDisputes: [{ amountMinor: 12_500, feeMinor: 15_000, feeCurrency: "NOK" }] }), settings, main);
    expect(line(p, "refunds")?.amountMinor).toBe(-20_000);
    expect(line(p, "shipping")?.amountMinor).toBe(0);
    expect(line(p, "disputes")?.amountMinor).toBe(-(10_000 + 15_000));
    expect(p.netMinor).toBe(80_000);
  });

  it("has no profit while a goods line has no cost, and says how many to fill in", () => {
    const p = orderProfit(order({ lines: [{ quantity: 1, unitCostMinor: 20_000, needsCost: true }, { quantity: 1, unitCostMinor: null, needsCost: true }, { quantity: 1, unitCostMinor: null, needsCost: false }] }), settings, main);
    expect(p.profitMinor).toBeNull();
    expect(p.margin).toBeNull();
    expect(p.linesWithoutCost).toBe(1);
  });

  it("leaves gift cards sold out of revenue and their payment out of the fee estimate", () => {
    const p = orderProfit(
      order({ voucherMinor: 50_000, totalMinor: 175_000, payments: [{ provider: "gift_card", amountMinor: 75_000, kaizenFeeMinor: 0, providerFeeMinor: null, feeCurrency: null }, { provider: "stripe", amountMinor: 100_000, kaizenFeeMinor: 0, providerFeeMinor: null, feeCurrency: null }] }),
      settings,
      main,
    );
    expect(line(p, "revenue")?.amountMinor).toBe(175_000 - 25_000 - 50_000);
    expect(line(p, "paymentFee")?.amountMinor).toBe(-(1_500 + 200));
  });

  it("converts the store's estimates and a fee in another currency into the order's, and has no figure without a rate", () => {
    const sek = orderProfit(order({ currency: "SEK", payments: [{ provider: "stripe", amountMinor: 125_000, kaizenFeeMinor: 0, providerFeeMinor: 2_300, feeCurrency: "NOK" }], parcels: [null] }), settings, main);
    expect(line(sek, "paymentFee")?.amountMinor).toBe(-Math.round(2_300 * (11.2 / 11.5)));
    expect(line(sek, "shipping")?.amountMinor).toBe(-Math.round(6_900 * (11.2 / 11.5)));
    const usd = orderProfit(order({ currency: "USD", parcels: [null], payments: [] }), settings, main);
    expect(usd.noRate).toBe(true);
    expect(usd.profitMinor).toBeNull();
  });

  it("lists the orders that lost money, worst first", () => {
    const at = (profit: number | null) => ({ profit: { ...orderProfit(order(), settings, main), profitMinor: profit } });
    const { losses, unknown } = lossMakers([at(500), at(-100), at(null), at(-900)]);
    expect(losses.map((r) => r.profit.profitMinor)).toEqual([-900, -100]);
    expect(unknown).toBe(1);
  });
});
