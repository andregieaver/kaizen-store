import { oneLine } from "./redirect-tools";
import { backorderMayPassAgreed, BACKORDER_LONG_HINT, reasonWord, type AdjustReason } from "./inventory";

/**
 * What the AI manager's stock tools (wave 3, D172, `docs/wave-3-inventory.md` 5.5) do that needs no database. `stock_levels` and `stock_history` read what the
 * Inventory page and its history read; `set_stock` sets one variant's figure at one location with a reason (the page's own `adjustStock()`, kept for the owner's
 * yes) and `set_backorder` turns "keep selling when sold out" on or off with the delivery time shoppers are told (the page's own `setVariantPolicies()`, kept for
 * the owner's yes). Every figure is the store's own; the model repeats it and works nothing out. Pure, so tests hold it without a database.
 */

export { oneLine };

export const STOCK_TOOLS = ["stock_levels", "stock_history", "set_stock", "set_backorder"] as const;

export type PickableLocation = { id: string; name: string; active: boolean };

/**
 * Which location a figure is for. A name matches exactly (any case) or, failing that, as the start of exactly one name; two matches is a question, not a guess.
 * With no name there must be exactly one ACTIVE location; with several the tool asks which, in the store's own words, rather than choosing one.
 */
export function pickLocation<L extends PickableLocation>(name: string | null | undefined, locations: readonly L[]): { ok: true; location: L } | { ok: false; problem: string } {
  const wanted = (name ?? "").trim().toLowerCase();
  const active = locations.filter((l) => l.active);
  if (wanted === "") {
    if (active.length === 1) return { ok: true, location: active[0] };
    if (active.length === 0) return { ok: false, problem: "The store has no active stock location." };
    return { ok: false, problem: `The store keeps stock at ${active.length} locations: say which one (${active.map((l) => l.name).join(", ")}).` };
  }
  const exact = locations.filter((l) => l.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return { ok: true, location: exact[0] };
  if (exact.length > 1) return { ok: false, problem: `More than one location is called ${name}: use the Inventory page.` };
  const starts = locations.filter((l) => l.name.trim().toLowerCase().startsWith(wanted));
  if (starts.length === 1) return { ok: true, location: starts[0] };
  const names = locations.map((l) => l.name).join(", ");
  return { ok: false, problem: starts.length > 1 ? `More than one location starts with ${name}: say which one (${starts.map((l) => l.name).join(", ")}).` : `The store has no location called ${name}. Its locations are ${names || "none yet"}.` };
}

/** A day as `YYYY-MM-DD`, `days` days before another (calendar days, no clock involved: the history's range is whole days in the store's time zone). */
export function dayBefore(day: string, days: number): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  return new Date(at - Math.max(0, Math.floor(days)) * 86_400_000).toISOString().slice(0, 10);
}

/** The words a gated `set_stock` is kept with, for the owner's yes: made from the arguments as given, never the model's own description. */
export function setStockSummary(input: { sku: string; quantity: number; location?: string | null; reason?: AdjustReason | string | null; note?: string | null }): string {
  const place = input.location?.trim() ? ` at ${oneLine(input.location, 60)}` : "";
  const reason = input.reason ? ` Reason: ${reasonWord(String(input.reason))}.` : "";
  const note = input.note?.trim() ? ` Note: "${oneLine(input.note)}".` : "";
  return `Set the stock of ${oneLine(input.sku, 100)}${place} to ${input.quantity}.${reason}${note}`;
}

/**
 * The words a gated `set_backorder` is kept with. Turning backorders on tells every shopper a delivery time, so the days are said as shoppers will read them, and a
 * time that, with transport, may pass 30 days carries the editor's own reminder (flagged for human review in `BACKORDER_LONG_HINT`).
 */
export function backorderSummary(input: { sku: string; policy: "continue" | "deny"; days?: number | null }): string {
  const sku = oneLine(input.sku, 100);
  if (input.policy === "deny") return `Stop selling ${sku} when it is sold out. Orders already placed still owe the units they were sold on backorder.`;
  const days = input.days ?? 0;
  const long = backorderMayPassAgreed(days) ? ` ${BACKORDER_LONG_HINT}` : "";
  return `Keep selling ${sku} when it is sold out. Shoppers are told, on the product page, in the cart, on the order and in the confirmation email, that it is expected to ship within ${days} ${days === 1 ? "day" : "days"}.${long}`;
}

export type LevelRow = {
  title: string;
  sku: string;
  options: Record<string, string>;
  onHand: number;
  committed: number;
  available: number;
  owed: number;
  stockPolicy: "deny" | "continue";
  backorderDays: number | null;
  lowStockThreshold: number | null;
  locations: { name: string; active: boolean; hasLevel: boolean; onHand: number; committed: number; available: number }[];
};

/** A stock row as the model reads it: names for the figures the Inventory page shows, and the two states it must say in words. */
export function shapeLevel(row: LevelRow, productAdmin: string | null) {
  const onBackorder = row.stockPolicy === "continue" && row.available <= 0;
  return {
    product: row.title,
    sku: row.sku,
    options: row.options,
    on_hand: row.onHand,
    committed_to_checkouts: row.committed,
    available: row.available,
    owed_to_customers: row.owed,
    when_sold_out: row.stockPolicy === "continue" ? "keeps selling on backorder" : "stops selling",
    ...(row.stockPolicy === "continue" ? { delivery_days: row.backorderDays } : {}),
    warning_level: row.lowStockThreshold,
    ...(row.lowStockThreshold !== null && row.onHand <= row.lowStockThreshold ? { at_or_below_warning_level: true } : {}),
    ...(onBackorder ? { on_backorder_now: true } : {}),
    ...(row.locations.length > 1 ? { per_location: row.locations.map((l) => ({ location: l.name, active: l.active, on_hand: l.onHand, committed_to_checkouts: l.committed })) } : {}),
    ...(productAdmin ? { admin: productAdmin } : {}),
  };
}

export const STOCK_LEVEL_NOTES = [
  "On hand is what is counted at the store's active locations; below zero is what the store still has to receive for orders sold on backorder.",
  "Committed is only what checkouts in progress hold for a few minutes: a paid order has already taken its units off on hand.",
  "Owed is the backordered units on orders that are paid and not sent yet.",
] as const;

export type MovementRow = { createdAt: string; location: string; delta: number; onHandAfter: number; reason: string; by: string; note: string | null };

/** A movement as the model reads it: when, where, how much, the figure after, why and by whom. */
export const shapeMovement = (m: MovementRow) => ({
  when: m.createdAt,
  location: m.location,
  change: m.delta,
  new_on_hand: m.onHandAfter,
  reason: reasonWord(m.reason),
  by: m.by,
  ...(m.note ? { note: oneLine(m.note) } : {}),
});
