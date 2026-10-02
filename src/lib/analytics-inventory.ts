import { safeRatio } from "./analytics-core";

/**
 * Stock figures for the inventory page (D152, docs/analytics.md): how fast
 * things sell, how long stock lasts, what is stuck, and what is about to run
 * out. Goods only: a variant with no stock tracking has no figures of this
 * kind. Amounts are minor units of the main currency.
 */

/** Weights of the 7-day and 30-day velocity in the blend that days of stock divides by. */
export const VELOCITY_WEIGHT_7D = 0.6;
export const VELOCITY_WEIGHT_30D = 0.4;

/** Stock that lasts this many days or fewer at the current pace is low. */
export const LOW_STOCK_DAYS = 14;
/** Stock that runs out within this many days is an alert. */
export const STOCKOUT_ALERT_DAYS = 7;
/** On hand and not sold for this many days is dead stock. */
export const DEAD_STOCK_DAYS = 90;
/** Fewer units than this sold in 30 days is too little to say how long stock lasts. */
export const MIN_SOLD_30D = 3;

/** A stocked variant, as SQL reads it. */
export type InventoryRow = {
  variantId: string;
  productId: string;
  /** Product name with the variant's option, for display. */
  name: string;
  sku: string | null;
  /** Whether the store counts this variant's stock; false is sold without a limit and has no figures. */
  tracked: boolean;
  /** Units on hand, which can be negative where overselling was allowed. */
  onHand: number;
  /** Units sold (paid orders, not refunded) in the last 7 and the last 30 days, counted back from today. */
  sold7: number;
  sold30: number;
  /** Units sold in the period shown, for sell-through. */
  soldPeriod: number;
  /** Days since the last paid sale; null when it has never sold. */
  lastSoldDaysAgo: number | null;
  /** Days since the variant was added: something never sold is only dead once it has been on offer this long. */
  ageDays: number;
  /** What one unit costs; null when not entered. */
  costMinor: number | null;
  /** The store's own warning level for this variant, if it set one. */
  lowStockThreshold: number | null;
};

export type StockStatus = "out" | "low" | "ok" | "dead" | "untracked";

export type Velocity = {
  /** Units per day over the last 7 days. */
  v7: number;
  /** Units per day over the last 30 days. */
  v30: number;
  /** 0.6 × v7 + 0.4 × v30. */
  blended: number;
};

/** Units sold per day over 7 and over 30 days, and the blend days of stock is worked out with. */
export function velocity(sold7: number, sold30: number): Velocity {
  const v7 = Math.max(0, sold7) / 7;
  const v30 = Math.max(0, sold30) / 30;
  return { v7, v30, blended: VELOCITY_WEIGHT_7D * v7 + VELOCITY_WEIGHT_30D * v30 };
}

/**
 * How many days the stock on hand lasts: on hand / (0.6 × 7-day + 0.4 × 30-day
 * velocity), both in units per day. Null when nothing sold (it would last
 * forever, which is not a figure); 0 when nothing is left but things do sell.
 */
export function daysOfStock(onHand: number, v7: number, v30: number): number | null {
  const blended = VELOCITY_WEIGHT_7D * Math.max(0, v7) + VELOCITY_WEIGHT_30D * Math.max(0, v30);
  if (blended <= 0) return null;
  return Math.max(0, onHand) / blended;
}

/** Units sold as a share of everything that was available: sold / (sold + on hand at the end). Null when there was neither. */
export function sellThrough(unitsSold: number, onHandAtEnd: number): number | null {
  const sold = Math.max(0, unitsSold);
  return safeRatio(sold, sold + Math.max(0, onHandAtEnd));
}

/** How many times the stock was sold through in a year: COGS of 365 days / current stock at cost. Null without stock value. */
export function turnover(cogs365Minor: number, stockValueMinor: number): number | null {
  return safeRatio(cogs365Minor, stockValueMinor > 0 ? stockValueMinor : null);
}

export type InventoryValue = {
  /** Σ on hand × cost over tracked variants with a known cost and stock. */
  valueMinor: number;
  /** Units on hand across tracked variants. */
  units: number;
  /** Units whose cost is unknown and so are not in the value. */
  unitsWithoutCost: number;
  /** Share of the units that are valued; null without stock. */
  coverage: number | null;
};

/** What the stock is worth at cost; stock with no cost entered is counted apart, never valued at 0 silently. */
export function inventoryValue(rows: readonly InventoryRow[]): InventoryValue {
  let valueMinor = 0;
  let units = 0;
  let unitsWithoutCost = 0;
  for (const r of rows) {
    if (!r.tracked || r.onHand <= 0) continue;
    units += r.onHand;
    if (r.costMinor === null) unitsWithoutCost += r.onHand;
    else valueMinor += r.onHand * r.costMinor;
  }
  return { valueMinor, units, unitsWithoutCost, coverage: safeRatio(units - unitsWithoutCost, units) };
}

/** Whether stock sat unsold long enough to be dead: on hand, and no sale for 90 days (or never, and on offer that long). */
function isDead(r: InventoryRow): boolean {
  if (r.onHand <= 0) return false;
  return r.lastSoldDaysAgo === null ? r.ageDays >= DEAD_STOCK_DAYS : r.lastSoldDaysAgo >= DEAD_STOCK_DAYS;
}

/**
 * Where a variant stands. Untracked first; out when nothing is left; dead when
 * stock sits unsold; low when it is at the store's own level or would last
 * `LOW_STOCK_DAYS` or fewer at today's pace (only when enough has sold to
 * tell, so one sale does not make everything look low); otherwise ok.
 */
export function stockStatus(r: InventoryRow): StockStatus {
  if (!r.tracked) return "untracked";
  if (r.onHand <= 0) return "out";
  if (isDead(r)) return "dead";
  if (r.lowStockThreshold !== null && r.onHand <= r.lowStockThreshold) return "low";
  if (r.sold30 >= MIN_SOLD_30D) {
    const v = velocity(r.sold7, r.sold30);
    const days = daysOfStock(r.onHand, v.v7, v.v30);
    if (days !== null && days <= LOW_STOCK_DAYS) return "low";
  }
  return "ok";
}

export type InventoryAnalysis = InventoryRow & {
  velocity: Velocity;
  /** Null when nothing sold, or too little to say, or not tracked. */
  daysOfStock: number | null;
  status: StockStatus;
  /** Stock value at cost; null when not tracked, no stock or no cost. */
  valueMinor: number | null;
  sellThrough: number | null;
};

/** Everything the inventory table shows for a variant. */
export function analyseVariant(r: InventoryRow): InventoryAnalysis {
  const v = velocity(r.sold7, r.sold30);
  const enough = r.tracked && r.sold30 >= MIN_SOLD_30D;
  return {
    ...r,
    velocity: v,
    daysOfStock: enough ? daysOfStock(r.onHand, v.v7, v.v30) : null,
    status: stockStatus(r),
    valueMinor: r.tracked && r.onHand > 0 && r.costMinor !== null ? r.onHand * r.costMinor : null,
    sellThrough: r.tracked ? sellThrough(r.soldPeriod, r.onHand) : null,
  };
}

export type StockoutAlert = {
  row: InventoryRow;
  /** `out` is already gone, `soon` will be within the window. */
  kind: "out" | "soon";
  /** 0 for out. */
  days: number;
};

/**
 * Variants that sell and are gone or will be within `withinDays` (7). A
 * variant needs `MIN_SOLD_30D` units sold in 30 days to count, so slow sellers
 * and one-off sales raise nothing. Those already out come first, then the
 * soonest.
 */
export function stockoutAlerts(rows: readonly InventoryRow[], withinDays = STOCKOUT_ALERT_DAYS): StockoutAlert[] {
  const alerts: StockoutAlert[] = [];
  for (const r of rows) {
    if (!r.tracked || r.sold30 < MIN_SOLD_30D) continue;
    if (r.onHand <= 0) {
      alerts.push({ row: r, kind: "out", days: 0 });
      continue;
    }
    const v = velocity(r.sold7, r.sold30);
    const days = daysOfStock(r.onHand, v.v7, v.v30);
    if (days !== null && days <= withinDays) alerts.push({ row: r, kind: "soon", days });
  }
  return alerts.sort((a, b) => a.days - b.days || b.row.sold30 - a.row.sold30 || a.row.name.localeCompare(b.row.name, "en") || (a.row.variantId < b.row.variantId ? -1 : 1));
}
