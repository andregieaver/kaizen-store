import { describe, expect, it } from "vitest";

import {
  cardPrice,
  chargeButton,
  chargeLine,
  chargeToken,
  isPremium,
  nextTryDelayMs,
  orderPrices,
  priceLine,
  priceText,
  pricesText,
  readChargeToken,
} from "./theme-prices";

// Intl puts a no-break space between a currency's code and its amount.
const plain = (text: string) => text.replace(/\u00a0/g, " ");

describe("theme prices (D286)", () => {
  const prices = [
    { currency: "SEK", amountMinor: 349000 },
    { currency: "EUR", amountMinor: 29900 },
    { currency: "NOK", amountMinor: 349000 },
  ];

  it("is free without a price, and lists prices in the plans' currency order", () => {
    expect(isPremium([])).toBe(false);
    expect(isPremium(prices)).toBe(true);
    expect(pricesText([])).toBe("Free");
    expect(orderPrices(prices, ["NOK", "SEK"]).map((p) => p.currency)).toEqual(["NOK", "SEK", "EUR"]);
    expect(plain(pricesText(prices, ["NOK"]))).toBe("NOK 3,490 · €299 · SEK 3,490");
  });

  it("shows a price without decimals when it is whole, and a card's in the platform's own currency", () => {
    expect(plain(priceText({ currency: "EUR", amountMinor: 29950 }))).toBe("€299.50");
    expect(cardPrice(undefined)).toBe("Free");
    expect(plain(cardPrice(orderPrices(prices, ["NOK"])))).toBe("NOK 3,490");
    expect(priceLine([])).toBe("Free");
    expect(plain(priceLine([{ currency: "NOK", amountMinor: 349000 }]))).toBe("NOK 3,490, excl. VAT, once per store. Free to try: you pay when your store goes live with it.");
  });

  it("reads back only a price it could have written", () => {
    const price = { currency: "NOK", amountMinor: 349000 };
    expect(readChargeToken(chargeToken(price))).toEqual(price);
    for (const bad of ["", "nok:1", "NOK:0", "NOK:-5", "NOK:1.5", "NOK:1e5", "NOK:9999999999", null, 12]) expect(readChargeToken(bad)).toBeNull();
  });

  it("says what pressing costs, and asks to pay only when it is charged at once", () => {
    const price = { currency: "NOK", amountMinor: 349000 };
    expect(chargeLine({ kind: "free" })).toBe("");
    expect(plain(chargeLine({ kind: "at_opening", price }))).toMatch(/^NOK 3,490 excl. VAT, once. Nothing to pay now/);
    expect(chargeLine({ kind: "now", price })).toMatch(/charged now/);
    expect(chargeLine({ kind: "owned", status: "paid" })).toBe("Your store has this theme.");
    expect(plain(chargeButton({ kind: "now", price }, "Apply"))).toBe("Pay NOK 3,490 and use it");
    expect(chargeButton({ kind: "at_opening", price }, "Apply")).toBe("Apply");
  });

  it("waits longer after each failed try, at most a day", () => {
    expect(nextTryDelayMs(1)).toBe(5 * 60_000);
    expect(nextTryDelayMs(2)).toBe(10 * 60_000);
    expect(nextTryDelayMs(20)).toBe(24 * 60 * 60_000);
  });
});
