/**
 * An order's VAT per rate, for the order page when there is more than one (D157, docs/wave-1a-tax.md section 2.1): the VAT
 * of each line as it was charged (`order_lines.tax_minor`) grouped by the rate the line was sold at, and what is left of
 * the order's VAT is the shipping's, at the rate it was charged at. Nothing is recomputed, so the rows add up to the
 * order's VAT to the minor unit. A reverse-charge order has no VAT to list, and a rate of nothing is left out.
 */
export type VatRateRow = { rate: number; taxMinor: number };

export function orderVatByRate(order: {
  taxMinor: number;
  vatKind: "standard" | "reverse_charge" | "ioss";
  shippingVatRate: number;
  lines: readonly { taxRate: number; taxMinor: number }[];
}): VatRateRow[] {
  if (order.vatKind === "reverse_charge" || order.taxMinor <= 0) return [];
  const byRate = new Map<number, number>();
  for (const line of order.lines) byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.taxMinor);
  const shipping = order.taxMinor - order.lines.reduce((sum, line) => sum + line.taxMinor, 0);
  if (shipping > 0) byRate.set(order.shippingVatRate, (byRate.get(order.shippingVatRate) ?? 0) + shipping);
  return [...byRate.entries()]
    .filter(([, taxMinor]) => taxMinor > 0)
    .map(([rate, taxMinor]) => ({ rate, taxMinor }))
    .sort((a, b) => b.rate - a.rate);
}

/** The rows only when the order has more than one rate: one rate is the order's single VAT row, as it always was. */
export function vatRowsWhenMixed(order: Parameters<typeof orderVatByRate>[0]): VatRateRow[] {
  const rows = orderVatByRate(order);
  return rows.length > 1 ? rows : [];
}

/** Why an order was not an IOSS sale though the store has an IOSS number: the shopper may be asked for import VAT at the border. */
export const IMPORT_NOTICE_REASONS: readonly string[] = ["ioss_over_limit", "ioss_no_rate"];
