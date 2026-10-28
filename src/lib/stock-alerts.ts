/**
 * The low-stock crossing (wave 3, D172, `docs/wave-3-inventory.md` 2.7, 3.4, 4.4). Pure.
 *
 * A variant with a level set ("warn me when stock is at or below ...") is in one of three states: `off` (no level), `ok` (on hand
 * over the active locations is above the level) or `low` (at or below it). It CROSSES when it goes from `ok` to `low`: that is one
 * notice, however many sales follow, and the stock must rise above the level again before the next crossing. Raising the level above
 * the current stock counts as a crossing at that moment; lowering or clearing it re-arms or switches it off.
 *
 * A variant created at or below its level, or a level set on a variant already at or below it (`off` to `low`), is a crossing at once
 * too (D370; before it, it was recorded as already told and the owners heard nothing until the stock rose and fell again). The
 * database still writes such a crossing with `notified_at` equal to `crossed_at` (both its transaction's `now()`, so the two are the
 * same instant to the microsecond and never so after the job's mark, which is a later transaction's): the job reads a `low` row whose
 * `notified_at` is null OR the crossing's own time as not yet told (`untold()`, and `UNTOLD_SQL` in `src/server/stock-alerts.ts`),
 * tells it once and marks it with its own time.
 *
 * `commerce.refresh_stock_alert()` holds the same table in SQL; `nextAlertState()` is the oracle a test runs against the database
 * for every transition, as `return-status.ts` is held to its SQL.
 */

export const ALERT_STATES = ["off", "ok", "low"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

/** What to do with a column of the `stock_alerts` row. */
export type AlertChange = {
  state: AlertState;
  /** `now`: a new crossing starts; `keep`: the crossing goes on; `clear`: no crossing. */
  crossedAt: "now" | "keep" | "clear";
  /**
   * `clear`: null, the owners are not yet told (a crossing from `ok`); `now`: the crossing's own time (a crossing from `off`), which the
   * job also reads as not yet told since D370 (`untold()`); `keep`: as it was.
   */
  notifiedAt: "clear" | "now" | "keep";
  /** `set`: the stock at the crossing is recorded now; `keep`; `clear`. */
  stockAtCrossing: "set" | "keep" | "clear";
  /** The owners are to be told of this crossing: a new crossing, from `ok` or (D370) from `off`. */
  crossing: boolean;
};

/** The state a figure and a level make: no level is `off`, at or below it is `low`, above it is `ok`. */
export function stateFor(threshold: number | null, stock: number): AlertState {
  if (threshold === null) return "off";
  return stock <= threshold ? "low" : "ok";
}

/**
 * The transition. `prev` is the state before (null: no row yet, which behaves as `off`); `threshold` and `stock` are the values
 * now (the stock is on hand summed over ACTIVE locations, and may be negative).
 */
export function nextAlertState(prev: AlertState | null, threshold: number | null, stock: number): AlertChange {
  const before: AlertState = prev ?? "off";
  const state = stateFor(threshold, stock);
  if (state === "off") return { state, crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false };
  if (state === "ok") return { state, crossedAt: "clear", notifiedAt: "keep", stockAtCrossing: "clear", crossing: false };
  // low
  if (before === "low") return { state, crossedAt: "keep", notifiedAt: "keep", stockAtCrossing: "keep", crossing: false };
  if (before === "ok") return { state, crossedAt: "now", notifiedAt: "clear", stockAtCrossing: "set", crossing: true };
  // off -> low: a variant created at or below its level, or a level set on one already at or below it: a crossing at once (D370), its
  // `notified_at` written as the crossing's own time, which `untold()` reads as not yet told.
  return { state, crossedAt: "now", notifiedAt: "now", stockAtCrossing: "set", crossing: true };
}

/**
 * Whether the owners are still to be told of a `low` row's crossing: never marked (a crossing from `ok`), or marked with the crossing's
 * own time (a crossing from `off`, D370). The job's mark is a later instant, so a crossing told once is never told again. The job asks the
 * same in SQL (`UNTOLD_SQL`), to the microsecond; a JavaScript date here has milliseconds.
 */
export function untold(row: { crossedAt: string | Date | null; notifiedAt: string | Date | null }): boolean {
  if (row.crossedAt === null) return false;
  if (row.notifiedAt === null) return true;
  return new Date(row.notifiedAt).getTime() === new Date(row.crossedAt).getTime();
}

/** One crossing the job has not told the owners about yet (a `low` row that is `untold()`). */
export type PendingCrossing = { variantId: string; sku: string; label: string; stock: number; threshold: number; crossedAt: string | Date };

/** The idempotency key of a store's low-stock email: the store plus the newest crossing time, so a retry is the same email. */
export function lowStockKey(storeId: string, crossings: readonly Pick<PendingCrossing, "crossedAt">[]): string {
  const newest = crossings.reduce((max, c) => Math.max(max, new Date(c.crossedAt).getTime()), 0);
  return `stock.low:${storeId}:${newest}`;
}

/** The lines the email lists (at most `max`) and how many more there are. */
export function lowStockLines<T>(crossings: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: crossings.slice(0, max), more: Math.max(crossings.length - max, 0) };
}
