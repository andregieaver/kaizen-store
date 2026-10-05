import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { applyPercent } from "@/lib/bulk-edit";
import { BULK_GRID_MAX_PRODUCTS, BULK_MAX_PRODUCTS } from "@/lib/data-limits";

import type { Membership } from "./auth";
import { addSwedish, auditOf, membersOf, priceOf, seedProducts, stockOf } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const bulk = await import("./bulk-edit");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The bulk editor (D165, `docs/wave-2-data.md` 2.6, 6.5): each action through the editor's own door, so a change is validated as an editor save is and a
 * price only changes through `commerce.set_price`; every change recorded with its value before and after; the grid with a review, conflicts and invalid
 * cells listed and nothing overwritten; an undo that puts back only what is still the batch's value, as a batch of its own; limits per request; one
 * audit entry per batch; failures listed with their reason; only the member's own store.
 */

let fx: Fixture;
let rival: Fixture;
let owner: Membership;
let rivalOwner: Membership;
let products: { id: string; handle: string; skus: string[] }[];
let multi: { id: string; handle: string; skus: string[] }[];

const ids = (list: { id: string }[]) => list.map((p) => p.id);
const count = async (q: ReturnType<typeof sql>) => Number(((await db().execute<Row>(q))[0] as Row).n);
const priceRows = (sku: string) => count(sql`select count(*)::int as n from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = ${sku} and p.market_code = 'NO'`);
const statusOf = async (handle: string) => String(((await db().execute<Row>(sql`select status from commerce.products where store_id = ${fx.storeId}::uuid and handle = ${handle}`))[0] as Row).status);

beforeAll(async () => {
  fx = await makeStore("bulk");
  rival = await makeStore("bulk2");
  await addSwedish(fx);
  const members = await membersOf(fx);
  owner = { ...members.owner, store: (await getStore(fx.slug))! };
  rivalOwner = (await membersOf(rival)).owner;
  products = await seedProducts(fx, 30, { prefix: "BULK" });
  multi = await seedProducts(fx, 3, { prefix: "MULTI", variants: 2 });
}, 180_000);

afterAll(async () => {
  await closeDb();
});

describe("a list action", () => {
  it("sets the status of 30 products in one confirmed step, and the one that cannot be published fails alone with the editor's sentence", async () => {
    // One product has no picture: it can be a draft but not active.
    const [bare] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'bulk-7'`);
    await db().execute(sql`delete from commerce.product_media where product_id = ${String(bare.id)}::uuid`);
    const preview = await bulk.previewBulk(owner, { action: "status", productIds: ids(products), to: "draft" });
    expect(preview).toMatchObject({ ok: true, counts: { products: 30, changed: 30, unchanged: 0, failed: 0 } });
    const made = await bulk.startBulk(owner, { action: "status", productIds: ids(products), to: "draft" });
    expect(made).toMatchObject({ ok: true, done: true, processed: 30, total: 30 });
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'bulk-%' and status = 'draft'`)).toBe(30);
    // Back to active: bulk-7 cannot be published.
    const back = await bulk.startBulk(owner, { action: "status", productIds: ids(products), to: "active" });
    if (!back.ok) throw new Error(back.problem);
    const summary = (await bulk.batchSummary(fx.storeId, back.batchId))!;
    expect(summary.counts).toEqual({ products: 30, changed: 29, unchanged: 0, failed: 1 });
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({ handle: "bulk-7", title: "Seed product 7" });
    expect(summary.failures[0].reason).toContain("Add at least one picture before publishing");
    expect(await statusOf("bulk-7")).toBe("draft");
    expect(await statusOf("bulk-8")).toBe("active");
    // Give it its picture back for the rest.
    await db().execute(sql`insert into commerce.product_media (store_id, product_id, url, position) values (${fx.storeId}::uuid, ${String(bare.id)}::uuid, '/demo/lamp.webp', 0)`);
  });

  it("writes exactly one audit entry for a batch of 30 whatever the count of changed prices, with counts and the batch id and no title or price", async () => {
    const before = (await auditOf(fx.storeId, "products.bulk_edited")).length;
    const made = await bulk.startBulk(owner, { action: "price", productIds: ids(products), percent: "10" });
    if (!made.ok) throw new Error(made.problem);
    const entries = await auditOf(fx.storeId, "products.bulk_edited");
    expect(entries.length).toBe(before + 1);
    const entry = entries.at(-1)!;
    expect(entry.details).toMatchObject({ action: "price", products: 30, batchId: made.batchId });
    expect(JSON.stringify(entry.details)).not.toMatch(/Seed product|BULK-|\d{3,}\.\d{2}/);
    // And no entry per product.
    expect(await count(sql`select count(*)::int as n from commerce.audit_log where store_id = ${fx.storeId}::uuid and action in ('product.updated', 'product.created') and created_at > now() - interval '1 minute'`)).toBe(0);
  });

  it("changes a price by a percentage on integer minor units, half up, through set_price, so the history shows both prices", async () => {
    // BULK-1 was 101.00 and +10 % made it 111.10 (11110); BULK-2 102.00 → 112.20.
    expect(await priceOf(fx.storeId, "BULK-1")).toBe(11110);
    expect(await priceOf(fx.storeId, "BULK-2")).toBe(11220);
    expect(await priceRows("BULK-1")).toBe(2);
    // A tie: 123.45 + 10 % is 135.795, which rounds half up to 135.80 (13580 minor units), never 135.79.
    const tie = await seedProducts(fx, 1, { prefix: "TIE" });
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, tie[0].id))!;
    input.variants[0].prices.NO = "123,45";
    await saveProduct(store, editor, tie[0].id, input);
    await bulk.startBulk(owner, { action: "price", productIds: [tie[0].id], percent: "10" });
    expect(await priceOf(fx.storeId, "TIE-1")).toBe(13580);
    // A reduction is shown against the lowest price of the last 30 days: set_price kept the history it is read from.
    await bulk.startBulk(owner, { action: "price", productIds: [tie[0].id], percent: "-50" });
    const [cur] = await db().execute<Row>(sql`select c.amount_minor, c.prior_30d_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'TIE-1' and c.market_code = 'NO'`);
    expect(Number(cur.amount_minor)).toBe(6790);
    expect(Number(cur.prior_30d_minor)).toBeGreaterThanOrEqual(6790);
  });

  it("changes a price by an amount in the market's currency, never across currencies, and a result below 0 fails for that variant alone", async () => {
    const before = await priceOf(fx.storeId, "BULK-4");
    const refusedAcross = await bulk.previewBulk(owner, { action: "price", productIds: [products[3].id], markets: ["NO", "SE"], amounts: { NO: "5" } });
    expect(refusedAcross).toMatchObject({ ok: false });
    expect(await bulk.previewBulk(owner, { action: "price", productIds: [products[3].id], percent: "10", amounts: { NO: "5" } })).toMatchObject({ ok: false });
    expect(await bulk.previewBulk(owner, { action: "price", productIds: [products[3].id], percent: "-95" })).toMatchObject({ ok: false });
    const up = await bulk.startBulk(owner, { action: "price", productIds: [products[3].id], amounts: { NO: "5,50" } });
    expect(up.ok).toBe(true);
    expect(await priceOf(fx.storeId, "BULK-4")).toBe((before as number) + 550);
    // A fall below nothing fails that variant (and only it): the others of the batch are done.
    const down = await bulk.startBulk(owner, { action: "price", productIds: [products[3].id, products[4].id], amounts: { NO: "-130" } });
    if (!down.ok) throw new Error(down.problem);
    const summary = (await bulk.batchSummary(fx.storeId, down.batchId))!;
    expect(summary.counts.failed).toBeGreaterThanOrEqual(1);
    expect(summary.failures.some((f) => f.reason === "The new price would be below 0.")).toBe(true);
    expect(await priceOf(fx.storeId, "BULK-4")).toBe((before as number) + 550);
  });

  it("sets or adjusts stock, and a result below 0 fails as the editor would", async () => {
    const [a, b] = [products[10], products[11]];
    expect(await stockOf(fx.storeId, a.skus[0])).toBe(11);
    await bulk.startBulk(owner, { action: "stock", productIds: [a.id, b.id], change: "+4" });
    expect(await stockOf(fx.storeId, a.skus[0])).toBe(15);
    expect(await stockOf(fx.storeId, b.skus[0])).toBe(16);
    await bulk.startBulk(owner, { action: "stock", productIds: [a.id, b.id], change: "20" });
    expect(await stockOf(fx.storeId, a.skus[0])).toBe(20);
    const over = await bulk.startBulk(owner, { action: "stock", productIds: [a.id], change: "-50" });
    if (!over.ok) throw new Error(over.problem);
    expect((await bulk.batchSummary(fx.storeId, over.batchId))!.counts).toMatchObject({ failed: 1 });
    expect(await stockOf(fx.storeId, a.skus[0])).toBe(20);
    expect(await bulk.previewBulk(owner, { action: "stock", productIds: [a.id], change: "lots" })).toMatchObject({ ok: false });
  });

  it("archives and unarchives (back to a draft), and keeps an archived product archived through a price change", async () => {
    const pair = [products[20], products[21]];
    await bulk.startBulk(owner, { action: "archive", productIds: ids(pair) });
    expect(await statusOf(pair[0].handle)).toBe("archived");
    // A price change on an archived product leaves it archived (the editor's save would make it a draft).
    const priceBefore = (await priceOf(fx.storeId, pair[0].skus[0])) as number;
    await bulk.startBulk(owner, { action: "price", productIds: [pair[0].id], percent: "5" });
    expect(await statusOf(pair[0].handle)).toBe("archived");
    expect(await priceOf(fx.storeId, pair[0].skus[0])).toBe(applyPercent(priceBefore, 500));
    await bulk.startBulk(owner, { action: "unarchive", productIds: ids(pair) });
    expect(await statusOf(pair[0].handle)).toBe("draft");
    // Already as asked: unchanged, no write.
    const again = await bulk.startBulk(owner, { action: "unarchive", productIds: ids(pair) });
    if (!again.ok) throw new Error(again.problem);
    expect((await bulk.batchSummary(fx.storeId, again.batchId))!.counts).toEqual({ products: 2, changed: 0, unchanged: 2, failed: 0 });
  });

  it("adds categories and tags to many products and takes them away", async () => {
    const [category] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'category', 'Bulk cat', 'bulk-cat') returning id`);
    const [tag] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'tag', 'bulk-tag', 'bulk-tag') returning id`);
    const some = products.slice(0, 12);
    await bulk.startBulk(owner, { action: "terms_add", productIds: ids(some), categoryIds: [String(category.id)], tagIds: [String(tag.id)] });
    expect(await count(sql`select count(*)::int as n from commerce.product_terms where store_id = ${fx.storeId}::uuid and term_id in (${String(category.id)}::uuid, ${String(tag.id)}::uuid)`)).toBe(24);
    await bulk.startBulk(owner, { action: "terms_remove", productIds: ids(some.slice(0, 5)), categoryIds: [String(category.id)], tagIds: [] });
    expect(await count(sql`select count(*)::int as n from commerce.product_terms where store_id = ${fx.storeId}::uuid and term_id = ${String(category.id)}::uuid`)).toBe(7);
    expect(await bulk.previewBulk(owner, { action: "terms_add", productIds: ids(some), categoryIds: [], tagIds: [] })).toMatchObject({ ok: false });
    // Another store's category is not the store's.
    const [foreign] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${rival.storeId}::uuid, 'product', 'category', 'Foreign', 'foreign') returning id`);
    expect(await bulk.previewBulk(owner, { action: "terms_add", productIds: ids(some), categoryIds: [String(foreign.id)], tagIds: [] })).toMatchObject({ ok: false });
  });
});

describe("limits, stores and rights", () => {
  it("refuses 501 products for a list action and 51 for the grid, naming the number, and a request for none", async () => {
    const many = Array.from({ length: BULK_MAX_PRODUCTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const refused = await bulk.previewBulk(owner, { action: "archive", productIds: many });
    expect(refused).toMatchObject({ ok: false, problem: expect.stringContaining("501") });
    expect(await bulk.startBulk(owner, { action: "archive", productIds: many })).toMatchObject({ ok: false });
    const grid = Array.from({ length: BULK_GRID_MAX_PRODUCTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await bulk.loadGrid(owner, grid)).toMatchObject({ ok: false, problem: expect.stringContaining("51") });
    expect(await bulk.previewBulk(owner, { action: "archive", productIds: [] })).toMatchObject({ ok: false });
  });

  it("never changes another store's product: its id is not found and nothing of it is written", async () => {
    const [theirs] = await seedProducts(rival, 1, { prefix: "THEIRS" });
    const theirPrice = await priceOf(rival.storeId, "THEIRS-1");
    const preview = await bulk.previewBulk(owner, { action: "price", productIds: [products[0].id, theirs.id], percent: "50" });
    expect(preview).toMatchObject({ ok: true, notFound: 1, counts: { products: 1 } });
    const made = await bulk.startBulk(owner, { action: "price", productIds: [products[0].id, theirs.id], percent: "50" });
    if (!made.ok) throw new Error(made.problem);
    expect(await priceOf(rival.storeId, "THEIRS-1")).toBe(theirPrice);
    const summary = (await bulk.batchSummary(fx.storeId, made.batchId))!;
    expect(summary.failures.some((f) => f.reason.includes("not found"))).toBe(true);
    // The batch is the store's: another store does not see it, change it or undo it.
    expect(await bulk.batchSummary(rival.storeId, made.batchId)).toBeNull();
    expect(await bulk.undoBatch(rivalOwner, made.batchId)).toMatchObject({ ok: false });
    expect(await bulk.continueBulk(rivalOwner, made.batchId)).toMatchObject({ ok: false });
  });

  it("is refused to a member who may not write products", async () => {
    const reader = { ...owner, role: "admin", permissions: ["products:read"] } as Membership;
    expect(await bulk.previewBulk(reader, { action: "archive", productIds: [products[0].id] })).toMatchObject({ ok: false });
    expect(await bulk.startBulk(reader, { action: "archive", productIds: [products[0].id] })).toMatchObject({ ok: false });
    expect(await bulk.loadGrid(reader, [products[0].id])).toMatchObject({ ok: false });
    expect(await bulk.applyGrid(reader, [])).toMatchObject({ ok: false });
    expect(await bulk.undoBatch(reader, "00000000-0000-4000-8000-000000000001")).toMatchObject({ ok: false });
  });

  it("takes up where it was after a run that stopped, once for each product, and two runs at once do not change a price twice", async () => {
    const group = products.slice(14, 20);
    const before = await Promise.all(group.map((p) => priceOf(fx.storeId, p.skus[0])));
    const first = await bulk.startBulk(owner, { action: "price", productIds: ids(group), percent: "100" }, { stopAfter: 2 });
    if (!first.ok) throw new Error(first.problem);
    expect(first).toMatchObject({ done: false, processed: 2, total: 6 });
    // Two clicks at once: one runs, the other finds the batch busy or done; each product changes once.
    const [a, b] = await Promise.all([bulk.continueBulk(owner, first.batchId), bulk.continueBulk(owner, first.batchId)]);
    expect([a, b].some((r) => r.ok && r.done)).toBe(true);
    const after = await Promise.all(group.map((p) => priceOf(fx.storeId, p.skus[0])));
    after.forEach((price, i) => expect(price).toBe((before[i] as number) * 2));
    expect((await bulk.batchSummary(fx.storeId, first.batchId))!.counts).toMatchObject({ products: 6, changed: 6 });
    // One audit entry for the finished batch, not two.
    expect((await auditOf(fx.storeId, "products.bulk_edited")).filter((e) => (e.details as { batchId?: string }).batchId === first.batchId)).toHaveLength(1);
    // Done is done.
    expect(await bulk.continueBulk(owner, first.batchId)).toMatchObject({ ok: true, done: true });
    expect((await auditOf(fx.storeId, "products.bulk_edited")).filter((e) => (e.details as { batchId?: string }).batchId === first.batchId)).toHaveLength(1);
  });

  it("lists the products of a filter, the first 500, and how many match in all", async () => {
    const all = await bulk.matchingProductIds(fx.storeId, {});
    expect(all.total).toBeGreaterThanOrEqual(33);
    expect(all.ids.length).toBeLessThanOrEqual(BULK_MAX_PRODUCTS);
    const one = await bulk.matchingProductIds(fx.storeId, { q: "bulk-9" });
    expect(one.ids).toEqual([products[8].id]);
    const archived = await bulk.matchingProductIds(fx.storeId, { status: "archived" });
    expect(archived.ids.every((id) => ![products[20].id].includes(id))).toBe(true);
    expect((await bulk.matchingProductIds(rival.storeId, { q: "bulk-9" })).ids).toEqual([]);
  });
});

describe("the grid", () => {
  it("loads a row for each variant with its cells as the editor types them", async () => {
    const grid = await bulk.loadGrid(owner, ids(multi), ["NO", "SE"]);
    if (!grid.ok) throw new Error(grid.problem);
    expect(grid.markets).toEqual([{ code: "NO", currency: "NOK" }, { code: "SE", currency: "SEK" }]);
    expect(grid.rows).toHaveLength(6);
    const first = grid.rows[0];
    expect(first).toMatchObject({ title: "Seed product 1", options: "S1" });
    expect(first.cells).toMatchObject({ sku: "MULTI-1-1", stock: "1", prices: { NO: expect.stringContaining("101"), SE: "" } });
    expect(await bulk.loadGrid(owner, ids(multi), ["NO", "SE", "NO", "DK", "FI"])).toMatchObject({ ok: false });
  });

  it("reviews every changed cell, writes prices through set_price with the history, and lists a SKU in use, an unreadable price and a conflict without overwriting", async () => {
    const grid = await bulk.loadGrid(owner, ids(multi));
    if (!grid.ok) throw new Error(grid.problem);
    // A product is saved whole or not at all, so the edit the editor refuses is on another product than the valid ones.
    const r1 = grid.rows[0];
    const r2 = grid.rows[2];
    const r3 = grid.rows[3];
    const r4 = grid.rows[4];
    const edit = (r: (typeof grid.rows)[number], over: Partial<(typeof grid.rows)[number]["cells"]>, prices: Record<string, string> = {}) => ({ productId: r.productId, variantId: r.variantId, loaded: r.cells, edited: { ...r.cells, ...over, prices: { ...r.cells.prices, ...prices } } });
    // A conflict: the stored price changes after the page was loaded.
    await bulk.startBulk(owner, { action: "price", productIds: [r4.productId], amounts: { NO: "1" } });
    const edits = [
      edit(r1, { stock: "42", cost: "55,50" }, { NO: "150" }),
      edit(r2, { sku: "BULK-1" }),
      edit(r3, {}, { NO: "twelve" }),
      edit(r4, {}, { NO: "999" }),
    ];
    const preview = await bulk.previewGrid(owner, edits);
    if (!preview.ok) throw new Error(preview.problem);
    expect(preview.changes.map((c) => c.field).sort()).toEqual(["cost", "price:NO", "sku", "stock"].sort());
    expect(preview.invalid.map((c) => c.field)).toEqual(["price:NO"]);
    expect(preview.conflicts.map((c) => c.field)).toEqual(["price:NO"]);
    expect(preview.products).toBe(2);
    // Nothing was written by the review.
    expect(await stockOf(fx.storeId, r1.cells.sku)).toBe(1);
    const sku1 = r1.cells.sku;
    const before = await priceRows(sku1);
    const result = await bulk.applyGrid(owner, edits);
    if (!result.ok) throw new Error(result.problem);
    expect(result.conflicts).toBe(1);
    expect(result.invalid).toBe(1);
    expect(await stockOf(fx.storeId, sku1)).toBe(42);
    expect(await priceOf(fx.storeId, sku1)).toBe(15000);
    expect(await priceRows(sku1)).toBe(before + 1);
    const [cost] = await db().execute<Row>(sql`select cost_minor from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = ${sku1}`);
    expect(Number(cost.cost_minor)).toBe(5550);
    // The SKU in use is refused by the editor's own rule, and the cell is left.
    const sku2 = r2.cells.sku;
    expect(await count(sql`select count(*)::int as n from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = ${sku2}`)).toBe(1);
    const summary = (await bulk.batchSummary(fx.storeId, result.batchId))!;
    expect(summary.failures.some((f) => /SKU/.test(f.reason))).toBe(true);
    // The conflicting price was not overwritten: it is the 1 kroner the other change made it.
    expect(await priceOf(fx.storeId, r4.cells.sku)).not.toBe(99900);
    expect((await auditOf(fx.storeId, "products.bulk_edited")).filter((e) => (e.details as { batchId?: string }).batchId === result.batchId)).toHaveLength(1);
  });

  it("refuses a negative stock and an unreadable cost as the editor does", async () => {
    const grid = await bulk.loadGrid(owner, [multi[1].id]);
    if (!grid.ok) throw new Error(grid.problem);
    const r = grid.rows[0];
    const preview = await bulk.previewGrid(owner, [{ productId: r.productId, variantId: r.variantId, loaded: r.cells, edited: { ...r.cells, stock: "-3", cost: "lots" } }]);
    if (!preview.ok) throw new Error(preview.problem);
    expect(preview.invalid.map((i) => i.field).sort()).toEqual(["cost", "stock"]);
    expect(preview.changes).toHaveLength(0);
  });
});

describe("undo", () => {
  it("puts a cell back only where it is still the batch's value, lists the rest, is a batch of its own, writes a new price in the history, and is done once", async () => {
    const group = products.slice(23, 26);
    const [x, y, z] = group;
    const original = await Promise.all(group.map((p) => priceOf(fx.storeId, p.skus[0])));
    const made = await bulk.startBulk(owner, { action: "price", productIds: ids(group), percent: "20" });
    if (!made.ok) throw new Error(made.problem);
    const changed = await Promise.all(group.map((p) => priceOf(fx.storeId, p.skus[0])));
    changed.forEach((c, i) => expect(c).not.toBe(original[i]));
    // One cell is changed by someone else after the batch.
    await bulk.startBulk(owner, { action: "price", productIds: [y.id], amounts: { NO: "3" } });
    const rowsBefore = await priceRows(x.skus[0]);
    const undone = await bulk.undoBatch(owner, made.batchId);
    if (!undone.ok) throw new Error(undone.problem);
    expect(undone).toMatchObject({ restored: 2, conflicts: 1, gone: 0 });
    expect(await priceOf(fx.storeId, x.skus[0])).toBe(original[0]);
    expect(await priceOf(fx.storeId, z.skus[0])).toBe(original[2]);
    // The cell changed since is left as it is.
    expect(await priceOf(fx.storeId, y.skus[0])).toBe((changed[1] as number) + 300);
    // A price put back is a new price row, as any change is.
    expect(await priceRows(x.skus[0])).toBe(rowsBefore + 1);
    // Its own batch, with its own entry.
    const own = (await bulk.batchSummary(fx.storeId, undone.batchId))!;
    expect(own).toMatchObject({ action: "undo", undoOf: made.batchId, undoable: false });
    expect(own.counts.failed).toBe(1);
    expect(own.failures[0].reason).toContain("changed after the edit");
    expect((await auditOf(fx.storeId, "products.bulk_undone")).filter((e) => (e.details as { batchId?: string }).batchId === undone.batchId)).toHaveLength(1);
    const original1 = (await bulk.batchSummary(fx.storeId, made.batchId))!;
    expect(original1.undoneAt).not.toBeNull();
    expect(original1.undoable).toBe(false);
    // Done once, and an undo is not undone.
    expect(await bulk.undoBatch(owner, made.batchId)).toMatchObject({ ok: false, problem: expect.stringContaining("already undone") });
    expect(await bulk.undoBatch(owner, undone.batchId)).toMatchObject({ ok: false, problem: expect.stringContaining("cannot be undone") });
    // The record is append-only: the database refuses to rewrite it.
    await expect(db().execute(sql`update commerce.bulk_edit_items set after = '1'::jsonb where batch_id = ${made.batchId}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("append_only") } });
  });

  it("is open for seven days: an older batch is refused by the app and by the database", async () => {
    const [batch] = await db().execute<Row>(sql`
      insert into commerce.bulk_edit_batches (store_id, requested_by, action, params, counts, created_at)
      values (${fx.storeId}::uuid, ${owner.account.id}::uuid, 'stock', ${JSON.stringify({ productIds: [products[0].id], change: "1" })}::jsonb, '{}'::jsonb, now() - interval '8 days') returning id
    `);
    const refused = await bulk.undoBatch(owner, String(batch.id));
    expect(refused).toMatchObject({ ok: false, problem: expect.stringContaining("seven days") });
    await expect(db().execute(sql`insert into commerce.bulk_edit_batches (store_id, requested_by, action, params, undo_of) values (${fx.storeId}::uuid, ${owner.account.id}::uuid, 'undo', '{}'::jsonb, ${String(batch.id)}::uuid)`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("undo_expired") } });
  });

  it("says a product that is gone cannot be undone, and puts status and terms back", async () => {
    const group = [products[26], products[27]];
    const [category] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'category', 'Undo cat', 'undo-cat') returning id`);
    const added = await bulk.startBulk(owner, { action: "terms_add", productIds: ids(group), categoryIds: [String(category.id)], tagIds: [] });
    if (!added.ok) throw new Error(added.problem);
    const archived = await bulk.startBulk(owner, { action: "archive", productIds: [group[0].id] });
    if (!archived.ok) throw new Error(archived.problem);
    expect(await statusOf(group[0].handle)).toBe("archived");
    // Undo the archive: back to what it was (active), and the terms put back off.
    const back = await bulk.undoBatch(owner, archived.batchId);
    expect(back).toMatchObject({ ok: true, restored: 1 });
    expect(await statusOf(group[0].handle)).not.toBe("archived");
    const undoTerms = await bulk.undoBatch(owner, added.batchId);
    expect(undoTerms).toMatchObject({ ok: true, restored: 2 });
    expect(await count(sql`select count(*)::int as n from commerce.product_terms where store_id = ${fx.storeId}::uuid and term_id = ${String(category.id)}::uuid`)).toBe(0);
  });
});

describe("stock while a product is saved (review: a sale paid after the read must not be put back on the shelf)", () => {
  async function readThenSell(sku: string, start: number, sold: number) {
    const { getEditorContext, getProductForEdit } = await import("./products");
    await db().execute(sql`update commerce.inventory_levels set on_hand = ${start} where variant_id = (select id from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = ${sku})`);
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const [row] = await db().execute<Row>(sql`select p.id from commerce.products p join commerce.product_variants v on v.product_id = p.id where p.store_id = ${fx.storeId}::uuid and v.sku = ${sku}`);
    const product = (await getProductForEdit(store, editor, String(row.id)))!;
    const { archived, ...input } = product;
    void archived;
    const variant = input.variants.find((v) => v.sku === sku)!;
    const read = variant.stock;
    // A payment completes after the read (what commerce.complete_order_payment does).
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand - ${sold} where variant_id = ${variant.id}::uuid`);
    return { store, editor, id: String(row.id), input, variant, read };
  }

  it("leaves the stock alone when the save does not change it, and writes it as given for the editor (no stock mode)", async () => {
    const { saveProduct } = await import("./products");
    const { store, editor, id, input, variant, read } = await readThenSell("BULK-10", 10, 3);
    expect(read).toBe(10);
    variant.cost = "12.50";
    expect(await saveProduct(store, editor, id, input, undefined, undefined, undefined, { loaded: new Map([[variant.id as string, read]]) })).toMatchObject({ ok: true });
    expect(await stockOf(fx.storeId, "BULK-10")).toBe(7);
    // The editor's save has no stock mode: what it holds is written, as it always was.
    expect(await saveProduct(store, editor, id, input)).toMatchObject({ ok: true });
    expect(await stockOf(fx.storeId, "BULK-10")).toBe(10);
  });

  it("applies an adjustment to the stock as it is now, and a figure that was set as that figure", async () => {
    const { saveProduct } = await import("./products");
    const { store, editor, id, input, variant, read } = await readThenSell("BULK-11", 11, 4);
    expect(read).toBe(11);
    variant.stock = read + 5;
    expect(await saveProduct(store, editor, id, input, undefined, undefined, undefined, { loaded: new Map([[variant.id as string, read]]), relative: true })).toMatchObject({ ok: true });
    // 11 on hand when read, 4 sold, 5 added: 12.
    expect(await stockOf(fx.storeId, "BULK-11")).toBe(12);
    variant.stock = 20;
    expect(await saveProduct(store, editor, id, input, undefined, undefined, undefined, { loaded: new Map([[variant.id as string, read]]) })).toMatchObject({ ok: true });
    expect(await stockOf(fx.storeId, "BULK-11")).toBe(20);
    // An adjustment never takes the stock below nothing.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 2 where variant_id = ${variant.id as string}::uuid`);
    variant.stock = 0;
    expect(await saveProduct(store, editor, id, input, undefined, undefined, undefined, { loaded: new Map([[variant.id as string, read]]), relative: true })).toMatchObject({ ok: true });
    expect(await stockOf(fx.storeId, "BULK-11")).toBe(0);
  });

  it("is what the bulk stock action does: an adjustment of +5 is five more than there is when it is written", async () => {
    const before = await stockOf(fx.storeId, "BULK-12");
    const result = await bulk.startBulk(owner, { action: "stock", productIds: [products[11].id], change: "+5" });
    expect(result).toMatchObject({ ok: true });
    expect(await stockOf(fx.storeId, "BULK-12")).toBe(before + 5);
  });
});
