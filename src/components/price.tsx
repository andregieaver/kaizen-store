import { withoutVat } from "@/lib/b2b";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { PriceVat, PriceView } from "@/lib/pricing";
import { unitPrice, unitPriceShown, type ShownMeasure, type UnitPriceResult } from "@/lib/unit-price";
import { unitLabelsOf, unitPriceWords, type UnitLabels } from "@/lib/unit-price-text";

export type VatLabels = { vatIncluded: string; vatExcluded: string };

/**
 * An amount kept with VAT, as the store shows it (B2B): with VAT, without,
 * or both, with the page's first script showing the one for the shopper's
 * kind (`for-private`, `for-business` in globals.css).
 */
export function VatAmount({
  amountMinor,
  currency,
  locale,
  vat,
  labels,
  label = true,
}: {
  amountMinor: number;
  currency: string;
  locale: string;
  vat: PriceVat;
  labels: VatLabels;
  /** Whether to say "incl. VAT" or "excl. VAT" after it. */
  label?: boolean;
}) {
  const shown = (excl: boolean) => (
    <>
      {formatMoney(excl ? withoutVat(amountMinor, vat.rate) : amountMinor, currency, locale)}
      {label && (
        <>
          {" "}
          <span className="text-sm font-normal text-muted">{excl ? labels.vatExcluded : labels.vatIncluded}</span>
        </>
      )}
    </>
  );
  if (vat.shown !== "choice") return shown(vat.shown === "excl");
  return (
    <>
      <span className="for-private">{shown(false)}</span>
      <span className="for-business">{shown(true)}</span>
    </>
  );
}

/** One unit price, drawn for the eye and said for a screen reader (D160): "199,60 kr/kg", "Unit price: 199,60 kr per kg". */
function UnitFigure({ result, currency, locale, labels }: { result: UnitPriceResult | undefined; currency: string; locale: string; labels: UnitLabels }) {
  if (!result?.ok) return null;
  const words = unitPriceWords(result, currency, locale, labels);
  return (
    <>
      <span aria-hidden="true">{words.text}</span>
      <span className="sr-only">{words.spoken}</span>
    </>
  );
}

/**
 * The price per kg, litre, metre, m² or piece under a price (D160), worked out by `unitPrice()` from the price as this
 * surface shows it: with VAT, without it (netted and rounded first), or both for a store selling to both, inside
 * `for-private` / `for-business` like `VatAmount`. It says nothing about VAT itself (the price above does), and
 * nothing at all when there is no content or the figure cannot be stated (equal to the price, free). `amountMinor` is
 * the price charged, never the 30-day reference.
 */
export function UnitLine({
  amountMinor,
  currency,
  locale,
  vat,
  measure,
  labels,
  inline = false,
}: {
  amountMinor: number;
  currency: string;
  locale: string;
  vat: PriceVat;
  measure: ShownMeasure | null;
  labels: UnitLabels;
  /** Drawn as a block of its own inside inline content (a link, a card), so no paragraph. */
  inline?: boolean;
}) {
  if (!measure) return null;
  const Wrapper = inline ? "span" : "p";
  const className = inline ? "block text-xs text-muted" : "text-sm text-muted";
  const shown = unitPriceShown(amountMinor, vat, measure, measure.base);
  const figure = (result: UnitPriceResult | undefined) => <UnitFigure result={result} currency={currency} locale={locale} labels={labels} />;
  if (vat.shown === "choice") {
    if (!shown.incl?.ok && !shown.excl?.ok) return null;
    return (
      <Wrapper className={className} data-unit-price="">
        <span className="for-private">{figure(shown.incl)}</span>
        <span className="for-business">{figure(shown.excl)}</span>
      </Wrapper>
    );
  }
  const only = vat.shown === "excl" ? shown.excl : shown.incl;
  if (!only?.ok) return null;
  return (
    <Wrapper className={className} data-unit-price="">
      {figure(only)}
    </Wrapper>
  );
}

/**
 * A line's unit price in the cart, at checkout, on the order page and in a list (D160): `shownMinor` is one unit's price
 * as that line shows it (without VAT for a business buyer there), `measure` what was in it. It does not depend on the
 * quantity. Nothing for no content, a gift or a free line.
 */
export function LineUnitPrice({
  shownMinor,
  measure,
  gift = false,
  currency,
  locale,
  m,
}: {
  shownMinor: number | null;
  measure: ShownMeasure | null;
  gift?: boolean;
  currency: string;
  locale: string;
  m: Pick<Messages, "unitPrice">;
}) {
  if (!measure || gift || shownMinor === null) return null;
  const result = unitPrice(shownMinor, measure, measure.base);
  if (!result.ok) return null;
  return (
    <span className="block text-sm text-muted" data-unit-price="">
      <UnitFigure result={result} currency={currency} locale={locale} labels={unitLabelsOf(m)} />
    </span>
  );
}

/**
 * A price, with or without VAT as the store shows it. When the price is a
 * genuine reduction, the lowest price of the previous 30 days is shown
 * beside it, as the law requires.
 */
export function Price({
  price,
  locale,
  m,
  from = false,
  large = false,
}: {
  price: PriceView;
  locale: string;
  m: Messages;
  from?: boolean;
  large?: boolean;
}) {
  return (
    <div>
      <p className={large ? "text-2xl font-semibold" : "font-semibold"}>
        {from && <span className="font-normal">{m.fromPrice} </span>}
        <VatAmount amountMinor={price.amountMinor} currency={price.currency} locale={locale} vat={price.vat} labels={m} />
      </p>
      {price.referenceMinor !== null && (
        <p className="text-sm text-muted">
          {m.priorPrice}:{" "}
          <VatAmount
            amountMinor={price.referenceMinor}
            currency={price.currency}
            locale={locale}
            vat={price.vat}
            labels={m}
            label={false}
          />
        </p>
      )}
      <UnitLine
        amountMinor={price.amountMinor}
        currency={price.currency}
        locale={locale}
        vat={price.vat}
        measure={price.measure}
        labels={unitLabelsOf(m)}
      />
    </div>
  );
}
