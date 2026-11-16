/**
 * The pure parts of a lost parcel's replacement (B3, D679, `src/server/replacements.ts`): which tracking phases mean the goods will not reach the
 * customer, and the lines sent again from the parcels' rows.
 */

/** A parcel the carrier reports in trouble, or on its way back to the store: its goods are sent again. A missed delivery (`attempted`) is not. */
export const REPLACEMENT_PHASES = ["problem", "returned_to_sender"] as const;

/** One parcel's share of an order line, as read. */
export type LostRow = {
  orderLineId: string;
  variantId: string | null;
  sku: string;
  title: string;
  /** Units of the line in this parcel. */
  quantity: number;
  /** Units of the line on the order, and what the line cost the customer, with VAT. */
  lineQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  taxRate: number;
  taxCode: string;
  withdrawalExclusion: string;
  unitCostMinor: number | null;
  measure: { amount: string; unit: string; base: string } | null;
  listPriceMinor: number | null;
  policy: "continue" | "deny";
};

/** A line of the replacement: a product's units, never more than the order had, and what the customer paid for them. */
export type ReplacementLine = Omit<LostRow, "variantId" | "lineQuantity" | "lineTotalMinor"> & { variantId: string; valueMinor: number };

/**
 * The replacement's lines: each order line once, with its units over every parcel in trouble (never more than the line had), a custom line without a
 * product left out (there is no stock to send again). The value is the line's own total for those units, so a discount the customer had is kept.
 */
export function replacementLines(rows: readonly LostRow[]): ReplacementLine[] {
  const byLine = new Map<string, LostRow>();
  for (const row of rows) {
    if (!row.variantId || row.quantity <= 0) continue;
    const seen = byLine.get(row.orderLineId);
    byLine.set(row.orderLineId, seen ? { ...seen, quantity: Math.min(seen.lineQuantity, seen.quantity + row.quantity) } : { ...row, quantity: Math.min(row.lineQuantity, row.quantity) });
  }
  return [...byLine.values()].map(({ lineQuantity, lineTotalMinor, variantId, ...rest }) => ({
    ...rest,
    variantId: variantId!,
    valueMinor: lineQuantity > 0 ? Math.round((lineTotalMinor * rest.quantity) / lineQuantity) : 0,
  }));
}

/**
 * Why the autopilot keeps a replacement for the owner in the challenge (B3, D679), or null when it may send it: within the cap on one replacement's
 * value, in the store's main currency. No cap set: every replacement waits.
 */
export function replacementCapProblem(f: { valueMinor: number; currency: string; mainCurrency: string; capMinor: number | null; money: (minor: number) => string }): string | null {
  if (f.capMinor === null) return "No cap on a replacement's value is set, so every replacement waits for your yes.";
  if (f.currency !== f.mainCurrency) return `The order is in ${f.currency}, and the cap is in ${f.mainCurrency}.`;
  if (f.valueMinor > f.capMinor) return `The goods sent again are worth ${f.money(f.valueMinor)}, more than the ${f.money(f.capMinor)} a replacement may be worth.`;
  return null;
}
