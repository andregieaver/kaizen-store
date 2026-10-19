import { describe, expect, it } from "vitest";

import { captureAmountProblem, captureDeadline, captureEventText, captureModeFor, DEFAULT_HOLD_DAYS, type CaptureFacts } from "./capture";
import { shipCellOf } from "./order-list-row";

const goods: CaptureFacts = { subscription: false, booking: false, partial: false, host: false, digital: false, ships: true };

describe("when an order is captured (D289)", () => {
  it("captures at checkout unless the store waits, and keeps the store's choice on goods that are sent", () => {
    expect(captureModeFor("at_checkout", goods)).toEqual({ mode: null, refused: null });
    expect(captureModeFor("when_sent", goods)).toEqual({ mode: "when_sent", refused: null });
    expect(captureModeFor("by_hand", goods)).toEqual({ mode: "by_hand", refused: null });
  });

  it("always captures at once what must be paid at once, saying why", () => {
    expect(captureModeFor("by_hand", { ...goods, subscription: true }).refused).toBe("subscription");
    expect(captureModeFor("by_hand", { ...goods, booking: true }).refused).toBe("booking");
    expect(captureModeFor("by_hand", { ...goods, partial: true }).refused).toBe("partial");
    expect(captureModeFor("by_hand", { ...goods, host: true }).refused).toBe("host");
    expect(captureModeFor("by_hand", { ...goods, digital: true }).refused).toBe("digital");
    // Nothing to send would never be charged when sent; captured by hand it can wait.
    expect(captureModeFor("when_sent", { ...goods, ships: false })).toEqual({ mode: null, refused: "nothing_to_send" });
    expect(captureModeFor("by_hand", { ...goods, ships: false }).mode).toBe("by_hand");
  });

  it("takes Stripe's deadline when it gives one, else seven days", () => {
    const at = new Date("2026-10-19T12:00:00Z");
    expect(captureDeadline(at, 1_800_000_000).toISOString()).toBe(new Date(1_800_000_000_000).toISOString());
    expect(captureDeadline(at, null).getTime() - at.getTime()).toBe(DEFAULT_HOLD_DAYS * 86_400_000);
  });

  it("captures a whole minor unit above zero and at most what is held", () => {
    expect(captureAmountProblem(10_000, 10_000)).toBeNull();
    expect(captureAmountProblem(1, 10_000)).toBeNull();
    for (const bad of [0, -1, 10_001, 10.5, Number.NaN]) expect(captureAmountProblem(bad, 10_000)).toBe("amount");
  });

  it("writes the history in words", () => {
    const money = (minor: number) => `${minor / 100} NOK`;
    expect(captureEventText("order.authorized", { mode: "when_sent" }, money)).toBe("Card held: charged when the order is sent");
    expect(captureEventText("order.authorized", { mode: "by_hand" }, money)).toBe("Card held: charged when you capture it");
    expect(captureEventText("payment.captured", { amount: 8000, released: 2000, by: "acc" }, money)).toBe("Captured 80 NOK; 20 NOK of the hold released");
    expect(captureEventText("payment.captured", { amount: 10000, released: 0, by: null }, money)).toBe("Captured 100 NOK (by Kaizena Flow)");
    expect(captureEventText("order.paid", {}, money)).toBeNull();
  });
});

describe("a held card in the order list (D289)", () => {
  const row = { copied: false, physical: true, backorderUnits: 0 };
  it("is to send when the first parcel captures it, and waits for the capture otherwise", () => {
    expect(shipCellOf({ ...row, status: "authorized", captureMode: "when_sent" })).toBe("to_send");
    expect(shipCellOf({ ...row, status: "authorized", captureMode: "by_hand" })).toBe("none");
    expect(shipCellOf({ ...row, status: "paid" })).toBe("to_send");
  });
});
