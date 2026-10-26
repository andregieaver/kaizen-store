/**
 * A product's price breaks (wave 6 unit E2, D323, `docs/wave-6-catalogue.md` E.2), the parts that need no database: the editor's rules and the
 * steps the product page's table shows. What a line costs is only `commerce.line_price()`; these never price anything. No imports: the editor
 * and the storefront read it.
 */

/** A product holds at most this many breaks (`price_breaks_rules()`). */
export const PRICE_BREAKS_MAX = 10;

/** A break as the editor holds it: a variant by SKU (null: every variant), from how many, and a percentage or a price per market as typed. */
export type PriceBreakInput = { variantSku: string | null; from: number; percent: number | null; prices: Record<string, string> };

/** What is wrong with a product's breaks, in plain sentences for the editor; `skus` are the product's variants, `parse` reads a typed price. */
export function priceBreakProblems(
  breaks: readonly PriceBreakInput[],
  skus: readonly string[],
  parse: (market: string, typed: string) => number | null,
): string[] {
  const problems: string[] = [];
  if (breaks.length > PRICE_BREAKS_MAX) problems.push(`A product has at most ${PRICE_BREAKS_MAX} price breaks.`);
  const seen = new Set<string>();
  for (const step of breaks) {
    const who = step.variantSku ?? "Every variant";
    if (!Number.isInteger(step.from) || step.from < 2 || step.from > 9999) problems.push(`${who}: a price break starts at 2 to 9,999 units.`);
    if (step.variantSku !== null && !skus.includes(step.variantSku)) problems.push(`${who}: no variant of this product has that SKU.`);
    const key = `${step.variantSku ?? ""}\u0000${step.from}`;
    if (seen.has(key)) problems.push(`${who}: two price breaks start at ${step.from}.`);
    seen.add(key);
    const typed = Object.entries(step.prices).filter(([, text]) => text.trim() !== "");
    if (step.percent !== null) {
      if (!Number.isInteger(step.percent) || step.percent < 1 || step.percent > 99) problems.push(`${who}: a percentage off is 1 to 99.`);
      if (typed.length > 0) problems.push(`${who}: give a percentage or prices, not both.`);
    } else if (typed.length === 0) {
      problems.push(`${who}, from ${step.from}: give a percentage off or a price in at least one country.`);
    } else {
      for (const [market, text] of typed) {
        if (parse(market, text) === null) problems.push(`${who}, from ${step.from}: "${text}" is not a price.`);
      }
    }
  }
  return problems;
}

/** A row of the product page's table: from how many, and the price each at that quantity (`line_price()`'s, in the market's own currency). */
export type BreakStep = { from: number; amountMinor: number };

/**
 * The rows the table shows, from the prices `line_price()` gives at the variant's minimum and at each break: in order of quantity, a row only where
 * the price falls, so a break a lower price already beats is left out. Fewer than two rows is no table.
 */
export function breakSteps(prices: readonly BreakStep[]): BreakStep[] {
  const rows: BreakStep[] = [];
  for (const step of [...prices].sort((a, b) => a.from - b.from)) {
    const last = rows[rows.length - 1];
    if (!last || step.amountMinor < last.amountMinor) rows.push(step);
  }
  return rows.length >= 2 ? rows : [];
}
