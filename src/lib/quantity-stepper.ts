/**
 * The quantity chooser (D430, `QuantityStepper`): a number with − and + buttons that follows a variant's quantity rule (D323, its minimum,
 * maximum and step), on the product page and on each cart line. A store chooses how its product pages show it (`stores.quantity_picker`), a
 * product layout's buy part may choose otherwise (`ProductBlock.quantity`), and it is shown only where a quantity can be chosen. Pure: the
 * browser reads it.
 */
import { lineMax, type QuantityRule } from "./quantity-rules";

/** How a product page offers the quantity: − and + buttons beside the number (the default), the number box alone, or not at all. */
export type QuantityPicker = "buttons" | "box" | "hidden";

export const QUANTITY_PICKERS: readonly QuantityPicker[] = ["buttons", "box", "hidden"];

export const isQuantityPicker = (value: unknown): value is QuantityPicker => value === "buttons" || value === "box" || value === "hidden";

/** Whether the rule lets a line hold more than one quantity: a variant its rule fixes at one quantity has nothing to choose. */
export const canChooseQuantity = (rule: QuantityRule): boolean => lineMax(rule) > rule.min;

/**
 * The chooser a product page draws for a variant (D430): the layout's buy part's choice, else the store's, and none for anything but goods
 * and bundles (an appointment, a stay, a rental and a gift card are chosen their own ways) or where the rule allows a single quantity.
 */
export function pickerFor(store: QuantityPicker, part: QuantityPicker | undefined, kind: string, rule: QuantityRule): Exclude<QuantityPicker, "hidden"> | null {
  const chosen = part ?? store;
  if (chosen === "hidden" || (kind !== "goods" && kind !== "bundle") || !canChooseQuantity(rule)) return null;
  return chosen;
}

const downToStep = (n: number, step: number) => Math.floor(n / step) * step;
const upToStep = (n: number, step: number) => Math.ceil(n / step) * step;

/** The quantity after +: the minimum from below it, else the next whole step, never above the line's maximum. */
export function stepUp(n: number, rule: QuantityRule): number {
  const most = lineMax(rule);
  if (!Number.isFinite(n) || n < rule.min) return rule.min;
  return Math.min(most, downToStep(n, rule.step) + rule.step);
}

/** The quantity after −: the maximum from above it, else the step below, never under the minimum. */
export function stepDown(n: number, rule: QuantityRule): number {
  const most = lineMax(rule);
  if (!Number.isFinite(n)) return rule.min;
  if (n > most) return most;
  return Math.max(rule.min, upToStep(n, rule.step) - rule.step);
}

/** The allowed quantity nearest to a typed one: within the minimum and the line's maximum, on a whole step (half a step rounds up). */
export function snapQuantity(n: number, rule: QuantityRule): number {
  const most = lineMax(rule);
  if (!Number.isFinite(n)) return rule.min;
  const within = Math.min(most, Math.max(rule.min, n));
  return Math.min(most, Math.max(rule.min, Math.round(within / rule.step) * rule.step));
}

/** A quantity as typed into the box: a whole number, or null for anything else (empty, a fraction, letters). */
export function typedQuantity(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
}
