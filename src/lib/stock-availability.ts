/**
 * What a shopper can buy of a variant, and how much of it is backordered (wave 3, D172, `docs/wave-3-inventory.md` 2.1, 3.5). Pure.
 *
 * `commerce.variant_availability` is the one reader of stock; its row becomes a `VariantStock` here, and everything that decides
 * "can this be added", "how many is on backorder" or "what does the structured data say" asks these functions, so the cart, the
 * product page, the order and the feeds cannot disagree.
 *
 * The one rule: nothing changes for a variant whose policy is `deny` (the default). It sells up to its stock and refuses more.
 * A `continue` variant (goods only) takes any quantity up to the line maximum; the units beyond what is in stock are backordered.
 */

import type { StockPolicy } from "./inventory";

export type { StockPolicy };

/** A row of `commerce.variant_availability`, in code's words. `inStock` is never below zero, `rawAvailable` can be negative. */
export type VariantStock = {
  inStock: number;
  rawAvailable: number;
  stockPolicy: StockPolicy;
  /** The days stated for a backorder; set exactly when the policy is `continue`. */
  backorderDays: number | null;
  /** `inStock > 0` or the policy is `continue`. */
  canBuy: boolean;
  /**
   * A pre-order's release date (`YYYY-MM-DD`, D396) while it is in the future, for a `continue` variant only: every unit is then a pre-order, said
   * with this date; null otherwise.
   */
  preorderUntil: string | null;
};

/** What the view's columns arrive as (a driver may give bigint sums as strings). */
export type AvailabilityRow = {
  in_stock: number | string | bigint;
  raw_available: number | string | bigint;
  stock_policy: string;
  backorder_days: number | string | null;
  can_buy?: boolean;
  preorder_until?: string | Date | null;
};

const whole = (v: number | string | bigint): number => Math.trunc(Number(v));

/** A view row as a `VariantStock`. The policy is read strictly: anything but `continue` is `deny`. */
export function stockOf(row: AvailabilityRow): VariantStock {
  const stockPolicy: StockPolicy = row.stock_policy === "continue" ? "continue" : "deny";
  const rawAvailable = whole(row.raw_available);
  const inStock = Math.max(whole(row.in_stock), 0);
  const days = row.backorder_days === null ? null : whole(row.backorder_days);
  return {
    inStock,
    rawAvailable,
    stockPolicy,
    backorderDays: stockPolicy === "continue" ? days : null,
    canBuy: inStock > 0 || stockPolicy === "continue",
    preorderUntil: stockPolicy === "continue" ? dateOf(row.preorder_until) : null,
  };
}

/** A date column as `YYYY-MM-DD` (a driver gives a string or a Date at midnight UTC). */
function dateOf(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** A variant with no stock row (a download, a service): always available, never on backorder. */
export const UNLIMITED: VariantStock = { inStock: Number.MAX_SAFE_INTEGER, rawAvailable: Number.MAX_SAFE_INTEGER, stockPolicy: "deny", backorderDays: null, canBuy: true, preorderUntil: null };

/**
 * `preorder` for a variant before its release date (D396), whatever is on the shelf; `in_stock` is what the page says; `backorder` only for a
 * `continue` variant with nothing in stock; `out_of_stock` otherwise.
 */
export type Availability = "in_stock" | "backorder" | "out_of_stock" | "preorder";

export function availabilityOf(stock: Pick<VariantStock, "inStock" | "stockPolicy"> & { preorderUntil?: string | null }): Availability {
  if (stock.preorderUntil) return "preorder";
  if (stock.inStock > 0) return "in_stock";
  return stock.stockPolicy === "continue" ? "backorder" : "out_of_stock";
}

/** Schema.org's availability for structured data (`Offer.availability`). */
export const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  backorder: "https://schema.org/BackOrder",
  out_of_stock: "https://schema.org/OutOfStock",
  preorder: "https://schema.org/PreOrder",
};
export const schemaAvailability = (stock: Pick<VariantStock, "inStock" | "stockPolicy"> & { preorderUntil?: string | null }): string => SCHEMA_AVAILABILITY[availabilityOf(stock)];

/**
 * The units of a quantity that are backordered: the part beyond what is in stock, only for a `continue` variant; 0 for `deny`
 * (which never sells beyond stock). A fractional or negative quantity is nothing.
 */
export function backorderOf(quantity: number, stock: Pick<VariantStock, "inStock" | "stockPolicy">): number {
  if (stock.stockPolicy !== "continue") return 0;
  const q = Math.floor(quantity);
  if (!(q > 0)) return 0;
  return Math.max(q - Math.max(stock.inStock, 0), 0);
}

/** How a request for a quantity of a variant is settled. */
export type Settled = {
  /** What may be in the cart: 0 when nothing can be bought. */
  quantity: number;
  /** The request was cut down (to the line maximum, or to the stock for a `deny` variant). */
  capped: boolean;
  /** The part of `quantity` that is in stock, and the part that is backordered (`backorder` never above `quantity`). */
  fromStock: number;
  backordered: number;
  /** Why nothing could be added (`out_of_stock`); null otherwise. */
  refused: "out_of_stock" | null;
};

/**
 * Settles a wanted quantity (the cart line's new quantity) against the stock. A `deny` variant is capped at the stock (and refused
 * at zero); a `continue` variant is capped only at the line maximum. `lineMax` is the cart's `MAX_LINE_QUANTITY`.
 */
export function settleWithBackorder(wanted: number, stock: Pick<VariantStock, "inStock" | "stockPolicy">, lineMax: number): Settled {
  const want = Math.floor(wanted);
  if (!(want > 0)) return { quantity: 0, capped: false, fromStock: 0, backordered: 0, refused: null };
  const limit = Math.max(Math.floor(lineMax), 0);
  const inStock = Math.max(stock.inStock, 0);
  const allowed = stock.stockPolicy === "continue" ? limit : Math.min(limit, inStock);
  if (allowed <= 0) return { quantity: 0, capped: false, fromStock: 0, backordered: 0, refused: "out_of_stock" };
  const quantity = Math.min(want, allowed);
  const fromStock = Math.min(quantity, inStock);
  return { quantity, capped: quantity < want, fromStock, backordered: quantity - fromStock, refused: null };
}

/**
 * A cart or order line's backorder as the shopper reads it: how many units and the days. Null for a line with none. The words
 * themselves are `m.backorder.line()` / `m.backorder.order()` (hand-written, flagged for review).
 */
export function backorderNote(
  quantity: number,
  stock: Pick<VariantStock, "inStock" | "stockPolicy" | "backorderDays"> & { preorderUntil?: string | null },
): { units: number; days: number; until?: string } | null {
  // A pre-order (D396): every unit waits for the release date, whatever is on the shelf.
  if (stock.preorderUntil && stock.stockPolicy === "continue" && stock.backorderDays !== null) {
    const q = Math.floor(quantity);
    return q > 0 ? { units: q, days: stock.backorderDays, until: stock.preorderUntil } : null;
  }
  const units = backorderOf(quantity, stock);
  if (units === 0 || stock.backorderDays === null) return null;
  return { units, days: stock.backorderDays };
}

/** Whether a cart line of this quantity is `ok` (it can be bought as it is) rather than `insufficient`: backordered units are ok. */
export function lineIsOk(quantity: number, stock: Pick<VariantStock, "inStock" | "stockPolicy">): boolean {
  return stock.stockPolicy === "continue" || quantity <= Math.max(stock.inStock, 0);
}
