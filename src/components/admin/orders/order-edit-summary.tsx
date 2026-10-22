import { hint } from "@/components/admin/data/ui";
import { formatMoney } from "@/lib/money";
import type { OrderTotals } from "@/lib/order-edit";
import { documentsSentence, moneySentence } from "@/lib/order-edit";
import { ratePercent, type EditSummaryView } from "@/lib/order-edit-view";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/drafts-words";

/**
 * The summary beside the order editor (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the SERVER's preview of the change (`previewOrderEdit()`, the same function
 * the apply uses), never worked out in the browser. What is taken off and added with their totals, the order's subtotal, discount, shipping, VAT and total before and after,
 * the VAT each rate moves by, the difference and what happens with it, the documents the change issues, and the problems in words. `state` says whether the figures are of
 * what is on the screen. In the account's language (the `drafts` catalogue).
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
  const lang = useAdminLang();
  const all = useAdminText("drafts").edit;
  const w = all.summary;
  const rate = (r: number) => ratePercent(r, lang === "en" ? "en" : ADMIN_LANG_FACTS[lang].locale);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  // The server writes the money and documents sentences in English; another language says them again from the same facts.
  const sentences =
    summary && lang !== "en"
      ? {
          money: moneySentence(summary.money, money(Math.abs(summary.differenceMinor)), summary.outside, all.sentences),
          documents: summary.documentFacts ? documentsSentence(summary.documentFacts, all.sentences) : summary.sentences.documents,
        }
      : summary?.sentences;
  const problems = [...formProblems.map((text, i) => ({ code: "form", key: String(i), text })), ...(summary?.problems ?? [])].filter((p) => p.code !== "no_change");
  const unchanged = summary?.problems.some((p) => p.code === "no_change") ?? true;
  return (
    <section aria-labelledby="edit-summary" aria-busy={state === "working"} className="flex flex-col gap-3 rounded-panel bg-sunken p-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="edit-summary" className="text-title text-ink">
          {w.title}
        </h2>
        <span className={hint} aria-live="polite">
          {state === "working" ? w.calculating : w.rules}
        </span>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-line bg-card p-3 text-danger-text">
          {problems.map((p, i) => (
            <li key={`${p.code}-${p.key ?? i}`}>{p.text}</li>
          ))}
        </ul>
      )}
      {!summary || !summary.before || !summary.after ? (
        <p className="text-muted">{w.empty}</p>
      ) : (
        <>
          {unchanged && summary.takenOff.length === 0 && summary.added.length === 0 && summary.differenceMinor === 0 && <p className="text-muted">{w.unchanged}</p>}
          {summary.takenOff.length + summary.added.length > 0 && (
            <ul className="flex flex-col divide-y divide-line" aria-label={w.whatChanges}>
              {[...summary.takenOff, ...summary.added].map((line) => (
                <li key={line.n} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words">
                      <span className="text-xs font-medium text-muted">{w.kinds[line.kind]}:</span> {line.title}
                    </p>
                    <p className="text-xs text-muted">
                      {line.quantity} × {money(line.unitPriceMinor)}
                      {line.kind === "add" && line.custom && line.listPriceMinor !== null && fillWords(w.customPrice, { price: money(line.listPriceMinor) })}
                      {fillWords(w.vat, { rate: rate(line.taxRate) })}
                    </p>
                    {line.backorder && (
                      <p className="text-xs font-medium">
                        {fillWords(w.backorder, { units: countWords(line.backorder.units, w.units) })}
                        {line.backorder.days ? fillWords(w.backorderDays, { days: countWords(line.backorder.days, w.days) }) : ""}
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
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-1 font-normal" />
                <th scope="col" className="py-1 text-right font-normal">
                  {w.before}
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  {w.after}
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [w.subtotal, "subtotalMinor"],
                  [w.discounts, "discountMinor"],
                  [w.shipping, "shippingMinor"],
                  [w.vatIncluded, "taxMinor"],
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
              <tr className="border-t border-line font-medium">
                <th scope="row" className="py-1">
                  {w.total}
                </th>
                <td className="py-1 text-right tabular-nums">{money(summary.before.totalMinor)}</td>
                <td className="py-1 text-right tabular-nums">{money(summary.after.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          {(summary.vatChanges.length > 0 || summary.shippingVatDeltaMinor !== 0) && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted" aria-label={w.vatChanges}>
              {summary.vatChanges.map((v) => (
                <li key={v.rate}>
                  {fillWords(w.vatAt, { rate: rate(v.rate) })}{v.deltaMinor > 0 ? "+" : "−"}
                  {money(Math.abs(v.deltaMinor))}
                </li>
              ))}
              {summary.shippingVatDeltaMinor !== 0 && (
                <li>
                  {w.vatShipping}{summary.shippingVatDeltaMinor > 0 ? "+" : "−"}
                  {money(Math.abs(summary.shippingVatDeltaMinor))}
                </li>
              )}
            </ul>
          )}
          <div className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <p className="flex justify-between gap-3 font-medium">
              <span>{w.difference}</span>
              <span className="tabular-nums">
                {summary.differenceMinor > 0 ? "+" : summary.differenceMinor < 0 ? "−" : ""}
                {money(Math.abs(summary.differenceMinor))}
              </span>
            </p>
            <p>{sentences?.money}</p>
            <p className="text-muted">{sentences?.documents}</p>
          </div>
          <p className={hint}>{w.hint}</p>
        </>
      )}
    </section>
  );
}
