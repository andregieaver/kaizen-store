"use client";

import { useId } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { PRICE_BREAKS_MAX, type PriceBreakInput } from "@/lib/price-breaks";
import { variantLabel, type ProductInput } from "@/lib/product-input";
import type { EditorContext } from "@/server/products";

const card = "rounded-lg border border-line bg-card p-5";
const field = "input min-h-10 rounded-md border border-line bg-card px-3";

/**
 * A product's price breaks (wave 6 unit E2, D323, `docs/wave-6-catalogue.md` E.2): from how many units in one line a lower price each, as a percentage
 * off or a price per country, for every variant or one. The product page shows them as a table and the cart charges them (`commerce.line_price()`);
 * never shown as a reduction. Goods and bundles only; `priceBreakProblems()` checks them on save.
 */
export function PriceBreaksSection({
  product,
  update,
  context,
}: {
  product: ProductInput;
  update: (change: (p: ProductInput) => ProductInput) => void;
  context: EditorContext;
}) {
  const w = useAdminText("product").priceBreaks;
  const id = useId();
  const breaks = product.priceBreaks;
  const set = (index: number, change: Partial<PriceBreakInput>) =>
    update((p) => ({ ...p, priceBreaks: p.priceBreaks.map((step, i) => (i === index ? { ...step, ...change } : step)) }));
  const add = () =>
    update((p) => {
      const last = p.priceBreaks.reduce((most, step) => Math.max(most, step.from), 0);
      return { ...p, priceBreaks: [...p.priceBreaks, { variantSku: null, from: last > 0 ? Math.min(9999, last * 2) : 10, percent: 10, prices: {} }] };
    });
  const remove = (index: number) => update((p) => ({ ...p, priceBreaks: p.priceBreaks.filter((_, i) => i !== index) }));
  const several = product.variants.length > 1;
  const whole = (value: string, fallback: number, low: number, high: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
  };

  return (
    <section aria-labelledby={`${id}-title`} className={card}>
      <h2 id={`${id}-title`} className="text-title text-ink">
        {w.title}
      </h2>
      <p className="mt-1 text-sm text-muted">{w.intro}</p>
      {product.plans.length > 0 && <p className="mt-1 text-sm text-muted">{w.notSubscriptions}</p>}
      {breaks.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {breaks.map((step, index) => (
            <li key={index} className="flex flex-col gap-3 rounded-panel border border-line p-3">
              <div className="flex flex-wrap items-end gap-3 text-sm">
                {several && (
                  <label className="flex flex-col gap-1">
                    {w.variant}
                    <select value={step.variantSku ?? ""} onChange={(e) => set(index, { variantSku: e.target.value || null })} className={field}>
                      <option value="">{w.everyVariant}</option>
                      {product.variants.map((v) => (
                        <option key={v.sku} value={v.sku}>
                          {variantLabel(v.options) || v.sku}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  {w.from}
                  <input
                    type="number"
                    min={2}
                    max={9999}
                    inputMode="numeric"
                    value={step.from}
                    onChange={(e) => set(index, { from: whole(e.target.value, step.from, 2, 9999) })}
                    className={`${field} w-28`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  {w.kind}
                  <select
                    value={step.percent === null ? "price" : "percent"}
                    onChange={(e) => set(index, e.target.value === "percent" ? { percent: 10, prices: {} } : { percent: null })}
                    className={field}
                  >
                    <option value="percent">{w.percent}</option>
                    <option value="price">{context.audience === "businesses" ? w.priceWithoutVat : w.price}</option>
                  </select>
                </label>
                {step.percent !== null && (
                  <label className="flex flex-col gap-1">
                    {w.percentOff}
                    <input
                      type="number"
                      min={1}
                      max={99}
                      inputMode="numeric"
                      value={step.percent}
                      onChange={(e) => set(index, { percent: whole(e.target.value, step.percent ?? 10, 1, 99) })}
                      className={`${field} w-24`}
                    />
                  </label>
                )}
                <button type="button" onClick={() => remove(index)} className="ml-auto min-h-10 rounded-pill border border-line px-3">
                  {w.remove}
                </button>
              </div>
              {step.percent === null && (
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  {context.markets.map((market) => (
                    <label key={market.code} className="flex flex-col gap-1">
                      {fillWords(w.priceIn, { market: market.name, currency: market.currency })}
                      <input
                        inputMode="decimal"
                        value={step.prices[market.code] ?? ""}
                        onChange={(e) => set(index, { prices: { ...step.prices, [market.code]: e.target.value } })}
                        placeholder="0,00"
                        className={field}
                      />
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={add}
        disabled={breaks.length >= PRICE_BREAKS_MAX}
        className="mt-4 min-h-10 rounded-pill border border-line px-4 text-sm disabled:opacity-50"
      >
        {w.add}
      </button>
    </section>
  );
}
