/**
 * Sales by weekday and hour for the traffic page (D152, docs/analytics.md).
 * SQL puts each paid order in its weekday and hour in the store's time zone;
 * this builds the matrix, its totals and its peaks.
 */

/** Monday first, as the ISO week and the admin show them. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Paid orders in one weekday and hour, in the store's time zone. */
export type HeatmapRow = {
  /** 1 (Monday) to 7 (Sunday): `extract(isodow …)`. */
  weekday: number;
  /** 0 to 23. */
  hour: number;
  orders: number;
  /** Revenue without VAT, minor units of the main currency. */
  revenueMinor: number;
};

export type HeatCell = { orders: number; revenueMinor: number };

export type HeatMetric = "orders" | "revenue";

export type HeatPeak = {
  /** 1 to 7. */
  weekday: number;
  /** The first hour of the cell or band. */
  hour: number;
  orders: number;
  revenueMinor: number;
};

export type Heatmap = {
  /** `cells[weekday - 1][hour]`: always 7 rows of 24. */
  cells: HeatCell[][];
  /** Per weekday (Monday first). */
  rowTotals: HeatCell[];
  /** Per hour of the day. */
  colTotals: HeatCell[];
  total: HeatCell;
  /** The cell with the most orders (and, among equals, the most revenue); null with no orders. */
  peakByOrders: HeatPeak | null;
  /** The cell with the most revenue (and, among equals, the most orders); null with no revenue. */
  peakByRevenue: HeatPeak | null;
  /** The weekday and the hour with the most orders overall; null with no orders. */
  peakWeekday: number | null;
  peakHour: number | null;
  /** The largest cell, for scaling colours. */
  max: HeatCell;
  /** Rows left out because their weekday or hour was not valid, or their numbers were not. */
  skipped: number;
};

const empty = (): HeatCell => ({ orders: 0, revenueMinor: 0 });

const validRow = (r: HeatmapRow) =>
  Number.isInteger(r.weekday) && r.weekday >= 1 && r.weekday <= 7 && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 && Number.isFinite(r.orders) && Number.isFinite(r.revenueMinor);

/** Rows that repeat a weekday and hour are added together. */
export function buildHeatmap(rows: readonly HeatmapRow[]): Heatmap {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, empty));
  let skipped = 0;
  for (const r of rows) {
    if (!validRow(r)) {
      skipped += 1;
      continue;
    }
    const cell = cells[r.weekday - 1][r.hour];
    cell.orders += r.orders;
    cell.revenueMinor += r.revenueMinor;
  }
  return summarise(cells, 1, skipped);
}

/** Totals, peaks and maximum for a matrix whose columns are `width` hours wide. */
function summarise(cells: HeatCell[][], width: number, skipped: number): Heatmap {
  const columns = cells[0].length;
  const rowTotals = cells.map((row) => row.reduce((s, c) => ({ orders: s.orders + c.orders, revenueMinor: s.revenueMinor + c.revenueMinor }), empty()));
  const colTotals = Array.from({ length: columns }, (_, h) => cells.reduce((s, row) => ({ orders: s.orders + row[h].orders, revenueMinor: s.revenueMinor + row[h].revenueMinor }), empty()));
  const total = rowTotals.reduce((s, c) => ({ orders: s.orders + c.orders, revenueMinor: s.revenueMinor + c.revenueMinor }), empty());

  let byOrders: HeatPeak | null = null;
  let byRevenue: HeatPeak | null = null;
  const max = empty();
  cells.forEach((row, d) =>
    row.forEach((c, h) => {
      max.orders = Math.max(max.orders, c.orders);
      max.revenueMinor = Math.max(max.revenueMinor, c.revenueMinor);
      const peak: HeatPeak = { weekday: d + 1, hour: h * width, orders: c.orders, revenueMinor: c.revenueMinor };
      if (c.orders > 0 && (!byOrders || c.orders > byOrders.orders || (c.orders === byOrders.orders && c.revenueMinor > byOrders.revenueMinor))) byOrders = peak;
      if (c.revenueMinor > 0 && (!byRevenue || c.revenueMinor > byRevenue.revenueMinor || (c.revenueMinor === byRevenue.revenueMinor && c.orders > byRevenue.orders))) byRevenue = peak;
    }),
  );

  const bestRow = rowTotals.reduce((best, c, i) => (c.orders > rowTotals[best].orders ? i : best), 0);
  const bestCol = colTotals.reduce((best, c, i) => (c.orders > colTotals[best].orders ? i : best), 0);
  return {
    cells,
    rowTotals,
    colTotals,
    total,
    peakByOrders: byOrders,
    peakByRevenue: byRevenue,
    peakWeekday: total.orders > 0 ? bestRow + 1 : null,
    peakHour: total.orders > 0 ? bestCol * width : null,
    max,
    skipped,
  };
}

/** How strong a cell is, 0..1 against the largest cell; 0 when there is nothing to compare with. */
export function intensity(cell: HeatCell, max: HeatCell, metric: HeatMetric): number {
  const [value, top] = metric === "orders" ? [cell.orders, max.orders] : [cell.revenueMinor, max.revenueMinor];
  return top > 0 && value > 0 ? Math.min(1, value / top) : 0;
}

export type HeatBands = Heatmap & {
  /** Hours per band. */
  bandSize: number;
  /** The bands, in order: `{ startHour, endHour }` with the end exclusive. */
  bands: { startHour: number; endHour: number; label: string }[];
};

/**
 * The same matrix with hours grouped into bands (2 hours: 00–02, 02–04 …). The
 * size must divide 24 so no band is cut short. Peaks and the peak hour then
 * name a band's first hour.
 */
export function bandHours(map: Pick<Heatmap, "cells" | "skipped">, bandSize = 2): HeatBands {
  if (!Number.isInteger(bandSize) || bandSize < 1 || 24 % bandSize !== 0) throw new RangeError(`A band must divide the day into whole bands: ${bandSize}`);
  const count = 24 / bandSize;
  const cells = map.cells.map((row) =>
    Array.from({ length: count }, (_, b) =>
      row.slice(b * bandSize, (b + 1) * bandSize).reduce((s, c) => ({ orders: s.orders + c.orders, revenueMinor: s.revenueMinor + c.revenueMinor }), empty()),
    ),
  );
  const pad = (h: number) => String(h).padStart(2, "0");
  return {
    ...summarise(cells, bandSize, map.skipped),
    bandSize,
    bands: Array.from({ length: count }, (_, b) => ({ startHour: b * bandSize, endHour: (b + 1) * bandSize, label: `${pad(b * bandSize)}–${pad((b + 1) * bandSize)}` })),
  };
}
