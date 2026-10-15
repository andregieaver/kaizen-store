import { exchangeProblemText } from "@/lib/exchange";
import { formatMoney } from "@/lib/money";
import { outcomeSentence, WORKING_LABELS } from "@/lib/return-admin";
import type { ExchangePreview } from "@/server/exchanges";

const STOCK_WORDS = {
  in_stock: "In stock",
  backorder: "Would be backordered",
  short: "Not enough stock: it would stop at zero",
} as const;

/**
 * The server's summary of an exchange (wave 3, D239, `docs/wave-3-exchanges.md` 2.2), drawn from `previewExchange()` alone: the credit `C` with `refundFor()`'s working,
 * the replacements priced, the total `T`, VAT per rate, the outcome (refund due, even, payment to collect), what each replacement's stock would do (nothing is held
 * yet) and the documents it will make. Every amount is the server's, written by `formatMoney` in the order's currency.
 */
export function ExchangeSummary({ preview, locale = "en-GB", working = false }: { preview: ExchangePreview; locale?: string; working?: boolean }) {
  const money = (minor: number) => formatMoney(minor, preview.currency, locale);
  const credit = preview.credit;
  return (
    <section aria-label="Summary of the exchange" aria-busy={working} className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4 text-sm">
      {credit && (
        <div className="flex flex-col gap-1">
          <h3 className="text-body-strong text-ink">The customer&apos;s credit</h3>
          <table className="w-full text-left">
            <tbody>
              {credit.working.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="py-0.5 pr-3 font-normal">
                    {WORKING_LABELS[row.key]}
                  </th>
                  <td className="py-0.5 text-right tabular-nums">{row.amountMinor < 0 ? `−${money(-row.amountMinor)}` : money(row.amountMinor)}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <th scope="row" className="pt-1 pr-3 font-medium">
                  Credit
                </th>
                <td className="pt-1 text-right font-medium tabular-nums">{money(credit.amountMinor)}</td>
              </tr>
            </tbody>
          </table>
          {!credit.final && <p className="text-xs text-muted">The credit can still change: the inspection has not been recorded.</p>}
        </div>
      )}

      {preview.lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-body-strong text-ink">What the customer gets</h3>
          <ul className="flex flex-col gap-1">
            {preview.lines.map((line, i) => (
              <li key={`${line.variantId}-${i}`} className="flex flex-col">
                <span className="flex justify-between gap-3">
                  <span>
                    {line.quantity} × {line.title || line.sku}
                  </span>
                  <span className="tabular-nums">{money(line.totalMinor)}</span>
                </span>
                <span className={`text-xs ${line.stock.state === "short" ? "text-warning-text" : "text-muted"}`}>
                  {STOCK_WORDS[line.stock.state]}
                  {line.stock.state === "backorder" && line.stock.backorderDays ? ` (about ${line.stock.backorderDays} days)` : ""}
                  {line.listPriceMinor !== null && line.unitPriceMinor < line.listPriceMinor ? ` · ${money(line.unitPriceMinor)} each, lowered from ${money(line.listPriceMinor)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
            <div className="flex justify-between gap-3">
              <dt>Shipping</dt>
              <dd className="tabular-nums">{preview.shippingMinor === 0 ? "Free" : money(preview.shippingMinor)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-medium">
              <dt>Replacements in all</dt>
              <dd className="tabular-nums">{money(preview.totalMinor)}</dd>
            </div>
            {preview.vatPerRate.map((r) => (
              <div key={r.rate} className="flex justify-between gap-3 text-xs text-muted">
                <dt>VAT {Math.round(r.rate * 10000) / 100} % included</dt>
                <dd className="tabular-nums">{money(r.taxMinor)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {preview.outcome && preview.lines.length > 0 && (
        <p className="text-body-strong text-ink" role="status">
          {outcomeSentence(preview.outcome, preview.currency, locale)}
        </p>
      )}
      {preview.lines.length > 0 && <p className="text-xs text-muted">Documents: a credit note for the returned items on the original order, and an invoice for the new order.</p>}

      {(preview.block || preview.problems.length > 0) && (
        <ul className="list-disc pl-5 text-danger-text">
          {preview.block && <li>{exchangeProblemText(preview.block)}</li>}
          {preview.problems
            .filter((p) => !(preview.lines.length === 0 && p.code === "no_lines"))
            .map((p, i) => (
              <li key={`${p.code}-${i}`}>{exchangeProblemText(p.code)}</li>
            ))}
        </ul>
      )}
    </section>
  );
}
