"use client";

import { useRef, useState, type ComponentType } from "react";

import { filterCount, type ListingFilters, type ListingSort } from "@/lib/listing-filters";
import type { ProductKind } from "@/lib/query-understanding";

type Choice = { value: string; label: string; count: number };

export type FilterFacets = {
  kinds: { kind: ProductKind; label: string; count: number }[];
  categories: (Choice & { depth: number })[];
  tags: Choice[];
  options: { name: string; label: string; values: Choice[] }[];
  /** The store's custom fields offered as filters (D118), titled in the shopper's language. */
  fields: { name: string; label: string; values: Choice[] }[];
  /** The standard taxonomy's attributes (D327), titled in the shopper's language; left out by a page that offers none. */
  attributes?: { name: string; label: string; values: Choice[] }[];
  /** Number and measurement fields offered as ranges (D120): the unit they compare in, the least and most, and how that reads. */
  ranges: { name: string; label: string; unit: string; min: number; max: number; hint: string }[];
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

export type FilterDialogProps = {
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
};

/** The dialog itself (`filter-panel.tsx`), drawn while it is open; it says when it has closed. */
type PanelView = ComponentType<FilterDialogProps & { onClosed: () => void }>;

/** The dialog's module (`filter-panel.tsx`), fetched once for the page; a fetch that failed is tried again on the next press. */
let panelLoad: Promise<PanelView> | null = null;
let panelLoaded: PanelView | null = null;
function loadPanel(): Promise<PanelView> {
  panelLoad ??= import("./filter-panel").then(
    (module) => (panelLoaded = module.FilterPanel),
    (error: unknown) => {
      panelLoad = null;
      throw error;
    },
  );
  return panelLoad;
}

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
 *
 * Only the button is in the page's first scripts: the dialog (`FilterPanel`) is fetched when a pointer or the focus comes to the
 * button, or on the press. A press made before it has arrived is kept (`wanted`) and opens the dialog as it arrives.
 */
export function FilterDialog(props: FilterDialogProps) {
  const { filters, labels } = props;
  const [wanted, setWanted] = useState(false);
  const [Panel, setPanel] = useState<PanelView | null>(() => panelLoaded);
  const fetching = useRef(false);
  const chosen = filterCount(filters);

  const fetchPanel = () => {
    if (Panel || fetching.current) return;
    fetching.current = true;
    loadPanel().then(
      (view) => setPanel(() => view),
      () => {
        // Not arrived (offline, say): the press is not kept, and the next one fetches again.
        fetching.current = false;
        setWanted(false);
      },
    );
  };
  const show = () => {
    setWanted(true);
    fetchPanel();
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        onPointerEnter={fetchPanel}
        onFocus={fetchPanel}
        onTouchStart={fetchPanel}
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
      {wanted && Panel && <Panel {...props} onClosed={() => setWanted(false)} />}
    </>
  );
}
