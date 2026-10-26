/**
 * How many of a variant one cart line may hold (wave 6 unit E, D323, `docs/wave-6-catalogue.md` E.1): a minimum, an optional maximum and a
 * step, the variant's own (`product_variants.min_quantity`, `max_quantity`, `quantity_step`). The cart's add and change, `placeOrder()` and
 * the WordPress cart all ask these functions, so they agree. No imports: the browser reads it too.
 */

/** The most units of one variant a single cart line holds when its rule sets no maximum and asks nothing more than one at a time. */
export const MAX_LINE_QUANTITY = 20;
/** The most units any line may hold: a variant's maximum is at most this. */
export const MAX_ORDER_QUANTITY = 9999;
/** Without a maximum, a line offers this many quantities: twenty steps from the minimum (`lineMax()`), which is 20 for the plain rule. */
const LINE_STEPS = MAX_LINE_QUANTITY;

export type QuantityRule = { min: number; max: number | null; step: number };

/** One at a time, from one: what a variant without a rule of its own, and any product but goods and bundles, is bought by. */
export const PLAIN_RULE: QuantityRule = { min: 1, max: null, step: 1 };

/** A rule as a row keeps it (`min_quantity`, `max_quantity`, `quantity_step`); a missing or broken value falls back to the plain rule's. */
export function ruleOf(row: { min_quantity?: unknown; max_quantity?: unknown; quantity_step?: unknown }): QuantityRule {
  const whole = (value: unknown): number | null => {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isInteger(n) && n >= 1 && n <= MAX_ORDER_QUANTITY ? n : null;
  };
  const step = whole(row.quantity_step) ?? 1;
  const min = whole(row.min_quantity) ?? 1;
  const max = whole(row.max_quantity);
  // The database keeps the minimum and maximum whole steps, the maximum at least the minimum; a row that is not is read as plain.
  if (min % step !== 0 || (max !== null && (max < min || max % step !== 0))) return PLAIN_RULE;
  return { min, max, step };
}

/** Whether the rule asks anything beyond one at a time from one, with no maximum. */
export function isPlain(rule: QuantityRule): boolean {
  return rule.min === 1 && rule.step === 1 && rule.max === null;
}

const downToStep = (n: number, step: number) => Math.floor(n / step) * step;
const upToStep = (n: number, step: number) => Math.ceil(n / step) * step;

/** The most units a line of the variant may hold: its maximum, else twenty steps from its minimum (20 for the plain rule), never above 9,999. */
export function lineMax(rule: QuantityRule): number {
  if (rule.max !== null) return rule.max;
  return Math.max(rule.min, downToStep(Math.min(MAX_ORDER_QUANTITY, rule.min + (LINE_STEPS - 1) * rule.step), rule.step));
}

export type QuantityProblem = { kind: "min" | "max" | "step"; n: number };

/** What is wrong with a line of `quantity` units under the rule, or null when nothing is: below the minimum, not whole steps, above `lineMax()`. */
export function quantityProblem(quantity: number, rule: QuantityRule): QuantityProblem | null {
  if (!Number.isInteger(quantity) || quantity < rule.min) return { kind: "min", n: rule.min };
  if (quantity % rule.step !== 0) return { kind: "step", n: rule.step };
  const most = lineMax(rule);
  if (quantity > most) return { kind: "max", n: most };
  return null;
}

/**
 * The quantity a line holds after adding `asked` units to the `current` ones: at least the minimum, rounded up to a whole step. So *Add to cart*
 * (one unit) puts a variant sold in sixes in by six, and a line the rule no longer fits is put right on the next add.
 */
export function nextQuantity(current: number, asked: number, rule: QuantityRule): number {
  return Math.max(rule.min, upToStep(Math.max(0, Math.floor(current)) + Math.max(1, Math.floor(asked)), rule.step));
}

/**
 * The largest quantity up to `wanted` that the rule and the stock (`available`) allow, 0 when even the minimum is more than they allow. A
 * quantity below the minimum or between steps is the caller's to refuse (`quantityProblem()`); this only cuts down.
 */
export function fitQuantity(wanted: number, available: number, rule: QuantityRule): number {
  const limit = Math.min(lineMax(rule), Math.max(0, Math.floor(available)));
  const fitted = downToStep(Math.min(Math.floor(wanted), limit), rule.step);
  return fitted >= rule.min ? fitted : 0;
}

/** The shopper's words for a rule ("At least 12 · In multiples of 6 · At most 48"), or null for the plain rule; the maximum only when the variant sets one. */
export function ruleWords(
  rule: QuantityRule,
  words: { min: (n: number) => string; max: (n: number) => string; step: (n: number) => string },
): string | null {
  const parts = [
    // A minimum of one step says nothing the step does not.
    rule.min > rule.step && words.min(rule.min),
    rule.step > 1 && words.step(rule.step),
    rule.max !== null && words.max(rule.max),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A variant's rule as its row keeps it, for goods and bundles; anything else (a gift card, a booking) is bought by the plain rule. */
export function ruleForKind(kind: unknown, row: { min_quantity?: unknown; max_quantity?: unknown; quantity_step?: unknown }): QuantityRule {
  return kind === "goods" || kind === "bundle" ? ruleOf(row) : PLAIN_RULE;
}

/** What is wrong with a rule an owner typed, as the database would refuse it (`product_variants` checks), or null; plain sentences for the editor. */
export function ruleProblem(rule: QuantityRule): string | null {
  const whole = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_ORDER_QUANTITY;
  if (!whole(rule.min) || !whole(rule.step) || (rule.max !== null && !whole(rule.max))) {
    return `Quantities are whole numbers from 1 to ${MAX_ORDER_QUANTITY}.`;
  }
  if (rule.min % rule.step !== 0) return `The minimum must be a whole number of steps of ${rule.step}.`;
  if (rule.max !== null && rule.max < rule.min) return "The maximum cannot be below the minimum.";
  if (rule.max !== null && rule.max % rule.step !== 0) return `The maximum must be a whole number of steps of ${rule.step}.`;
  return null;
}
