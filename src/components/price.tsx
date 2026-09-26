import { withoutVat } from "@/lib/b2b";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { PriceVat, PriceView } from "@/lib/pricing";

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
    </div>
  );
}
