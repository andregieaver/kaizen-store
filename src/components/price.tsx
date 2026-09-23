import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { PriceView } from "@/lib/pricing";

/**
 * A VAT-inclusive price. When the price is a genuine reduction, the lowest
 * price of the previous 30 days is shown beside it, as the law requires.
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
        {formatMoney(price.amountMinor, price.currency, locale)}{" "}
        <span className="text-sm font-normal text-muted">{m.vatIncluded}</span>
      </p>
      {price.referenceMinor !== null && (
        <p className="text-sm text-muted">
          {m.priorPrice}: {formatMoney(price.referenceMinor, price.currency, locale)}
        </p>
      )}
    </div>
  );
}
