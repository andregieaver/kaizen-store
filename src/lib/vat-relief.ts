/**
 * The arithmetic of the VAT an order carries and the VAT a reverse-charge order does not charge (D157,
 * docs/wave-1a-tax.md section 4.2), in one place that the cart summary and `placeOrder()` both use, so they agree.
 *
 * Everything is on the shown amounts of the order's currency, in integer minor units, with the rounding that has
 * always been used: `vatIncluded(total, rate)` (`src/lib/checkout.ts`). A line's total is VAT-inclusive and after every
 * discount and credit. Reverse charge does not split a net amount: the relief of a line is exactly the tax it would have
 * had, so a reverse-charge total is the ordinary total minus the ordinary tax, to the minor unit.
 *
 * The VAT not charged is part of the order's discount (like bonus credits, D130), so the database's checks
 * (`total = subtotal + shipping - discount`, `line total = unit * quantity - discount`) keep holding.
 */
import { vatIncluded } from "./checkout";

export type ReliefLineInput = {
  /** Anything that tells the line apart in the result (an index, an id). */
  key: string;
  /** The line's total with VAT, after campaigns, group discount, welcome discount, code and credits. */
  totalMinor: number;
  /** The rate the line is charged at (a fraction); with reverse charge, the rate that would have applied. */
  rate: number;
};

export type ReliefInput = {
  lines: readonly ReliefLineInput[];
  /** Shipping with VAT, after the shipping discount; 0 when free. */
  shippingMinor: number;
  /** The rate of the shipping (`shippingRate()`). */
  shippingRate: number;
  reverseCharge: boolean;
};

export type ReliefLine = {
  key: string;
  rate: number;
  /** The line's total as charged: unchanged, or without its VAT when reverse charge. */
  totalMinor: number;
  /** The VAT in the line as charged: its VAT, or 0 when reverse charge. */
  taxMinor: number;
  /** The VAT not charged on the line (reverse charge), added to the line's discount. */
  reliefMinor: number;
};

export type ReliefResult = {
  lines: ReliefLine[];
  shipping: { rate: number; totalMinor: number; taxMinor: number; reliefMinor: number };
  /** The VAT the order carries (0 when reverse charge). */
  taxMinor: number;
  /** The VAT not charged: the lines' relief and the shipping's, the part of `orders.discount_minor` that is VAT relief. */
  reliefMinor: number;
};

/** The VAT of every line and of the shipping, and, with reverse charge, the relief that takes the VAT off. */
export function reliefFor(input: ReliefInput): ReliefResult {
  const lines = input.lines.map((line): ReliefLine => {
    const tax = vatIncluded(line.totalMinor, line.rate);
    return input.reverseCharge
      ? { key: line.key, rate: line.rate, totalMinor: line.totalMinor - tax, taxMinor: 0, reliefMinor: tax }
      : { key: line.key, rate: line.rate, totalMinor: line.totalMinor, taxMinor: tax, reliefMinor: 0 };
  });
  const shippingTax = vatIncluded(input.shippingMinor, input.shippingRate);
  const shipping = input.reverseCharge
    ? { rate: input.shippingRate, totalMinor: input.shippingMinor - shippingTax, taxMinor: 0, reliefMinor: shippingTax }
    : { rate: input.shippingRate, totalMinor: input.shippingMinor, taxMinor: shippingTax, reliefMinor: 0 };
  return {
    lines,
    shipping,
    taxMinor: lines.reduce((sum, line) => sum + line.taxMinor, 0) + shipping.taxMinor,
    reliefMinor: lines.reduce((sum, line) => sum + line.reliefMinor, 0) + shipping.reliefMinor,
  };
}

/** Whether the order carries any VAT at all (what `vatTreatment()` calls `taxedAmountPositive`): from the ordinary result. */
export const carriesVat = (ordinary: Pick<ReliefResult, "taxMinor">): boolean => ordinary.taxMinor > 0;

export type RateTotal = { rate: number; taxMinor: number };

/**
 * The VAT of an order per rate, for the order page when there is more than one: every line and the shipping, with
 * reverse charge by the tax each would have had (so the relief per rate can be read). Rates with nothing are left out.
 */
export function vatPerRate(result: ReliefResult, reverseCharge: boolean): RateTotal[] {
  const totals = new Map<number, number>();
  const add = (rate: number, minor: number) => totals.set(rate, (totals.get(rate) ?? 0) + minor);
  for (const line of result.lines) add(line.rate, reverseCharge ? line.reliefMinor : line.taxMinor);
  add(result.shipping.rate, reverseCharge ? result.shipping.reliefMinor : result.shipping.taxMinor);
  return [...totals]
    .filter(([, minor]) => minor !== 0)
    .map(([rate, taxMinor]) => ({ rate, taxMinor }))
    .sort((a, b) => b.rate - a.rate);
}
