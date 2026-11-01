import { addDays } from "./analytics-period";

/**
 * What the autopilot's changes moved (D418): each change it made itself (an audit entry `acted_by = 'autopilot'`) is measured once, two weeks on, on
 * the figure it was meant to move. A change to a product (`PRODUCT_EFFECT_TOOLS`) is measured on that product's sales; anything else on the store's.
 * Sales here are what the goods sold for without VAT (order lines, gift cards left out, before refunds), in the store's main currency, over the
 * `EFFECT_DAYS` store days before the change's day and the `EFFECT_DAYS` after it (the day itself is in neither). Beside each product's figure is
 * the store's own over the same days, so a lift is read against the store's trend: what the product would have sold had it moved as the store
 * did (`expectedAfter()`), and the difference (`liftMinor()`). It is a comparison, never proof that the change caused it, and every text says so.
 * Pure: the reads are in `src/server/autopilot-effects.ts`.
 */

/** Days measured on each side of a change. */
export const EFFECT_DAYS = 14;
/** How long after a change it is still measured: past this an unmeasured change is left (a store without rates, say). */
export const EFFECT_LOOKBACK_DAYS = 90;
/** Changes measured in one run. */
export const EFFECTS_PER_RUN = 40;

/** The AI manager's tools whose change is to one product, named by `args.product` (or a new one by `args.title`). */
export const PRODUCT_EFFECT_TOOLS: ReadonlySet<string> = new Set(["create_product", "update_product", "set_prices", "set_product_status", "write_product_texts"]);

/** The tool an audit action names (`store.assistant.{tool}`), or null for any other action. */
export function toolOfAction(action: string): string | null {
  const m = /^store\.assistant\.([a-z0-9_]+)$/.exec(action);
  return m ? m[1] : null;
}

/** What the change was made to, by its tool and arguments: a product by its reference, else the store. */
export function effectTarget(tool: string, args: unknown): { kind: "product"; ref: string } | { kind: "store" } {
  if (!PRODUCT_EFFECT_TOOLS.has(tool) || !args || typeof args !== "object") return { kind: "store" };
  const a = args as Record<string, unknown>;
  const ref = tool === "create_product" ? a.title : a.product;
  return typeof ref === "string" && ref.trim() ? { kind: "product", ref: ref.trim().slice(0, 200) } : { kind: "store" };
}

export type EffectWindows = { before: { from: string; to: string }; after: { from: string; to: string }; measurableOn: string };

/** The store days measured for a change made on `actedDay`, and the first day it can be measured (the day after the last day after it). */
export function effectWindows(actedDay: string, days = EFFECT_DAYS): EffectWindows {
  const before = { from: addDays(actedDay, -days), to: addDays(actedDay, -1) };
  const after = { from: addDays(actedDay, 1), to: addDays(actedDay, days) };
  return { before, after, measurableOn: addDays(after.to, 1) };
}

export type Effect = {
  tool: string;
  targetKind: "product" | "store";
  /** The product's title when it was measured (or what the change named it), empty for the store. */
  targetLabel: string;
  actedAt: string;
  currency: string;
  beforeMinor: number;
  afterMinor: number;
  beforeUnits: number | null;
  afterUnits: number | null;
  storeBeforeMinor: number;
  storeAfterMinor: number;
};

/** What the product would have sold after had it moved as the whole store did; null for a store change or a store that sold nothing before. */
export function expectedAfter(e: Pick<Effect, "targetKind" | "beforeMinor" | "storeBeforeMinor" | "storeAfterMinor">): number | null {
  if (e.targetKind !== "product" || e.storeBeforeMinor <= 0) return null;
  return Math.round((e.beforeMinor * e.storeAfterMinor) / e.storeBeforeMinor);
}

/** A product change's sales beyond the store's own trend (an estimate); null where there is nothing to read it against. */
export function liftMinor(e: Pick<Effect, "targetKind" | "beforeMinor" | "afterMinor" | "storeBeforeMinor" | "storeAfterMinor">): number | null {
  const expected = expectedAfter(e);
  return expected === null ? null : e.afterMinor - expected;
}

/** A difference in money with its sign, written by `money` (`+kr 200,00`, `−kr 50,00`). */
export const signedMoney = (minor: number, money: (minor: number) => string): string => `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${money(Math.abs(minor))}`;

/** The change of a figure as a share of where it started; null from nothing. */
export const changeShare = (before: number, after: number): number | null => (before > 0 ? (after - before) / before : null);

export type EffectsMonth = {
  /** `YYYY-MM`. */
  month: string;
  /** Changes the autopilot made itself in the month. */
  actions: number;
  /** Changes measured in the month (made two weeks or more before). */
  measured: number;
  /** Of those, the product changes, and their products' sales before and after, summed. */
  products: number;
  beforeMinor: number;
  afterMinor: number;
  /** The product changes' sales beyond the store's own trend, summed where it could be read; null when none could. */
  liftMinor: number | null;
  /** How many of the product changes sold more than the store's trend, and how many less. */
  above: number;
  below: number;
  currency: string;
};

/** The month's changes and what the measured ones moved; store changes are counted, never summed into money (their windows overlap). */
export function effectsMonth(month: string, actions: number, effects: readonly Effect[], currency: string): EffectsMonth {
  const products = effects.filter((e) => e.targetKind === "product" && e.currency === currency);
  const lifts = products.map(liftMinor).filter((l): l is number => l !== null);
  return {
    month,
    actions,
    measured: effects.length,
    products: products.length,
    beforeMinor: products.reduce((s, e) => s + e.beforeMinor, 0),
    afterMinor: products.reduce((s, e) => s + e.afterMinor, 0),
    liftMinor: lifts.length > 0 ? lifts.reduce((s, l) => s + l, 0) : null,
    above: lifts.filter((l) => l > 0).length,
    below: lifts.filter((l) => l < 0).length,
    currency,
  };
}

/** The month before `month` (`YYYY-MM`), and a month's first and last day. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export function monthDays(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The lines a review is told (D328): what the store's last changes moved, written by code; the model reads them as data. */
export function effectLines(effects: readonly Effect[], money: (minor: number, currency: string) => string, max = 8): string[] {
  return effects.slice(0, max).map((e) => {
    const m = (minor: number) => money(minor, e.currency);
    const what = e.targetKind === "product" ? `${e.tool} on "${e.targetLabel}"` : e.tool;
    const own = `${m(e.beforeMinor)} → ${m(e.afterMinor)}`;
    const lift = liftMinor(e);
    return e.targetKind === "product"
      ? `- ${e.actedAt.slice(0, 10)} ${what}: the product sold ${own} (${EFFECT_DAYS} days before → after); the store ${m(e.storeBeforeMinor)} → ${m(e.storeAfterMinor)}${lift === null ? "" : `; ${lift >= 0 ? "above" : "below"} the store's trend by ${m(Math.abs(lift))}`}.`
      : `- ${e.actedAt.slice(0, 10)} ${what}: the store sold ${own} (${EFFECT_DAYS} days before → after).`;
  });
}
