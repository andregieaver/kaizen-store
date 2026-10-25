import { describe, expect, it } from "vitest";

import { goalMet, targetFromInput, targetProgress, type GoalFigures } from "./autopilot-goals";
import { parsePrice } from "./product-input";

/** The autopilot's goals (D309, `docs/ai-autopilot.md` 7.1): targets typed by the model, and progress worked out in code. */

const figures = (over: Partial<GoalFigures> = {}): GoalFigures => ({
  revenue30d: 4_250_000,
  currency: "NOK",
  orders30d: 87,
  conversion30d: 1.5,
  openedOn: "2026-09-01",
  today: "2026-10-25",
  products: 12,
  pages: 4,
  stores: null,
  missing: {},
  ...over,
});

describe("targetFromInput", () => {
  it("reads an amount in the main currency's major units into minor units", () => {
    expect(targetFromInput({ kind: "revenue_30d", amount: "50 000" }, "store", "NOK", parsePrice)).toEqual({ ok: true, target: { kind: "revenue_30d", amount_minor: 5_000_000, currency: "NOK" } });
    expect(targetFromInput({ kind: "revenue_30d", amount: "lots" }, "store", "NOK", parsePrice)).toMatchObject({ ok: false });
  });

  it("refuses a target the scope cannot measure, or one missing its number", () => {
    expect(targetFromInput({ kind: "stores", count: 10 }, "store", "NOK", parsePrice)).toMatchObject({ ok: false });
    expect(targetFromInput({ kind: "revenue_30d", amount: "1" }, "platform", null, parsePrice)).toMatchObject({ ok: false });
    expect(targetFromInput({ kind: "orders_30d" }, "store", "NOK", parsePrice)).toMatchObject({ ok: false, problem: "orders_30d needs a count." });
    expect(targetFromInput({ kind: "pages", count: 5 }, "platform", null, parsePrice)).toEqual({ ok: true, target: { kind: "pages", count: 5 } });
  });
});

describe("targetProgress", () => {
  it("compares the store's own figures with the target", () => {
    expect(targetProgress({ kind: "revenue_30d", amount_minor: 5_000_000, currency: "NOK" }, figures(), "en-GB")).toMatchObject({ met: false });
    expect(targetProgress({ kind: "orders_30d", count: 80 }, figures())).toMatchObject({ met: true, now: "87" });
    expect(targetProgress({ kind: "products", count: 12 }, figures())).toMatchObject({ met: true });
    expect(targetProgress({ kind: "open_by", date: "2026-10-01" }, figures())).toMatchObject({ met: true, now: "Open since 2026-09-01" });
    expect(targetProgress({ kind: "open_by", date: "2026-10-01" }, figures({ openedOn: null }))).toMatchObject({ met: false, now: "Not open, and the date has passed" });
  });

  it("says not measured, never zero and never met, when a figure cannot be known", () => {
    const off = targetProgress({ kind: "conversion_30d", percent: 2 }, figures({ conversion30d: null, missing: { conversion_30d: "Visit counting is off." } }));
    expect(off).toEqual({ kind: "conversion_30d", target: "2 % of visits order", now: "not measured", met: null, missing: "Visit counting is off." });
    const otherCurrency = targetProgress({ kind: "revenue_30d", amount_minor: 100, currency: "EUR" }, figures());
    expect(otherCurrency).toMatchObject({ met: null, missing: expect.stringContaining("EUR") });
  });

  it("calls a goal met only when it has targets and every one is met", () => {
    expect(goalMet([])).toBe(false);
    expect(goalMet([{ kind: "pages", target: "", now: "", met: true }, { kind: "products", target: "", now: "", met: null }])).toBe(false);
    expect(goalMet([{ kind: "pages", target: "", now: "", met: true }])).toBe(true);
  });
});
