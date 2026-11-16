"use client";

import { Check } from "lucide-react";

import { fillWords } from "@/lib/admin-fill";
import type { ProductMessages } from "@/lib/admin-messages/product.en";
import { formatMoney } from "@/lib/money";
import { parsePrice, type ProductInput } from "@/lib/product-input";
import { readiness } from "@/lib/product-readiness";

type Market = { code: string; currency: string; name: string };

/** The product's own words in the main language, else its first. */
function ownWords(product: ProductInput, locale: string) {
  return product.translations.find((t) => t.locale === locale) ?? product.translations[0];
}

/** Units in stock over the active physical variants, or null for a product that keeps no stock. */
function stockOf(product: ProductInput): number | null {
  const physical = product.variants.filter((v) => v.active && v.delivery === "physical");
  if (physical.length === 0 || product.kind !== "goods") return null;
  return physical.reduce((sum, v) => sum + v.stock, 0);
}

/**
 * Beside the product editor (round 1, D595, step 5): the product as a shopper sees it on a phone, drawn from what is typed now, and what it
 * still lacks to sell well. A sketch of the store's product page, not the page itself: *Open* shows the real one.
 */
export function ProductPreview({
  product,
  locale,
  market,
  href,
  words: w,
}: {
  product: ProductInput;
  locale: string;
  market: Market | undefined;
  href: string | null;
  words: ProductMessages["preview"];
}) {
  const own = ownWords(product, locale);
  const title = own?.title ?? "";
  const description = own?.description ?? "";
  const picture = product.media[0] ? (product.media[0].thumbnailUrl ?? product.media[0].url) : null;
  const variant = product.variants.find((v) => v.active) ?? product.variants[0];
  const minor = market && variant ? parsePrice(variant.prices[market.code] ?? "", market.currency) : null;
  const stock = stockOf(product);
  const firstOption = product.options[0];
  const checks = readiness({
    title,
    description,
    pictures: product.media.length,
    priced: Boolean(market && product.variants.some((v) => v.active && parsePrice(v.prices[market.code] ?? "", market.currency) !== null)),
    stock,
    categories: product.categories.length,
  });
  const done = checks.filter((c) => c.done).length;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={w.title} className="flex flex-col gap-3 rounded-card bg-card p-5 dark:border dark:border-line">
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">{w.title}</h2>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="text-body text-brand-text hover:underline">
              {w.open} ↗
            </a>
          )}
        </div>
        <div className="flex justify-center rounded-panel bg-sunken p-3.5">
          <div aria-hidden className="flex w-56 flex-col overflow-hidden rounded-[18px] bg-[#fbfaf6] ring-[6px] ring-ink">
            <div className="aspect-square w-full bg-[#eceae4]">
              {/* eslint-disable-next-line @next/next/no-img-element -- the product's own picture, as uploaded. */}
              {picture && <img src={picture} alt="" className="size-full object-cover" />}
            </div>
            <div className="flex flex-col gap-1.5 p-3.5 text-[#1b2433]">
              <span className="text-[15px] leading-snug">{title || <span className="text-[#8a93a3]">{w.noTitle}</span>}</span>
              <span className="text-[14px]">
                {minor !== null && market ? formatMoney(minor, market.currency, "en", { decimals: "hide_whole" }) : <span className="text-[#8a93a3]">{w.noPrice}</span>}
                {minor !== null && <span className="ml-1 text-[10px] text-[#5c6778]">{w.inclVat}</span>}
              </span>
              {firstOption && firstOption.values.length > 1 && (
                <span className="flex flex-wrap gap-1">
                  {firstOption.values.slice(0, 5).map((value, i) => (
                    <span key={value} className={`rounded-full px-2 py-0.5 text-[10px] ${i === 0 ? "bg-[#1b2433] text-white" : "bg-[#e8e6df]"}`}>
                      {value}
                    </span>
                  ))}
                </span>
              )}
              {stock !== null && stock > 0 && stock <= 5 && <span className="text-[11px] text-[#9c6a00]">{fillWords(w.onlyLeft, { n: stock })}</span>}
              <span className="mt-1 flex h-8 items-center justify-center rounded-full bg-[#2f4a73] text-[11px] text-white">{w.addToCart}</span>
              {description && <span className="line-clamp-2 text-[10px] leading-relaxed text-[#5c6778]">{description.replace(/<[^>]*>/g, " ")}</span>}
            </div>
          </div>
        </div>
      </section>
      <section aria-label={w.ready} className="flex flex-col gap-2.5 rounded-card bg-card p-5 dark:border dark:border-line">
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">{w.ready}</h2>
          <span className="text-caption text-positive-text">{fillWords(w.readyCount, { done, total: checks.length })}</span>
        </div>
        <ul className="flex flex-col gap-2 text-body">
          {checks.map(({ check, done: ok }) => (
            <li key={check} className="flex items-center gap-2.5">
              {ok ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-brand text-brand-ink">
                  <Check aria-hidden className="size-3" strokeWidth={3.5} />
                </span>
              ) : (
                <span aria-hidden className="size-5 shrink-0 rounded-pill border-2 border-edge" />
              )}
              <span className={ok ? "text-ink" : "text-ink-2"}>
                <span className="sr-only">{ok ? "✓ " : "○ "}</span>
                {w.checks[check]}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
