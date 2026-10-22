import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { formatMoney } from "@/lib/money";
import { outcomeSentence } from "@/lib/return-admin";
import type { ExchangePreview } from "@/server/exchanges";

/**
 * The server's summary of an exchange (wave 3, D239, `docs/wave-3-exchanges.md` 2.2), drawn from `previewExchange()` alone: the credit `C` with `refundFor()`'s working,
 * the replacements priced, the total `T`, VAT per rate, the outcome (refund due, even, payment to collect), what each replacement's stock would do (nothing is held
 * yet) and the documents it will make. Every amount is the server's, written by `formatMoney` in the order's currency.
 */
export function ExchangeSummary({ preview, locale = "en-GB", working = false }: { preview: ExchangePreview; locale?: string; working?: boolean }) {
  const money = (minor: number) => formatMoney(minor, preview.currency, locale);
  const credit = preview.credit;
  const w = useAdminText("returns");
  const x = w.exchange;
  return (
    <section aria-label={x.summary} aria-busy={working} className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4 text-sm">
      {credit && (
        <div className="flex flex-col gap-1">
          <h3 className="text-body-strong text-ink">{x.customerCredit}</h3>
          <table className="w-full text-left">
            <tbody>
              {credit.working.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="py-0.5 pr-3 font-normal">
                    {w.labels.working[row.key]}
                  </th>
                  <td className="py-0.5 text-right tabular-nums">{row.amountMinor < 0 ? `−${money(-row.amountMinor)}` : money(row.amountMinor)}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <th scope="row" className="pt-1 pr-3 font-medium">
                  {x.credit}
                </th>
                <td className="pt-1 text-right font-medium tabular-nums">{money(credit.amountMinor)}</td>
              </tr>
            </tbody>
          </table>
          {!credit.final && <p className="text-xs text-muted">{x.creditMayChange}</p>}
        </div>
      )}

      {preview.lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-body-strong text-ink">{x.customerGets}</h3>
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
                  {x.stock[line.stock.state]}
                  {line.stock.state === "backorder" && line.stock.backorderDays ? fillWords(x.aboutDays, { n: line.stock.backorderDays }) : ""}
                  {line.listPriceMinor !== null && line.unitPriceMinor < line.listPriceMinor ? fillWords(x.eachLowered, { price: money(line.unitPriceMinor), list: money(line.listPriceMinor) }) : ""}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
            <div className="flex justify-between gap-3">
              <dt>{x.shipping}</dt>
              <dd className="tabular-nums">{preview.shippingMinor === 0 ? x.free : money(preview.shippingMinor)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-medium">
              <dt>{x.allReplacements}</dt>
              <dd className="tabular-nums">{money(preview.totalMinor)}</dd>
            </div>
            {preview.vatPerRate.map((r) => (
              <div key={r.rate} className="flex justify-between gap-3 text-xs text-muted">
                <dt>{fillWords(x.vatIncluded, { rate: (Math.round(r.rate * 10000) / 100).toLocaleString(locale) })}</dt>
                <dd className="tabular-nums">{money(r.taxMinor)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {preview.outcome && preview.lines.length > 0 && (
        <p className="text-body-strong text-ink" role="status">
          {outcomeSentence(preview.outcome, preview.currency, locale, w)}
        </p>
      )}
      {preview.lines.length > 0 && <p className="text-xs text-muted">{x.documents}</p>}

      {(preview.block || preview.problems.length > 0) && (
        <ul className="list-disc pl-5 text-danger-text">
          {preview.block && <li>{w.labels.exchangeProblems[preview.block]}</li>}
          {preview.problems
            .filter((p) => !(preview.lines.length === 0 && p.code === "no_lines"))
            .map((p, i) => (
              <li key={`${p.code}-${i}`}>{w.labels.exchangeProblems[p.code]}</li>
            ))}
        </ul>
      )}
    </section>
  );
}
