import type { ProductInput, VariantInput } from "./product-input-schema";
import { rhythmIn } from "./subscriptions";

/**
 * A plan's billing as the product editor's Billing card shows it (D912, the owner's "this shouldn't be this hard", 27 November 2026):
 * Monthly and Yearly, each on or off with its price in every country, and nothing else to set. Underneath they are what a plan always
 * was, a variant each (the option Billing when both are on) with a purchase option renewing at its own price; the card reads that shape
 * (`billingOf()`) and writes it back (`withBilling()`), keeping each period's variant (its id and SKU) and its purchase option (its id,
 * free trial, sign-up fee and commitment). A period switched off keeps its variant, switched off as the save does with any variant taken
 * out, and switched on again it is that variant once more, so its SKU and order history stay one. A plan set up otherwise is shown as it
 * is, under Customise.
 */

export type BillingPeriod = "month" | "year";
export const BILLING_PERIODS: readonly BillingPeriod[] = ["month", "year"];
export type BillingRow = { on: boolean; prices: Record<string, string> };
export type Billing = Record<BillingPeriod, BillingRow>;

type Plan = ProductInput["plans"][number];
type Linked = Partial<Record<BillingPeriod, { variant: VariantInput; plan: Plan }>>;

/** The period a purchase option renews at, when it is one the card offers: every month or every year, at the variant's own price. */
const periodOf = (plan: Plan): BillingPeriod | null =>
  plan.intervalCount === 1 && plan.discountPercent === 0 && (plan.interval === "month" || plan.interval === "year") ? plan.interval : null;

/** Each period's variant and purchase option (variants switched off left aside), or null when the plan is not in the card's shape. */
function linked(p: ProductInput): Linked | null {
  if (p.kind !== "plan" || p.options.length > 1) return null;
  const active = p.variants.filter((v) => v.active);
  if (active.length === 0 || active.length > 2 || p.plans.length !== active.length) return null;
  const out: Linked = {};
  for (const variant of active) {
    const own = p.plans.filter((plan) => plan.variantSku !== null && plan.variantSku === variant.sku);
    // A plan of one variant may have its purchase option for every variant.
    const plans = own.length > 0 ? own : active.length === 1 ? p.plans.filter((plan) => plan.variantSku === null) : [];
    const period = plans.length === 1 ? periodOf(plans[0]) : null;
    if (!period || out[period]) return null;
    out[period] = { variant, plan: plans[0] };
  }
  return out;
}

/** The plan as the Billing card shows it, or null when it is set up some other way (more periods, a discount, another option). */
export function billingOf(p: ProductInput): Billing | null {
  const found = linked(p);
  if (!found) return null;
  const row = (period: BillingPeriod): BillingRow => ({ on: Boolean(found[period]), prices: { ...(found[period]?.variant.prices ?? {}) } });
  return { month: row("month"), year: row("year") };
}

/**
 * The plan with the card's billing: a variant for each period on (the option Billing, or the plan's own option name, when both are),
 * each kept from before where it was, else made by `make` with the SKU `{base}-monthly` or `{base}-yearly`; and a purchase option for
 * each, renewing at its variant's price. `words` is the option's name and the two periods' names in the owner's language.
 */
export function withBilling(
  p: ProductInput,
  billing: Billing,
  words: readonly [option: string, monthly: string, yearly: string],
  make: (options: Record<string, string>) => VariantInput,
  base: string,
): ProductInput {
  const on = BILLING_PERIODS.filter((period) => billing[period].on);
  const found = linked(p) ?? {};
  if (on.length === 0) return p;
  const optionName = p.options[0]?.name.trim() || words[0];
  const nameOf = (period: BillingPeriod) =>
    found[period]?.variant.options[optionName] ?? (period === "month" ? words[1] : words[2]);
  const taken = new Set(p.variants.map((v) => v.sku));
  const skuOf = (period: BillingPeriod) => {
    const wanted = `${base}-${period === "month" ? "monthly" : "yearly"}`.slice(0, 64);
    return taken.has(wanted) ? `${wanted.slice(0, 59)}-${Math.random().toString(36).slice(2, 6)}` : wanted;
  };
  // A period's variant switched off before (by this card, or a save since): its name or SKU says the period.
  // The latest first: the one this card just switched off, before older ones.
  const off = p.variants.filter((v) => !v.active).reverse();
  const sleeping = (period: BillingPeriod) =>
    off.find((v) => Object.values(v.options).some((value) => rhythmIn(value) === period) || v.sku.endsWith(period === "month" ? "-monthly" : "-yearly"));
  const reused = new Set<VariantInput>();
  const variants = on.map((period) => {
    const options = on.length > 1 ? { [optionName]: nameOf(period) } : ({} as Record<string, string>);
    const kept = found[period]?.variant ?? sleeping(period);
    if (kept) reused.add(kept);
    const variant = kept ? { ...kept, options, active: true } : { ...make(options), sku: skuOf(period), active: true };
    return { ...variant, prices: { ...billing[period].prices } };
  });
  // The periods switched off keep their variants, off (the save switches off a variant left out anyway), with no purchase option.
  const rest = p.variants.filter((v) => !reused.has(v)).map((v) => ({ ...v, active: false }));
  const plans = on.map((period, i) => {
    const kept = found[period]?.plan;
    return kept
      ? { ...kept, variantSku: variants[i].sku }
      : { id: null, variantSku: variants[i].sku, interval: period, intervalCount: 1, discountPercent: 0, trialDays: 0, signupFee: {}, minCycles: 0 };
  });
  return {
    ...p,
    options: on.length > 1 ? [{ name: optionName, values: on.map(nameOf) }] : [],
    variants: [...variants, ...rest],
    plans,
    subscriptionOnly: true,
  };
}

/**
 * Variants kept through an edit of the options (the owner's report, 27 November 2026: a rename lost every variant's SKU): a previous
 * variant's options as the new options name them. An option's name follows it by place; a value follows by place while the option keeps
 * as many values (one being retyped), and by its text when values are added or taken away.
 */
export function renamedOptions(
  previous: readonly { name: string; values: readonly string[] }[],
  next: readonly { name: string; values: readonly string[] }[],
): (options: Record<string, string>) => Record<string, string> {
  const maps = previous.map((before, i) => {
    const after = next[i];
    const values = new Map<string, string>();
    if (after && after.values.length === before.values.length) before.values.forEach((value, j) => values.set(value.trim(), after.values[j].trim()));
    return { from: before.name.trim(), to: (after?.name ?? before.name).trim(), values };
  });
  return (options) => {
    const out: Record<string, string> = { ...options };
    for (const { from, to, values } of maps) {
      if (!(from in options)) continue;
      const value = options[from];
      delete out[from];
      out[to] = values.get(value) ?? value;
    }
    return out;
  };
}
