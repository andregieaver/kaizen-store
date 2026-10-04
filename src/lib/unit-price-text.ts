/**
 * The words of a unit price (D160): "199,60 kr/kg". No React, no I/O. The figure itself is `unitPrice()`
 * (`unit-price.ts`); these only write it, in the market's currency and the shown language.
 */
import type { Messages } from "./i18n";
import { formatMoney } from "./money";
import type { PriceVat } from "./pricing";
import { unitPrice, unitPriceShown, type Base, type ShownMeasure } from "./unit-price";

type UnitPriceMessages = Pick<Messages, "unitPrice">;

/**
 * The words a unit line needs, as plain data so a client component can be given them (the sentence a screen reader
 * says is a function in `Messages`, which cannot cross to the browser): `{amount}` and `{base}` stand for the two
 * parts of `m.unitPrice.spoken`.
 */
export type UnitLabels = { spoken: string; bases: Record<Base, string> };

export function unitLabelsOf(m: UnitPriceMessages): UnitLabels {
  return { spoken: m.unitPrice.spoken("{amount}", "{base}"), bases: m.unitPrice.bases };
}

/** A unit price written for the eye ("199,60 kr/kg") and for a screen reader ("Unit price: 199,60 kr per kg"), from plain labels. */
export function unitPriceWords(
  unit: { minor: number; base: Base },
  currency: string,
  locale: string,
  labels: UnitLabels,
): { text: string; spoken: string } {
  const amount = formatMoney(unit.minor, currency, locale);
  const base = labels.bases[unit.base];
  return { text: `${amount}/${base}`, spoken: labels.spoken.replace("{amount}", () => amount).replace("{base}", () => base) };
}

/** The short label of a base in the shown language: "kg", "100 g", "l", "100 ml", "m", "m²", "stk.". */
export function baseLabel(base: Base, m: UnitPriceMessages): string {
  return m.unitPrice.bases[base];
}

/** "199,60 kr/kg", "NOK 199.60/kg": the amount, a slash and the base's label. Number and currency follow the locale. */
export function unitPriceText(unit: { minor: number; base: Base }, currency: string, locale: string, m: UnitPriceMessages): string {
  return `${formatMoney(unit.minor, currency, locale)}/${baseLabel(unit.base, m)}`;
}

/** What a screen reader says: "Unit price: 199,60 kr per kg". */
export function unitPriceSpoken(unit: { minor: number; base: Base }, currency: string, locale: string, m: UnitPriceMessages): string {
  return m.unitPrice.spoken(formatMoney(unit.minor, currency, locale), baseLabel(unit.base, m));
}

/**
 * The unit price text of an order line or a cart line, or null when there is none to show: no content, a free gift, or a
 * figure `unitPrice()` cannot state (equal to the price, free, rounding to nothing). `unitPriceMinor` is the price of one
 * unit as the line shows it, in `currency`; the quantity never enters it.
 */
export function lineUnitPriceText(
  line: { unitPriceMinor: number | null; measure: ShownMeasure | null; gift?: boolean },
  currency: string,
  locale: string,
  m: UnitPriceMessages,
): string | null {
  if (!line.measure || line.gift || line.unitPriceMinor === null) return null;
  const result = unitPrice(line.unitPriceMinor, line.measure, line.measure.base);
  return result.ok ? unitPriceText(result, currency, locale, m) : null;
}

/** A line's unit price for the eye and for a screen reader, or null when there is none to show: `lineUnitPriceText`'s rules, as plain data a client component can be given. */
export function lineUnitWords(
  line: { unitPriceMinor: number | null; measure: ShownMeasure | null; gift?: boolean },
  currency: string,
  locale: string,
  m: UnitPriceMessages,
): { text: string; spoken: string } | null {
  if (!line.measure || line.gift || line.unitPriceMinor === null) return null;
  const result = unitPrice(line.unitPriceMinor, line.measure, line.measure.base);
  return result.ok ? unitPriceWords(result, currency, locale, unitLabelsOf(m)) : null;
}

/**
 * The unit price as a sentence for the chat agent's tool results ("Unit price: 199,60 kr per kg"), worked out in code
 * from the price as the store shows it (without VAT in a business-only store, else with): the model repeats it and
 * computes nothing. Null when there is none to say.
 */
export function priceUnitSentence(
  price: { amountMinor: number; currency: string; vat: PriceVat; measure: ShownMeasure | null },
  locale: string,
  m: UnitPriceMessages,
): string | null {
  if (!price.measure) return null;
  const shown = unitPriceShown(price.amountMinor, price.vat, price.measure, price.measure.base);
  const result = price.vat.shown === "excl" ? shown.excl : shown.incl;
  return result?.ok ? unitPriceSpoken(result, price.currency, locale, m) : null;
}
