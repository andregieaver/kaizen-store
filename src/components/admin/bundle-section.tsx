"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { bundleComponentFactsAction, searchBundleComponentsAction } from "@/app/admin/(gated)/[store]/products/actions";
import { useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { withoutVat } from "@/lib/b2b";
import { bundleStock, computedBundlePrice, type BundlePart } from "@/lib/bundles";
import {
  BUNDLE_COMPONENTS_MAX,
  BUNDLE_PERCENT_MAX,
  BUNDLE_QUANTITY_MAX,
  bundleUnits,
  formatPriceInput,
  type BundleInput,
  type ProductInput,
} from "@/lib/product-input";
import type { ComponentFacts } from "@/server/bundles";
import type { EditorContext } from "@/server/products";

const card = "rounded-lg border border-line bg-card p-5";
const field = "input min-h-10 rounded-md border border-line bg-card px-3";

/** A bundle's starting point (D322): nothing in it yet, priced from its products at 10 % off, the choice most owners make. */
export const NEW_BUNDLE: BundleInput = { pricing: "computed", percentOff: 10, components: [] };

/**
 * What a bundle is made of and how it is priced (wave 6 unit D, D322): its components found by name or SKU, how many of each, the stock that
 * comes to, the price (its products' less a percentage, or its own) and the few details of its one variant. Shown in place of the variants.
 */
export function BundleSection({
  storeSlug,
  product,
  update,
  context,
}: {
  storeSlug: string;
  product: ProductInput;
  update: (change: (p: ProductInput) => ProductInput) => void;
  context: EditorContext;
}) {
  const w = useAdminText("product").bundle;
  const id = useId();
  const bundle = product.bundle ?? NEW_BUNDLE;
  const variant = product.variants[0];
  const [facts, setFacts] = useState<Map<string, ComponentFacts>>(new Map());
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ComponentFacts[] | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The facts of components not yet known (those the product was loaded with, or added by a search).
  const missing = bundle.components.map((c) => c.variantId).filter((v) => !facts.has(v));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (missingKey === "") return;
    let live = true;
    void bundleComponentFactsAction(storeSlug, missingKey.split(",")).then((rows) => {
      if (!live) return;
      setFacts((was) => new Map([...was, ...rows.map((r) => [r.variantId, r] as const)]));
    });
    return () => {
      live = false;
    };
  }, [storeSlug, missingKey]);

  const setBundle = (change: (b: BundleInput) => BundleInput) => update((p) => ({ ...p, bundle: change(p.bundle ?? NEW_BUNDLE) }));
  const setVariant = (change: Partial<ProductInput["variants"][number]>) =>
    update((p) => ({ ...p, variants: p.variants.map((v, i) => (i === 0 ? { ...v, ...change } : v)) }));

  const search = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setFound(null);
      return;
    }
    timer.current = setTimeout(() => {
      startSearch(async () => {
        const rows = await searchBundleComponentsAction(storeSlug, text);
        setFound(rows);
        setFacts((was) => new Map([...was, ...rows.map((r) => [r.variantId, r] as const)]));
      });
    }, 250);
  };

  const add = (variantId: string) => {
    setBundle((b) =>
      b.components.some((c) => c.variantId === variantId)
        ? { ...b, components: b.components.map((c) => (c.variantId === variantId ? { ...c, quantity: Math.min(c.quantity + 1, BUNDLE_QUANTITY_MAX) } : c)) }
        : { ...b, components: [...b.components, { variantId, quantity: 1 }].slice(0, BUNDLE_COMPONENTS_MAX) },
    );
  };
  const move = (index: number, by: number) =>
    setBundle((b) => {
      const to = index + by;
      if (to < 0 || to >= b.components.length) return b;
      const next = [...b.components];
      [next[index], next[to]] = [next[to], next[index]];
      return { ...b, components: next };
    });

  const parts: BundlePart[] = useMemo(
    () =>
      bundle.components.map((c) => {
        const fact = facts.get(c.variantId);
        return { quantity: c.quantity, inStock: fact?.inStock ?? 0, prices: fact?.prices ?? {}, usable: Boolean(fact && fact.active && fact.status !== "archived") };
      }),
    [bundle.components, facts],
  );
  const stock = bundleStock(parts);
  // A store selling only to businesses sees prices without VAT, as its price fields are typed (B2B).
  const shownMinor = (minor: number, market: EditorContext["markets"][number]) =>
    context.audience === "businesses" ? withoutVat(minor, market.vatRates[product.vatCategory] ?? 0) : minor;

  return (
    <>
      <section aria-labelledby={`${id}-title`} className={card}>
        <h2 id={`${id}-title`} className="text-title text-ink">
          {w.title}
        </h2>
        <p className="mt-1 text-sm text-muted">{w.intro}</p>
        {bundle.components.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{w.empty}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {bundle.components.map((component, index) => {
              const fact = facts.get(component.variantId);
              const name = fact?.title ?? component.variantId;
              return (
                <li key={component.variantId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{name}</span>
                    {fact && (
                      <span className="block text-muted">
                        {fact.sku} · {fillWords(w.inStock, { count: String(fact.inStock) })}
                      </span>
                    )}
                  </span>
                  <label className="flex items-center gap-2">
                    <span className="text-muted">{w.quantity}</span>
                    <input
                      type="number"
                      min={1}
                      max={BUNDLE_QUANTITY_MAX}
                      value={component.quantity}
                      onChange={(e) => {
                        const quantity = Math.max(1, Math.min(BUNDLE_QUANTITY_MAX, Math.floor(Number(e.target.value) || 1)));
                        setBundle((b) => ({ ...b, components: b.components.map((c, i) => (i === index ? { ...c, quantity } : c)) }));
                      }}
                      className={`${field} w-20`}
                    />
                  </label>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={fillWords(w.moveUp, { name })} className="min-h-10 rounded-pill border border-line px-3">
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === bundle.components.length - 1}
                      aria-label={fillWords(w.moveDown, { name })}
                      className="min-h-10 rounded-pill border border-line px-3"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setBundle((b) => ({ ...b, components: b.components.filter((_, i) => i !== index) }))}
                      aria-label={fillWords(w.remove, { name })}
                      className="min-h-10 rounded-pill border border-line px-3"
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {bundle.components.length < BUNDLE_COMPONENTS_MAX && (
          <div className="mt-4">
            <label htmlFor={`${id}-search`} className="block text-sm font-medium">
              {w.search}
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder={w.searchPlaceholder}
              autoComplete="off"
              className={`${field} mt-1 w-full max-w-md`}
            />
            <div aria-live="polite" className="mt-2 text-sm">
              {searching && <p className="text-muted">{w.searching}</p>}
              {!searching && found !== null && found.length === 0 && <p className="text-muted">{w.noMatch}</p>}
              {!searching && found !== null && found.length > 0 && (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {found.map((f) => (
                    <li key={f.variantId} className="flex items-center gap-3 p-2">
                      <span className="min-w-0 flex-1">
                        {f.title} <span className="text-muted">· {f.sku} · {fillWords(w.inStock, { count: String(f.inStock) })}</span>
                      </span>
                      <button type="button" onClick={() => add(f.variantId)} className="min-h-10 rounded-pill border border-line px-3">
                        {w.add}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 text-sm">
          <span className="font-medium">{w.stockTitle}: </span>
          {countWords(stock, w.stock)}
        </p>
        {bundleUnits(bundle) < 2 && <p className="mt-1 text-sm text-muted">{w.unitsNeeded}</p>}
      </section>

      <section aria-labelledby={`${id}-price`} className={card}>
        <fieldset>
          <legend id={`${id}-price`} className="mb-3 font-medium">
            {w.priceTitle}
          </legend>
          <div className="flex flex-col gap-2 text-sm">
            {(
              [
                ["computed", w.computed, w.computedNote],
                ["fixed", w.fixed, w.fixedNote],
              ] as const
            ).map(([value, name, note]) => (
              <label key={value} className="flex items-start gap-2">
                <input type="radio" name={`${id}-pricing`} checked={bundle.pricing === value} onChange={() => setBundle((b) => ({ ...b, pricing: value }))} className="mt-0.5 size-4" />
                <span>
                  <span className="block font-medium">{name}</span>
                  <span className="text-muted">{note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {bundle.pricing === "computed" ? (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-medium">{w.percentOff}</span>
              <input
                type="number"
                min={0}
                max={BUNDLE_PERCENT_MAX}
                value={bundle.percentOff}
                onChange={(e) => {
                  const percentOff = Math.max(0, Math.min(BUNDLE_PERCENT_MAX, Math.floor(Number(e.target.value) || 0)));
                  setBundle((b) => ({ ...b, percentOff }));
                }}
                className={`${field} w-24`}
              />
              <span>%</span>
            </label>
            <ul className="flex flex-col gap-1">
              {context.markets.map((market) => {
                const price = computedBundlePrice(parts, market.code, bundle.percentOff);
                return (
                  <li key={market.code}>
                    {price
                      ? `${fillWords(w.comesTo, { price: `${formatPriceInput(shownMinor(price.priceMinor, market), market.currency)} ${market.currency}`, country: market.name })} (${fillWords(w.sumWas, { price: `${formatPriceInput(shownMinor(price.sumMinor, market), market.currency)} ${market.currency}` })})`
                      : bundle.components.length > 0
                        ? fillWords(w.noPriceIn, { country: market.name })
                        : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {context.markets.map((market) => (
              <label key={market.code} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{fillWords(w.priceIn, { country: market.name, currency: market.currency })}</span>
                <input
                  inputMode="decimal"
                  value={variant?.prices[market.code] ?? ""}
                  onChange={(e) => setVariant({ prices: { ...(variant?.prices ?? {}), [market.code]: e.target.value } })}
                  className={field}
                />
              </label>
            ))}
          </div>
        )}
      </section>

      {variant && (
        <section aria-labelledby={`${id}-details`} className={card}>
          <h2 id={`${id}-details`} className="mb-3 text-title text-ink">
            {w.detailsTitle}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{w.sku}</span>
              <input value={variant.sku} onChange={(e) => setVariant({ sku: e.target.value })} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{w.gtin}</span>
              <input inputMode="numeric" value={variant.gtin ?? ""} onChange={(e) => setVariant({ gtin: e.target.value.trim() || null })} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{w.weight}</span>
              <input
                type="number"
                min={1}
                value={variant.weightGrams ?? ""}
                onChange={(e) => setVariant({ weightGrams: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                className={field}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}
