/**
 * The bulk editor's rules (D165, `docs/wave-2-data.md` 2.6, 4.5), pure: what a percentage or an amount does to a price, what a stock
 * change does, which cells of a grid changed and which are in conflict, what an undo puts back, and the limits. No database: the server
 * loads the products, calls these, and writes every change through the editor's own `getProductForEdit()` and `saveProduct()` (so a
 * bulk change is validated exactly as an editor save is and prices only change through `commerce.set_price`).
 *
 * Money is integer minor units end to end. A percentage is held as BASIS POINTS (a typed 12.5 is 1,250, two decimals at most) and the new
 * amount is `floor((a x (10,000 + bp) x 2 + 10,000) / 20,000)`, i.e. half up, in BigInt. A result below 0 is a failure for that variant,
 * and a change of 0 is "unchanged" and writes nothing. The amount is the price AS THE EDITOR TYPES IT (a store selling only to
 * businesses changes prices without VAT). Omnibus: a lowered price is shown to shoppers as a reduction against the lowest price of the
 * previous 30 days, from the price history `commerce.set_price` keeps; nothing here writes a reduction any other way.
 */
import { BULK_GRID_MAX_PRODUCTS, BULK_MAX_PRODUCTS, BULK_PERCENT_MAX, BULK_PERCENT_MIN, BULK_STOCK_MAX, BULK_UNDO_DAYS } from "./data-limits";
import { parsePrice } from "./product-input";

export const BULK_ACTIONS = ["status", "archive", "unarchive", "terms_add", "terms_remove", "price", "stock", "grid", "undo"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** The fields an item records: `price:{COUNTRY}` too. */
export type BulkField = "status" | "archived" | "terms" | "stock" | "cost" | "sku" | `price:${string}`;

/** One cell that changes: the value it has and the value it gets (figures and codes: minor units, a word, a list of ids). */
export type Change = { productId: string; variantId: string | null; field: BulkField; before: unknown; after: unknown };
/** A product or variant that could not be changed, with the reason in the editor's own words. */
export type Failure = { productId: string; variantId?: string | null; sku?: string; reason: string };

export const SELECTION_SENTENCES = {
  none: "Choose at least one product.",
  list: (n: number) => `You chose ${n} products and a bulk action takes at most ${BULK_MAX_PRODUCTS}. Choose fewer, or narrow the filter.`,
  grid: (n: number) => `You chose ${n} products and the grid takes at most ${BULK_GRID_MAX_PRODUCTS}. Choose fewer.`,
};

/** Why a selection is too large (or empty); null when it is fine. */
export function selectionProblem(count: number, mode: "list" | "grid"): string | null {
  if (count < 1) return SELECTION_SENTENCES.none;
  const max = mode === "grid" ? BULK_GRID_MAX_PRODUCTS : BULK_MAX_PRODUCTS;
  return count > max ? SELECTION_SENTENCES[mode](count) : null;
}

/** Whether "Select all N matching" is capped, and said in words. */
export function matchingNote(matching: number): string | null {
  return matching > BULK_MAX_PRODUCTS ? `${matching} products match, and a bulk action takes the first ${BULK_MAX_PRODUCTS}. Narrow the filter to take the rest.` : null;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** A typed percentage ("12.5", "-10", "+5,25") as basis points, or null: at most two decimals, either mark, an optional sign. */
export function parsePercentBp(text: string): number | null {
  const match = /^([+-]?)(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] === "-" ? -bp : bp;
}

/** Whether basis points are inside what a bulk change may do (-90 % to +500 %). */
export const percentInRange = (bp: number): boolean => bp >= BULK_PERCENT_MIN * 100 && bp <= BULK_PERCENT_MAX * 100;

export function percentProblem(text: string): string | null {
  const bp = parsePercentBp(text);
  if (bp === null) return "Write a percentage such as -10 or 12.5, with at most two decimals.";
  if (!percentInRange(bp)) return `A price changes by at most ${BULK_PERCENT_MIN} % to +${BULK_PERCENT_MAX} % at once.`;
  return null;
}

/** An amount's change typed in a market's currency ("5", "+5,50", "-20"), as signed minor units; null when it is not one. */
export function parseDelta(text: string, currency: string): number | null {
  const t = text.trim();
  const sign = t.startsWith("-") ? -1 : 1;
  const minor = parsePrice(t.replace(/^[+-]/, ""), currency);
  return minor === null ? null : sign * minor;
}

/** `a` changed by `bp` basis points, half up to the minor unit, in BigInt. */
export function applyPercent(minor: number, bp: number): number {
  const a = BigInt(minor);
  const num = a * (BigInt(10_000) + BigInt(bp)) * BigInt(2) + BigInt(10_000);
  // BigInt division truncates; the numerator is never negative (a price is not, and bp is at least -9,000).
  return Number(num / BigInt(20_000));
}

export type PriceChange = { kind: "percent"; bp: number } | { kind: "amount"; deltaByMarket: Record<string, number> };

export type PriceResult = { ok: true; minor: number } | { ok: false; reason: string };
export const NEGATIVE_PRICE = "The new price would be below 0.";

/** The new price of one price, or why not. A price the variant has not got is never asked about. */
export function changePrice(minor: number, change: PriceChange, market: string): PriceResult {
  const next = change.kind === "percent" ? applyPercent(minor, change.bp) : minor + (change.deltaByMarket[market] ?? 0);
  return next < 0 ? { ok: false, reason: NEGATIVE_PRICE } : { ok: true, minor: next };
}

/** A variant with the prices it has as the editor types them, in minor units by market (a market it has no price in is absent or null). */
export type VariantPrices = { productId: string; variantId: string; sku: string; prices: Record<string, number | null | undefined> };

export type PlanResult = { changes: Change[]; unchanged: number; failures: Failure[] };

/** What a price change does to each variant in the chosen markets: changes, variants left as they are, and failures (below 0). */
export function planPriceChanges(variants: readonly VariantPrices[], change: PriceChange, markets: readonly string[]): PlanResult {
  const out: PlanResult = { changes: [], unchanged: 0, failures: [] };
  for (const v of variants) {
    const mine: Change[] = [];
    let failed = false;
    for (const market of markets) {
      const before = v.prices[market];
      if (before === null || before === undefined) continue;
      const result = changePrice(before, change, market);
      if (!result.ok) {
        out.failures.push({ productId: v.productId, variantId: v.variantId, sku: v.sku, reason: result.reason });
        failed = true;
        break;
      }
      if (result.minor !== before) mine.push({ productId: v.productId, variantId: v.variantId, field: `price:${market}`, before, after: result.minor });
    }
    if (failed) continue;
    if (mine.length === 0) out.unchanged += 1;
    else out.changes.push(...mine);
  }
  return out;
}

/** The first few before and after figures of a price change, for the confirmation. */
export function pricePreview(changes: readonly Change[], limit = 5): { productId: string; variantId: string | null; market: string; before: number; after: number }[] {
  return changes
    .filter((c) => c.field.startsWith("price:"))
    .slice(0, limit)
    .map((c) => ({ productId: c.productId, variantId: c.variantId, market: c.field.slice(6), before: c.before as number, after: c.after as number }));
}

/** The sentence the confirmation of any price change carries (Omnibus, Directive 98/6/EC Art. 6a): a person should read it. */
export const OMNIBUS_SENTENCE = "Lowering a price shows shoppers a reduction against the lowest price of the last 30 days.";

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export type StockChange = { kind: "set"; value: number } | { kind: "adjust"; delta: number };

/** A typed stock change: a number sets it ("12"), a signed one adjusts it ("+5", "-3"); null when it is neither. */
export function parseStockChange(text: string): StockChange | null {
  const t = text.trim();
  if (/^\d{1,7}$/.test(t)) return { kind: "set", value: Number(t) };
  if (/^[+-]\d{1,7}$/.test(t)) return { kind: "adjust", delta: Number(t) };
  return null;
}

export const STOCK_SENTENCES = {
  negative: "The stock would be below 0.",
  over: `Stock is at most ${BULK_STOCK_MAX.toLocaleString("en")}.`,
  digital: "A download has no stock.",
};

export type VariantStock = { productId: string; variantId: string; sku: string; stock: number; delivery: "physical" | "digital" | "service" };

/** What a stock change does to each variant; downloads are skipped with the reason, a result outside 0 to 1,000,000 fails. */
export function planStockChanges(variants: readonly VariantStock[], change: StockChange): PlanResult & { skipped: Failure[] } {
  const out: PlanResult & { skipped: Failure[] } = { changes: [], unchanged: 0, failures: [], skipped: [] };
  for (const v of variants) {
    if (v.delivery === "digital") {
      out.skipped.push({ productId: v.productId, variantId: v.variantId, sku: v.sku, reason: STOCK_SENTENCES.digital });
      continue;
    }
    const next = change.kind === "set" ? change.value : v.stock + change.delta;
    if (next < 0) out.failures.push({ productId: v.productId, variantId: v.variantId, sku: v.sku, reason: STOCK_SENTENCES.negative });
    else if (next > BULK_STOCK_MAX) out.failures.push({ productId: v.productId, variantId: v.variantId, sku: v.sku, reason: STOCK_SENTENCES.over });
    else if (next === v.stock) out.unchanged += 1;
    else out.changes.push({ productId: v.productId, variantId: v.variantId, field: "stock", before: v.stock, after: next });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status, archive and terms
// ---------------------------------------------------------------------------

export type ProductState = { productId: string; status: "draft" | "active"; archived: boolean };

/** Set the status of products: the product that already has it is unchanged. Active goes through the editor's publish check at the save. */
export function planStatus(products: readonly ProductState[], to: "draft" | "active"): PlanResult {
  const out: PlanResult = { changes: [], unchanged: 0, failures: [] };
  for (const p of products) {
    if (!p.archived && p.status === to) out.unchanged += 1;
    else out.changes.push({ productId: p.productId, variantId: null, field: "status", before: p.archived ? "archived" : p.status, after: to });
  }
  return out;
}

/** Archive or unarchive (back to a draft, as the editor's button does). */
export function planArchive(products: readonly ProductState[], archive: boolean): PlanResult {
  const out: PlanResult = { changes: [], unchanged: 0, failures: [] };
  for (const p of products) {
    if (p.archived === archive) out.unchanged += 1;
    else out.changes.push({ productId: p.productId, variantId: null, field: "archived", before: p.archived, after: archive });
  }
  return out;
}

export type ProductTerms = { productId: string; categories: readonly string[]; tags: readonly string[] };
export type TermChoice = { categories: readonly string[]; tags: readonly string[] };

const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();

/** Add terms to, or take them from, products. The change records the whole sorted lists before and after. */
export function planTerms(products: readonly ProductTerms[], op: "add" | "remove", choice: TermChoice): PlanResult {
  const out: PlanResult = { changes: [], unchanged: 0, failures: [] };
  for (const p of products) {
    const apply = (have: readonly string[], pick: readonly string[]) => sorted(op === "add" ? [...have, ...pick] : have.filter((id) => !pick.includes(id)));
    const before = { categories: sorted(p.categories), tags: sorted(p.tags) };
    const after = { categories: apply(p.categories, choice.categories), tags: apply(p.tags, choice.tags) };
    if (same(before, after)) out.unchanged += 1;
    else out.changes.push({ productId: p.productId, variantId: null, field: "terms", before, after });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** The cells of one variant's row as typed text: SKU, stock, cost (main currency, without VAT) and a price per market as the editor types it. */
export type GridCells = { sku: string; stock: string; cost: string; prices: Record<string, string> };
export type GridRow = { productId: string; variantId: string; loaded: GridCells; current: GridCells; edited: GridCells };
export type GridMarket = { code: string; currency: string };

export type Conflict = { productId: string; variantId: string; field: BulkField; current: unknown };
export type Invalid = { productId: string; variantId: string; field: BulkField; reason: string };

/** A typed cell as the value it stands for: minor units, a whole number, a SKU. `undefined` when it is not valid. */
export function cellValue(field: BulkField, typed: string, markets: readonly GridMarket[], mainCurrency: string): unknown {
  const t = typed.trim();
  if (field === "sku") return t === "" ? undefined : t.length > 64 ? undefined : t;
  if (field === "stock") return /^\d{1,7}$/.test(t) && Number(t) <= BULK_STOCK_MAX ? Number(t) : undefined;
  if (field === "cost") return t === "" ? null : (parsePrice(t, mainCurrency) ?? undefined);
  const market = markets.find((m) => `price:${m.code}` === field);
  if (!market) return undefined;
  return t === "" ? null : (parsePrice(t, market.currency) ?? undefined);
}

const GRID_REASONS: Record<string, string> = {
  sku: "Every variant needs a SKU of at most 64 characters.",
  stock: `Stock is a whole number from 0 to ${BULK_STOCK_MAX.toLocaleString("en")}.`,
  cost: "Cost is an amount in the store's main currency, or empty.",
  price: "A price is an amount in the market's currency, or empty for none.",
};

export type GridPlan = PlanResult & { conflicts: Conflict[]; invalid: Invalid[] };

const FIELDS_OF = (markets: readonly GridMarket[]): BulkField[] => ["sku", "stock", "cost", ...markets.map((m) => `price:${m.code}` as BulkField)];
const typedOf = (cells: GridCells, field: BulkField): string => (field === "sku" ? cells.sku : field === "stock" ? cells.stock : field === "cost" ? cells.cost : (cells.prices[field.slice(6)] ?? ""));

/**
 * What a grid's edits come to. A cell is looked at only when it was edited (its text differs from what the page loaded). If the stored
 * value changed since the page loaded it, the cell is a conflict and is not overwritten (and says what is there now); else a cell that
 * is not valid is listed with the reason; else it is a change from the loaded value to the typed one. A typed value equal to the stored
 * one is unchanged.
 */
export function planGrid(rows: readonly GridRow[], markets: readonly GridMarket[], mainCurrency: string): GridPlan {
  const out: GridPlan = { changes: [], unchanged: 0, failures: [], conflicts: [], invalid: [] };
  for (const row of rows) {
    for (const field of FIELDS_OF(markets)) {
      const loadedText = typedOf(row.loaded, field);
      const editedText = typedOf(row.edited, field);
      if (loadedText === editedText) continue;
      const currentValue = cellValue(field, typedOf(row.current, field), markets, mainCurrency);
      const loadedValue = cellValue(field, loadedText, markets, mainCurrency);
      if (!same(currentValue, loadedValue)) {
        out.conflicts.push({ productId: row.productId, variantId: row.variantId, field, current: currentValue ?? null });
        continue;
      }
      const after = cellValue(field, editedText, markets, mainCurrency);
      if (after === undefined) {
        out.invalid.push({ productId: row.productId, variantId: row.variantId, field, reason: GRID_REASONS[field.startsWith("price:") ? "price" : field] });
        continue;
      }
      if (same(after, loadedValue)) out.unchanged += 1;
      else out.changes.push({ productId: row.productId, variantId: row.variantId, field, before: loadedValue ?? null, after });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** The same JSON with its object keys in order: `jsonb` stores an object's keys by length and then by name, so a value read back from the record may list them in another order than the one written. */
const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export type RecordedItem = { productId: string; variantId: string | null; field: BulkField; before: unknown; after: unknown; outcome: "changed" | "unchanged" | "failed" | "undone" };

/** The value now stored for a cell, or `undefined` when the product or variant is gone. */
export type CurrentValue = (productId: string, variantId: string | null, field: BulkField) => unknown;

export type UndoPlan = {
  /** Each cell to put back: from what it is now (the batch's `after`) to the batch's `before`. */
  restores: Change[];
  /** Cells that changed since the batch, which are left and listed with what is there now. */
  conflicts: Conflict[];
  /** Cells of a product or variant that no longer exists. */
  gone: { productId: string; variantId: string | null; field: BulkField }[];
};

/** Puts each changed cell back only where its stored value is still the batch's `after`; anything else is left and listed. */
export function undoPlan(items: readonly RecordedItem[], current: CurrentValue): UndoPlan {
  const out: UndoPlan = { restores: [], conflicts: [], gone: [] };
  for (const item of items) {
    if (item.outcome !== "changed") continue;
    const now = current(item.productId, item.variantId, item.field);
    if (now === undefined) out.gone.push({ productId: item.productId, variantId: item.variantId, field: item.field });
    else if (same(now, item.after)) out.restores.push({ productId: item.productId, variantId: item.variantId, field: item.field, before: item.after, after: item.before });
    else out.conflicts.push({ productId: item.productId, variantId: item.variantId ?? "", field: item.field, current: now });
  }
  return out;
}

/** Whether a batch can still be undone: made within `BULK_UNDO_DAYS`, not an undo, not undone already. */
export function canUndo(batch: { action: BulkAction; createdAt: Date; undoneAt: Date | null }, now: Date): boolean {
  if (batch.action === "undo" || batch.undoneAt !== null) return false;
  return now.getTime() - batch.createdAt.getTime() <= BULK_UNDO_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// Counts and the audit entry
// ---------------------------------------------------------------------------

export type BatchCounts = { products: number; changed: number; unchanged: number; failed: number };

/** The counts of a batch in PRODUCTS: changed when any of its cells changed, failed when any failed, else unchanged. */
export function batchCounts(selected: readonly string[], changes: readonly Change[], failures: readonly Failure[]): BatchCounts {
  const changed = new Set(changes.map((c) => c.productId));
  const failed = new Set(failures.map((f) => f.productId));
  const ids = new Set(selected);
  let c = 0;
  let f = 0;
  for (const id of ids) {
    if (failed.has(id)) f += 1;
    else if (changed.has(id)) c += 1;
  }
  return { products: ids.size, changed: c, unchanged: ids.size - c - f, failed: f };
}

/** What the ONE audit entry of a batch holds: the action, counts and the batch id; never a title, a SKU or a price. */
export function auditDetails(action: BulkAction, counts: BatchCounts, batchId: string): Record<string, unknown> {
  return { action, products: counts.products, succeeded: counts.changed + counts.unchanged, changed: counts.changed, failed: counts.failed, batchId };
}

/** The audit action of a batch: an undo has its own. */
export const auditActionOf = (action: BulkAction): "products.bulk_edited" | "products.bulk_undone" => (action === "undo" ? "products.bulk_undone" : "products.bulk_edited");
