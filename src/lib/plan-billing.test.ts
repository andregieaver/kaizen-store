import { describe, expect, it } from "vitest";

import { billingOf, renamedOptions, withBilling, type Billing } from "./plan-billing";
import type { ProductInput, VariantInput } from "./product-input-schema";

/**
 * A plan's Billing card (the owner's "this shouldn't be this hard", 27 November 2026): Monthly and Yearly read from a plan's variants and
 * purchase options and written back, each period keeping its variant and purchase option; and options retyped keep their variants.
 */

const WORDS = ["Billing", "Monthly", "Yearly"] as const;
const variant = (sku: string, options: Record<string, string>, nok: string): VariantInput =>
  ({ id: `id-${sku}`, sku, options, active: true, prices: { NO: nok } }) as unknown as VariantInput;
const plan = (variantSku: string | null, interval: "month" | "year", more: Partial<ProductInput["plans"][number]> = {}) => ({
  id: `plan-${variantSku}-${interval}`,
  variantSku,
  interval,
  intervalCount: 1,
  discountPercent: 0,
  trialDays: 0,
  signupFee: {},
  minCycles: 0,
  ...more,
});
const product = (more: Partial<ProductInput>): ProductInput =>
  ({ kind: "plan", handle: "pro", translations: [{ title: "Pro" }], options: [], variants: [], plans: [], subscriptionOnly: true, ...more }) as unknown as ProductInput;
const make = (options: Record<string, string>) => ({ id: null, sku: "", options, active: false, prices: {} }) as unknown as VariantInput;

const pro = product({
  options: [{ name: "Billing", values: ["Monthly", "Yearly"] }],
  variants: [variant("pro-monthly", { Billing: "Monthly" }, "299"), variant("pro-yearly", { Billing: "Yearly" }, "2990")],
  plans: [plan("pro-monthly", "month", { trialDays: 14 }), plan("pro-yearly", "year")],
});

describe("a plan's billing card", () => {
  it("reads Monthly and Yearly from the plan's variants and purchase options", () => {
    expect(billingOf(pro)).toEqual({ month: { on: true, prices: { NO: "299" } }, year: { on: true, prices: { NO: "2990" } } });
  });

  it("reads a plan of one period, its option for every variant", () => {
    const free = product({ variants: [variant("free", {}, "0")], plans: [plan(null, "month")] });
    expect(billingOf(free)).toEqual({ month: { on: true, prices: { NO: "0" } }, year: { on: false, prices: {} } });
  });

  it("leaves a plan set up otherwise to Customise", () => {
    expect(billingOf(product({ ...pro, plans: [plan("pro-monthly", "month", { discountPercent: 10 }), plan("pro-yearly", "year")] }))).toBeNull();
    expect(billingOf(product({ ...pro, plans: [plan("pro-monthly", "month", { intervalCount: 3 }), plan("pro-yearly", "year")] }))).toBeNull();
    // A purchase option whose variant is gone (a SKU retyped): shown as it is, so the owner sees what to choose.
    expect(billingOf(product({ ...pro, plans: [plan("old-sku", "month"), plan("pro-yearly", "year")] }))).toBeNull();
    expect(billingOf(product({ ...pro, kind: "goods" }))).toBeNull();
  });

  it("writes a price back to its period's variant, keeping its SKU, id and purchase option", () => {
    const billing = billingOf(pro) as Billing;
    const next = withBilling(pro, { ...billing, year: { on: true, prices: { NO: "2490" } } }, WORDS, make, "pro");
    expect(next.variants.map((v) => [v.id, v.sku, v.prices.NO])).toEqual([
      ["id-pro-monthly", "pro-monthly", "299"],
      ["id-pro-yearly", "pro-yearly", "2490"],
    ]);
    expect(next.plans.map((p) => [p.id, p.variantSku, p.interval, p.trialDays])).toEqual([
      ["plan-pro-monthly-month", "pro-monthly", "month", 14],
      ["plan-pro-yearly-year", "pro-yearly", "year", 0],
    ]);
    expect(billingOf(next)?.year.prices).toEqual({ NO: "2490" });
  });

  it("switches a period off and on: its variant is switched off and back on, its SKU and id kept", () => {
    const monthly = withBilling(pro, { month: { on: true, prices: { NO: "299" } }, year: { on: false, prices: {} } }, WORDS, make, "pro");
    expect(monthly.options).toEqual([]);
    expect(monthly.variants.map((v) => [v.sku, v.options, v.active])).toEqual([
      ["pro-monthly", {}, true],
      ["pro-yearly", { Billing: "Yearly" }, false],
    ]);
    expect(monthly.plans.map((p) => [p.variantSku, p.interval])).toEqual([["pro-monthly", "month"]]);
    // As the card reads it, and as the editor loads it after a save: the variant switched off is left aside.
    expect(billingOf(monthly)).toEqual({ month: { on: true, prices: { NO: "299" } }, year: { on: false, prices: {} } });
    const both = withBilling(monthly, { month: { on: true, prices: { NO: "299" } }, year: { on: true, prices: { NO: "2990" } } }, WORDS, make, "pro");
    expect(both.options).toEqual([{ name: "Billing", values: ["Monthly", "Yearly"] }]);
    expect(both.variants.map((v) => [v.id, v.sku, v.options, v.active, v.prices.NO])).toEqual([
      ["id-pro-monthly", "pro-monthly", { Billing: "Monthly" }, true, "299"],
      ["id-pro-yearly", "pro-yearly", { Billing: "Yearly" }, true, "2990"],
    ]);
    expect(both.plans.map((p) => [p.id, p.variantSku, p.interval])).toEqual([
      ["plan-pro-monthly-month", "pro-monthly", "month"],
      [null, "pro-yearly", "year"],
    ]);
    expect(billingOf(both)).not.toBeNull();
  });

  it("makes a period's variant, SKU and purchase option when it never had one", () => {
    const free = product({ variants: [variant("free", {}, "0")], plans: [plan(null, "month")] });
    const next = withBilling(free, { month: { on: true, prices: { NO: "0" } }, year: { on: true, prices: { NO: "990" } } }, WORDS, make, "free");
    expect(next.variants.map((v) => [v.sku, v.options, v.active])).toEqual([
      ["free", { Billing: "Monthly" }, true],
      ["free-yearly", { Billing: "Yearly" }, true],
    ]);
    expect(next.plans.map((p) => [p.variantSku, p.interval])).toEqual([
      ["free", "month"],
      ["free-yearly", "year"],
    ]);
  });

  it("keeps the plan's own option name and period names", () => {
    const plus = product({
      options: [{ name: "Interval", values: ["Månedlig", "Årlig"] }],
      variants: [variant("plus-m", { Interval: "Månedlig" }, "99"), variant("plus-y", { Interval: "Årlig" }, "990")],
      plans: [plan("plus-m", "month"), plan("plus-y", "year")],
    });
    const next = withBilling(plus, billingOf(plus) as Billing, WORDS, make, "plus");
    expect(next.options).toEqual([{ name: "Interval", values: ["Månedlig", "Årlig"] }]);
  });
});

describe("variants kept through an edit of the options", () => {
  it("follows a renamed option by place, and a retyped value while the option keeps as many values", () => {
    const before = [{ name: "Billing", values: ["Monthly", "Yearly"] }];
    expect(renamedOptions(before, [{ name: "Interval", values: ["Monthly", "Yearly"] }])({ Billing: "Yearly" })).toEqual({ Interval: "Yearly" });
    expect(renamedOptions(before, [{ name: "Billing", values: ["Monthly", "Annual"] }])({ Billing: "Yearly" })).toEqual({ Billing: "Annual" });
    // A value added: the others are matched by their text.
    expect(renamedOptions(before, [{ name: "Billing", values: ["Weekly", "Monthly", "Yearly"] }])({ Billing: "Yearly" })).toEqual({ Billing: "Yearly" });
  });
});
