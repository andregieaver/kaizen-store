import { describe, expect, it } from "vitest";

import { creditOf, creditOrders, type CreditPair } from "./order-credit";

const pair = (key: string, sentAt: string, orderId: string, placedAt: string, totalMinor = 10_000, currency = "NOK"): CreditPair => ({
  key,
  sentAt,
  orderId,
  placedAt,
  currency,
  totalMinor,
});

describe("orders after a message (email plan M1.4, D761)", () => {
  it("follows a message only after it and within seven days", () => {
    const counted = (sentAt: string, placedAt: string) => creditOf(creditOrders([pair("k", sentAt, "o", placedAt)]), "k").orders === 1;
    expect(counted("2026-11-01T10:00:00Z", "2026-11-01T10:00:01Z")).toBe(true);
    expect(counted("2026-11-01T10:00:00Z", "2026-11-08T10:00:00Z")).toBe(true);
    expect(counted("2026-11-01T10:00:00Z", "2026-11-08T10:00:01Z")).toBe(false);
    expect(counted("2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z")).toBe(false);
    expect(counted("2026-11-01T10:00:00Z", "2026-10-31T10:00:00Z")).toBe(false);
    expect(counted("not a date", "2026-11-01T10:00:00Z")).toBe(false);
  });

  it("credits an order once, to the latest message before it, whatever sent it", () => {
    const credit = creditOrders([
      pair("broadcast:a", "2026-11-01T10:00:00Z", "o1", "2026-11-04T10:00:00Z"),
      pair("automation:cart", "2026-11-03T10:00:00Z", "o1", "2026-11-04T10:00:00Z"),
      pair("text:t", "2026-11-05T10:00:00Z", "o1", "2026-11-04T10:00:00Z"),
    ]);
    expect([...credit.keys()]).toEqual(["automation:cart"]);
    expect(creditOf(credit, "automation:cart")).toEqual({ orders: 1, minor: { NOK: 10_000 } });
    expect(creditOf(credit, "broadcast:a")).toEqual({ orders: 0, minor: {} });
  });

  it("sums orders and totals per currency, and leaves out pairs outside the window", () => {
    const credit = creditOrders([
      pair("broadcast:a", "2026-11-01T10:00:00Z", "o1", "2026-11-02T10:00:00Z", 10_000, "NOK"),
      pair("broadcast:a", "2026-11-01T10:00:00Z", "o2", "2026-11-03T10:00:00Z", 2_500, "EUR"),
      pair("broadcast:a", "2026-11-01T10:00:00Z", "o3", "2026-11-03T12:00:00Z", 5_000, "NOK"),
      pair("broadcast:a", "2026-11-01T10:00:00Z", "o4", "2026-11-20T10:00:00Z", 99_999, "NOK"),
    ]);
    expect(creditOf(credit, "broadcast:a")).toEqual({ orders: 3, minor: { NOK: 15_000, EUR: 2_500 } });
  });

  it("gives a tie to the same message whatever the rows' order", () => {
    const rows = [pair("b", "2026-11-01T10:00:00Z", "o1", "2026-11-02T10:00:00Z"), pair("a", "2026-11-01T10:00:00Z", "o1", "2026-11-02T10:00:00Z")];
    expect([...creditOrders(rows).keys()]).toEqual(["a"]);
    expect([...creditOrders([...rows].reverse()).keys()]).toEqual(["a"]);
  });
});
