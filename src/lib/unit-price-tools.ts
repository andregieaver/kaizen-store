/**
 * What the AI manager says about unit prices (D160, `docs/wave-1d-unit-price.md` 2.2 and 5.5): the words of
 * `unit_price_gaps` and of `get_product`'s per-market figures. No I/O. The figures are `unitPriceShown()`'s and
 * arrive here already worked out; nothing is computed in this file, so the model repeats what it is given and
 * adds no arithmetic. English, because the manager talks to the owner.
 */
import type { Messages } from "./i18n";
import { measureText, type ShownMeasure, type UnitPriceReason, type UnitPriceResult, type UnitPriceShown } from "./unit-price";
import { unitPriceText } from "./unit-price-text";

type Words = Pick<Messages, "unitPrice">;

const UNIT_WORDS: Record<ShownMeasure["unit"], string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  cl: "cl",
  l: "l",
  cm: "cm",
  m: "m",
  m2: "m²",
  piece: "pieces",
};

/** What is in a pack, as the owner reads it: "250 g", "0.75 l", "6 pieces". */
export function contentWords(measure: ShownMeasure): string {
  return `${measureText(measure)} ${UNIT_WORDS[measure.unit]}`;
}

/** Why a figure is not shown, in the owner's words (the reasons of `unitPrice()`). */
const REASON_WORDS: Record<UnitPriceReason, string> = {
  family: "the content's unit does not fit what it is compared per",
  free: "the price is 0",
  same_as_price: "the content is the same as what it is compared per, so the price already is the unit price",
  rounds_to_zero: "the figure would round to nothing",
  too_large: "the figure is too large to show",
  invalid: "the content cannot be read",
};

export const reasonWords = (reason: UnitPriceReason): string => REASON_WORDS[reason];

/** One unit price figure written ("199,60 kr/kg") or why it is not shown. */
function say(result: UnitPriceResult, currency: string, locale: string, m: Words): { text: string } | { not_shown: string } {
  return result.ok ? { text: unitPriceText(result, currency, locale, m) } : { not_shown: reasonWords(result.reason) };
}

export type UnitPriceAnswer = {
  /** "199,60 kr/kg" with VAT: the figure a private buyer sees. Absent when the store shows prices without VAT only. */
  with_vat?: string;
  /** The same without VAT: what a business buyer sees. Absent when the store shows prices with VAT only. */
  without_vat?: string;
  /** Why no figure is shown in this market, when none is. */
  not_shown?: string;
};

/**
 * A market's unit price as the shop shows it (`unitPriceShown()`'s result), in the market's own currency, or null for
 * a variant without content. When the figure cannot be shown (for example it equals the price) `not_shown` says why.
 */
export function unitPriceAnswer(shown: UnitPriceShown | null, currency: string, locale: string, m: Words): UnitPriceAnswer | null {
  if (!shown) return null;
  const out: UnitPriceAnswer = {};
  const reasons: string[] = [];
  for (const [key, result] of [["with_vat", shown.incl], ["without_vat", shown.excl]] as const) {
    if (!result) continue;
    const said = say(result, currency, locale, m);
    if ("text" in said) out[key] = said.text;
    else reasons.push(said.not_shown);
  }
  if (!out.with_vat && !out.without_vat && reasons.length > 0) out.not_shown = [...new Set(reasons)].join("; ");
  return out;
}
