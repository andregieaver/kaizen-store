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
};
export const KIND_ORDER: readonly SavedPartKind[] = ["row", "column", "block"];

/** One template as a store sees it in a list: light, without its content (that comes when it is used). */
export type TemplateItem = {
  id: string;
  kind: SavedPartKind;
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
  /** Changes how one of this store's own saved parts is shared. */
  setSharing: (id: string, sharing: PartSharing) => Promise<TemplateResult>;
};

/** A few words for what a template holds, from the counts the server worked out. */
export function summaryText(kind: SavedPartKind, columns: number, blockNames: readonly string[]): string {
  const names = [...new Set(blockNames)].slice(0, 4).join(", ");
  if (kind === "block") return names || "Empty";
  const shape = kind === "row" ? `${columns} ${columns === 1 ? "column" : "columns"}` : "";
  return [shape, names].filter(Boolean).join(": ") || "Empty";
}
