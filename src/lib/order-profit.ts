import type { AnalyticsSettings } from "./analytics-kpi";
import { conversionFactor, type Rates } from "./currency";

/**
 * Profit per order (D415): what one paid order left the store, by the Finance page's own definitions (docs/analytics.md) for one order, in
 * the order's own currency: revenue without VAT, less refunds without VAT, the cost of the goods as it was frozen at the sale, the payment
 * fee (Stripe's own where every Stripe payment of the order has it, else the store's estimate), Kaizena Flow's fee, the parcels' cost (each
 * booked label's own price where it was given, else the store's estimate per parcel) and a lost dispute. Before ads and fixed costs, which
 * belong to no one order. Pure: the reads are in `src/server/order-profit.ts`.
 *
 * An order whose goods have a line without a cost has no profit figure (as the Finance page has no cost of goods below 30 % of sales known):
 * it names how many lines lack one, so the owner knows what to fill in. Every other cost is known or estimated, and says which.
 */

export type OrderProfitInput = {
  currency: string;
  totalMinor: number;
  taxMinor: number;
  /** Gift card lines' total (no VAT): selling a gift card is no sale, so it is not revenue here, as on the Finance page. */
  voucherMinor: number;
  /** Succeeded refunds with VAT, the settlements of an order change left out (`NOT_EDIT_REFUND`). */
  refundsMinor: number;
  /** The order's goods and custom lines (gift cards left out): a line with a variant or a custom one needs a cost. */
  lines: readonly { quantity: number; unitCostMinor: number | null; needsCost: boolean }[];
  /** Captured payments. */
  payments: readonly { provider: string; amountMinor: number; kaizenFeeMinor: number; providerFeeMinor: number | null; feeCurrency: string | null }[];
  /** Whether a line is sent (a physical line): only then does sending cost anything. */
  physical: boolean;
  /** The order's parcels (not handovers, not undone): each one's label cost without VAT in the order's currency, or null when not known. */
  parcels: readonly (number | null)[];
  /** Disputes lost on the order: the amount with VAT, and the dispute fee in its currency when known. */
  lostDisputes: readonly { amountMinor: number; feeMinor: number | null; feeCurrency: string | null }[];
};

export type OrderProfitLineKey = "revenue" | "refunds" | "cogs" | "paymentFee" | "platformFee" | "shipping" | "disputes";

export type OrderProfitLine = {
  key: OrderProfitLineKey;
  /** Signed: income positive, costs negative; null when it cannot be known. */
  amountMinor: number | null;
  /** Worked out from the store's own estimates rather than recorded. */
  estimated: boolean;
};

export type OrderProfit = {
  currency: string;
  lines: OrderProfitLine[];
  /** Revenue less refunds, without VAT. */
  netMinor: number;
  /** Null while a line has no cost (`linesWithoutCost`) or an estimate's currency has no rate. */
  profitMinor: number | null;
  /** Profit as a share of net revenue; null when either is not known or net is not above 0. */
  margin: number | null;
  /** Some cost is an estimate (the payment fee or a parcel). */
  estimated: boolean;
  /** Goods lines with no cost price: profit waits on them. */
  linesWithoutCost: number;
  /** An estimate's amount in the main currency could not be converted into the order's (no rate): profit is not known. */
  noRate: boolean;
};

/** An amount without VAT, as a refund or a dispute is scaled on the Finance page: by the order's `(total − tax) / total`. */
const withoutVat = (amountMinor: number, totalMinor: number, taxMinor: number): number =>
  totalMinor > 0 ? Math.round((amountMinor * (totalMinor - taxMinor)) / totalMinor) : amountMinor;

export function orderProfit(input: OrderProfitInput, settings: Pick<AnalyticsSettings, "paymentFeeBps" | "paymentFeeFixedMinor" | "shippingCostMinor">, main: { currency: string; rates: Rates }): OrderProfit {
  const currency = input.currency.trim();
  // A cost converted at the store's rates, unrounded to the currency's price step (that is for prices shoppers see).
  const convert = (minor: number, from: string): number | null => {
    if (from === currency) return minor;
    const c = conversionFactor(from, currency, main.rates);
    return c ? Math.round(minor * c.factor) : null;
  };
  // The store's own estimates are written in its main currency.
  const fromMain = (minor: number): number | null => (minor === 0 ? 0 : convert(minor, main.currency));
  const toOrder = (minor: number, from: string | null): number | null => (from === null ? null : convert(minor, from.trim()));
  let noRate = false;

  const revenue = input.totalMinor - input.taxMinor - input.voucherMinor;
  // A refund is shared by the order's revenue, gift cards left out (they are no sale), as the Finance page shares it.
  const refunds = input.totalMinor > 0 ? Math.round((input.refundsMinor * Math.max(0, revenue)) / input.totalMinor) : input.refundsMinor;

  const linesWithoutCost = input.lines.filter((l) => l.needsCost && l.unitCostMinor === null).length;
  const cogs = linesWithoutCost > 0 ? null : input.lines.reduce((sum, l) => sum + (l.unitCostMinor ?? 0) * l.quantity, 0);

  // Stripe's own fee when every captured Stripe payment has one in a currency the store converts (D290); else the estimate on the total less
  // what gift cards paid (they take no card fee), as the Finance page does.
  const stripe = input.payments.filter((p) => p.provider === "stripe");
  const realFees = stripe.map((p) => (p.providerFeeMinor === null ? null : toOrder(p.providerFeeMinor, p.feeCurrency)));
  const feeReal = stripe.length > 0 && realFees.every((f) => f !== null);
  let paymentFee: number | null;
  if (feeReal) paymentFee = realFees.reduce<number>((s, f) => s + (f ?? 0), 0);
  else {
    const charged = input.totalMinor - input.payments.filter((p) => p.provider === "gift_card").reduce((s, p) => s + p.amountMinor, 0);
    const fixed = fromMain(settings.paymentFeeFixedMinor);
    if (fixed === null) noRate = true;
    paymentFee = charged > 0 && fixed !== null ? Math.round((charged * settings.paymentFeeBps) / 10_000) + fixed : charged > 0 ? null : 0;
  }
  const platformFee = input.payments.reduce((s, p) => s + p.kaizenFeeMinor, 0);

  // Each parcel at its own label's cost; a parcel without one, or an order to send with no parcel yet, at the store's estimate per parcel.
  let shipping: number | null = 0;
  let shippingEstimated = false;
  if (input.physical) {
    const estimate = fromMain(settings.shippingCostMinor);
    const parcels = input.parcels.length > 0 ? input.parcels : [null];
    for (const cost of parcels) {
      if (cost !== null) shipping = shipping === null ? null : shipping + cost;
      else {
        shippingEstimated = true;
        if (estimate === null) {
          noRate = true;
          shipping = null;
        } else if (shipping !== null) shipping += estimate;
      }
    }
  }

  let disputes = 0;
  for (const d of input.lostDisputes) {
    disputes += withoutVat(d.amountMinor, input.totalMinor, input.taxMinor);
    // A dispute fee in a currency the store cannot convert is left out, as the Finance page leaves it out.
    const fee = d.feeMinor === null ? null : toOrder(d.feeMinor, d.feeCurrency);
    if (fee !== null) disputes += fee;
  }

  const lines: OrderProfitLine[] = [
    { key: "revenue", amountMinor: revenue, estimated: false },
    { key: "refunds", amountMinor: refunds === 0 ? 0 : -refunds, estimated: false },
    { key: "cogs", amountMinor: cogs === null ? null : cogs === 0 ? 0 : -cogs, estimated: false },
    { key: "paymentFee", amountMinor: paymentFee === null ? null : paymentFee === 0 ? 0 : -paymentFee, estimated: !feeReal && paymentFee !== 0 },
    { key: "platformFee", amountMinor: platformFee === 0 ? 0 : -platformFee, estimated: false },
    { key: "shipping", amountMinor: shipping === null ? null : shipping === 0 ? 0 : -shipping, estimated: shippingEstimated },
  ];
  if (disputes !== 0) lines.push({ key: "disputes", amountMinor: -disputes, estimated: false });

  const net = revenue - refunds;
  const known = lines.every((l) => l.amountMinor !== null);
  const profit = known ? lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0) : null;
  return {
    currency,
    lines,
    netMinor: net,
    profitMinor: profit,
    margin: profit !== null && net > 0 ? profit / net : null,
    estimated: lines.some((l) => l.estimated),
    linesWithoutCost,
    noRate,
  };
}

/** Of a period's orders, the ones that cost more than they brought, worst first; and how many had no figure. */
export function lossMakers<T extends { profit: OrderProfit }>(rows: readonly T[]): { losses: T[]; unknown: number } {
  return {
    losses: rows.filter((r) => r.profit.profitMinor !== null && r.profit.profitMinor < 0).sort((a, b) => (a.profit.profitMinor ?? 0) - (b.profit.profitMinor ?? 0)),
    unknown: rows.filter((r) => r.profit.profitMinor === null).length,
  };
}
