/**
 * What the bulk editor's screens decide before they ask the server (D165, `docs/wave-2-data.md` 2.6), pure: the words of each action, the request a
 * form makes, which cells of the grid changed, and how a before or after figure is shown. The server checks everything again (`previewBulk()`,
 * `applyGrid()`): nothing here is trusted, it only saves a round trip and keeps the screens' wording in one place.
 */
import { BULK_GRID_MAX_PRODUCTS, BULK_MAX_PRODUCTS } from "./data-limits";
import { formatMoney } from "./money";

export const LIST_ACTIONS = ["status", "archive", "unarchive", "terms_add", "terms_remove", "price", "stock"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];

/** The request of a list action, as the server's `BulkRequest` takes it (structurally the same). */
export type BulkRequestInput =
  | { action: "status"; productIds: string[]; to: "draft" | "active" }
  | { action: "archive" | "unarchive"; productIds: string[] }
  | { action: "terms_add" | "terms_remove"; productIds: string[]; categoryIds: string[]; tagIds: string[] }
  | { action: "price"; productIds: string[]; markets?: string[]; percent?: string; amounts?: Record<string, string> }
  | { action: "stock"; productIds: string[]; change: string };

export const ACTION_WORDS: Record<string, string> = {
  status: "Set status",
  archive: "Archive",
  unarchive: "Unarchive",
  terms_add: "Add to a category or tag",
  terms_remove: "Remove from a category or tag",
  price: "Change price",
  stock: "Set stock",
  grid: "Edit in a grid",
  undo: "Undo",
};

/** The form of the action panel: everything any action asks for, held as text. */
export type PanelForm = {
  to: "draft" | "active";
  termIds: string[];
  markets: string[];
  mode: "percent" | "amount";
  percent: string;
  amounts: Record<string, string>;
  stock: string;
};

export const emptyPanel = (mainMarket: string): PanelForm => ({ to: "active", termIds: [], markets: [mainMarket], mode: "percent", percent: "", amounts: {}, stock: "" });

/** The request a panel makes for the selected products, or the sentence saying what is missing. */
export function buildBulkRequest(action: ListAction, form: PanelForm, productIds: readonly string[], terms: readonly { id: string; kind: "category" | "tag" }[]): { ok: true; request: BulkRequestInput } | { ok: false; problem: string } {
  const ids = [...productIds];
  switch (action) {
    case "status":
      return { ok: true, request: { action, productIds: ids, to: form.to } };
    case "archive":
    case "unarchive":
      return { ok: true, request: { action, productIds: ids } };
    case "terms_add":
    case "terms_remove": {
      if (form.termIds.length === 0) return { ok: false, problem: "Choose at least one category or tag." };
      const kind = new Map(terms.map((t) => [t.id, t.kind]));
      return {
        ok: true,
        request: { action, productIds: ids, categoryIds: form.termIds.filter((id) => kind.get(id) === "category"), tagIds: form.termIds.filter((id) => kind.get(id) === "tag") },
      };
    }
    case "stock":
      return form.stock.trim() === "" ? { ok: false, problem: "Write a stock figure such as 12, or a change such as +5 or -3." } : { ok: true, request: { action, productIds: ids, change: form.stock.trim() } };
    case "price": {
      if (form.markets.length === 0) return { ok: false, problem: "Choose at least one market." };
      if (form.mode === "percent") {
        return form.percent.trim() === "" ? { ok: false, problem: "Write a percentage, such as -10 or 5.5." } : { ok: true, request: { action, productIds: ids, markets: [...form.markets], percent: form.percent.trim() } };
      }
      const missing = form.markets.filter((m) => (form.amounts[m] ?? "").trim() === "");
      if (missing.length > 0) return { ok: false, problem: `Write an amount for ${missing.join(", ")}: an amount is never applied across currencies.` };
      return { ok: true, request: { action, productIds: ids, markets: [...form.markets], amounts: Object.fromEntries(form.markets.map((m) => [m, form.amounts[m].trim()])) } };
    }
  }
}

/** Why the selection cannot go into a grid (or null), in the server's own words. */
export const gridSelectionProblem = (count: number): string | null =>
  count < 1 ? "Choose at least one product." : count > BULK_GRID_MAX_PRODUCTS ? `The grid takes at most ${BULK_GRID_MAX_PRODUCTS} products; you chose ${count}.` : null;

/** Said when a "select all matching" is cut at the limit. */
export const cappedNote = (matching: number): string | null => (matching > BULK_MAX_PRODUCTS ? `${matching} products match; a bulk action takes the first ${BULK_MAX_PRODUCTS}. Narrow the list to take the rest.` : null);

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
export function figureText(field: string, value: unknown, currencyOf: (field: string) => string | null, locale: string): string {
  if (value === null || value === undefined) return "none";
  if (field === "terms" && typeof value === "object") {
    const v = value as { categories?: unknown[]; tags?: unknown[] };
    const c = v.categories?.length ?? 0;
    const t = v.tags?.length ?? 0;
    return `${c} ${c === 1 ? "category" : "categories"}, ${t} ${t === 1 ? "tag" : "tags"}`;
  }
  if (field === "archived") return value === true ? "archived" : "not archived";
  const currency = currencyOf(field);
  if (currency && typeof value === "number" && Number.isSafeInteger(value)) return formatMoney(value, currency, locale);
  return String(value);
}

/** The name of a field for a person: `price:NO` is the price for NO. */
export function fieldWords(field: string): string {
  if (field.startsWith("price:")) return `Price (${field.slice(6)})`;
  return ({ status: "Status", archived: "Archived", terms: "Categories and tags", stock: "Stock", cost: "Cost", sku: "SKU" } as Record<string, string>)[field] ?? field;
}
