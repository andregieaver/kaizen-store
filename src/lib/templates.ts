import type { PageRow, PageType } from "./page-content";
import type { SavedPart, SavedPartKind } from "./saved-parts";

/**
 * Templates (D125): the rows, columns and components an owner saves (D46) can be shared, and other stores use them.
 * A saved part is `private` to its store, shared with `stores` (the other stores its owner owns) or with the
 * `marketplace` (every store owner). Kaizen's own saved parts (no store) are the marketplace's first listing, published
 * by Kaizen. A store lists the templates it may see (`TemplateItem`), *activates* the ones it wants in the builder's
 * Templates tab, and uses one as a copy: the copy is the store's own from then on, so nobody else's later edit or
 * removal can change a page. Shared by the browser (the builder) and the server, which checks everything again.
 */

export const PART_SHARING = ["private", "stores", "marketplace"] as const;
export type PartSharing = (typeof PART_SHARING)[number];

export const SHARING_LABELS: Record<PartSharing, { label: string; hint: string }> = {
  private: { label: "Only this store", hint: "Nobody else can see it." },
  stores: { label: "My stores", hint: "The other stores you own can use it." },
  marketplace: { label: "Marketplace", hint: "Every store owner can find and use it, with your store's name on it." },
};

/** Where a store looks for templates: its owner's other stores, or the marketplace. */
export type TemplateSource = "stores" | "marketplace";
export const TEMPLATE_SOURCES: readonly TemplateSource[] = ["stores", "marketplace"];

export const TEMPLATE_SOURCE_LABELS: Record<TemplateSource, string> = { stores: "My stores", marketplace: "Marketplace" };

export const KIND_LABELS: Record<SavedPartKind, { one: string; many: string }> = {
  row: { one: "Row", many: "Rows" },
  column: { one: "Column", many: "Columns" },
  block: { one: "Component", many: "Components" },
  // A whole page's layout (D127).
  page: { one: "Page layout", many: "Page layouts" },
};
/** Page layouts first: the biggest building block. */
export const KIND_ORDER: readonly SavedPartKind[] = ["page", "row", "column", "block"];

/** One template as a store sees it in a list: light, without its content (that comes when it is used). */
export type TemplateItem = {
  id: string;
  kind: SavedPartKind;
  /** For a page layout (D127): the kind of page it is for, and only there can it be used; null for the rest. */
  pageType: PageType | null;
  name: string;
  /** What is in it, in a few words: "2 columns: heading, text, button". Worked out on the server from its content. */
  summary: string;
  /** Whose it is: the store's name, or "Kaizen". */
  publisher: string;
  fromKaizen: boolean;
  sharing: Exclude<PartSharing, "private">;
  /** Whether this store has switched it on for its builder's Templates tab. Kaizen's are on until a store switches them off. */
  active: boolean;
  updatedAt: string;
};

/**
 * A template as the preview shows it (D127): the same sanitised content a use would copy, drawn before anything is
 * activated or copied. `rows` is always what is drawn: a page layout's rows, a row itself, a column as a row of one
 * column, a block as a single-column row. Its pictures still point at the publisher's files: it is view-only.
 */
export type TemplatePreview = {
  id: string;
  kind: SavedPartKind;
  name: string;
  publisher: string;
  fromKaizen: boolean;
  /** For a page layout: the kind of page it is for; null for the rest. */
  pageType: PageType | null;
  summary: string;
  rows: PageRow[];
  /** A page layout's own CSS when it is clean, else empty. */
  css: string;
};

export type TemplateResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * What the builder can ask about templates, bound to the store by its routes; null on Kaizen's own pages, where
 * everything saved is already the marketplace's.
 */
export type TemplateActions = {
  /** Every template this store may see from a source (its own excluded), active or not, newest first. */
  list: (source: TemplateSource) => Promise<TemplateItem[]>;
  /** Switches a template on or off for this store. */
  setActive: (id: string, active: boolean) => Promise<TemplateResult>;
  /** A template made ready to place on a page: a copy that is not saved, with what belonged to the other store left out. */
  use: (id: string) => Promise<TemplateResult<{ part: SavedPart }>>;
  /**
   * Where a template is shown before it is activated or used (D127): the address of a page with nothing but the
   * template on it, drawn as the store's own pages are, for the builder to show in a frame. Nothing is copied or saved.
   */
  previewHref: (id: string) => string;
  /** Changes how one of this store's own saved parts is shared. */
  setSharing: (id: string, sharing: PartSharing) => Promise<TemplateResult>;
};

/** A few words for what a template holds, from the counts the server worked out. */
export function summaryText(kind: SavedPartKind, columns: number, blockNames: readonly string[]): string {
  const names = [...new Set(blockNames)].slice(0, 4).join(", ");
  if (kind === "block") return names || "Empty";
  // A page layout: `columns` is its rows.
  if (kind === "page") return [`${columns} ${columns === 1 ? "row" : "rows"}`, names].filter(Boolean).join(": ");
  const shape = kind === "row" ? `${columns} ${columns === 1 ? "column" : "columns"}` : "";
  return [shape, names].filter(Boolean).join(": ") || "Empty";
}
