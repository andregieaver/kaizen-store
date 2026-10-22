import { hint } from "@/components/admin/data/ui";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";
import { unitPrice } from "@/lib/unit-price";
import type { DraftProblemWords } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import type { DraftSummary } from "@/server/draft-orders";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/drafts-words";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";

const percent = (rate: number, lang: string = "en"): string => `${(Math.round(rate * 10000) / 100).toLocaleString(lang, { maximumFractionDigits: 2 })} %`;

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
  const lang = useAdminLang();
  const w = useAdminText("drafts").summary;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const bases = t(lang).unitPrice.bases;
  const blocking = problems.filter((p) => p.blocking);
  const notes = problems.filter((p) => !p.blocking);
  return (
    <section aria-labelledby="draft-summary" className="flex flex-col gap-3 rounded-panel bg-sunken p-4 text-sm" aria-busy={state === "working"}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="draft-summary" className="text-title text-ink">
          {w.title}
        </h2>
        <span className={hint} aria-live="polite">
          {state === "working" ? w.calculating : state === "stale" ? w.saveToUpdate : w.rules}
        </span>
      </div>

      {blocking.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-line bg-card p-3 text-danger-text">
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
        <p className="text-muted">{w.addLine}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {summary.lines.map((line) => {
              const per = line.measure ? unitPrice(line.unitPriceMinor, { amount: line.measure.amount, unit: line.measure.unit }, line.measure.base) : null;
              return (
                <li key={line.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words">{line.title}</p>
                    <p className="text-xs text-muted">
                      {line.quantity} × {money(line.unitPriceMinor)}
                      {line.customPrice && line.listPriceMinor !== null && fillWords(w.customPrice, { price: money(line.listPriceMinor) })}
                      {line.customPrice && line.listPriceMinor === null && w.customItem}
                      {per?.ok && ` · ${money(per.minor)}/${bases[per.base]}`}
                    </p>
                    {line.staffDiscountMinor > 0 && <p className="text-xs text-muted">{fillWords(w.discount, { amount: money(line.staffDiscountMinor) })}</p>}
                    {line.backorder && (
                      <p className="text-xs font-medium">
                        {fillWords(w.backorder, { units: countWords(line.backorder.units, w.units), days: countWords(line.backorder.days, w.days) })}
                      </p>
                    )}
                    {line.currentListMinor !== null && <p className="text-xs font-medium">{fillWords(w.listNow, { price: money(line.currentListMinor) })}</p>}
                  </div>
                  <span className="shrink-0 tabular-nums">{money(line.totalMinor)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="flex flex-col gap-1 border-t border-line pt-2">
            <div className="flex justify-between">
              <dt>{w.subtotal}</dt>
              <dd className="tabular-nums">{money(summary.subtotalMinor)}</dd>
            </div>
            {summary.staffDiscountMinor > 0 && (
              <div className="flex justify-between">
                <dt>
                  {summary.staffDiscountLabel ?? w.discountLabel} <span className="text-xs text-muted">{w.buyerSees}</span>
                </dt>
                <dd className="tabular-nums">−{money(summary.staffDiscountMinor)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>{w.shipping}</dt>
              <dd className="tabular-nums">{summary.shippingMinor === 0 ? w.free : money(summary.shippingMinor)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1 text-base font-medium">
              <dt>{w.total}</dt>
              <dd className="tabular-nums">{money(summary.totalMinor)}</dd>
            </div>
            {summary.vatPerRate.map((v) => (
              <div key={v.rate} className="flex justify-between text-muted">
                <dt>{fillWords(w.vatAt, { rate: percent(v.rate, lang === "en" ? "en" : ADMIN_LANG_FACTS[lang].locale) })}</dt>
                <dd className="tabular-nums">{money(v.taxMinor)}</dd>
              </div>
            ))}
            {summary.vatPerRate.length === 0 && (
              <div className="flex justify-between text-muted">
                <dt>{w.vat}</dt>
                <dd className="tabular-nums">{money(summary.taxMinor)}</dd>
              </div>
            )}
          </dl>
          <p className={hint}>{w.hint}</p>
        </>
      )}
    </section>
  );
}
