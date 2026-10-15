import { describe, expect, it } from "vitest";

import { vatIncluded } from "./checkout";
import { priceDraft, type DraftTaxBasket, type DraftTaxOutcome } from "./draft-order";
import {
  DATABASE_BLOCKS,
  EXCHANGE_BLOCKS,
  EXCHANGE_PROBLEMS,
  EXCHANGE_TRANSITIONS,
  EXCHANGE_STATUSES,
  canMoveExchange,
  creditStillHolds,
  exchangeBlock,
  exchangeDeadline,
  exchangeOutcome,
  isExchangeFinal,
  isExchangeLapsed,
  isExchangeOpen,
  lastDayOf,
  nextExchangeStatus,
  priceExchange,
  type ExchangeFacts,
  type ExchangeLineInput,
} from "./exchange";
import { EXCHANGE_LINES_MAX, EXCHANGE_MIN_HOURS, EXCHANGE_PROPOSAL_DAYS, EXCHANGE_QUANTITY_MAX, EXCHANGES_PER_RETURN_MAX } from "./exchange-limits";
import { reliefFor } from "./vat-relief";

/** The tax decision of a cart, from the same building blocks `decideTax()` uses; a standard or a reverse-charge treatment. */
function taxWith(opts: { shippingRate?: number; kind?: "standard" | "reverse_charge" | "ioss" } = {}) {
  return (basket: DraftTaxBasket): DraftTaxOutcome => {
    const shippingRate = opts.shippingRate ?? 0.25;
    const reverseCharge = opts.kind === "reverse_charge";
    const result = reliefFor({
      lines: basket.lines.map((l) => ({ key: l.key, totalMinor: l.totalMinor, rate: l.rate })),
      shippingMinor: basket.shippingMinor,
      shippingRate,
      reverseCharge,
    });
    return { taxMinor: result.taxMinor, reliefMinor: result.reliefMinor, shippingRate, decision: { kind: opts.kind ?? "standard", reverseCharge }, result };
  };
}

const line = (key: string, unit: number, quantity = 1, over: Partial<ExchangeLineInput> = {}): ExchangeLineInput => ({
  key,
  quantity,
  listPriceMinor: unit,
  unitPriceMinor: unit,
  rate: 0.25,
  goods: true,
  ...over,
});

describe("the lifecycle table", () => {
  it("names every status, ends in the final ones and opens only the four live ones", () => {
    expect(Object.keys(EXCHANGE_TRANSITIONS).sort()).toEqual([...EXCHANGE_STATUSES].sort());
    expect(EXCHANGE_STATUSES.filter(isExchangeFinal)).toEqual(["settled", "declined_by_customer", "cancelled", "expired", "superseded"]);
    expect(EXCHANGE_STATUSES.filter(isExchangeOpen)).toEqual(["draft", "proposed", "confirmed", "processed"]);
    expect(EXCHANGE_STATUSES.filter(isExchangeLapsed)).toEqual(["declined_by_customer", "cancelled", "expired", "superseded"]);
  });

  it("moves forward only", () => {
    expect(nextExchangeStatus("draft", "proposed")).toBe("proposed");
    expect(nextExchangeStatus("proposed", "settled")).toBeNull();
    expect(canMoveExchange("processed", "settled")).toBe(true);
    expect(canMoveExchange("processed", "superseded")).toBe(false);
    expect(canMoveExchange("settled", "cancelled")).toBe(false);
    for (const from of EXCHANGE_STATUSES) expect(canMoveExchange(from, "draft")).toBe(false);
  });
});

describe("which returns can be exchanged (4.3)", () => {
  const ok: ExchangeFacts = {
    settingOn: true,
    copied: false,
    host: false,
    vatKind: "standard",
    subscription: false,
    weeklyBox: false,
    booking: false,
    allGoods: true,
    restricted: false,
    storeOpen: true,
    shopOn: true,
    returnStatus: "approved",
    refunded: false,
    editPending: false,
    proposals: 0,
    testModeMismatch: false,
    paymentsNeeded: false,
    paymentsOn: true,
  };

  it("lets a standard order's approved return of goods through", () => {
    expect(exchangeBlock(ok)).toBeNull();
    for (const status of ["approved", "in_transit", "received", "inspected"] as const) expect(exchangeBlock({ ...ok, returnStatus: status })).toBeNull();
  });

  it("says each reason, the first one first", () => {
    const cases: [Partial<ExchangeFacts>, string][] = [
      [{ copied: true }, "copied"],
      [{ host: true }, "host"],
      [{ vatKind: "ioss" }, "vat_kind"],
      [{ vatKind: "reverse_charge" }, "vat_kind"],
      [{ restricted: true }, "restricted"],
      [{ subscription: true }, "subscription"],
      [{ weeklyBox: true }, "weekly_box"],
      [{ booking: true }, "booking"],
      [{ storeOpen: false }, "store_closed"],
      [{ shopOn: false }, "shop_off"],
      [{ settingOn: false }, "off"],
      [{ returnStatus: "closed" }, "ended"],
      [{ returnStatus: "declined" }, "ended"],
      [{ returnStatus: "requested" }, "requested"],
      [{ refunded: true }, "refunded"],
      [{ allGoods: false }, "not_goods"],
      [{ editPending: true }, "edit_pending"],
      [{ proposals: EXCHANGES_PER_RETURN_MAX }, "limit"],
      [{ testModeMismatch: true }, "test_mode"],
      [{ paymentsNeeded: true, paymentsOn: false }, "payments_off"],
    ];
    for (const [over, code] of cases) expect([over, exchangeBlock({ ...ok, ...over })]).toEqual([over, code]);
    expect(exchangeBlock({ ...ok, copied: true, host: true, settingOn: false })).toBe("copied");
    expect(exchangeBlock({ ...ok, paymentsOn: false })).toBeNull();
    expect(exchangeBlock({ ...ok, proposals: EXCHANGES_PER_RETURN_MAX - 1 })).toBeNull();
  });

  it("has words for every reason, and the database's are the first group", () => {
    for (const code of EXCHANGE_BLOCKS) expect(EXCHANGE_PROBLEMS[code].length).toBeGreaterThan(10);
    expect(DATABASE_BLOCKS).toEqual(["copied", "host", "vat_kind", "restricted", "subscription", "weekly_box", "booking", "store_closed", "shop_off", "off", "ended", "requested", "refunded", "not_goods", "edit_pending"]);
  });
});

describe("the outcome (4.2 point 6)", () => {
  it("nets the replacements against the credit: refund due, even, to pay", () => {
    expect(exchangeOutcome(12000, 10000)).toEqual({ kind: "refund_due", differenceMinor: -2000, transferMinor: 10000, refundMinor: 2000, toPayMinor: 0 });
    expect(exchangeOutcome(10000, 10000)).toEqual({ kind: "even", differenceMinor: 0, transferMinor: 10000, refundMinor: 0, toPayMinor: 0 });
    expect(exchangeOutcome(10000, 14900)).toEqual({ kind: "to_pay", differenceMinor: 4900, transferMinor: 10000, refundMinor: 0, toPayMinor: 4900 });
    expect(exchangeOutcome(0, 500)).toEqual({ kind: "to_pay", differenceMinor: 500, transferMinor: 0, refundMinor: 0, toPayMinor: 500 });
  });

  it("adds up: transfer + refund = C and transfer + to pay = T, for any integers", () => {
    for (const [c, t] of [
      [1, 1],
      [99999, 1],
      [1, 99999],
      [123457, 123456],
      [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER],
    ]) {
      const o = exchangeOutcome(c, t);
      expect(o.transferMinor + o.refundMinor).toBe(c);
      expect(o.transferMinor + o.toPayMinor).toBe(t);
    }
  });

  it("refuses what is not minor units", () => {
    expect(() => exchangeOutcome(-1, 0)).toThrow(RangeError);
    expect(() => exchangeOutcome(1.5, 0)).toThrow(RangeError);
  });

  it("lets a processing through only when the customer pays no more than confirmed", () => {
    expect(creditStillHolds(2000, 2000)).toBe(true);
    expect(creditStillHolds(2000, 1500)).toBe(true);
    expect(creditStillHolds(-500, -800)).toBe(true);
    expect(creditStillHolds(2000, 2001)).toBe(false);
  });
});

describe("pricing replacements (4.2)", () => {
  it("is priceDraft()'s pricing of the same goods with no discount: what the checkout would charge", () => {
    const lines = [line("a", 12999, 2), line("b", 4950, 1, { rate: 0.15 })];
    const rate = { amountMinor: 5900, freeOverMinor: null };
    const e = priceExchange({ lines, shipping: { kind: "standard", rate }, currency: "NOK", creditMinor: 10000 }, taxWith());
    const d = priceDraft(
      { lines: lines.map((l) => ({ key: l.key, kind: "goods", unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, rate: l.rate, physical: true })), discount: null, shipping: { kind: "rate", rate }, currency: "NOK" },
      taxWith(),
    );
    expect(e.ok).toBe(true);
    expect(e.pricing).toEqual(d);
    expect(e.totalMinor).toBe(12999 * 2 + 4950 + 5900);
    expect(e.pricing.taxMinor).toBe(vatIncluded(25998, 0.25) + vatIncluded(4950, 0.15) + vatIncluded(5900, 0.25));
    expect(e.outcome).toEqual(exchangeOutcome(10000, e.totalMinor));
  });

  it("prices in the order's own currency: a euro view, cents and a free-over limit", () => {
    const e = priceExchange(
      { lines: [line("a", 4995, 1, { rate: 0.24 }), line("b", 1999, 2, { rate: 0.24 })], shipping: { kind: "standard", rate: { amountMinor: 690, freeOverMinor: 8000 } }, currency: "EUR", creditMinor: 4995 },
      taxWith({ shippingRate: 0.24 }),
    );
    expect(e.pricing.subtotalMinor).toBe(8993);
    // Free over 80,00: the goods before any discount are 89,93.
    expect(e.pricing.shippingMinor).toBe(0);
    expect(e.totalMinor).toBe(8993);
    expect(e.pricing.taxMinor).toBe(vatIncluded(4995, 0.24) + vatIncluded(3998, 0.24));
    expect(e.outcome).toEqual({ kind: "to_pay", differenceMinor: 3998, transferMinor: 4995, refundMinor: 0, toPayMinor: 3998 });
  });

  it("takes free shipping by default and a price staff set with its VAT at the standard rate", () => {
    const free = priceExchange({ lines: [line("a", 10000)], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith());
    expect(free.pricing.shippingMinor).toBe(0);
    const set = priceExchange({ lines: [line("a", 10000)], shipping: { kind: "set", amountMinor: 4900 }, currency: "NOK", creditMinor: 0 }, taxWith());
    expect(set.pricing.shippingMinor).toBe(4900);
    expect(set.pricing.taxMinor).toBe(vatIncluded(10000, 0.25) + vatIncluded(4900, 0.25));
  });

  it("lowers a price staff typed and refuses one above the list price", () => {
    const lower = priceExchange({ lines: [line("a", 8000, 1, { listPriceMinor: 10000 })], shipping: { kind: "free" }, currency: "NOK", creditMinor: 10000 }, taxWith());
    expect(lower.ok).toBe(true);
    expect(lower.outcome.kind).toBe("refund_due");
    const up = priceExchange({ lines: [line("a", 10001, 1, { listPriceMinor: 10000 })], shipping: { kind: "free" }, currency: "NOK", creditMinor: 10000 }, taxWith());
    expect(up.ok).toBe(false);
    expect(up.problems).toContainEqual({ code: "price_up", key: "a" });
  });

  it("refuses too many lines, a bad quantity, a variant not offered, a service and a zero total", () => {
    const many = Array.from({ length: EXCHANGE_LINES_MAX + 1 }, (_, i) => line(`l${i}`, 100));
    expect(priceExchange({ lines: many, shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith()).problems).toContainEqual({ code: "too_many_lines" });
    const q = priceExchange({ lines: [line("a", 100, EXCHANGE_QUANTITY_MAX + 1)], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith());
    expect(q.problems).toContainEqual({ code: "quantity", key: "a" });
    expect(priceExchange({ lines: [line("a", 100, EXCHANGE_QUANTITY_MAX)], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith()).ok).toBe(true);
    const gone = priceExchange({ lines: [line("a", 100, 1, { listPriceMinor: null })], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith());
    expect(gone.problems).toContainEqual({ code: "not_offered", key: "a" });
    const service = priceExchange({ lines: [line("a", 100, 1, { goods: false })], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith());
    expect(service.problems).toContainEqual({ code: "not_goods_replacement", key: "a" });
    const zero = priceExchange({ lines: [line("a", 0)], shipping: { kind: "free" }, currency: "NOK", creditMinor: 100 }, taxWith());
    expect(zero.problems).toContainEqual({ code: "total_zero" });
    expect(priceExchange({ lines: [], shipping: { kind: "free" }, currency: "NOK", creditMinor: 0 }, taxWith()).problems).toContainEqual({ code: "no_lines" });
  });

  it("refuses a market with no shipping rate when the standard rate is chosen, and a bad shipping price", () => {
    expect(priceExchange({ lines: [line("a", 100)], shipping: { kind: "standard", rate: null }, currency: "NOK", creditMinor: 0 }, taxWith()).problems).toContainEqual({
      code: "shipping_rate_missing",
    });
    expect(priceExchange({ lines: [line("a", 100)], shipping: { kind: "set", amountMinor: -1 }, currency: "NOK", creditMinor: 0 }, taxWith()).problems).toContainEqual({
      code: "shipping_invalid",
    });
  });

  it("refuses a VAT decision other than the destination's ordinary VAT", () => {
    const rc = priceExchange({ lines: [line("a", 10000)], shipping: { kind: "free" }, currency: "SEK", creditMinor: 0 }, taxWith({ kind: "reverse_charge" }));
    expect(rc.problems).toContainEqual({ code: "vat_changed" });
  });
});

describe("deadlines (4.5)", () => {
  const tz = "Europe/Oslo";
  const now = new Date("2026-10-15T10:00:00Z");

  it("gives a voluntary return its seven days", () => {
    const d = exchangeDeadline({ kind: "return", step: "proposal", now, refundDeadline: null, timeZone: tz });
    expect(d).toEqual({ ok: true, expiresAt: new Date(now.getTime() + EXCHANGE_PROPOSAL_DAYS * 86_400_000), capped: false });
  });

  it("caps a withdrawal's at the store day before its refund deadline", () => {
    // Refund deadline 2026-10-19 15:00 Oslo time: the link ends at local midnight starting the 19th (22:00Z on the 18th, summer time).
    const d = exchangeDeadline({ kind: "withdrawal", step: "pay", now, refundDeadline: new Date("2026-10-19T13:00:00Z"), timeZone: tz });
    expect(d).toEqual({ ok: true, expiresAt: new Date("2026-10-18T22:00:00Z"), capped: true });
    expect(lastDayOf(new Date("2026-10-18T22:00:00Z"), tz)).toBe("2026-10-18");
    // A deadline far off leaves the seven days.
    const far = exchangeDeadline({ kind: "withdrawal", step: "proposal", now, refundDeadline: new Date("2026-11-30T12:00:00Z"), timeZone: tz });
    expect(far).toEqual({ ok: true, expiresAt: new Date(now.getTime() + 7 * 86_400_000), capped: false });
  });

  it("refuses an exchange when less than a day is left to the cap", () => {
    // Cap at local midnight starting 2026-10-16 = 22:00Z on the 15th: 12 hours away.
    const near = exchangeDeadline({ kind: "withdrawal", step: "proposal", now, refundDeadline: new Date("2026-10-16T09:00:00Z"), timeZone: tz });
    expect(near).toEqual({ ok: false, code: "deadline_near", capAt: new Date("2026-10-15T22:00:00Z") });
    // Exactly the minimum is enough.
    const exact = exchangeDeadline({ kind: "withdrawal", step: "proposal", now: new Date(new Date("2026-10-16T22:00:00Z").getTime() - EXCHANGE_MIN_HOURS * 3_600_000), refundDeadline: new Date("2026-10-17T09:00:00Z"), timeZone: tz });
    expect(exact.ok).toBe(true);
  });

  it("follows the store's own days across the change from summer time", () => {
    // Oslo leaves summer time on 2026-10-25: local midnight starting the 27th is 23:00Z on the 26th.
    const d = exchangeDeadline({ kind: "withdrawal", step: "proposal", now: new Date("2026-10-22T10:00:00Z"), refundDeadline: new Date("2026-10-27T10:00:00Z"), timeZone: tz });
    expect(d).toEqual({ ok: true, expiresAt: new Date("2026-10-26T23:00:00Z"), capped: true });
  });
});
