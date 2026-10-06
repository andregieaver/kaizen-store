import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import type { VariantStock } from "./stock-availability";
import { canOffer, stockNote } from "./stock-words";

const stock = (over: Partial<VariantStock> = {}): VariantStock => ({
  inStock: 0,
  rawAvailable: 0,
  stockPolicy: "deny",
  backorderDays: null,
  canBuy: false,
  ...over,
});

describe("what a variant's stock note says (wave 3, D172)", () => {
  const en = t("en");

  it("is unchanged for a variant that stops selling at zero: in stock, only n left, sold out", () => {
    expect(stockNote(stock({ inStock: 12, canBuy: true }), en)).toBe(en.inStock);
    expect(stockNote(stock({ inStock: 3, canBuy: true }), en)).toBe(en.lowStock(3));
    expect(stockNote(stock(), en)).toBe(en.outOfStock);
    expect(canOffer(stock())).toBe(false);
    expect(canOffer(stock({ inStock: 1, canBuy: true }))).toBe(true);
  });

  it("says a variant that keeps selling is on backorder, with its days, only when nothing is in stock", () => {
    const keeps = stock({ stockPolicy: "continue", backorderDays: 7, canBuy: true });
    expect(stockNote(keeps, en)).toBe("On backorder: expected to ship within 7 days");
    expect(stockNote({ ...keeps, backorderDays: 1 }, en)).toBe("On backorder: expected to ship within 1 day");
    expect(canOffer(keeps)).toBe(true);
    // With stock in hand it is simply in stock, or low.
    expect(stockNote({ ...keeps, inStock: 40 }, en)).toBe(en.inStock);
    expect(stockNote({ ...keeps, inStock: 2 }, en)).toBe(en.lowStock(2));
  });

  it("never offers a backorder without its days, so a delivery time is always stated", () => {
    const noDays = stock({ stockPolicy: "continue", backorderDays: null, canBuy: true });
    expect(canOffer(noDays)).toBe(false);
    expect(stockNote(noDays, en)).toBe(en.outOfStock);
  });

  it("is sold out for a variant the read did not find", () => {
    expect(canOffer(undefined)).toBe(false);
    expect(stockNote(undefined, en)).toBe(en.outOfStock);
  });

  it("is said in Norwegian, Swedish and Danish by hand, with the days and no date", () => {
    const keeps = stock({ stockPolicy: "continue", backorderDays: 14, canBuy: true });
    expect(stockNote(keeps, t("nb"))).toBe("På restordre: forventes sendt innen 14 dager");
    expect(stockNote(keeps, t("sv"))).toBe("På restorder: förväntas skickas inom 14 dagar");
    expect(stockNote(keeps, t("da"))).toBe("På restordre: forventes afsendt inden for 14 dage");
  });
});
