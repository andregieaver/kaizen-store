/**
 * The low-stock crossing (wave 3, D172, `docs/wave-3-inventory.md` 2.7, 3.4, 4.4). Pure.
 *
 * A variant with a level set ("warn me when stock is at or below ...") is in one of three states: `off` (no level), `ok` (on hand
 * over the active locations is above the level) or `low` (at or below it). It CROSSES when it goes from `ok` to `low`: that is one
 * notice, however many sales follow, and the stock must rise above the level again before the next crossing. Setting a level on a
 * variant that is already at or below it does not send a notice (it is recorded as already told). Raising the level above the
 * current stock counts as a crossing at that moment; lowering or clearing it re-arms or switches it off.
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
  /** `clear`: the owners are not yet told (a new crossing); `now`: told already (a level set on a low variant); `keep`: as it was. */
  notifiedAt: "clear" | "now" | "keep";
  /** `set`: the stock at the crossing is recorded now; `keep`; `clear`. */
  stockAtCrossing: "set" | "keep" | "clear";
  /** The owners are to be told of this crossing: a new crossing (not an already-told one). */
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
  // off -> low: a level set on a variant already at or below it: recorded as already told.
  return { state, crossedAt: "now", notifiedAt: "now", stockAtCrossing: "set", crossing: false };
}

/** One crossing the job has not told the owners about yet (a `low` row with `notified_at` null). */
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
