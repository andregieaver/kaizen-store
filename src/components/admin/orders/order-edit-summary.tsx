import { hint } from "@/components/admin/data/ui";
import { formatMoney } from "@/lib/money";
import type { OrderTotals } from "@/lib/order-edit";
import { ratePercent, type EditSummaryLine, type EditSummaryView } from "@/lib/order-edit-view";

const KIND_WORDS: Record<EditSummaryLine["kind"], string> = { remove: "Taken off", reduce: "Fewer", add: "Added" };

/**
 * The summary beside the order editor (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the SERVER's preview of the change (`previewOrderEdit()`, the same function
 * the apply uses), never worked out in the browser. What is taken off and added with their totals, the order's subtotal, discount, shipping, VAT and total before and after,
 * the VAT each rate moves by, the difference and what happens with it, the documents the change issues, and the problems in words. `state` says whether the figures are of
 * what is on the screen. English: the admin.
 */
export function OrderEditSummary({
  summary,
  currency,
  locale,
  state,
  formProblems = [],
}: {
  summary: EditSummaryView | null;
  /** The order's own currency: every amount of a change is in it. */
  currency: string;
  locale: string;
  state: "fresh" | "working";
  formProblems?: string[];
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const problems = [...formProblems.map((text, i) => ({ code: "form", key: String(i), text })), ...(summary?.problems ?? [])].filter((p) => p.code !== "no_change");
  const unchanged = summary?.problems.some((p) => p.code === "no_change") ?? true;
  return (
    <section aria-labelledby="edit-summary" aria-busy={state === "working"} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="edit-summary" className="font-medium">
          Summary
        </h2>
        <span className={hint} aria-live="polite">
          {state === "working" ? "Calculating …" : "Worked out by the checkout's rules"}
        </span>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-border bg-background p-3 text-red-700 dark:text-red-400">
          {problems.map((p, i) => (
            <li key={`${p.code}-${p.key ?? i}`}>{p.text}</li>
          ))}
        </ul>
      )}
      {!summary || !summary.before || !summary.after ? (
        <p className="text-muted">Change a quantity or add a product to see what the change does.</p>
      ) : (
        <>
          {unchanged && summary.takenOff.length === 0 && summary.added.length === 0 && summary.differenceMinor === 0 && <p className="text-muted">Nothing is changed yet.</p>}
          {summary.takenOff.length + summary.added.length > 0 && (
            <ul className="flex flex-col divide-y divide-border" aria-label="What changes">
              {[...summary.takenOff, ...summary.added].map((line) => (
                <li key={line.n} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words">
                      <span className="text-xs font-medium text-muted">{KIND_WORDS[line.kind]}:</span> {line.title}
                    </p>
                    <p className="text-xs text-muted">
                      {line.quantity} × {money(line.unitPriceMinor)}
                      {line.kind === "add" && line.custom && line.listPriceMinor !== null && ` (custom price, list ${money(line.listPriceMinor)})`}
                      {` · VAT ${ratePercent(line.taxRate)}`}
                    </p>
                    {line.backorder && (
                      <p className="text-xs font-medium">
                        On backorder: {line.backorder.units} {line.backorder.units === 1 ? "unit" : "units"}
                        {line.backorder.days ? `, shipped within ${line.backorder.days} ${line.backorder.days === 1 ? "day" : "days"}` : ""}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {line.kind === "add" ? "" : "−"}
                    {money(line.totalMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <table className="w-full text-left">
            <caption className="sr-only">The order before and after the change</caption>
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th scope="col" className="py-1 font-normal" />
                <th scope="col" className="py-1 text-right font-normal">
                  Before
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Subtotal", "subtotalMinor"],
                  ["Discounts", "discountMinor"],
                  ["Shipping", "shippingMinor"],
                  ["VAT included", "taxMinor"],
                ] as [string, keyof OrderTotals][]
              ).map(([label, key]) => (
                <tr key={key}>
                  <th scope="row" className="py-1 font-normal">
                    {label}
                  </th>
                  <td className="py-1 text-right tabular-nums">{key === "discountMinor" && summary.before![key] > 0 ? `−${money(summary.before![key])}` : money(summary.before![key])}</td>
                  <td className="py-1 text-right tabular-nums">{key === "discountMinor" && summary.after![key] > 0 ? `−${money(summary.after![key])}` : money(summary.after![key])}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <th scope="row" className="py-1">
                  Total
                </th>
                <td className="py-1 text-right tabular-nums">{money(summary.before.totalMinor)}</td>
                <td className="py-1 text-right tabular-nums">{money(summary.after.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          {(summary.vatChanges.length > 0 || summary.shippingVatDeltaMinor !== 0) && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted" aria-label="How the VAT changes">
              {summary.vatChanges.map((v) => (
                <li key={v.rate}>
                  VAT at {ratePercent(v.rate)}: {v.deltaMinor > 0 ? "+" : "−"}
                  {money(Math.abs(v.deltaMinor))}
                </li>
              ))}
              {summary.shippingVatDeltaMinor !== 0 && (
                <li>
                  VAT on shipping: {summary.shippingVatDeltaMinor > 0 ? "+" : "−"}
                  {money(Math.abs(summary.shippingVatDeltaMinor))}
                </li>
              )}
            </ul>
          )}
          <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-3">
            <p className="flex justify-between gap-3 font-medium">
              <span>Difference</span>
              <span className="tabular-nums">
                {summary.differenceMinor > 0 ? "+" : summary.differenceMinor < 0 ? "−" : ""}
                {money(Math.abs(summary.differenceMinor))}
              </span>
            </p>
            <p>{summary.sentences.money}</p>
            <p className="text-muted">{summary.sentences.documents}</p>
          </div>
          <p className={hint}>
            Items kept keep the price and discounts they were sold with. Added products are priced at the market&apos;s price (or the price you type) with no campaign, code, group discount or
            credits, and VAT by the checkout&apos;s own rules.
          </p>
        </>
      )}
    </section>
  );
}
