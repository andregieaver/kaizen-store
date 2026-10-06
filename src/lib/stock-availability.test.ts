import { describe, expect, it } from "vitest";

import {
  SCHEMA_AVAILABILITY,
  UNLIMITED,
  availabilityOf,
  backorderNote,
  backorderOf,
  lineIsOk,
  schemaAvailability,
  settleWithBackorder,
  stockOf,
} from "./stock-availability";

const deny = (inStock: number) => ({ inStock, stockPolicy: "deny" as const });
const keep = (inStock: number, backorderDays: number | null = 7) => ({ inStock, stockPolicy: "continue" as const, backorderDays });

describe("a row of the availability view", () => {
  it("reads the figures as whole numbers and the policy strictly", () => {
    expect(stockOf({ in_stock: "12", raw_available: "12", stock_policy: "deny", backorder_days: null, can_buy: true })).toEqual({
      inStock: 12,
      rawAvailable: 12,
      stockPolicy: "deny",
      backorderDays: null,
      canBuy: true,
    });
    expect(stockOf({ in_stock: BigInt(0), raw_available: -3, stock_policy: "continue", backorder_days: "7" })).toEqual({
      inStock: 0,
      rawAvailable: -3,
      stockPolicy: "continue",
      backorderDays: 7,
      canBuy: true,
    });
    // Anything but `continue` is `deny`, and a deny variant carries no days.
    expect(stockOf({ in_stock: 0, raw_available: 0, stock_policy: "whatever", backorder_days: 5 })).toMatchObject({ stockPolicy: "deny", backorderDays: null, canBuy: false });
    // In stock is never below zero.
    expect(stockOf({ in_stock: -4, raw_available: -4, stock_policy: "deny", backorder_days: null }).inStock).toBe(0);
  });

  it("has an unlimited stock for a download, which is never on backorder", () => {
    expect(availabilityOf(UNLIMITED)).toBe("in_stock");
    expect(backorderOf(20, UNLIMITED)).toBe(0);
    expect(lineIsOk(20, UNLIMITED)).toBe(true);
  });
});

describe("availability", () => {
  it("is in stock above zero, on backorder only for a variant that keeps selling, and out of stock otherwise", () => {
    expect(availabilityOf(deny(3))).toBe("in_stock");
    expect(availabilityOf(keep(3))).toBe("in_stock");
    expect(availabilityOf(deny(0))).toBe("out_of_stock");
    expect(availabilityOf(keep(0))).toBe("backorder");
  });

  it("has the schema.org words for structured data", () => {
    expect(schemaAvailability(deny(1))).toBe("https://schema.org/InStock");
    expect(schemaAvailability(keep(0))).toBe("https://schema.org/BackOrder");
    expect(schemaAvailability(deny(0))).toBe("https://schema.org/OutOfStock");
    expect(Object.values(SCHEMA_AVAILABILITY)).toHaveLength(3);
  });
});

describe("the units on backorder", () => {
  it("is the part beyond the stock, only for a variant that keeps selling", () => {
    expect(backorderOf(5, keep(3))).toBe(2);
    expect(backorderOf(3, keep(3))).toBe(0);
    expect(backorderOf(2, keep(3))).toBe(0);
    expect(backorderOf(4, keep(0))).toBe(4);
    expect(backorderOf(5, deny(3))).toBe(0);
    expect(backorderOf(0, keep(0))).toBe(0);
    expect(backorderOf(-2, keep(0))).toBe(0);
    expect(backorderOf(2.9, keep(0))).toBe(2);
    expect(backorderOf(3, { inStock: -5, stockPolicy: "continue" })).toBe(3);
  });

  it("has a note for the shopper only when there are units and days to say", () => {
    expect(backorderNote(5, keep(3, 7))).toEqual({ units: 2, days: 7 });
    expect(backorderNote(3, keep(3, 7))).toBeNull();
    expect(backorderNote(5, deny(3) as never)).toBeNull();
    expect(backorderNote(5, keep(3, null))).toBeNull();
  });

  it("is ok for a line of a variant that keeps selling whatever the quantity, and for another only up to its stock", () => {
    expect(lineIsOk(9, keep(0))).toBe(true);
    expect(lineIsOk(3, deny(3))).toBe(true);
    expect(lineIsOk(4, deny(3))).toBe(false);
    expect(lineIsOk(1, deny(0))).toBe(false);
  });
});

describe("settling a wanted quantity against the stock", () => {
  it("caps a variant that stops selling at the stock, and refuses it at zero", () => {
    expect(settleWithBackorder(2, deny(5), 20)).toEqual({ quantity: 2, capped: false, fromStock: 2, backordered: 0, refused: null });
    expect(settleWithBackorder(8, deny(5), 20)).toEqual({ quantity: 5, capped: true, fromStock: 5, backordered: 0, refused: null });
    expect(settleWithBackorder(8, deny(30), 20)).toEqual({ quantity: 8, capped: false, fromStock: 8, backordered: 0, refused: null });
    expect(settleWithBackorder(25, deny(30), 20)).toEqual({ quantity: 20, capped: true, fromStock: 20, backordered: 0, refused: null });
    expect(settleWithBackorder(1, deny(0), 20)).toEqual({ quantity: 0, capped: false, fromStock: 0, backordered: 0, refused: "out_of_stock" });
  });

  it("takes any quantity up to the line maximum for a variant that keeps selling, and says how much is backordered", () => {
    expect(settleWithBackorder(5, keep(3), 20)).toEqual({ quantity: 5, capped: false, fromStock: 3, backordered: 2, refused: null });
    expect(settleWithBackorder(3, keep(3), 20)).toEqual({ quantity: 3, capped: false, fromStock: 3, backordered: 0, refused: null });
    expect(settleWithBackorder(20, keep(0), 20)).toEqual({ quantity: 20, capped: false, fromStock: 0, backordered: 20, refused: null });
    expect(settleWithBackorder(21, keep(0), 20)).toEqual({ quantity: 20, capped: true, fromStock: 0, backordered: 20, refused: null });
    expect(settleWithBackorder(99, keep(1000), 20)).toEqual({ quantity: 20, capped: true, fromStock: 20, backordered: 0, refused: null });
  });

  it("settles nothing wanted as nothing, and never returns more than was asked or the limit", () => {
    expect(settleWithBackorder(0, deny(5), 20)).toMatchObject({ quantity: 0, refused: null });
    expect(settleWithBackorder(-3, keep(5), 20)).toMatchObject({ quantity: 0, refused: null });
    let seed = 7;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % (max + 1);
    };
    for (let i = 0; i < 500; i++) {
      const stock = next(1) === 0 ? deny(next(40)) : keep(next(40));
      const wanted = next(60);
      const limit = 1 + next(30);
      const out = settleWithBackorder(wanted, stock, limit);
      expect(out.quantity).toBeLessThanOrEqual(Math.min(wanted, limit));
      expect(out.fromStock + out.backordered).toBe(out.quantity);
      expect(out.fromStock).toBeLessThanOrEqual(stock.inStock);
      if (stock.stockPolicy === "deny") expect(out.backordered).toBe(0);
      expect(out.backordered).toBe(backorderOf(out.quantity, stock));
    }
  });
});
