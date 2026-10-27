/**
 * What the bulk editor's screens decide before they ask the server (D165, `docs/wave-2-data.md` 2.6), pure: the words of each action, the request a
 * form makes, which cells of the grid changed, and how a before or after figure is shown. The server checks everything again (`previewBulk()`,
 * `applyGrid()`): nothing here is trusted, it only saves a round trip and keeps the screens' wording in one place.
 */
import type { Widen } from "./admin-messages/common.en";
import { countWords, fillWords } from "./admin-fill";
import { BULK_GRID_MAX_PRODUCTS, BULK_MAX_PRODUCTS } from "./data-limits";
import { formatMoney } from "./money";

export const LIST_ACTIONS = ["status", "archive", "unarchive", "terms_add", "terms_remove", "price", "stock", "sell_in", "stop_selling_in"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];

/** The request of a list action, as the server's `BulkRequest` takes it (structurally the same). */
export type BulkRequestInput =
  | { action: "status"; productIds: string[]; to: "draft" | "active" }
  | { action: "archive" | "unarchive"; productIds: string[] }
  | { action: "terms_add" | "terms_remove"; productIds: string[]; categoryIds: string[]; tagIds: string[] }
  | { action: "price"; productIds: string[]; markets?: string[]; percent?: string; amounts?: Record<string, string> }
  | { action: "stock"; productIds: string[]; change: string }
  | { action: "sell_in" | "stop_selling_in"; productIds: string[]; markets: string[] };

const ACTIONS = {
  status: "Set status",
  archive: "Archive",
  unarchive: "Unarchive",
  terms_add: "Add to a category or tag",
  terms_remove: "Remove from a category or tag",
  price: "Change price",
  stock: "Set stock",
  grid: "Edit in a grid",
  undo: "Undo",
  sell_in: "Sell in",
  stop_selling_in: "Stop selling in",
};

export const ACTION_WORDS: Record<string, string> = ACTIONS;

/**
 * Every word this module gives a person, in English (D312 A5): the admin's `products` catalogue carries them in each language, and each
 * function takes them as its last argument, English unless given.
 */
export const BULK_WORDS = {
  actions: ACTIONS,
  chooseTerm: "Choose at least one category or tag.",
  writeStock: "Write a stock figure such as 12, or a change such as +5 or -3.",
  chooseMarket: "Choose at least one market.",
  chooseCountry: "Choose at least one country.",
  writePercent: "Write a percentage, such as -10 or 5.5.",
  writeAmounts: "Write an amount for {markets}: an amount is never applied across currencies.",
  chooseProduct: "Choose at least one product.",
  gridMax: "The grid takes at most {max} products; you chose {count}.",
  capped: "{matching} products match; a bulk action takes the first {max}. Narrow the list to take the rest.",
  none: "none",
  categories: { one: "{n} category", many: "{n} categories" },
  tags: { one: "{n} tag", many: "{n} tags" },
  terms: "{categories}, {tags}",
  archived: "archived",
  notArchived: "not archived",
  soldEverywhere: "sold in every country",
  notSoldIn: "not sold in {list}",
  price: "Price ({market})",
  fields: { status: "Status", archived: "Archived", terms: "Categories and tags", stock: "Stock", cost: "Cost", sku: "SKU", availability: "Where it is sold" },
};

export type BulkWords = Widen<typeof BULK_WORDS>;

/** An action's name in `words`, or the action itself. */
export const actionWords = (action: string, words: BulkWords = BULK_WORDS): string => (words.actions as Record<string, string>)[action] ?? action;

/** The form of the action panel: everything any action asks for, held as text. */
export type PanelForm = {
  to: "draft" | "active";
  termIds: string[];
  markets: string[];
  mode: "percent" | "amount";
  percent: string;
  amounts: Record<string, string>;
  stock: string;
  /** The countries a product is sold in again, or no longer (D335): none chosen until a person chooses. */
  countries: string[];
};

export const emptyPanel = (mainMarket: string): PanelForm => ({ to: "active", termIds: [], markets: [mainMarket], mode: "percent", percent: "", amounts: {}, stock: "", countries: [] });

/** The request a panel makes for the selected products, or the sentence saying what is missing. */
export function buildBulkRequest(
  action: ListAction,
  form: PanelForm,
  productIds: readonly string[],
  terms: readonly { id: string; kind: "category" | "tag" }[],
  words: BulkWords = BULK_WORDS,
): { ok: true; request: BulkRequestInput } | { ok: false; problem: string } {
  const ids = [...productIds];
  switch (action) {
    case "status":
      return { ok: true, request: { action, productIds: ids, to: form.to } };
    case "archive":
    case "unarchive":
      return { ok: true, request: { action, productIds: ids } };
    case "terms_add":
    case "terms_remove": {
      if (form.termIds.length === 0) return { ok: false, problem: words.chooseTerm };
      const kind = new Map(terms.map((t) => [t.id, t.kind]));
      return {
        ok: true,
        request: { action, productIds: ids, categoryIds: form.termIds.filter((id) => kind.get(id) === "category"), tagIds: form.termIds.filter((id) => kind.get(id) === "tag") },
      };
    }
    case "stock":
      return form.stock.trim() === "" ? { ok: false, problem: words.writeStock } : { ok: true, request: { action, productIds: ids, change: form.stock.trim() } };
    case "sell_in":
    case "stop_selling_in":
      return form.countries.length === 0 ? { ok: false, problem: words.chooseCountry } : { ok: true, request: { action, productIds: ids, markets: [...form.countries] } };
    case "price": {
      if (form.markets.length === 0) return { ok: false, problem: words.chooseMarket };
      if (form.mode === "percent") {
        return form.percent.trim() === "" ? { ok: false, problem: words.writePercent } : { ok: true, request: { action, productIds: ids, markets: [...form.markets], percent: form.percent.trim() } };
      }
      const missing = form.markets.filter((m) => (form.amounts[m] ?? "").trim() === "");
      if (missing.length > 0) return { ok: false, problem: fillWords(words.writeAmounts, { markets: missing.join(", ") }) };
      return { ok: true, request: { action, productIds: ids, markets: [...form.markets], amounts: Object.fromEntries(form.markets.map((m) => [m, form.amounts[m].trim()])) } };
    }
  }
}

/** Why the selection cannot go into a grid (or null), in the server's own words. */
export const gridSelectionProblem = (count: number, words: BulkWords = BULK_WORDS): string | null =>
  count < 1 ? words.chooseProduct : count > BULK_GRID_MAX_PRODUCTS ? fillWords(words.gridMax, { max: BULK_GRID_MAX_PRODUCTS, count }) : null;

/** Said when a "select all matching" is cut at the limit. */
export const cappedNote = (matching: number, words: BulkWords = BULK_WORDS): string | null =>
  matching > BULK_MAX_PRODUCTS ? fillWords(words.capped, { matching, max: BULK_MAX_PRODUCTS }) : null;

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export type GridCells = { sku: string; stock: string; cost: string; prices: Record<string, string> };

export type GridEditInput = { productId: string; variantId: string; loaded: GridCells; edited: GridCells };

const sameCells = (a: GridCells, b: GridCells): boolean =>
  a.sku === b.sku && a.stock === b.stock && a.cost === b.cost && Object.keys({ ...a.prices, ...b.prices }).every((k) => (a.prices[k] ?? "") === (b.prices[k] ?? ""));

/** The rows the member changed: only these are sent for review; each carries the value it was loaded with, so the server can tell a conflict. */
export function changedEdits(rows: readonly { productId: string; variantId: string; loaded: GridCells }[], edited: Readonly<Record<string, GridCells>>): GridEditInput[] {
  const out: GridEditInput[] = [];
  for (const row of rows) {
    const now = edited[row.variantId];
    if (now && !sameCells(row.loaded, now)) out.push({ productId: row.productId, variantId: row.variantId, loaded: row.loaded, edited: now });
  }
  return out;
}

/** How many cells of the edited rows differ from what was loaded (for the button's label). */
export function changedCellCount(edits: readonly GridEditInput[]): number {
  let n = 0;
  for (const e of edits) {
    if (e.loaded.sku !== e.edited.sku) n += 1;
    if (e.loaded.stock !== e.edited.stock) n += 1;
    if (e.loaded.cost !== e.edited.cost) n += 1;
    for (const k of Object.keys({ ...e.loaded.prices, ...e.edited.prices })) if ((e.loaded.prices[k] ?? "") !== (e.edited.prices[k] ?? "")) n += 1;
  }
  return n;
}

/** A recorded before or after figure as text: a price or a cost in its currency, stock as a number, a SKU or a status as it is, a list of terms by count. */
export function figureText(field: string, value: unknown, currencyOf: (field: string) => string | null, locale: string, words: BulkWords = BULK_WORDS): string {
  if (value === null || value === undefined) return words.none;
  if (field === "terms" && typeof value === "object") {
    const v = value as { categories?: unknown[]; tags?: unknown[] };
    const c = v.categories?.length ?? 0;
    const t = v.tags?.length ?? 0;
    return fillWords(words.terms, { categories: countWords(c, words.categories), tags: countWords(t, words.tags) });
  }
  if (field === "archived") return value === true ? words.archived : words.notArchived;
  // Where a product is not sold (D335): the countries off for the whole product, then a variant's own.
  if (field === "availability" && typeof value === "object") {
    const v = value as { off?: string[]; variants?: Record<string, string[]> };
    const parts = [...(v.off ?? []), ...Object.entries(v.variants ?? {}).filter(([, codes]) => codes.length > 0).map(([sku, codes]) => `${sku}: ${codes.join(", ")}`)];
    return parts.length === 0 ? fillWords(words.soldEverywhere, {}) : fillWords(words.notSoldIn, { list: parts.join("; ") });
  }
  const currency = currencyOf(field);
  if (currency && typeof value === "number" && Number.isSafeInteger(value)) return formatMoney(value, currency, locale);
  return String(value);
}

/** The name of a field for a person: `price:NO` is the price for NO. */
export function fieldWords(field: string, words: BulkWords = BULK_WORDS): string {
  if (field.startsWith("price:")) return fillWords(words.price, { market: field.slice(6) });
  return (words.fields as Record<string, string>)[field] ?? field;
}
