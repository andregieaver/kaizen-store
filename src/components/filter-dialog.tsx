"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  filterCount,
  LISTING_SORTS,
  listingQuery,
  NO_FILTERS,
  type ListingFilters,
  type ListingSort,
  type OptionFilter,
} from "@/lib/listing-filters";
import type { ProductKind } from "@/lib/query-understanding";

type Choice = { value: string; label: string; count: number };

export type FilterFacets = {
  kinds: { kind: ProductKind; label: string; count: number }[];
  categories: (Choice & { depth: number })[];
  tags: Choice[];
  options: { name: string; label: string; values: Choice[] }[];
  price: { min: number; max: number } | null;
};

export type FilterLabels = {
  open: string;
  title: string;
  close: string;
  sort: string;
  sorts: Record<ListingSort, string>;
  kind: string;
  category: string;
  tag: string;
  price: string;
  priceFrom: string;
  priceTo: string;
  /** Where the page's prices run, formatted; null without a range. */
  priceRange: string | null;
  /** The currency's sign or code, beside the price fields. */
  currency: string;
  availability: string;
  inStock: string;
  clear: string;
  apply: string;
};

/**
 * Sort and filter a product listing (D78): a button that opens a dialog
 * (a sheet from the bottom on phones, a panel from the right on larger
 * screens) with the order, the kinds, categories, features (tags),
 * variant options and price range the page's products offer, and stock.
 * Showing the products goes to the page's address with the choices in it,
 * which the server applies, so the list can be shared and opened again.
 * Live (D83), each choice goes to the address as it is made, so the
 * products behind the dialog follow while it is open (seen beside it on
 * larger screens, and counted in it).
 */
export function FilterDialog({
  path,
  keep,
  filters,
  facets,
  labels,
  live = false,
  count: resultCount,
}: {
  /** The page's address without its query. */
  path: string;
  /** Other parameters of the page to keep, such as a search's `q`. */
  keep: Record<string, string>;
  filters: ListingFilters;
  facets: FilterFacets;
  labels: FilterLabels;
  /** Apply each choice at once while the dialog is open. */
  live?: boolean;
  /** How many products show now, as said to the shopper (live). */
  count?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListingFilters>(filters);
  const [minText, setMinText] = useState(filters.minPrice === null ? "" : String(filters.minPrice));
  const [maxText, setMaxText] = useState(filters.maxPrice === null ? "" : String(filters.maxPrice));
  const [pending, start] = useTransition();
  const chosen = filterCount(filters);

  const show = () => {
    // Opened afresh from what the page shows.
    setDraft(filters);
    setMinText(filters.minPrice === null ? "" : String(filters.minPrice));
    setMaxText(filters.maxPrice === null ? "" : String(filters.maxPrice));
    dialog.current?.showModal();
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => setOpen(true));
  };
  const hide = () => {
    setOpen(false);
    document.documentElement.style.overflow = "";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => dialog.current?.close(), reduced ? 0 : 300);
  };

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const toggleOption = (name: string, value: string) =>
    setDraft((current) => {
      const existing = current.options.find((option) => option.name === name);
      const values = toggle(existing?.values ?? [], value);
      const others = current.options.filter((option) => option.name !== name);
      const options: OptionFilter[] = values.length > 0 ? [...others, { name, values }] : others;
      return { ...current, options };
    });
  const amount = (text: string): number | null => {
    const number = Number(text.replace(",", ".").trim());
    return text.trim() && Number.isFinite(number) && number >= 0 ? number : null;
  };

  const chosenNow = () => ({ ...draft, minPrice: amount(minText), maxPrice: amount(maxText) });
  const apply = () => {
    const query = listingQuery(chosenNow(), keep);
    start(() => {
      if (live) {
        // Most choices are in the address already; a last one may still be on its way.
        if (query !== listingQuery(filters, keep)) router.replace(`${path}${query}`, { scroll: false });
      } else {
        router.push(`${path}${query}`, { scroll: false });
      }
      hide();
    });
  };
  /** Closing keeps what is chosen when live, and drops it otherwise. */
  const close = () => (live ? apply() : hide());

  // Live: each choice reaches the address a moment after it is made (typing a price waits for a pause).
  const shown = listingQuery(filters, keep);
  const wanted = open && live ? listingQuery({ ...draft, minPrice: amount(minText), maxPrice: amount(maxText) }, keep) : shown;
  useEffect(() => {
    if (!live || wanted === shown) return;
    const timer = window.setTimeout(() => start(() => router.replace(`${path}${wanted}`, { scroll: false })), 250);
    return () => window.clearTimeout(timer);
  }, [live, wanted, shown, path, router]);
  const clear = () => {
    setDraft({ ...NO_FILTERS, sort: draft.sort });
    setMinText("");
    setMaxText("");
  };

  const chip = (pressed: boolean) =>
    `inline-flex min-h-10 items-center gap-1.5 rounded-button border px-4 text-sm ${
      pressed ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface"
    }`;
  const count = (n: number) => <span className="text-xs opacity-70">({n})</span>;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center gap-2 rounded-button border border-border px-4 text-sm font-medium hover:bg-surface"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" strokeLinecap="round" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        {labels.open}
        {chosen > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs text-accent-foreground">
            {chosen}
          </span>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="filter-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
      >
        <div
          aria-hidden="true"
          onClick={close}
          className={`fixed inset-0 bg-black/40 transition-opacity duration-300 motion-reduce:transition-none ${
            live ? "md:bg-black/10" : ""
          } ${open ? "opacity-100" : "opacity-0"}`}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          className={`fixed inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[26rem] md:rounded-none ${
            open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-x-full md:translate-y-0"
          }`}
        >
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <h2 id="filter-dialog-title" className="text-xl font-heading">
              {labels.title}
            </h2>
            <button type="button" onClick={close} className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
              <span className="sr-only">{labels.close}</span>
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-7 overflow-y-auto overscroll-contain px-4 py-6">
            <Section legend={labels.sort}>
              <div className="flex flex-col gap-1">
                {LISTING_SORTS.map((sort) => (
                  <label key={sort} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="sort"
                      checked={draft.sort === sort}
                      onChange={() => setDraft({ ...draft, sort })}
                      className="size-5 accent-(--accent)"
                    />
                    {labels.sorts[sort]}
                  </label>
                ))}
              </div>
            </Section>

            {facets.kinds.length > 0 && (
              <Section legend={labels.kind}>
                <div className="flex flex-wrap gap-2">
                  {facets.kinds.map(({ kind, label, count: n }) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={draft.kinds.includes(kind)}
                      onClick={() => setDraft({ ...draft, kinds: toggle(draft.kinds, kind) })}
                      className={chip(draft.kinds.includes(kind))}
                    >
                      {label} {count(n)}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {facets.categories.length > 0 && (
              <Section legend={labels.category}>
                <div className="flex flex-col gap-1">
                  {facets.categories.map((category) => (
                    <label
                      key={category.value}
                      style={{ paddingInlineStart: `${category.depth * 1.25}rem` }}
                      className="flex min-h-10 cursor-pointer items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={draft.categories.includes(category.value)}
                        onChange={() => setDraft({ ...draft, categories: toggle(draft.categories, category.value) })}
                        className="size-5 accent-(--accent)"
                      />
                      <span>
                        {category.label} {count(category.count)}
                      </span>
                    </label>
                  ))}
                </div>
              </Section>
            )}

            {facets.tags.length > 0 && (
              <Section legend={labels.tag}>
                <div className="flex flex-wrap gap-2">
                  {facets.tags.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      aria-pressed={draft.tags.includes(tag.value)}
                      onClick={() => setDraft({ ...draft, tags: toggle(draft.tags, tag.value) })}
                      className={chip(draft.tags.includes(tag.value))}
                    >
                      {tag.label} {count(tag.count)}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {facets.options.map((option) => {
              const picked = draft.options.find((o) => o.name === option.name)?.values ?? [];
              return (
                <Section key={option.name} legend={option.label}>
                  <div className="flex flex-wrap gap-2">
                    {option.values.map((value) => (
                      <button
                        key={value.value}
                        type="button"
                        aria-pressed={picked.includes(value.value)}
                        onClick={() => toggleOption(option.name, value.value)}
                        className={chip(picked.includes(value.value))}
                      >
                        {value.label} {count(value.count)}
                      </button>
                    ))}
                  </div>
                </Section>
              );
            })}

            {facets.price && (
              <Section legend={labels.price}>
                <div className="grid grid-cols-2 gap-3">
                  <PriceField label={labels.priceFrom} currency={labels.currency} value={minText} onChange={setMinText} placeholder={String(facets.price.min)} />
                  <PriceField label={labels.priceTo} currency={labels.currency} value={maxText} onChange={setMaxText} placeholder={String(facets.price.max)} />
                </div>
                {labels.priceRange && <p className="mt-2 text-sm text-muted">{labels.priceRange}</p>}
              </Section>
            )}

            <Section legend={labels.availability}>
              <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.inStock}
                  onChange={(event) => setDraft({ ...draft, inStock: event.target.checked })}
                  className="size-5 accent-(--accent)"
                />
                {labels.inStock}
              </label>
            </Section>
          </div>

          {live && resultCount && (
            <p role="status" aria-live="polite" className={`shrink-0 border-t border-border px-4 pt-3 text-sm ${pending ? "text-muted" : ""}`}>
              {resultCount}
            </p>
          )}
          <div
            className={`flex shrink-0 gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] ${live && resultCount ? "" : "border-t border-border"}`}
          >
            <button type="button" onClick={clear} className="min-h-11 flex-1 rounded-button border border-border px-4 text-sm font-medium hover:bg-surface">
              {labels.clear}
            </button>
            <button type="submit" disabled={pending} className="min-h-11 flex-[2] button-primary px-4 text-sm font-medium disabled:opacity-40">
              {labels.apply}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 font-heading text-base font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

function PriceField({
  label,
  currency,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <span className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 focus-within:ring-2 focus-within:ring-(--accent)">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder={placeholder}
          className="w-full min-w-0 bg-transparent outline-none"
        />
        <span className="shrink-0 text-muted">{currency}</span>
      </span>
    </label>
  );
}
