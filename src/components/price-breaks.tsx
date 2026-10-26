import type { Messages } from "@/lib/i18n";
import type { BreakStep } from "@/lib/price-breaks";
import type { PriceView } from "@/lib/pricing";

import { VatAmount } from "./price";

/**
 * A variant's price breaks on its product page (wave 6 unit E2, D323): from how many, the price each, as the cart charges it (`priceBreaksFor()`).
 * A price at a quantity, never a reduction (decision 3): no struck-through price and no 30-day reference. Amounts are in the market's view
 * (`shown()`), with the store's VAT display.
 */
export function PriceBreakTable({ steps, price, locale, m }: { steps: BreakStep[]; price: Pick<PriceView, "currency" | "vat">; locale: string; m: Messages }) {
  return (
    <table className="w-full text-sm">
      <caption className="pb-1 text-left font-medium">{m.priceBreaks.title}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{m.priceBreaks.quantity}</th>
          <th scope="col">{m.priceBreaks.each}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {steps.map((step) => (
          <tr key={step.from}>
            <th scope="row" className="py-1 pr-4 text-left font-normal">
              {m.priceBreaks.from(step.from)}
            </th>
            <td className="py-1 text-right">
              <VatAmount amountMinor={step.amountMinor} currency={price.currency} locale={locale} vat={price.vat} labels={m} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
