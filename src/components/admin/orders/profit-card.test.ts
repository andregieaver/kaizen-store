import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { orderEn } from "@/lib/admin-messages/order.en";
import { orderNb } from "@/lib/admin-messages/order.nb";
import { toRates } from "@/lib/currency";
import { orderProfit, type OrderProfitInput } from "@/lib/order-profit";

import { ProfitCard } from "./profit-card";

/** Profit on the order page (D415): one figure first, how it adds up one step away. */

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const main = { currency: "NOK", rates: toRates([{ currency: "NOK", rate: 11.5, roundTo: 100 }]) };
const settings = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 6900 };
const input = (extra: Partial<OrderProfitInput> = {}): OrderProfitInput => ({
  currency: "NOK",
  totalMinor: 125_000,
  taxMinor: 25_000,
  voucherMinor: 0,
  refundsMinor: 0,
  lines: [{ quantity: 1, unitCostMinor: 30_000, needsCost: true }],
  payments: [{ provider: "stripe", amountMinor: 125_000, kaizenFeeMinor: 0, providerFeeMinor: 2_000, feeCurrency: "NOK" }],
  physical: true,
  parcels: [],
  lostDisputes: [],
  ...extra,
});
const card = (profit: ReturnType<typeof orderProfit>, words = orderEn.profit) =>
  createElement(ProfitCard, { profit, money: (m: number) => `${(m / 100).toFixed(2)} kr`, percent: (s: number) => `${Math.round(s * 100)} %`, words, costsHref: "/admin/s/products", settingsHref: "/admin/s/analytics/settings" });

describe("the profit card", () => {
  it("says what the order made and its share, with the lines and the estimate marked", () => {
    const out = html(card(orderProfit(input(), settings, main)));
    // 1 000,00 − 300,00 − 20,00 − 69,00 (sending, estimated).
    expect(out).toContain("You made 611.00 kr on this order");
    expect(out).toContain("61 % of what it brought in");
    expect(out).toContain("Partly estimated");
    expect(out).toContain("Sending");
    expect(out).toContain("(estimated)");
    expect(out).toContain('href="/admin/s/analytics/settings"');
  });

  it("says a loss plainly, asks for cost prices when one is missing, and speaks Norwegian", () => {
    expect(html(card(orderProfit(input({ lines: [{ quantity: 1, unitCostMinor: 120_000, needsCost: true }] }), settings, main)))).toContain("This order cost you");
    const missing = html(card(orderProfit(input({ lines: [{ quantity: 1, unitCostMinor: null, needsCost: true }] }), settings, main)));
    expect(missing).toContain("One item has no cost price");
    expect(missing).toContain('href="/admin/s/products"');
    expect(html(card(orderProfit(input(), settings, main), orderNb.profit))).toContain("Du tjente 611.00 kr på denne ordren");
  });
});
