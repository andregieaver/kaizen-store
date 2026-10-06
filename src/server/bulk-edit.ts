import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  BULK_ACTIONS,
  auditActionOf,
  auditDetails,
  batchCounts,
  canUndo,
  parseDelta,
  parsePercentBp,
  parseStockChange,
  percentProblem,
  planArchive,
  planGrid,
  planPriceChanges,
  planStatus,
  planStockChanges,
  planTerms,
  pricePreview,
  selectionProblem,
  undoPlan,
  type BatchCounts,
  type BulkAction,
  type BulkField,
  type Change,
  type Failure,
  type GridRow,
  type PlanResult,
  type PriceChange,
  type RecordedItem,
  type StockChange,
} from "@/lib/bulk-edit";
import { BULK_GRID_MARKETS_MAX, BULK_MAX_PRODUCTS, DATA_JOB_BUDGET_MS } from "@/lib/data-limits";
import { formatPriceInput, parsePrice, type ProductInput } from "@/lib/product-input";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { fieldsTag } from "./custom-fields";
import { refreshStoreEmbeddings } from "./embeddings";
import { NO_ACCESS, memberCan } from "./permissions";
import { pgUuidArray } from "./pg-arrays";
import { getEditorContext, getProductForEdit, saveProduct, setArchived, type EditorContext, type StockMode } from "./products";
import { refreshTag } from "./refresh";
import type { Store } from "./stores";
import { listTerms } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * The bulk editor (D165, `docs/wave-2-data.md` 2.6, 4.5): actions on many products of the list and a grid of their variants, each through the editor's
 * own door (`getProductForEdit()`, the change laid over it, `saveProduct()`), so a bulk change is validated exactly as an editor save is and a price
 * only changes through `commerce.set_price` inside it. An archive or an unarchive is `setArchived()`. The rules (percentages in basis points, half up
 * on integer minor units, stock, terms, the diff and the undo) are `src/lib/bulk-edit.ts`'s; this module reads, plans with them, writes, and records.
 *
 * Every change is recorded in `commerce.bulk_edit_items` with its value before and after (the batch is created before the first product is written, so a
 * run that stops loses at most the product it was in), which is what the undo of seven days reads. A run is resumable: the selection is in the batch's
 * `params`, a product is processed once (it leaves an item, even when nothing changed), runs are serialised per batch by an advisory lock so two clicks do
 * not change a price twice, and a run goes on until its time is up. One audit entry per batch (`products.bulk_edited`) when the last product is done, and one
 * per undo (`products.bulk_undone`): counts and the batch id, never a title or a price.
 */

const WRITE = "products:write" as const;

export type BulkRequest =
  | { action: "status"; productIds: string[]; to: "draft" | "active" }
  | { action: "archive" | "unarchive"; productIds: string[] }
  | { action: "terms_add" | "terms_remove"; productIds: string[]; categoryIds: string[]; tagIds: string[] }
  | { action: "price"; productIds: string[]; markets?: string[]; percent?: string; amounts?: Record<string, string> }
  | { action: "stock"; productIds: string[]; change: string };

type Params = Record<string, unknown> & { productIds: string[] };

export type BulkFailure = { productId: string; handle: string | null; title: string | null; sku: string | null; field: string; reason: string };

export type BulkPreview = {
  ok: true;
  action: BulkAction;
  counts: BatchCounts;
  /** The first five before and after figures of a price change, with the product they belong to. */
  prices: { productId: string; title: string; sku: string; market: string; currency: string; before: number; after: number }[];
  failures: BulkFailure[];
  /** Products named that are not the store's: never changed. */
  notFound: number;
};

export type BulkProblem = { ok: false; problem: string };

const uuid = z.uuid();
const dedupe = (ids: readonly string[]): string[] => [...new Set(ids)];

// ---------------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------------

export type LoadedProduct = { id: string; handle: string; title: string; input: ProductInput; archived: boolean };

async function loadProducts(store: Store, editor: EditorContext, ids: readonly string[]): Promise<{ loaded: Map<string, LoadedProduct>; notFound: string[] }> {
  const rows = ids.length === 0 ? [] : await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and id = any(${pgUuidArray(ids)}::uuid[])`);
  const have = new Set(rows.map((r) => String(r.id)));
  const loaded = new Map<string, LoadedProduct>();
  const queue = [...have];
  const lane = async () => {
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const product = await getProductForEdit(store, editor, id);
      if (!product) continue;
      const { archived, ...input } = product;
      const title = input.translations.find((t) => t.locale === editor.primaryLocale)?.title || input.handle;
      loaded.set(id, { id, handle: input.handle, title, input, archived });
    }
  };
  await Promise.all(Array.from({ length: 6 }, lane));
  return { loaded, notFound: ids.filter((id) => !loaded.has(id)) };
}

const priceMinor = (input: ProductInput, variantIndex: number, code: string, currency: string): number | null => {
  const typed = input.variants[variantIndex]?.prices[code];
  return typed ? parsePrice(typed, currency) : null;
};

// ---------------------------------------------------------------------------
// Planning an action
// ---------------------------------------------------------------------------

type Planned = { plan: PlanResult & { skipped?: Failure[] }; priceChange?: PriceChange; markets?: { code: string; currency: string }[] };

function parseRequest(store: Store, editor: EditorContext, request: BulkRequest): { ok: true; priceChange?: PriceChange; markets?: { code: string; currency: string }[]; stock?: StockChange; params: Params } | BulkProblem {
  const productIds = dedupe(request.productIds ?? []);
  if (productIds.some((id) => !uuid.safeParse(id).success)) return { ok: false, problem: "A product in the selection is not one of this store's." };
  const problem = selectionProblem(productIds.length, "list");
  if (problem) return { ok: false, problem };
  const base: Params = { productIds };
  switch (request.action) {
    case "status":
      return request.to === "draft" || request.to === "active" ? { ok: true, params: { ...base, to: request.to } } : { ok: false, problem: "Choose draft or active." };
    case "archive":
    case "unarchive":
      return { ok: true, params: base };
    case "terms_add":
    case "terms_remove": {
      const categoryIds = dedupe(request.categoryIds ?? []);
      const tagIds = dedupe(request.tagIds ?? []);
      if (categoryIds.length + tagIds.length === 0) return { ok: false, problem: "Choose at least one category or tag." };
      const known = new Set(editor.terms.map((t) => t.id));
      if ([...categoryIds, ...tagIds].some((id) => !known.has(id))) return { ok: false, problem: "A category or tag you chose no longer exists." };
      return { ok: true, params: { ...base, categoryIds, tagIds } };
    }
    case "stock": {
      const change = parseStockChange(request.change ?? "");
      if (!change) return { ok: false, problem: "Write a stock figure such as 12, or a change such as +5 or -3." };
      return { ok: true, stock: change, params: { ...base, change: request.change.trim() } };
    }
    case "price": {
      const wanted = dedupe(request.markets && request.markets.length > 0 ? request.markets.map((m) => m.toUpperCase()) : [store.markets[0]?.code ?? ""]);
      const markets = wanted.map((code) => editor.markets.find((m) => m.code === code)).filter((m): m is NonNullable<typeof m> => m !== undefined);
      if (markets.length === 0 || markets.length !== wanted.length) return { ok: false, problem: "Choose markets of this store." };
      const picked = markets.map((m) => ({ code: m.code, currency: m.currency }));
      const hasPercent = typeof request.percent === "string" && request.percent.trim() !== "";
      const hasAmounts = request.amounts !== undefined && Object.values(request.amounts).some((v) => v.trim() !== "");
      if (hasPercent === hasAmounts) return { ok: false, problem: "Give a percentage or an amount, not both." };
      if (hasPercent) {
        const bad = percentProblem(request.percent as string);
        if (bad) return { ok: false, problem: bad };
        return { ok: true, priceChange: { kind: "percent", bp: parsePercentBp(request.percent as string) as number }, markets: picked, params: { ...base, markets: picked.map((m) => m.code), percent: (request.percent as string).trim() } };
      }
      const deltaByMarket: Record<string, number> = {};
      for (const m of picked) {
        const delta = parseDelta(request.amounts?.[m.code] ?? "", m.currency);
        if (delta === null) return { ok: false, problem: `Give an amount in ${m.currency} for ${m.code}: an amount is never applied across currencies.` };
        deltaByMarket[m.code] = delta;
      }
      return { ok: true, priceChange: { kind: "amount", deltaByMarket }, markets: picked, params: { ...base, markets: picked.map((m) => m.code), amounts: request.amounts } };
    }
    default:
      return { ok: false, problem: "Choose an action." };
  }
}

/** What an action does to the loaded products now: its changes, the variants left as they are and the failures. */
function planAction(action: BulkAction, products: readonly LoadedProduct[], parsed: Extract<ReturnType<typeof parseRequest>, { ok: true }>): Planned {
  switch (action) {
    case "status":
      return { plan: planStatus(products.map((p) => ({ productId: p.id, status: p.input.status, archived: p.archived })), parsed.params.to as "draft" | "active") };
    case "archive":
    case "unarchive":
      return { plan: planArchive(products.map((p) => ({ productId: p.id, status: p.input.status, archived: p.archived })), action === "archive") };
    case "terms_add":
    case "terms_remove":
      return {
        plan: planTerms(products.map((p) => ({ productId: p.id, categories: p.input.categories, tags: p.input.tags })), action === "terms_add" ? "add" : "remove", {
          categories: parsed.params.categoryIds as string[],
          tags: parsed.params.tagIds as string[],
        }),
      };
    case "stock":
      return {
        plan: planStockChanges(
          products.flatMap((p) =>
            p.input.variants.flatMap((v) => (v.id ? [{ productId: p.id, variantId: v.id, sku: v.sku, stock: v.stock, delivery: v.delivery }] : [])),
          ),
          parsed.stock as StockChange,
        ),
      };
    case "price": {
      const markets = parsed.markets ?? [];
      const variants = products.flatMap((p) =>
        p.input.variants.flatMap((v, i) =>
          v.id ? [{ productId: p.id, variantId: v.id, sku: v.sku, prices: Object.fromEntries(markets.map((m) => [m.code, priceMinor(p.input, i, m.code, m.currency)])) }] : [],
        ),
      );
      return { plan: planPriceChanges(variants, parsed.priceChange as PriceChange, markets.map((m) => m.code)), priceChange: parsed.priceChange, markets };
    }
    default:
      return { plan: { changes: [], unchanged: 0, failures: [] } };
  }
}

const failureOf = (p: LoadedProduct | undefined, f: Failure): BulkFailure => ({
  productId: f.productId,
  handle: p?.handle ?? null,
  title: p?.title ?? null,
  sku: f.sku ?? null,
  field: "",
  reason: f.reason,
});

/** The confirmation of a bulk action: how many products it would change, the first five prices before and after, and what would fail. Writes nothing. */
export async function previewBulk(member: Membership, request: BulkRequest): Promise<BulkPreview | BulkProblem> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const editor = await getEditorContext(member.store);
  const parsed = parseRequest(member.store, editor, request);
  if (!parsed.ok) return parsed;
  const ids = parsed.params.productIds;
  const { loaded, notFound } = await loadProducts(member.store, editor, ids);
  const products = ids.flatMap((id) => (loaded.has(id) ? [loaded.get(id) as LoadedProduct] : []));
  const planned = planAction(request.action, products, parsed);
  const failures = [...planned.plan.failures, ...(planned.plan.skipped ?? [])];
  const byId = loaded;
  const counts = batchCounts(ids.filter((id) => loaded.has(id)), planned.plan.changes, failures);
  const currencyOf = (code: string) => editor.markets.find((m) => m.code === code)?.currency ?? "";
  return {
    ok: true,
    action: request.action,
    counts,
    prices: pricePreview(planned.plan.changes, 5).map((c) => {
      const p = byId.get(c.productId);
      const sku = p?.input.variants.find((v) => v.id === c.variantId)?.sku ?? "";
      return { productId: c.productId, title: p?.title ?? "", sku, market: c.market, currency: currencyOf(c.market), before: c.before, after: c.after };
    }),
    failures: failures.map((f) => failureOf(byId.get(f.productId), f)),
    notFound: notFound.length,
  };
}

// ---------------------------------------------------------------------------
// Writing a product's changes
// ---------------------------------------------------------------------------

const fieldOfStatus = (a: BulkAction): BulkField => (a === "archive" || a === "unarchive" ? "archived" : a === "terms_add" || a === "terms_remove" ? "terms" : a === "price" ? "status" : "status");

/** Lays a product's changes over the editor's product. Null when all could be laid; else the reason one could not. */
function layOver(input: ProductInput, changes: readonly Change[], editor: EditorContext, adjust = false): string | null {
  for (const c of changes) {
    if (c.field === "status") {
      if (c.after === "active" || c.after === "draft") input.status = c.after;
      continue;
    }
    if (c.field === "terms") {
      const after = c.after as { categories: string[]; tags: string[] };
      input.categories = [...after.categories];
      input.tags = [...after.tags];
      continue;
    }
    const variant = input.variants.find((v) => v.id === c.variantId);
    if (!variant) return "This variant no longer exists.";
    // An adjustment ("+5") is the change laid over the stock as it is now, not the figure worked out from an earlier read.
    if (c.field === "stock") variant.stock = adjust ? Math.max(0, variant.stock + (Number(c.after) - Number(c.before))) : (c.after as number);
    else if (c.field === "sku") variant.sku = String(c.after);
    else if (c.field === "cost") variant.cost = c.after === null ? "" : formatPriceInput(c.after as number, editor.mainCurrency);
    else if (c.field.startsWith("price:")) {
      const code = c.field.slice(6);
      const market = editor.markets.find((m) => m.code === code);
      if (!market) return "This market no longer exists.";
      if (c.after === null) delete variant.prices[code];
      else variant.prices[code] = formatPriceInput(c.after as number, market.currency);
    }
  }
  return null;
}

type Outcome = { ok: true } | { ok: false; reason: string };

/** The editor's sentence for a product that could not be saved, with what a person typed taken out of it. */
const sentence = (problem: string): string => problem.replace(/"[^"]*"/g, "…").slice(0, 400);

/**
 * Writes one product's changes: an archive or unarchive through `setArchived()`, everything else laid over the editor's product and saved by
 * `saveProduct()` (all of it or nothing). A product that was archived stays archived unless the change says otherwise (the editor's save would
 * make it a draft).
 */
async function writeProduct(store: Store, editor: EditorContext, product: LoadedProduct, changes: readonly Change[], adjust = false, by: { accountId: string; batchId: string } | null = null): Promise<Outcome> {
  const archiveChange = changes.find((c) => c.field === "archived");
  const rest = changes.filter((c) => c.field !== "archived");
  const statusChange = rest.find((c) => c.field === "status");
  if (archiveChange) {
    const ok = await setArchived(store, product.id, archiveChange.after === true);
    return ok ? { ok: true } : { ok: false, reason: "This product no longer exists." };
  }
  if (statusChange && statusChange.after === "archived") {
    const ok = await setArchived(store, product.id, true);
    return ok ? { ok: true } : { ok: false, reason: "This product no longer exists." };
  }
  if (rest.length === 0) return { ok: true };
  // With several stock locations a product's stock is a total (D172): the Inventory page sets one location's figure with a reason, this grid cannot.
  if (editor.activeLocations > 1 && rest.some((c) => c.field === "stock")) return { ok: false, reason: "This store has several stock locations: change stock on the Inventory page." };
  const fresh = await getProductForEdit(store, editor, product.id);
  if (!fresh) return { ok: false, reason: "This product no longer exists." };
  const { archived, ...input } = fresh;
  // Stock as it is now: a variant whose stock the change leaves alone is not written (a sale paid since the read stays paid), an adjustment is relative.
  const stockMode: StockMode = { loaded: new Map(input.variants.flatMap((v) => (v.id ? [[v.id, v.stock] as const] : []))), relative: adjust, source: "bulk", accountId: by?.accountId ?? null, jobId: by?.batchId ?? null };
  const problem = layOver(input, rest, editor, adjust);
  if (problem) return { ok: false, reason: problem };
  const saved = await saveProduct(store, editor, product.id, input, undefined, undefined, undefined, stockMode);
  if (!saved.ok) return { ok: false, reason: sentence(saved.problems[0] ?? "The product could not be saved.") };
  // Unless the change was a status, an archived product is put back where it was.
  if (archived && !statusChange) await setArchived(store, product.id, true);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The batch and its items
// ---------------------------------------------------------------------------

async function createBatch(member: Membership, action: BulkAction, params: Params, counts: Record<string, unknown>, undoOf: string | null = null): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.bulk_edit_batches (store_id, requested_by, action, params, counts, undo_of)
    values (${member.store.id}::uuid, ${member.account.id}::uuid, ${action}, ${JSON.stringify(params)}::jsonb, ${JSON.stringify(counts)}::jsonb, ${undoOf}::uuid)
    returning id
  `);
  return String(row.id);
}

type ItemRow = { productId: string; variantId: string | null; field: BulkField; before: unknown; after: unknown; outcome: "changed" | "unchanged" | "failed"; reason: string | null };

async function putBatchItems(storeId: string, batchId: string, items: readonly ItemRow[]): Promise<void> {
  if (items.length === 0) return;
  const [next] = await db().execute<Row>(sql`select coalesce(max(seq), -1) + 1 as n from commerce.bulk_edit_items where store_id = ${storeId}::uuid and batch_id = ${batchId}::uuid`);
  let seq = Number(next?.n ?? 0);
  for (let start = 0; start < items.length; start += 200) {
    const part = items.slice(start, start + 200);
    const values = part.map(
      (i) => sql`(${storeId}::uuid, ${batchId}::uuid, ${seq++}, ${i.productId}::uuid, ${i.variantId}::uuid, ${i.field}, ${JSON.stringify(i.before ?? null)}::jsonb, ${JSON.stringify(i.after ?? null)}::jsonb, ${i.outcome}, ${i.reason})`,
    );
    await db().execute(sql`
      insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, variant_id, field, before, after, outcome, reason)
      values ${sql.join(values, sql`, `)}
    `);
  }
}

/** The products of a batch that already have an item: they are done. */
async function processedOf(storeId: string, batchId: string): Promise<Set<string>> {
  const rows = await db().execute<Row>(sql`select distinct product_id from commerce.bulk_edit_items where store_id = ${storeId}::uuid and batch_id = ${batchId}::uuid`);
  return new Set(rows.map((r) => String(r.product_id)));
}

export type BatchRow = { id: string; action: BulkAction; params: Params; undoOf: string | null; counts: Record<string, unknown>; createdAt: string; undoneAt: string | null; requestedBy: string };

async function getBatchRow(storeId: string, batchId: string): Promise<BatchRow | null> {
  if (!uuid.safeParse(batchId).success) return null;
  const [row] = await db().execute<Row>(sql`select * from commerce.bulk_edit_batches where store_id = ${storeId}::uuid and id = ${batchId}::uuid`);
  if (!row) return null;
  return {
    id: String(row.id),
    action: String(row.action) as BulkAction,
    params: (row.params ?? {}) as Params,
    undoOf: row.undo_of ? String(row.undo_of) : null,
    counts: (row.counts ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
    undoneAt: row.undone_at ? new Date(String(row.undone_at)).toISOString() : null,
    requestedBy: String(row.requested_by),
  };
}

// ---------------------------------------------------------------------------
// Running a batch
// ---------------------------------------------------------------------------

export type BulkProgress = { ok: true; batchId: string; done: boolean; processed: number; total: number } | BulkProblem;

const refreshCaches = async (store: Store, wrote: boolean): Promise<void> => {
  if (!wrote) return;
  refreshTag(catalogTag(store.id));
  refreshTag(fieldsTag(store.id));
  // Search by meaning finds the products as saved; never stops the run.
  await refreshStoreEmbeddings(store.id).catch(() => undefined);
};

/** Takes the batch's lock for a run (`pg_try_advisory_xact_lock` in a transaction that stays open while the run works). Null when another run holds it. */
async function withBatchLock<T>(batchId: string, work: () => Promise<T>): Promise<T | null> {
  let result: T | null = null;
  let acquired = false;
  await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`bulk:${batchId}`}, 0)) as ok`);
    acquired = row?.ok === true;
    if (acquired) result = await work();
  });
  return acquired ? result : null;
}

/**
 * The audit entry of a finished batch, once: written by the run that finds nothing left, under the batch's lock, and never twice (the entry is looked for
 * first). Counts and the batch id, never a title or a price.
 */
async function auditFinished(member: Membership, batch: BatchRow, counts: BatchCounts): Promise<void> {
  const action = auditActionOf(batch.action);
  const [have] = await db().execute<Row>(sql`select 1 as x from commerce.audit_log where store_id = ${member.store.id}::uuid and action = ${action} and details ->> 'batchId' = ${batch.id} limit 1`);
  if (have) return;
  await audit(member.account.id, member.store.id, action, auditDetails(batch.action, counts, batch.id), { area: "products", target: { type: "bulk_edit", id: batch.id } });
}

/** The counts of a batch as its items say: products changed (any cell changed, none failed), failed (any cell failed) and unchanged. */
async function countsOf(storeId: string, batchId: string): Promise<BatchCounts> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as products,
      count(*) filter (where failed)::int as failed,
      count(*) filter (where not failed and changed)::int as changed
    from (
      select product_id, bool_or(outcome = 'failed') as failed, bool_or(outcome in ('changed', 'undone')) as changed
      from commerce.bulk_edit_items where store_id = ${storeId}::uuid and batch_id = ${batchId}::uuid group by product_id
    ) t
  `);
  const products = Number(row?.products ?? 0);
  const failed = Number(row?.failed ?? 0);
  const changed = Number(row?.changed ?? 0);
  return { products, changed, unchanged: products - failed - changed, failed };
}

/** Runs the products of a list action that are not done yet, for as long as the time allows. Called with the batch's lock held. */
async function runListBatch(member: Membership, editor: EditorContext, batch: BatchRow, until: number, deps: BulkDeps): Promise<{ done: boolean; processed: number; total: number }> {
  const ids = batch.params.productIds;
  const done = await processedOf(member.store.id, batch.id);
  const remaining = ids.filter((id) => !done.has(id));
  const request = requestOf(batch);
  const parsed = parseRequest(member.store, editor, request);
  if (!parsed.ok) throw new Error(parsed.problem);
  let wrote = false;
  for (let i = 0; i < remaining.length; i += 1) {
    if (Date.now() >= until) break;
    const id = remaining[i];
    const { loaded } = await loadProducts(member.store, editor, [id]);
    const product = loaded.get(id);
    if (!product) {
      await putBatchItems(member.store.id, batch.id, [{ productId: id, variantId: null, field: fieldOfStatus(batch.action), before: null, after: null, outcome: "failed", reason: "This product was not found." }]);
      continue;
    }
    const planned = planAction(batch.action, [product], parsed);
    const items: ItemRow[] = [];
    for (const f of [...planned.plan.failures, ...(planned.plan.skipped ?? [])]) {
      items.push({ productId: id, variantId: f.variantId ?? null, field: batch.action === "price" ? (`price:${parsed.markets?.[0]?.code ?? "XX"}` as BulkField) : batch.action === "stock" ? "stock" : fieldOfStatus(batch.action), before: null, after: null, outcome: "failed", reason: f.reason });
    }
    if (planned.plan.changes.length > 0) {
      const written = await writeProduct(member.store, editor, product, planned.plan.changes, parsed.stock?.kind === "adjust", { accountId: member.account.id, batchId: batch.id });
      if (written.ok) {
        wrote = true;
        for (const c of planned.plan.changes) items.push({ productId: c.productId, variantId: c.variantId, field: c.field, before: c.before, after: c.after, outcome: "changed", reason: null });
      } else {
        for (const c of planned.plan.changes) items.push({ productId: c.productId, variantId: c.variantId, field: c.field, before: c.before, after: c.after, outcome: "failed", reason: written.reason });
      }
    }
    if (items.length === 0) items.push({ productId: id, variantId: null, field: batch.action === "stock" ? "stock" : batch.action === "price" ? (`price:${parsed.markets?.[0]?.code ?? "XX"}` as BulkField) : fieldOfStatus(batch.action), before: null, after: null, outcome: "unchanged", reason: null });
    await putBatchItems(member.store.id, batch.id, items);
    if (deps.stopAfter !== undefined && i + 1 >= deps.stopAfter) {
      await refreshCaches(member.store, wrote);
      return { done: false, processed: ids.length - remaining.length + i + 1, total: ids.length };
    }
  }
  await refreshCaches(member.store, wrote);
  const nowDone = await processedOf(member.store.id, batch.id);
  return { done: ids.every((id) => nowDone.has(id)), processed: nowDone.size, total: ids.length };
}

export type BulkDeps = { budgetMs?: number; stopAfter?: number };

/** The request a batch was made from (its params are the request). */
function requestOf(batch: BatchRow): BulkRequest {
  const p = batch.params;
  const productIds = p.productIds;
  switch (batch.action) {
    case "status":
      return { action: "status", productIds, to: p.to as "draft" | "active" };
    case "archive":
    case "unarchive":
      return { action: batch.action, productIds };
    case "terms_add":
    case "terms_remove":
      return { action: batch.action, productIds, categoryIds: (p.categoryIds ?? []) as string[], tagIds: (p.tagIds ?? []) as string[] };
    case "price":
      return { action: "price", productIds, markets: (p.markets ?? []) as string[], percent: p.percent as string | undefined, amounts: p.amounts as Record<string, string> | undefined };
    case "stock":
      return { action: "stock", productIds, change: String(p.change) };
    default:
      throw new Error("not a list action");
  }
}

async function finish(member: Membership, batch: BatchRow): Promise<void> {
  const counts = await countsOf(member.store.id, batch.id);
  await auditFinished(member, batch, counts);
}

/**
 * Starts a list action: one confirmed step. The batch is made first (its selection in `params`), then products are processed in the editor's own
 * door until the time is up; a larger selection is taken on by `continueBulk()`. At most `BULK_MAX_PRODUCTS` per request, and a product that is not the
 * store's is not found and never changed.
 */
export async function startBulk(member: Membership, request: BulkRequest, deps: BulkDeps = {}): Promise<BulkProgress> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const editor = await getEditorContext(member.store);
  const parsed = parseRequest(member.store, editor, request);
  if (!parsed.ok) return parsed;
  const batchId = await createBatch(member, request.action, parsed.params, { products: parsed.params.productIds.length });
  return continueBulk(member, batchId, deps);
}

/** Goes on with a batch that has products left (the open page asks again until it is done). One run at a time per batch. */
export async function continueBulk(member: Membership, batchId: string, deps: BulkDeps = {}): Promise<BulkProgress> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const batch = await getBatchRow(member.store.id, batchId);
  if (!batch || batch.action === "undo" || batch.action === "grid") return { ok: false, problem: "This change could not be found." };
  const editor = await getEditorContext(member.store);
  const until = Date.now() + (deps.budgetMs ?? DATA_JOB_BUDGET_MS);
  const run = await withBatchLock(batch.id, async () => {
    const progress = await runListBatch(member, editor, batch, until, deps);
    if (progress.done) await finish(member, batch);
    return progress;
  });
  if (!run) return { ok: true, batchId: batch.id, done: false, processed: (await processedOf(member.store.id, batch.id)).size, total: batch.params.productIds.length };
  return { ok: true, batchId: batch.id, done: run.done, processed: run.processed, total: run.total };
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export type GridVariant = { productId: string; variantId: string; title: string; handle: string; options: string; active: boolean; cells: { sku: string; stock: string; cost: string; prices: Record<string, string> } };
export type GridData = { ok: true; markets: { code: string; currency: string }[]; mainCurrency: string; rows: GridVariant[]; notFound: number } | BulkProblem;

const cellsOf = (input: ProductInput, index: number, markets: readonly { code: string }[]): GridVariant["cells"] => {
  const v = input.variants[index];
  return { sku: v.sku, stock: String(v.stock), cost: v.cost ?? "", prices: Object.fromEntries(markets.map((m) => [m.code, v.prices[m.code] ?? ""])) };
};

function gridMarkets(store: Store, editor: EditorContext, codes: readonly string[] | undefined): { code: string; currency: string }[] | BulkProblem {
  const wanted = dedupe((codes && codes.length > 0 ? codes : [store.markets[0]?.code ?? ""]).map((c) => c.toUpperCase()));
  if (wanted.length > BULK_GRID_MARKETS_MAX) return { ok: false, problem: `The grid shows at most ${BULK_GRID_MARKETS_MAX} markets.` };
  const markets = wanted.map((code) => editor.markets.find((m) => m.code === code));
  if (markets.some((m) => m === undefined)) return { ok: false, problem: "Choose markets of this store." };
  return (markets as NonNullable<(typeof markets)[number]>[]).map((m) => ({ code: m.code, currency: m.currency }));
}

/** The grid's rows: a row per variant of up to `BULK_GRID_MAX_PRODUCTS` products, each with the text it is loaded with (prices as the editor types them). */
export async function loadGrid(member: Membership, productIds: readonly string[], marketCodes?: readonly string[]): Promise<GridData> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const ids = dedupe(productIds);
  const bad = selectionProblem(ids.length, "grid");
  if (bad) return { ok: false, problem: bad };
  if (ids.some((id) => !uuid.safeParse(id).success)) return { ok: false, problem: "A product in the selection is not one of this store's." };
  const editor = await getEditorContext(member.store);
  const markets = gridMarkets(member.store, editor, marketCodes);
  if (!Array.isArray(markets)) return markets;
  const { loaded, notFound } = await loadProducts(member.store, editor, ids);
  const rows: GridVariant[] = [];
  for (const id of ids) {
    const p = loaded.get(id);
    if (!p) continue;
    p.input.variants.forEach((v, i) => {
      if (!v.id) return;
      rows.push({ productId: id, variantId: v.id, title: p.title, handle: p.handle, options: Object.values(v.options).join(" / "), active: v.active, cells: cellsOf(p.input, i, markets) });
    });
  }
  return { ok: true, markets, mainCurrency: editor.mainCurrency, rows, notFound: notFound.length };
}

export type GridEdit = { productId: string; variantId: string; loaded: GridVariant["cells"]; edited: GridVariant["cells"] };

export type GridPreview = {
  ok: true;
  changes: { productId: string; variantId: string | null; field: BulkField; before: unknown; after: unknown; title: string; sku: string }[];
  conflicts: { productId: string; variantId: string; field: BulkField; current: unknown; title: string; sku: string }[];
  invalid: { productId: string; variantId: string; field: BulkField; reason: string; title: string; sku: string }[];
  unchanged: number;
  products: number;
  variants: number;
};

async function gridPlan(member: Membership, edits: readonly GridEdit[], marketCodes?: readonly string[]) {
  const ids = dedupe(edits.map((e) => e.productId));
  const bad = selectionProblem(ids.length, "grid");
  if (bad) return { ok: false as const, problem: bad };
  if (ids.some((id) => !uuid.safeParse(id).success)) return { ok: false as const, problem: "A product in the selection is not one of this store's." };
  const editor = await getEditorContext(member.store);
  const markets = gridMarkets(member.store, editor, marketCodes);
  if (!Array.isArray(markets)) return markets;
  const { loaded } = await loadProducts(member.store, editor, ids);
  const rows: GridRow[] = [];
  for (const e of edits) {
    const p = loaded.get(e.productId);
    const index = p ? p.input.variants.findIndex((v) => v.id === e.variantId) : -1;
    if (!p || index === -1) continue;
    rows.push({ productId: e.productId, variantId: e.variantId, loaded: e.loaded, current: cellsOf(p.input, index, markets), edited: e.edited });
  }
  const plan = planGrid(rows, markets, editor.mainCurrency);
  return { ok: true as const, editor, markets, loaded, plan, edits: rows };
}

const labelOf = (loaded: Map<string, LoadedProduct>, productId: string, variantId: string | null) => ({
  title: loaded.get(productId)?.title ?? "",
  sku: loaded.get(productId)?.input.variants.find((v) => v.id === variantId)?.sku ?? "",
});

/** What a grid's edits would do, for the review: every changed cell before and after, what is in conflict with the store's value now, and what is invalid. Writes nothing. */
export async function previewGrid(member: Membership, edits: readonly GridEdit[], marketCodes?: readonly string[]): Promise<GridPreview | BulkProblem> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const planned = await gridPlan(member, edits, marketCodes);
  if (!planned.ok) return planned;
  const { plan, loaded } = planned;
  return {
    ok: true,
    changes: plan.changes.map((c) => ({ ...c, ...labelOf(loaded, c.productId, c.variantId) })),
    conflicts: plan.conflicts.map((c) => ({ ...c, ...labelOf(loaded, c.productId, c.variantId) })),
    invalid: plan.invalid.map((c) => ({ ...c, ...labelOf(loaded, c.productId, c.variantId) })),
    unchanged: plan.unchanged,
    products: new Set(plan.changes.map((c) => c.productId)).size,
    variants: new Set(plan.changes.map((c) => c.variantId)).size,
  };
}

export type GridResult = { ok: true; batchId: string; counts: BatchCounts; conflicts: number; invalid: number } | BulkProblem;

/**
 * Applies a grid's edits: only the cells that changed and are valid and not in conflict, each product through `saveProduct()` (a price through
 * `commerce.set_price` inside it). Up to `BULK_GRID_MAX_PRODUCTS` products, so it is done in the one request. One audit entry.
 */
export async function applyGrid(member: Membership, edits: readonly GridEdit[], marketCodes?: readonly string[]): Promise<GridResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const planned = await gridPlan(member, edits, marketCodes);
  if (!planned.ok) return planned;
  const { plan, loaded, editor, markets } = planned;
  const ids = dedupe(edits.map((e) => e.productId));
  const batchId = await createBatch(member, "grid", { productIds: ids, markets: markets.map((m) => m.code) }, { products: ids.length });
  const batch = (await getBatchRow(member.store.id, batchId)) as BatchRow;
  const run = await withBatchLock(batchId, async () => {
    let wrote = false;
    const failures: Failure[] = [];
    const byProduct = new Map<string, Change[]>();
    for (const c of plan.changes) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);
    for (const id of ids) {
      const product = loaded.get(id);
      const changes = byProduct.get(id) ?? [];
      const items: ItemRow[] = [];
      if (!product) {
        items.push({ productId: id, variantId: null, field: "sku", before: null, after: null, outcome: "failed", reason: "This product was not found." });
      } else {
        for (const c of plan.conflicts.filter((x) => x.productId === id)) items.push({ productId: id, variantId: c.variantId, field: c.field, before: null, after: c.current ?? null, outcome: "failed", reason: "The value changed since the page was opened, so it was left as it is." });
        for (const c of plan.invalid.filter((x) => x.productId === id)) items.push({ productId: id, variantId: c.variantId, field: c.field, before: null, after: null, outcome: "failed", reason: c.reason });
        if (changes.length > 0) {
          const written = await writeProduct(member.store, editor, product, changes, false, { accountId: member.account.id, batchId });
          if (written.ok) wrote = true;
          else failures.push(...changes.map((c) => ({ productId: id, variantId: c.variantId, reason: written.reason })));
          for (const c of changes) items.push({ productId: id, variantId: c.variantId, field: c.field, before: c.before, after: c.after, outcome: written.ok ? "changed" : "failed", reason: written.ok ? null : written.reason });
        }
        if (items.length === 0) items.push({ productId: id, variantId: null, field: "sku", before: null, after: null, outcome: "unchanged", reason: null });
      }
      await putBatchItems(member.store.id, batchId, items);
    }
    await refreshCaches(member.store, wrote);
    await finish(member, batch);
    return true;
  });
  if (!run) return { ok: false, problem: "This change is already being made." };
  return { ok: true, batchId, counts: await countsOf(member.store.id, batchId), conflicts: plan.conflicts.length, invalid: plan.invalid.length };
}

// ---------------------------------------------------------------------------
// Reading a batch, and the undo
// ---------------------------------------------------------------------------

export type BatchSummary = {
  id: string;
  action: BulkAction;
  createdAt: string;
  undoneAt: string | null;
  undoOf: string | null;
  total: number;
  processed: number;
  done: boolean;
  counts: BatchCounts;
  failures: BulkFailure[];
  /** The batch can be undone now: made within seven days, not an undo, not undone. */
  undoable: boolean;
};

/** A batch for its result page: counts as its items say, every failure with its reason (title or handle, SKU), and whether it can be undone. */
export async function batchSummary(storeId: string, batchId: string, now: Date = new Date()): Promise<BatchSummary | null> {
  const batch = await getBatchRow(storeId, batchId);
  if (!batch) return null;
  const counts = await countsOf(storeId, batchId);
  const total = Array.isArray(batch.params.productIds) ? batch.params.productIds.length : Number(batch.counts.products ?? counts.products);
  const failed = await db().execute<Row>(sql`
    select i.product_id, i.variant_id, i.field, i.reason, p.handle,
      coalesce((select t.title from commerce.product_translations t where t.product_id = i.product_id and btrim(t.title) <> '' order by t.locale limit 1), p.handle) as title,
      (select v.sku from commerce.product_variants v where v.store_id = i.store_id and v.id = i.variant_id) as sku
    from commerce.bulk_edit_items i
    left join commerce.products p on p.store_id = i.store_id and p.id = i.product_id
    where i.store_id = ${storeId}::uuid and i.batch_id = ${batchId}::uuid and i.outcome = 'failed'
    order by i.seq limit 500
  `);
  return {
    id: batch.id,
    action: batch.action,
    createdAt: batch.createdAt,
    undoneAt: batch.undoneAt,
    undoOf: batch.undoOf,
    total,
    processed: counts.products,
    done: batch.action === "undo" ? true : counts.products >= total,
    counts,
    failures: failed.map((r) => ({ productId: String(r.product_id), handle: r.handle ? String(r.handle) : null, title: r.title ? String(r.title) : null, sku: r.sku ? String(r.sku) : null, field: String(r.field), reason: String(r.reason ?? "") })),
    undoable: canUndo({ action: batch.action, createdAt: new Date(batch.createdAt), undoneAt: batch.undoneAt ? new Date(batch.undoneAt) : null }, now) && counts.products >= total,
  };
}

/** The store's recent batches, newest first, for the list of changes that can still be undone. */
export async function listBatches(storeId: string, limit = 20): Promise<BatchRow[]> {
  const rows = await db().execute<Row>(sql`select id from commerce.bulk_edit_batches where store_id = ${storeId}::uuid order by created_at desc limit ${Math.min(Math.max(1, limit), 100)}`);
  const out: BatchRow[] = [];
  for (const r of rows) {
    const b = await getBatchRow(storeId, String(r.id));
    if (b) out.push(b);
  }
  return out;
}

export type UndoResult = { ok: true; batchId: string; restored: number; conflicts: number; gone: number } | BulkProblem;

/**
 * Undoes a batch: each cell is put back to its value before, ONLY where its stored value is still the batch's value after; anything changed since is
 * left and listed as a conflict. The undo is a batch of its own (and its own audit entry, `products.bulk_undone`), a price put back is a new price in
 * the history as any price change is, a batch is undone once and within seven days (the database holds both).
 */
export async function undoBatch(member: Membership, batchId: string): Promise<UndoResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const original = await getBatchRow(member.store.id, batchId);
  if (!original) return { ok: false, problem: "This change could not be found." };
  if (!canUndo({ action: original.action, createdAt: new Date(original.createdAt), undoneAt: original.undoneAt ? new Date(original.undoneAt) : null }, new Date())) {
    return { ok: false, problem: original.action === "undo" ? "An undo cannot be undone. Make the change again instead." : original.undoneAt ? "This change was already undone." : "A change can be undone for seven days." };
  }
  const summary = await batchSummary(member.store.id, batchId);
  if (summary && !summary.done) return { ok: false, problem: "This change is not finished yet." };
  const rows = await db().execute<Row>(sql`
    select product_id, variant_id, field, before, after, outcome from commerce.bulk_edit_items
    where store_id = ${member.store.id}::uuid and batch_id = ${batchId}::uuid and outcome = 'changed' order by seq
  `);
  const recorded: RecordedItem[] = rows.map((r) => ({ productId: String(r.product_id), variantId: r.variant_id ? String(r.variant_id) : null, field: String(r.field) as BulkField, before: r.before ?? null, after: r.after ?? null, outcome: "changed" }));
  const editor = await getEditorContext(member.store);
  const { loaded } = await loadProducts(member.store, editor, dedupe(recorded.map((r) => r.productId)));
  const current = (productId: string, variantId: string | null, field: BulkField): unknown => {
    const p = loaded.get(productId);
    if (!p) return undefined;
    if (field === "status") return p.archived ? "archived" : p.input.status;
    if (field === "archived") return p.archived;
    if (field === "terms") return { categories: [...p.input.categories].sort(), tags: [...p.input.tags].sort() };
    const index = p.input.variants.findIndex((v) => v.id === variantId);
    if (index === -1) return undefined;
    const v = p.input.variants[index];
    if (field === "stock") return v.stock;
    if (field === "sku") return v.sku;
    if (field === "cost") return v.cost ? parsePrice(v.cost, editor.mainCurrency) : null;
    const code = field.slice(6);
    const market = editor.markets.find((m) => m.code === code);
    return market ? priceMinor(p.input, index, code, market.currency) : undefined;
  };
  const plan = undoPlan(recorded, current);
  const productIds = dedupe(recorded.map((r) => r.productId));
  const undoId = await createBatch(member, "undo", { productIds }, { products: productIds.length }, original.id);
  const done = await withBatchLock(undoId, async () => {
    let wrote = false;
    const byProduct = new Map<string, Change[]>();
    for (const c of plan.restores) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);
    const restoredKeys = new Set<string>();
    for (const id of productIds) {
      const product = loaded.get(id);
      const restores = byProduct.get(id) ?? [];
      const items: ItemRow[] = [];
      for (const c of plan.conflicts.filter((x) => x.productId === id)) items.push({ productId: id, variantId: c.variantId || null, field: c.field, before: null, after: c.current ?? null, outcome: "failed", reason: "The value changed after the edit, so it was left as it is." });
      for (const g of plan.gone.filter((x) => x.productId === id)) items.push({ productId: id, variantId: g.variantId, field: g.field, before: null, after: null, outcome: "failed", reason: "The product or variant no longer exists." });
      if (restores.length > 0 && product) {
        const written = await writeProduct(member.store, editor, product, restores, false, { accountId: member.account.id, batchId: undoId });
        if (written.ok) wrote = true;
        for (const c of restores) {
          items.push({ productId: id, variantId: c.variantId, field: c.field, before: c.before, after: c.after, outcome: written.ok ? "changed" : "failed", reason: written.ok ? null : written.reason });
          if (written.ok) restoredKeys.add(`${c.productId}|${c.variantId ?? ""}|${c.field}`);
        }
      }
      if (items.length === 0) items.push({ productId: id, variantId: null, field: recorded[0]?.field ?? "status", before: null, after: null, outcome: "unchanged", reason: null });
      await putBatchItems(member.store.id, undoId, items);
    }
    // The cells put back are marked undone in the batch they came from (the one change the append-only rule allows).
    for (const c of plan.restores) {
      if (!restoredKeys.has(`${c.productId}|${c.variantId ?? ""}|${c.field}`)) continue;
      await db().execute(sql`
        update commerce.bulk_edit_items set outcome = 'undone'
        where store_id = ${member.store.id}::uuid and batch_id = ${original.id}::uuid and product_id = ${c.productId}::uuid
          and variant_id is not distinct from ${c.variantId}::uuid and field = ${c.field} and outcome = 'changed'
      `);
    }
    await db().execute(sql`update commerce.bulk_edit_batches set undone_at = now() where store_id = ${member.store.id}::uuid and id = ${original.id}::uuid and undone_at is null`);
    await refreshCaches(member.store, wrote);
    await finish(member, { ...(await getBatchRow(member.store.id, undoId)) as BatchRow });
    return true;
  });
  if (!done) return { ok: false, problem: "This change is already being undone." };
  return { ok: true, batchId: undoId, restored: plan.restores.length, conflicts: plan.conflicts.length, gone: plan.gone.length };
}

// ---------------------------------------------------------------------------
// "Select all N matching"
// ---------------------------------------------------------------------------

export type MatchFilter = { status?: "active" | "draft" | "archived"; q?: string };

/** The products of a list filter, the first `BULK_MAX_PRODUCTS` of them (the list's own order), and how many match in all. */
export async function matchingProductIds(storeId: string, filter: MatchFilter): Promise<{ ids: string[]; total: number }> {
  const q = (filter.q ?? "").trim().toLowerCase().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = sql`p.store_id = ${storeId}::uuid
    ${filter.status ? sql`and p.status = ${filter.status}` : sql`and p.status <> 'archived'`}
    ${q ? sql`and (lower(p.handle) like ${like} or exists (select 1 from commerce.product_translations t where t.product_id = p.id and lower(t.title) like ${like}) or exists (select 1 from commerce.product_variants v where v.product_id = p.id and lower(v.sku) like ${like}))` : sql``}`;
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.products p where ${where}`);
  const rows = await db().execute<Row>(sql`select p.id from commerce.products p where ${where} order by p.updated_at desc, p.handle limit ${BULK_MAX_PRODUCTS}`);
  return { ids: rows.map((r) => String(r.id)), total: Number(count?.n ?? 0) };
}

export { BULK_ACTIONS, listTerms };
