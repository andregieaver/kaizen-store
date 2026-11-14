"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { LOW_STOCK_AT } from "@/lib/control-center";
import { formatMoney } from "@/lib/money";

import { useAdminText } from "./admin-text";
import { ProductsTable, type BulkTools, type ProductRowView } from "./products-bulk";
import { AdminLink } from "./ui/link";

type Filter = "all" | "active" | "draft" | "stock";

const VIEW_KEY = "kz-products-view";
const viewListeners = new Set<() => void>();
const subscribeView = (listener: () => void) => {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
};
const readView = (): "grid" | "table" => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
};
const PAGE = 60;

const keepsStock = (p: ProductRowView) => !(p.digitalVariants > 0 && p.digitalVariants === p.variants);
/** A product that needs stock: it keeps stock and has LOW_STOCK_AT or fewer over its variants (the control center's line for "running low"). */
export const needsStock = (p: ProductRowView) => p.status !== "archived" && keepsStock(p) && p.stock <= LOW_STOCK_AT;

/**
 * The products list (round 2, D597): the catalogue as pictures by default, the table (with its bulk tools) one press away; a search over names and
 * SKUs and filters by state and stock, applied in the browser over the list the page read; sixty at a time with *Show more*. The choice of view is kept
 * in this browser only.
 */
export function ProductCatalogue({
  slug,
  rows,
  archived,
  priceHeader,
  locale,
  bulk,
  skus,
}: {
  slug: string;
  rows: ProductRowView[];
  archived: boolean;
  priceHeader: string;
  locale: string;
  bulk: BulkTools | null;
  /** Each product's SKUs, by id, for the search. */
  skus: Record<string, string[]>;
}) {
  const w = useAdminText("products").catalogue;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // The browser's remembered choice: pictures on the server and until the browser says otherwise.
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as const);
  const [shown, setShown] = useState(PAGE);
  const setView = (next: "grid" | "table") => {
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // No storage: nothing is remembered.
    }
    for (const listener of viewListeners) listener();
  };
  const counts = useMemo(
    () => ({ all: rows.length, active: rows.filter((r) => r.status === "active").length, draft: rows.filter((r) => r.status === "draft").length, stock: rows.filter(needsStock).length }),
    [rows],
  );
  const matching = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (filter === "active" && r.status !== "active") return false;
      if (filter === "draft" && r.status !== "draft") return false;
      if (filter === "stock" && !needsStock(r)) return false;
      if (!q) return true;
      return r.title.toLocaleLowerCase().includes(q) || (skus[r.id] ?? []).some((sku) => sku.toLocaleLowerCase().includes(q));
    });
  }, [rows, filter, query, skus]);
  const page = matching.slice(0, shown);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  const chip = "inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-sm";
  const chips: { key: Filter; label: string; n: number; warn?: boolean }[] = [
    { key: "all", label: w.all, n: counts.all },
    { key: "active", label: w.onSale, n: counts.active },
    { key: "draft", label: w.drafts, n: counts.draft },
    { key: "stock", label: w.needsStock, n: counts.stock, warn: true },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-11 min-w-0 flex-[1_1_16rem] items-center gap-2.5 rounded-pill bg-card px-4 ring-1 ring-edge sm:max-w-sm">
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="sr-only">{w.search}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder={w.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        {!archived && (
          <div role="group" aria-label={w.show} className="flex flex-wrap gap-1.5">
            {chips
              .filter((c) => c.key === "all" || c.n > 0)
              .map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={filter === c.key}
                  onClick={() => {
                    setFilter(c.key);
                    setShown(PAGE);
                  }}
                  className={`${chip} ${filter === c.key ? "bg-inverse text-inverse-ink" : c.warn ? "bg-warning-soft text-warning-text" : "bg-card text-ink-2 hover:text-ink"}`}
                >
                  {c.label} <span className="tabular-nums opacity-80">{c.n}</span>
                </button>
              ))}
          </div>
        )}
        <div role="group" aria-label={w.view} className="ml-auto flex gap-0.5 rounded-pill bg-card p-[3px]">
          <button type="button" aria-pressed={view === "grid"} aria-label={w.pictures} title={w.pictures} onClick={() => setView("grid")} className={`flex h-9 w-10 items-center justify-center rounded-pill ${view === "grid" ? "bg-inverse text-inverse-ink" : "text-ink-2"}`}>
            <LayoutGrid aria-hidden className="size-4" />
          </button>
          <button type="button" aria-pressed={view === "table"} aria-label={w.table} title={w.table} onClick={() => setView("table")} className={`flex h-9 w-10 items-center justify-center rounded-pill ${view === "table" ? "bg-inverse text-inverse-ink" : "text-ink-2"}`}>
            <List aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      {matching.length === 0 ? (
        <p className="rounded-card bg-card p-8 text-center text-body text-muted">{fillWords(w.noMatch, { q: query.trim() })}</p>
      ) : view === "table" ? (
        <ProductsTable slug={slug} rows={page} archived={archived} priceHeader={priceHeader} locale={locale} bulk={bulk} />
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr))]">
          {page.map((p) => {
            const soldOut = keepsStock(p) && p.stock <= 0 && p.status !== "archived";
            const low = keepsStock(p) && p.stock > 0 && p.stock <= LOW_STOCK_AT;
            return (
              <li key={p.id}>
                <AdminLink href={`/admin/${slug}/products/${p.id}`} className="relative flex h-full flex-col overflow-hidden rounded-card bg-card hover:ring-1 hover:ring-edge dark:ring-1 dark:ring-line">
                  {(soldOut || p.status === "draft") && (
                    <span className={`absolute top-2.5 left-2.5 z-10 inline-flex h-6.5 items-center gap-1.5 rounded-pill px-2.5 text-caption ${soldOut ? "bg-warning-soft text-warning-text" : "bg-neutral-soft text-neutral-text"}`}>
                      {soldOut && <span aria-hidden className="size-1.5 rounded-pill bg-warning-solid" />}
                      {soldOut ? w.soldOut : w.draft}
                    </span>
                  )}
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the product's own picture, as stored.
                    <img src={p.image} alt="" loading="lazy" className={`aspect-[4/3] w-full bg-sunken object-cover ${soldOut ? "opacity-55" : ""}`} />
                  ) : (
                    <span className="flex aspect-[4/3] w-full items-center justify-center bg-sunken text-caption text-muted">{w.noPhoto}</span>
                  )}
                  <span className="flex flex-1 flex-col gap-2 px-4 py-3.5">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-body-strong text-ink">{p.title}</span>
                      <span className="shrink-0 text-body text-ink tabular-nums">
                        {p.price ? (p.price.min === p.price.max ? money(p.price.min, p.price.currency) : `${money(p.price.min, p.price.currency)}–${money(p.price.max, p.price.currency)}`) : <span className="text-muted">{w.noPrice}</span>}
                      </span>
                    </span>
                    {p.variants > 1 && <span className="text-caption text-muted">{countWords(p.variants, w.options)}</span>}
                    {p.status === "draft" ? (
                      <>
                        <span className="text-caption text-muted">{w.hidden}</span>
                        <span className="text-body text-brand-text">{w.finish} ›</span>
                      </>
                    ) : !keepsStock(p) ? (
                      <span className="text-caption text-ink-2">{w.digital}</span>
                    ) : soldOut ? (
                      <>
                        <span className="text-caption text-muted">{w.cantBuy}</span>
                        <span className="text-body text-brand-text">{w.restock} ›</span>
                      </>
                    ) : (
                      <span role="img" aria-label={low ? countWords(p.stock, w.left) : fillWords(w.inStock, { n: p.stock })} className="flex flex-col gap-1">
                        <span className="relative block h-1.5 rounded-pill bg-sunken">
                          <span style={{ width: `${Math.min(100, Math.max(6, (p.stock / 50) * 100))}%` }} className={`absolute inset-y-0 left-0 rounded-pill ${low ? "bg-warning-solid" : "bg-ink"}`} />
                        </span>
                        <span className={`text-caption ${low ? "text-warning-text" : "text-ink-2"}`}>{low ? countWords(p.stock, w.left) : fillWords(w.inStock, { n: p.stock })}</span>
                      </span>
                    )}
                  </span>
                </AdminLink>
              </li>
            );
          })}
        </ul>
      )}
      {matching.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="self-center rounded-pill border border-edge bg-card px-5 py-2.5 text-body text-ink hover:bg-sunken">
          {fillWords(w.showMore, { n: Math.min(PAGE, matching.length - shown) })}
        </button>
      )}
    </div>
  );
}
