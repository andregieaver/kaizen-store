/**
 * A product as the WordPress plugin draws it (D169), pure: the price written out in the market's language and currency exactly as the
 * storefront's `<Price>` shows it (VAT as the store shows it, the 30-day reference only for a genuine reduction, the unit price from
 * `unitPriceShown()`), so the plugin never works out a price, a rate or a label of its own.
 */
import { withoutVat } from "./b2b";
import type { Messages } from "./i18n";
import { formatMoney } from "./money";
import type { PriceView } from "./pricing";
import { unitPriceShown } from "./unit-price";
import { unitLabelsOf, unitPriceWords } from "./unit-price-text";

export type WordpressPrice = {
  /** The amount as the store shows it: "kr 199,00". For a store that shows both, the price with VAT. */
  text: string;
  /** "inkl. mva." or "ekskl. mva.", in the market's language. */
  vat_label: string;
  /** "From" (in the market's language) when the variants differ in price and this is the lowest; otherwise null. */
  from_label: string | null;
  /** "Lowest price in the last 30 days" and the price, only for a genuine reduction. */
  prior_label: string | null;
  prior_text: string | null;
  /** "199,60 kr/kg" when the product has a content to compare by, else null. */
  unit_text: string | null;
  /** The amount in minor units and the currency, for a theme that wants to format it itself. */
  amount_minor: number;
  currency: string;
};

type Words = Pick<Messages, "vatIncluded" | "vatExcluded" | "fromPrice" | "priorPrice" | "unitPrice">;

/** A price written out. `price.vat.shown` `excl` shows without VAT; `incl` and `choice` (a store selling to both) with it. */
export function wordpressPrice(price: PriceView, from: boolean, locale: string, m: Words): WordpressPrice {
  const excl = price.vat.shown === "excl";
  const amount = (minor: number) => (excl ? withoutVat(minor, price.vat.rate) : minor);
  const shownMinor = amount(price.amountMinor);
  let unit_text: string | null = null;
  if (price.measure) {
    const shown = unitPriceShown(price.amountMinor, price.vat, price.measure, price.measure.base);
    const result = excl ? shown.excl : shown.incl;
    if (result?.ok) unit_text = unitPriceWords(result, price.currency, locale, unitLabelsOf(m)).text;
  }
  return {
    text: formatMoney(shownMinor, price.currency, locale),
    vat_label: excl ? m.vatExcluded : m.vatIncluded,
    from_label: from ? m.fromPrice : null,
    prior_label: price.referenceMinor !== null ? m.priorPrice : null,
    prior_text: price.referenceMinor !== null ? formatMoney(amount(price.referenceMinor), price.currency, locale) : null,
    unit_text,
    amount_minor: shownMinor,
    currency: price.currency,
  };
}
