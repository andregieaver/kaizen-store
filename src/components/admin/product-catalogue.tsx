"use client";

import { LayoutGrid, List } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { LOW_STOCK_AT } from "@/lib/control-center";
import { formatMoney } from "@/lib/money";
import type { MatchFilter } from "@/server/bulk-edit";

import { useAdminText } from "./admin-text";
import { ProductsTable, type BulkTools, type ProductRowView } from "./products-bulk";
import { ButtonLink } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { AdminLink } from "./ui/link";

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

const keepsStock = (p: ProductRowView) => !(p.digitalVariants > 0 && p.digitalVariants === p.variants);

/**
 * The products list (round 2, D597): the catalogue as pictures by default, the table (with its bulk tools) one press away. The page reads a
 * hundred at a time on the server (code review 1.13, D834): its search and views are the `toolbar` (the kit's `ListSearch`, a GET form), its
 * pages the `pager` (the kit's `Pager`, "100 of 150"), both drawn on the server; `total` and `filter` are what *Choose all that match* takes.
 * The choice of view is kept in this browser only.
 */
export function ProductCatalogue({
  slug,
  rows,
  total,
  filter,
  archived,
  priceHeader,
  locale,
  bulk,
  toolbar,
  pager,
}: {
  slug: string;
  /** The page's products. */
  rows: ProductRowView[];
  /** How many the view and search find on all pages. */
  total: number;
  filter: MatchFilter;
  archived: boolean;
  priceHeader: string;
  locale: string;
  bulk: BulkTools | null;
  /** The search and the views, beside the choice of pictures or table. */
  toolbar: ReactNode;
  /** Under the list: how many of all are shown, and the pages before and after. */
  pager: ReactNode;
}) {
  const w = useAdminText("products").catalogue;
  const { clearFilters } = useAdminText("common").list;
  // The browser's remembered choice: pictures on the server and until the browser says otherwise.
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as const);
  const setView = (next: "grid" | "table") => {
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // No storage: nothing is remembered.
    }
    for (const listener of viewListeners) listener();
  };
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {toolbar}
        <div role="group" aria-label={w.view} className="ml-auto flex gap-0.5 rounded-pill bg-card p-[3px] max-sm:hidden">
          <button type="button" aria-pressed={view === "grid"} aria-label={w.pictures} title={w.pictures} onClick={() => setView("grid")} className={`flex h-9 w-10 items-center justify-center rounded-pill ${view === "grid" ? "bg-inverse text-inverse-ink" : "text-ink-2"}`}>
            <LayoutGrid aria-hidden className="size-4" />
          </button>
          <button type="button" aria-pressed={view === "table"} aria-label={w.table} title={w.table} onClick={() => setView("table")} className={`flex h-9 w-10 items-center justify-center rounded-pill ${view === "table" ? "bg-inverse text-inverse-ink" : "text-ink-2"}`}>
            <List aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        // A search or a view that found nothing goes back to every product (the store with none at all has the page's own first-product card).
        <EmptyState
          title={filter.q ? fillWords(w.noMatch, { q: filter.q }) : w.noneShown}
          action={<ButtonLink href={`/admin/${slug}/products${archived ? "?show=archived" : ""}`}>{clearFilters}</ButtonLink>}
        />
      ) : view === "table" ? (
        <ProductsTable slug={slug} rows={rows} total={total} filter={filter} archived={archived} priceHeader={priceHeader} locale={locale} bulk={bulk} />
      ) : (
        // On a phone (round 8, D626) each product is a row: a small picture, the name, the price and one line of state with its action.
        <ul className="grid gap-4 max-sm:gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr))]">
          {rows.map((p) => {
            const soldOut = keepsStock(p) && p.stock <= 0 && p.status !== "archived";
            const low = keepsStock(p) && p.stock > 0 && p.stock <= LOW_STOCK_AT;
            return (
              <li key={p.id}>
                <AdminLink href={`/admin/${slug}/products/${p.id}`} className="relative flex h-full flex-col overflow-hidden rounded-card bg-card hover:ring-1 hover:ring-edge max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:p-3 dark:ring-1 dark:ring-line">
                  {(soldOut || p.status === "draft") && (
                    <span className={`absolute top-2.5 left-2.5 z-10 max-sm:hidden inline-flex h-6.5 items-center gap-1.5 rounded-pill px-2.5 text-caption ${soldOut ? "bg-warning-soft text-warning-text" : "bg-neutral-soft text-neutral-text"}`}>
                      {soldOut && <span aria-hidden className="size-1.5 rounded-pill bg-warning-solid" />}
                      {soldOut ? w.soldOut : w.draft}
                    </span>
                  )}
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the product's own picture, as stored.
                    <img src={p.image} alt="" loading="lazy" className={`aspect-[4/3] w-full bg-sunken object-cover max-sm:size-12 max-sm:shrink-0 max-sm:rounded-md ${soldOut ? "opacity-55" : ""}`} />
                  ) : (
                    <span className="flex aspect-[4/3] w-full items-center justify-center bg-sunken text-caption text-muted max-sm:size-12 max-sm:shrink-0 max-sm:rounded-md max-sm:text-[0]">{w.noPhoto}</span>
                  )}
                  <span className="flex flex-1 flex-col gap-2 px-4 py-3.5 max-sm:min-w-0 max-sm:gap-0.5 max-sm:p-0">
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
                        <span className="text-caption text-muted max-sm:text-danger-text">
                          <span className="sm:hidden">{w.soldOut} · </span>
                          {w.cantBuy}
                        </span>
                        <span className="text-body text-brand-text">{w.restock} ›</span>
                      </>
                    ) : (
                      <span role="img" aria-label={low ? countWords(p.stock, w.left) : fillWords(w.inStock, { n: p.stock })} className="flex flex-col gap-1">
                        <span className="relative block h-1.5 rounded-pill bg-sunken max-sm:hidden">
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
      {pager}
      {/* On a phone the one green button is under the list, in the thumb's reach (round 8). */}
      {bulk && !archived && (
        <AdminLink href={`/admin/${slug}/products/new`} className="flex h-12 items-center justify-center rounded-pill bg-brand text-body-strong text-brand-ink sm:hidden">
          + {w.addProduct}
        </AdminLink>
      )}
    </div>
  );
}
