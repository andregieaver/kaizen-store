/**
 * What a shopper reads about a variant's stock on a product page (wave 3, D172, `docs/wave-3-inventory.md` 2.1). Pure.
 *
 * The figures come from `commerce.variant_availability` through `getVariantStock()`; the words are `m.inStock`, `m.lowStock()`,
 * `m.outOfStock` and the backorder sentence `m.backorder.page()`, which always carries the days the store states and never
 * a date, so a variant that keeps selling past zero is never described as "in stock" and never as "sold out".
 */

import type { Messages } from "./i18n";
import { stockLevel } from "./pricing";
import { availabilityOf, type VariantStock } from "./stock-availability";

/**
 * Whether the shopper may be offered the variant: it has units in stock, or it keeps selling at zero **and states its days**
 * (the database makes that pair certain; a row that says otherwise is refused here rather than sold without a delivery time).
 */
export function canOffer(stock: VariantStock | undefined): boolean {
  if (!stock) return false;
  if (stock.inStock > 0) return true;
  return stock.stockPolicy === "continue" && stock.backorderDays !== null;
}

/** The line under a variant in the picker and the buy part. */
export function stockNote(stock: VariantStock | undefined, m: Pick<Messages, "inStock" | "lowStock" | "outOfStock" | "backorder">): string {
  if (!stock || !canOffer(stock)) return m.outOfStock;
  if (availabilityOf(stock) === "backorder") return m.backorder.page(stock.backorderDays as number);
  const level = stockLevel(stock.inStock);
  return level === "low" ? m.lowStock(stock.inStock) : m.inStock;
}
