import { hint } from "@/components/admin/data/ui";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";
import { unitPrice } from "@/lib/unit-price";
import type { DraftProblemWords } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import type { DraftSummary } from "@/server/draft-orders";

const percent = (rate: number): string => `${(Math.round(rate * 10000) / 100).toLocaleString("en", { maximumFractionDigits: 2 })} %`;

/**
 * The summary beside the draft editor (wave 3, D173, `docs/wave-3-orders.md` 2.4): what the draft totals, worked out by the SERVER from what it saved (`previewDraft()`, the same pricing the send uses),
 * never in the browser. The lines with the price charged and the share of the staff discount, the shipping, the VAT per rate, the total, the price per kg or litre where the variant has a content (D160), and the
 * problems in words: the blocking ones stop a send, the notes (a backorder, a changed price) only tell. `state` says whether the figures are of what is on the screen.
 */
export function DraftSummaryPanel({
  summary,
  problems,
  currency,
  locale,
  state,
}: {
  summary: DraftSummary | null;
  problems: DraftProblemWords[];
  currency: string;
  locale: string;
  /** `fresh`: these are the saved draft's figures; `stale`: there are changes not yet saved; `working`: being saved. */
  state: "fresh" | "stale" | "working";
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const bases = t("en").unitPrice.bases;
  const blocking = problems.filter((p) => p.blocking);
  const notes = problems.filter((p) => !p.blocking);
  return (
    <section aria-labelledby="draft-summary" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm" aria-busy={state === "working"}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="draft-summary" className="font-medium">
          Summary
        </h2>
        <span className={hint} aria-live="polite">
          {state === "working" ? "Calculating …" : state === "stale" ? "Save to update" : "Worked out by the checkout's rules"}
        </span>
      </div>

      {blocking.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-border bg-background p-3 text-red-700 dark:text-red-400">
          {blocking.map((p, i) => (
            <li key={`${p.code}-${p.key ?? i}`}>{p.text}</li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul role="status" className="flex flex-col gap-1 text-muted">
          {notes.map((p, i) => (
            <li key={`${p.code}-${p.key ?? i}`}>{p.text}</li>
          ))}
        </ul>
      )}

      {!summary ? (
        <p className="text-muted">Add a line to see the totals.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {summary.lines.map((line) => {
              const per = line.measure ? unitPrice(line.unitPriceMinor, { amount: line.measure.amount, unit: line.measure.unit }, line.measure.base) : null;
              return (
                <li key={line.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words">{line.title}</p>
                    <p className="text-xs text-muted">
                      {line.quantity} × {money(line.unitPriceMinor)}
                      {line.customPrice && line.listPriceMinor !== null && ` (custom price, list ${money(line.listPriceMinor)})`}
                      {line.customPrice && line.listPriceMinor === null && " (custom item)"}
                      {per?.ok && ` · ${money(per.minor)}/${bases[per.base]}`}
                    </p>
                    {line.staffDiscountMinor > 0 && <p className="text-xs text-muted">Discount −{money(line.staffDiscountMinor)}</p>}
                    {line.backorder && (
                      <p className="text-xs font-medium">
                        Backorder: {line.backorder.units} {line.backorder.units === 1 ? "unit" : "units"}, shipped within {line.backorder.days} {line.backorder.days === 1 ? "day" : "days"}
                      </p>
                    )}
                    {line.currentListMinor !== null && <p className="text-xs font-medium">The list price is now {money(line.currentListMinor)}: save the line again to take it.</p>}
                  </div>
                  <span className="shrink-0 tabular-nums">{money(line.totalMinor)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="flex flex-col gap-1 border-t border-border pt-2">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(summary.subtotalMinor)}</dd>
            </div>
            {summary.staffDiscountMinor > 0 && (
              <div className="flex justify-between">
                <dt>
                  {summary.staffDiscountLabel ?? "Discount"} <span className="text-xs text-muted">(the buyer sees this)</span>
                </dt>
                <dd className="tabular-nums">−{money(summary.staffDiscountMinor)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd className="tabular-nums">{summary.shippingMinor === 0 ? "Free" : money(summary.shippingMinor)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(summary.totalMinor)}</dd>
            </div>
            {summary.vatPerRate.map((v) => (
              <div key={v.rate} className="flex justify-between text-muted">
                <dt>VAT included, {percent(v.rate)}</dt>
                <dd className="tabular-nums">{money(v.taxMinor)}</dd>
              </div>
            ))}
            {summary.vatPerRate.length === 0 && (
              <div className="flex justify-between text-muted">
                <dt>VAT included</dt>
                <dd className="tabular-nums">{money(summary.taxMinor)}</dd>
              </div>
            )}
          </dl>
          <p className={hint}>
            Prices include VAT. Campaigns, discount codes, bonus credits and VAT-number checks do not apply to a draft: the price and the discount are the ones you set.
          </p>
        </>
      )}
    </section>
  );
}
