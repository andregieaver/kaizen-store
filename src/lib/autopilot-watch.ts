/**
 * Watch and roll back (`docs/100-day-challenge.md` F4): each change the autopilot made itself that can be undone is watched in the hours after
 * it, on conversion (paid orders per visitor) and add-to-cart (carts with goods per visitor), against what the same hours of the week brought
 * in the weeks before. A clear fall undoes the change. Clear means enough visitors on both sides and a fall far outside chance (a one-sided
 * binomial test), never a dip a quiet afternoon explains. Errors are counted per day only (`store_usage_daily`), too coarse to blame one
 * change, so they are not watched here. Pure: the kinds, the thresholds and the verdict; the server reads the figures and undoes.
 */

/** The changes that can be undone, and how (`src/server/autopilot-watch.ts`). */
export const REVERTIBLE_TOOLS = ["set_prices", "create_discount", "set_discount_active", "create_campaign", "set_campaign_active", "make_theme_live", "set_ad_budget"] as const;
export type RevertibleTool = (typeof REVERTIBLE_TOOLS)[number];
export const isRevertible = (tool: string): tool is RevertibleTool => (REVERTIBLE_TOOLS as readonly string[]).includes(tool);

/** A change is judged once this many hours have passed, and no longer watched after `WATCH_UNTIL_HOURS`. */
export const WATCH_FROM_HOURS = 6;
export const WATCH_UNTIL_HOURS = 48;
/** The weeks before whose same hours make what was expected. */
export const BASELINE_WEEKS = 4;
/** Visitors needed since the change, and in the weeks before together, for a verdict at all. */
export const MIN_VISITORS_AFTER = 150;
export const MIN_VISITORS_BEFORE = 300;
/** How far below expected a rate must fall (a share of it), and how far outside chance (standard errors), to count as clear. */
export const FALL_SHARE = 0.35;
export const FALL_Z = 3;

export type Counts = { visitors: number; carts: number; orders: number };

export type Verdict =
  | { kind: "fine"; conversion: Reading | null; addToCart: Reading | null }
  | { kind: "fall"; signal: "conversion" | "addToCart"; conversion: Reading | null; addToCart: Reading | null }
  | { kind: "too_little"; visitorsAfter: number; visitorsBefore: number };

/** One rate since the change against the rate expected, with how many standard errors it lies below (negative: below). */
export type Reading = { observed: number; expected: number; z: number };

/** A rate since the change against the baseline's: null when the baseline has none of it (nothing to fall from). */
export function reading(hits: number, visitors: number, baseHits: number, baseVisitors: number): Reading | null {
  if (visitors <= 0 || baseVisitors <= 0 || baseHits <= 0) return null;
  const expected = baseHits / baseVisitors;
  const observed = hits / visitors;
  const se = Math.sqrt((expected * (1 - expected)) / visitors);
  return { observed, expected, z: se > 0 ? (observed - expected) / se : 0 };
}

const clearFall = (r: Reading | null): boolean => r !== null && r.observed < r.expected * (1 - FALL_SHARE) && r.z <= -FALL_Z;

/**
 * The verdict on a change: too little traffic to say; a clear fall of conversion or add-to-cart (conversion first: it is the money); or fine.
 * `before` is the sum of the same hours in the `BASELINE_WEEKS` weeks before.
 */
export function watchVerdict(after: Counts, before: Counts): Verdict {
  if (after.visitors < MIN_VISITORS_AFTER || before.visitors < MIN_VISITORS_BEFORE) return { kind: "too_little", visitorsAfter: after.visitors, visitorsBefore: before.visitors };
  const conversion = reading(after.orders, after.visitors, before.orders, before.visitors);
  const addToCart = reading(after.carts, after.visitors, before.carts, before.visitors);
  if (clearFall(conversion)) return { kind: "fall", signal: "conversion", conversion, addToCart };
  if (clearFall(addToCart)) return { kind: "fall", signal: "addToCart", conversion, addToCart };
  return { kind: "fine", conversion, addToCart };
}

/** The windows of the weeks before that match `[from, to)`: the same hours, 1 to `weeks` weeks earlier. */
export function baselineWindows(from: Date, to: Date, weeks = BASELINE_WEEKS): { from: Date; to: Date }[] {
  const week = 7 * 86_400_000;
  return Array.from({ length: weeks }, (_, i) => ({ from: new Date(from.getTime() - (i + 1) * week), to: new Date(to.getTime() - (i + 1) * week) }));
}

/** The verdict in words for the owner and the log, the rates as percentages with one decimal. */
export function verdictWords(v: Verdict): string {
  const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString("en-GB")} %`;
  const line = (label: string, r: Reading | null) => (r ? `${label} ${pct(r.observed)} against ${pct(r.expected)} expected` : null);
  if (v.kind === "too_little") return `Too few visitors to judge (${v.visitorsAfter} since, ${v.visitorsBefore} in the same hours of the weeks before).`;
  const parts = [line("conversion", v.conversion), line("add-to-cart", v.addToCart)].filter(Boolean).join("; ");
  return v.kind === "fall" ? `A clear fall in ${v.signal === "conversion" ? "conversion" : "add-to-cart"}: ${parts}.` : `No clear fall: ${parts || "nothing to compare"}.`;
}
