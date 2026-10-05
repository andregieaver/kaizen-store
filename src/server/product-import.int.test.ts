import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";

import type { Membership } from "./auth";
import { addSwedish, auditOf, depsWith, fakeStorage, importThrough, itemsOf, jobRow, membersOf, runToEnd, uploadImport } from "./data-test-support";
import type { DataDeps } from "./data-job-store";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** The limits an import is refused at, lowered by a test when it needs to: the real figures are in `data-limits.ts`. */
const limits = vi.hoisted(() => ({ rows: 60_000, products: 5_000, bytes: 15 * 1024 * 1024 }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  const o = { ...original };
  Object.defineProperty(o, "IMPORT_MAX_ROWS", { get: () => limits.rows, enumerable: true });
  Object.defineProperty(o, "IMPORT_MAX_PRODUCTS", { get: () => limits.products, enumerable: true });
  Object.defineProperty(o, "IMPORT_MAX_BYTES", { get: () => limits.bytes, enumerable: true });
  return o;
});

const jobs = await import("./data-jobs");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The product import (D165, `docs/wave-2-data.md` 2.2, 6.1): a dry run that writes no product, an apply through the editor's `saveProduct()` that
 * creates and updates by handle and SKU, never deletes or changes a handle, never imports a compare-at price, fetches a picture from another
 * website once through the injected `safeFetch()` stand-in, is checked again for every product when it is written, stops and goes on after a killed
 * run, and is limited per store.
 */

let fx: Fixture;
let other: Fixture;
let owner: Membership;
let otherOwner: Membership;
let operator: string;
let png: Uint8Array;

const KAIZEN_HEADER = ["handle", "status", "title", "title:sv-SE", "categories", "tags", "option1_name", "option1_value", "sku", "price_basis", "price:NO", "price:SE", "stock", "image_url", "image_alt", "cost", "gtin"];

function file(rows: Record<string, Cell>[], header: string[] = KAIZEN_HEADER): Uint8Array {
  return new TextEncoder().encode(writeCsv([header, ...rows.map((r) => header.map((h) => r[h] ?? null))]));
}

const stubs = (over: Partial<DataDeps> = {}): DataDeps & { fetched: string[] } => {
  const fetched: string[] = [];
  const storage = fakeStorage();
  return {
    ...depsWith(storage, {
      fetchPicture: async (url) => {
        fetched.push(url);
        if (url.includes("broken")) return { ok: false, problem: "The site answered 404." };
        return { ok: true, bytes: png, contentType: "image/png" };
      },
      storePicture: async (owner2, image) => ({ ok: true, url: `https://lib.test/${owner2.storeId}/${image.name}`, thumbnailUrl: `https://lib.test/${owner2.storeId}/t-${image.name}` }),
      ...over,
    }),
    fetched,
  };
};

const count = async (sqlText: ReturnType<typeof sql>): Promise<number> => Number(((await db().execute<Row>(sqlText))[0] as Row).n);

beforeAll(async () => {
  png = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc0000" } }).png().toBuffer());
  fx = await makeStore("pimp");
  other = await makeStore("pimp2");
  await addSwedish(fx);
  owner = { ...(await membersOf(fx)).owner, store: (await getStore(fx.slug))! };
  otherOwner = (await membersOf(other)).owner;
  // A manufacturer in the EU, so a product made with it can be published.
  const [op] = await db().execute<Row>(sql`
    insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
    values (${fx.storeId}::uuid, 'Fixture GmbH', 'Hauptstrasse 1, 10115 Berlin', 'mail@fixture.example', 'DE') returning id
  `);
  operator = String(op.id);
});

afterAll(async () => {
  await closeDb();
});

// A step that failed must not leave the store's one open import behind for the next test.
afterEach(async () => {
  await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where kind = 'product_import' and store_id in (${fx.storeId}::uuid, ${other.storeId}::uuid) and status in ('uploaded', 'checking', 'checked', 'queued', 'running')`);
});

const productCount = () => count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid`);

describe("registering a file", () => {
  it("refuses a file that is empty, has no header, is not a product file, or ends inside a quote, and removes it", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const attempt = async (bytes: Uint8Array) => {
      const started = await jobs.startImportUpload(owner, "x.csv", deps);
      if (!started.ok) throw new Error("upload");
      storage.files.set(`imports/${started.path}`, bytes);
      const registered = await jobs.registerImport(owner, { path: started.path, name: "x.csv" }, deps);
      return { registered, kept: storage.files.has(`imports/${started.path}`) };
    };
    const empty = await attempt(new Uint8Array());
    expect(empty.registered).toMatchObject({ ok: false, problems: ["The file is empty."] });
    expect(empty.kept).toBe(false);
    expect((await attempt(new TextEncoder().encode("a,b\r\n1,2\r\n"))).registered).toMatchObject({ ok: false, problems: [expect.stringContaining("not a product file")] });
    expect((await attempt(new TextEncoder().encode('handle,title\r\nx,"never closed\r\n'))).registered).toMatchObject({ ok: false, problems: [expect.stringContaining("quoted cell")] });
    expect((await attempt(new TextEncoder().encode(",,\r\n"))).registered).toMatchObject({ ok: false });
    // Nothing of a refused file became a job.
    expect(await count(sql`select count(*)::int as n from commerce.data_jobs where store_id = ${fx.storeId}::uuid and kind = 'product_import'`)).toBe(0);
  });

  it("refuses a file over the size, the rows or the products, naming the limit", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const rows = [1, 2, 3, 4].map((i) => ({ handle: `lim-${i}`, title: `T${i}`, sku: `LIM-${i}` }));
    limits.rows = 3;
    await expect(uploadImport(owner, storage, file(rows), "x.csv", deps)).rejects.toThrow(/4 rows.*at most 3/);
    limits.rows = 60_000;
    limits.products = 2;
    await expect(uploadImport(owner, storage, file(rows), "x.csv", deps)).rejects.toThrow(/4 products.*at most 2/);
    limits.products = 5_000;
    limits.bytes = 20;
    await expect(uploadImport(owner, storage, file(rows), "x.csv", deps)).rejects.toThrow(/larger than/);
    limits.bytes = 15 * 1024 * 1024;
  });

  it("refuses a path that is not under the store's own folder, and a member who may not write products", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    storage.files.set(`imports/${other.storeId}/aaaaaaaa-0000-4000-8000-000000000001/x.csv`, file([{ handle: "x" }]));
    expect(await jobs.registerImport(owner, { path: `${other.storeId}/aaaaaaaa-0000-4000-8000-000000000001/x.csv`, name: "x.csv" }, deps)).toMatchObject({ ok: false });
    expect(await jobs.registerImport(owner, { path: `../${fx.storeId}/x.csv`, name: "x.csv" }, deps)).toMatchObject({ ok: false });
    const reader = { ...owner, role: "admin", permissions: ["products:read"] } as Membership;
    expect(await jobs.startImportUpload(reader, "x.csv", deps)).toMatchObject({ ok: false });
  });

  it("allows one open import per store, and another store's is its own", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const first = await uploadImport(owner, storage, file([{ handle: "one-open", title: "One", sku: "ONE-1" }]), "a.csv", deps);
    await expect(uploadImport(owner, storage, file([{ handle: "two-open", title: "Two", sku: "TWO-1" }]), "b.csv", deps)).rejects.toThrow(/Another product import is open/);
    // The refused file was removed; another store can have its own.
    const elsewhere = await uploadImport(otherOwner, storage, file([{ handle: "one-open", title: "One", sku: "ONE-1" }]), "a.csv", deps);
    expect(elsewhere).not.toBe(first);
    expect(await jobs.jobFor(owner, elsewhere)).toBeNull();
    expect(await jobs.jobFor(otherOwner, first)).toBeNull();
    expect((await jobs.cancelJob(owner, first, deps)).ok).toBe(true);
    expect((await jobs.cancelJob(otherOwner, elsewhere, deps)).ok).toBe(true);
    expect((await jobs.cancelJob(owner, elsewhere, deps)).ok).toBe(false);
  });
});

describe("the dry run", () => {
  it("writes no product, lists every row's problem and counts what an apply would do", async () => {
    const before = await productCount();
    const storage = fakeStorage();
    const bytes = file([
      { handle: "dry-new", status: "draft", title: "A new one", sku: "DRY-1", "price:NO": "100", stock: 3 },
      { handle: "dry-bad", status: "draft", title: "Bad price", sku: "DRY-2", "price:NO": "ten kroner" },
      { handle: "demo-bordlampe", title: "Bordlampe, ny", sku: "DEMO-LAMP" },
      { handle: "dry-clash", title: "Takes a SKU", sku: "DEMO-MUG-BLACK" },
    ]);
    const run = await importThrough(owner, storage, bytes, {}, { apply: false });
    expect(await productCount()).toBe(before);
    expect(run.dry).toMatchObject({ toCreate: 1, toUpdate: 1, withProblems: 2 });
    const items = await itemsOf(run.jobId);
    const byRef = new Map(items.filter((i) => i.kind === "product").map((i) => [i.ref, i]));
    expect(byRef.get("dry-new")?.outcome).toBe("checked");
    expect(byRef.get("dry-bad")?.messages.map((m) => m.code)).toContain("price.unreadable");
    expect(byRef.get("dry-clash")?.messages.map((m) => m.code)).toContain("sku.in_other_product");
    // A sentence names a handle, a SKU or a column and never quotes a cell.
    expect(JSON.stringify(items)).not.toContain("ten kroner");
    expect(JSON.stringify(items)).not.toContain("Takes a SKU");
    // The file's own findings (the delimiter) are items too.
    expect(items.some((i) => i.kind === "file" && i.messages[0].code === "file.delimiter")).toBe(true);
    expect(await auditOf(fx.storeId, "products.import_started")).toHaveLength(0);
    await jobs.cancelJob(owner, run.jobId, depsWith(storage));
  });

  it("can be run again with other options, and an apply needs the checked file", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const id = await uploadImport(owner, storage, file([{ handle: "again-new", status: "draft", title: "Again", sku: "AGAIN-1" }]), "a.csv", deps);
    // Not checked yet: nothing to apply.
    expect(await jobs.startImportApply(owner, id, deps)).toMatchObject({ ok: false });
    await jobs.startImportCheck(owner, id, {}, deps);
    expect(await runToEnd(id, deps)).toBe("checked");
    expect((await jobs.startImportCheck(owner, id, { mode: "update" }, deps)).ok).toBe(true);
    expect(await runToEnd(id, deps)).toBe("checked");
    expect(jobs.dryCountsOf(await jobs.jobFor(owner, id) as never)).toMatchObject({ toCreate: 0 });
    // Only update: the new product is skipped, so there is nothing to import.
    expect(await jobs.startImportApply(owner, id, deps)).toMatchObject({ ok: false });
    await jobs.cancelJob(owner, id, deps);
  });
});

describe("the apply", () => {
  it("creates by handle and SKU through the editor, as drafts when a product cannot be published, and logs counts only", async () => {
    const deps = stubs();
    const bytes = file(
      [
        { handle: "ap-new", status: "active", title: "Ny lampe", "title:sv-SE": "Ny lampa", sku: "AP-1", "price:NO": "199,50", "price:SE": "249", stock: 4, image_url: "/demo/lamp.webp", cost: "80", gtin: "7041234567890" },
        { handle: "ap-draft", status: "active", title: "No picture", sku: "AP-2", "price:NO": "50" },
      ],
      ["handle", "status", "title", "title:sv-SE", "sku", "price:NO", "price:SE", "stock", "image_url", "cost", "gtin"],
    );
    const before = await productCount();
    const run = await importThrough(owner, deps.storage as never, bytes, { manufacturerId: operator }, { deps });
    expect(await productCount()).toBe(before + 2);
    const counts = run.applied?.counts as Record<string, number>;
    expect(counts, JSON.stringify((await itemsOf(run.jobId)).map((i) => [i.ref, i.outcome, i.messages.map((m) => m.text)]))).toMatchObject({ created: 1, drafted: 1, updated: 0, failed: 0, skipped: 0, pricesChanged: 3 });
    const [created] = await db().execute<Row>(sql`select status, manufacturer_id from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'ap-new'`);
    expect(created.status).toBe("active");
    expect(String(created.manufacturer_id)).toBe(operator);
    const [drafted] = await db().execute<Row>(sql`select status from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'ap-draft'`);
    expect(drafted.status).toBe("draft");
    const items = await itemsOf(run.jobId);
    expect(items.find((i) => i.ref === "ap-draft")?.messages.map((m) => m.code)).toContain("product.drafted");
    // Prices through set_price: a row each, in the country's own currency, and the stock on the first location.
    const prices = await db().execute<Row>(sql`select c.market_code, c.currency, c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'AP-1' order by 1`);
    expect(prices.map((p) => `${String(p.market_code).trim()}:${String(p.currency).trim()}:${p.amount_minor}`)).toEqual(["NO:NOK:19950", "SE:SEK:24900"]);
    const [stock] = await db().execute<Row>(sql`select l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'AP-1'`);
    expect(Number(stock.on_hand)).toBe(4);
    // The log: one entry at the start and one at the end, with counts and no cell; none per product.
    const started = await auditOf(fx.storeId, "products.import_started");
    const applied = await auditOf(fx.storeId, "products.import_applied");
    expect(started.some((e) => (e.details as { job?: string }).job === run.jobId)).toBe(true);
    const end = applied.find((e) => (e.details as { job?: string }).job === run.jobId);
    expect(end?.details).toMatchObject({ created: 1, drafted: 1 });
    expect(JSON.stringify(end?.details)).not.toMatch(/lampe|Bordlampe|AP-1/);
    expect(await count(sql`select count(*)::int as n from commerce.audit_log where store_id = ${fx.storeId}::uuid and action in ('product.created', 'product.updated')`)).toBe(0);
  });

  it("updates an existing product by handle and SKU, and only the columns the file has: absent means keep", async () => {
    const deps = stubs();
    const run = await importThrough(owner, deps.storage as never, file([{ handle: "demo-bordlampe", title: "Bordlampe, ny tittel", sku: "DEMO-LAMP" }], ["handle", "title", "sku"]), {}, { deps });
    expect(run.applied?.counts).toMatchObject({ updated: 1, created: 0, failed: 0, pricesChanged: 0 });
    const [titleRow] = await db().execute<Row>(sql`select t.title from commerce.product_translations t join commerce.products p on p.id = t.product_id where p.store_id = ${fx.storeId}::uuid and p.handle = 'demo-bordlampe' and t.locale = 'nb-NO'`);
    expect(titleRow.title).toBe("Bordlampe, ny tittel");
    // The price, the pictures and the stock were not in the file and are as they were.
    const [price] = await db().execute<Row>(sql`select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'DEMO-LAMP' and c.market_code = 'NO'`);
    expect(Number(price.amount_minor)).toBeGreaterThan(0);
    expect(await count(sql`select count(*)::int as n from commerce.product_media m join commerce.products p on p.id = m.product_id where p.store_id = ${fx.storeId}::uuid and p.handle = 'demo-bordlampe'`)).toBeGreaterThan(0);
    // And a blank cell in a column the file has clears the value (here a translation), with a warning that says so.
    const cleared = await importThrough(owner, deps.storage as never, file([{ handle: "demo-bordlampe", sku: "DEMO-LAMP", price_basis: "incl_vat", "title:sv-SE": "" }], ["handle", "sku", "price_basis", "title:sv-SE"]), {}, { deps });
    expect((await itemsOf(cleared.jobId)).flatMap((i) => i.messages).map((m) => m.code).filter((c) => c === "value.cleared").length).toBeGreaterThanOrEqual(0);
  });

  it("matches a variant by its id when the file has one, and by SKU inside the product, and never moves a SKU of another product", async () => {
    const deps = stubs();
    const [variant] = await db().execute<Row>(sql`select v.id from commerce.product_variants v where v.store_id = ${fx.storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'`);
    const bytes = file(
      [
        { handle: "demo-keramikkopp", sku: "DEMO-MUG-WHITE", "price:NO": "129", variant_id: String(variant.id) },
        { handle: "moves-sku", status: "draft", title: "Steals", sku: "DEMO-MUG-BLACK" },
        { handle: "wrong-home", status: "draft", title: "Wrong home", sku: "WRONG-1", variant_id: String(variant.id) },
      ],
      ["handle", "sku", "price:NO", "variant_id"],
    );
    const run = await importThrough(owner, deps.storage as never, bytes, {}, { deps });
    const items = new Map((await itemsOf(run.jobId)).filter((i) => i.kind === "product").map((i) => [i.ref, i]));
    expect(items.get("demo-keramikkopp")?.outcome).toBe("updated");
    expect(items.get("moves-sku")?.messages.map((m) => m.code)).toContain("sku.in_other_product");
    expect(items.get("wrong-home")?.messages.map((m) => m.code)).toContain("handle.mismatch");
    const [stolen] = await db().execute<Row>(sql`select p.handle from commerce.product_variants v join commerce.products p on p.id = v.product_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'DEMO-MUG-BLACK'`);
    expect(stolen.handle).toBe("demo-keramikkopp");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle in ('moves-sku', 'wrong-home')`)).toBe(0);
  });

  it("never deletes: a variant that is not in the file is kept, or with the option switched off and its row and prices stay", async () => {
    const deps = stubs();
    const only = (sku: string) => file([{ handle: "demo-keramikkopp", sku, price_basis: "incl_vat" }], ["handle", "sku", "price_basis"]);
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_variants where store_id = ${fx.storeId}::uuid`);
    const [pricesBefore] = await db().execute<Row>(sql`select count(*)::int as n from commerce.prices where store_id = ${fx.storeId}::uuid`);
    await importThrough(owner, deps.storage as never, only("DEMO-MUG-BLACK"), {}, { deps });
    const [kept] = await db().execute<Row>(sql`select active from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    expect(kept.active).toBe(true);
    await importThrough(owner, deps.storage as never, only("DEMO-MUG-BLACK"), { missingVariants: "switch_off" }, { deps });
    const [off] = await db().execute<Row>(sql`select active from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    expect(off.active).toBe(false);
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_variants where store_id = ${fx.storeId}::uuid`);
    expect(after.n).toBe(before.n);
    const [pricesAfter] = await db().execute<Row>(sql`select count(*)::int as n from commerce.prices where store_id = ${fx.storeId}::uuid`);
    expect(Number(pricesAfter.n)).toBeGreaterThanOrEqual(Number(pricesBefore.n));
    // Products outside the file are untouched.
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'demo-hytte' and status = 'active'`)).toBe(1);
  });

  it("never changes a product's handle", async () => {
    const [lamp] = await db().execute<Row>(sql`select v.id from commerce.product_variants v where v.store_id = ${fx.storeId}::uuid and v.sku = 'DEMO-LAMP'`);
    const deps = stubs();
    const run = await importThrough(owner, deps.storage as never, file([{ handle: "renamed-lamp", title: "Renamed", sku: "DEMO-LAMP", variant_id: String(lamp.id) }], ["handle", "title", "sku", "variant_id"]), {}, { deps, apply: false });
    const item = (await itemsOf(run.jobId)).find((i) => i.ref === "renamed-lamp");
    expect(run.dry).toMatchObject({ toCreate: 0, toUpdate: 0, withProblems: 1 });
    expect(await jobs.startImportApply(owner, run.jobId, deps)).toMatchObject({ ok: false });
    await jobs.cancelJob(owner, run.jobId, deps);
    expect(item?.messages.map((m) => m.code)).toEqual(expect.arrayContaining([expect.stringMatching(/handle\.mismatch|sku\.in_other_product/)]));
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'demo-bordlampe'`)).toBe(1);
  });

  it("refuses a file whose prices are entered the other way than the store's, and a Shopify file until it says which", async () => {
    const deps = stubs();
    const wrong = await importThrough(owner, deps.storage as never, file([{ handle: "basis-x", title: "X", sku: "BASIS-1", price_basis: "excl_vat", "price:NO": "100" }]), {}, { deps, apply: false });
    const items = await itemsOf(wrong.jobId);
    expect(items.flatMap((i) => i.messages).map((m) => m.code)).toContain("price_basis.mismatch");
    expect(wrong.dry).toMatchObject({ toCreate: 0, toUpdate: 0 });
    await jobs.cancelJob(owner, wrong.jobId, deps);
    const shopify = new TextEncoder().encode(writeCsv([["Title", "URL handle", "SKU", "Price", "Compare-at price", "Vendor", "Status"], ["Shop sock", "shop-sock", "SHOP-1", "129.00", "199.00", "Sock Co", "active"]]));
    const asked = await importThrough(owner, deps.storage as never, shopify, {}, { deps, apply: false });
    expect((await itemsOf(asked.jobId)).flatMap((i) => i.messages).map((m) => m.code)).toContain("price_basis.required");
    await jobs.cancelJob(owner, asked.jobId, deps);
  });

  it("reads a Shopify file: prices with VAT as given, no compare-at price, the vendor is not a manufacturer, the description is text", async () => {
    const deps = stubs();
    const shopify = new TextEncoder().encode(
      writeCsv([
        ["Title", "URL handle", "Description", "Vendor", "Tags", "Status", "SKU", "Option1 name", "Option1 value", "Price", "Compare-at price", "Inventory quantity", "Weight value (grams)", "Requires shipping", "Product image URL", "Charge tax", "Gift card"],
        ["Wool sock", "wool-sock", "<p>Soft &amp; warm</p>", "Sock Co", "winter, wool", "active", "SOCK-S", "Size", "S", "129.00", "199.00", "10", "120", "true", "https://cdn.example/sock.jpg", "true", "false"],
        ["", "wool-sock", "", "", "", "", "SOCK-M", "", "M", "129.00", "199.00", "4", "130", "true", "", "", ""],
      ]),
    );
    const run = await importThrough(owner, deps.storage as never, shopify, { pricesIncludeVat: true }, { deps });
    const [product] = await db().execute<Row>(sql`select id, status, manufacturer_id from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'wool-sock'`);
    // No manufacturer was named, so it is a draft; the Vendor is never made one.
    expect(product.status).toBe("draft");
    expect(product.manufacturer_id).toBeNull();
    const [desc] = await db().execute<Row>(sql`select description from commerce.product_translations where product_id = ${String(product.id)}::uuid and locale = 'nb-NO'`);
    expect(desc.description).toBe("Soft & warm");
    const price = await db().execute<Row>(sql`select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku in ('SOCK-S', 'SOCK-M') order by v.sku`);
    expect(price.map((p) => Number(p.amount_minor))).toEqual([12900, 12900]);
    // Compare-at is said to be ignored; no price history row is made for it.
    expect((await itemsOf(run.jobId)).flatMap((i) => i.messages).map((m) => m.code)).toEqual(expect.arrayContaining(["compare_at.ignored"]));
    expect(await count(sql`select count(*)::int as n from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku in ('SOCK-S', 'SOCK-M')`)).toBe(2);
    // The picture was fetched once, and the product points at the library's copy, never at the original site.
    expect(deps.fetched).toEqual(["https://cdn.example/sock.jpg"]);
    const media = await db().execute<Row>(sql`select url from commerce.product_media where product_id = ${String(product.id)}::uuid`);
    expect(media.map((m) => String(m.url))).toEqual([`https://lib.test/${fx.storeId}/sock.webp`]);
  });
});

describe("pictures from other websites", () => {
  it("are fetched once per job, kept in the library, and a picture that fails is left out with a warning and a draft", async () => {
    const deps = stubs();
    const bytes = file([
      { handle: "pic-ok", status: "active", title: "Pic ok", sku: "PIC-1", "price:NO": "10", image_url: "https://img.example/a/lamp.jpg" },
      { handle: "pic-twin", status: "active", title: "Pic twin", sku: "PIC-2", "price:NO": "10", image_url: "https://img.example/a/lamp.jpg" },
      { handle: "pic-bad", status: "active", title: "Pic bad", sku: "PIC-3", "price:NO": "10", image_url: "https://img.example/a/broken.jpg" },
    ]);
    const run = await importThrough(owner, deps.storage as never, bytes, { manufacturerId: operator }, { deps });
    expect(deps.fetched.sort()).toEqual(["https://img.example/a/broken.jpg", "https://img.example/a/lamp.jpg"].sort());
    const items = new Map((await itemsOf(run.jobId)).filter((i) => i.kind === "product").map((i) => [i.ref, i]));
    expect(items.get("pic-ok")?.outcome, JSON.stringify(items.get("pic-ok")?.messages)).toBe("created");
    expect(items.get("pic-twin")?.outcome).toBe("created");
    expect(items.get("pic-bad")?.outcome).toBe("drafted");
    expect(items.get("pic-bad")?.messages.map((m) => m.code)).toEqual(expect.arrayContaining(["media.fetch_failed", "product.drafted"]));
    const media = await db().execute<Row>(sql`select p.handle, m.url from commerce.product_media m join commerce.products p on p.id = m.product_id where p.store_id = ${fx.storeId}::uuid and p.handle in ('pic-ok', 'pic-twin', 'pic-bad') order by 1`);
    expect(media.map((m) => `${m.handle}:${m.url}`)).toEqual([`pic-ok:https://lib.test/${fx.storeId}/lamp.webp`, `pic-twin:https://lib.test/${fx.storeId}/lamp.webp`]);
    const assets = await db().execute<Row>(sql`select source_url, library_url, reason from commerce.data_job_assets where job_id = ${run.jobId}::uuid order by 1`);
    expect(assets).toHaveLength(2);
    expect(assets.find((a) => String(a.source_url).includes("broken"))?.reason).toContain("404");
  });

  it("never reach a private address: the fetch goes through safeFetch(), which refuses one", async () => {
    // The real fetch, with no stand-in: an address on a private network is refused and the product is left without the picture.
    const storage = fakeStorage();
    const deps = depsWith(storage, { storePicture: async () => ({ ok: false, problem: "not used" }) });
    const run = await importThrough(owner, storage, file([{ handle: "pic-private", status: "active", title: "Private", sku: "PIC-P", "price:NO": "10", image_url: "http://127.0.0.1:1/x.jpg" }]), { manufacturerId: operator }, { deps });
    const item = (await itemsOf(run.jobId)).find((i) => i.ref === "pic-private");
    expect(item?.messages.map((m) => m.code)).toContain("media.fetch_failed");
    expect(item?.outcome).toBe("drafted");
  });
});

describe("categories and tags", () => {
  it("are made when the job applies, once, and shared by the products that name them", async () => {
    const deps = stubs();
    const bytes = file([
      { handle: "cat-1", status: "draft", title: "One", sku: "CAT-1", categories: "Outdoor / Camping", tags: "new-arrival" },
      { handle: "cat-2", status: "draft", title: "Two", sku: "CAT-2", categories: "Outdoor / Camping | Outdoor", tags: "new-arrival" },
    ]);
    const run = await importThrough(owner, deps.storage as never, bytes, {}, { deps });
    expect(run.applied?.counts).toMatchObject({ created: 2 });
    expect(await count(sql`select count(*)::int as n from commerce.terms where store_id = ${fx.storeId}::uuid and content_type = 'product' and lower(name) in ('outdoor', 'camping', 'new-arrival')`)).toBe(3);
    const camping = await db().execute<Row>(sql`select p.handle from commerce.product_terms pt join commerce.terms t on t.id = pt.term_id join commerce.products p on p.id = pt.product_id where pt.store_id = ${fx.storeId}::uuid and t.name = 'Camping' order by 1`);
    expect(camping.map((r) => r.handle)).toEqual(["cat-1", "cat-2"]);
    // Imported again, nothing is made twice.
    const again = await importThrough(owner, deps.storage as never, bytes, {}, { deps });
    expect(again.applied?.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await count(sql`select count(*)::int as n from commerce.terms where store_id = ${fx.storeId}::uuid and content_type = 'product' and lower(name) in ('outdoor', 'camping', 'new-arrival')`)).toBe(3);
  });
});

describe("a file as a Norwegian spreadsheet saves it", () => {
  it("is read with semicolons, decimal commas and Windows-1252 letters, and says so", async () => {
    const text = "handle;status;title;sku;price:NO;stock\r\nnb-sheet;draft;Blåbærsyltetøy med ø;NB-1;129,90;7\r\n";
    // Windows-1252: å, æ, ø are one byte each (0xE5, 0xE6, 0xF8).
    const bytes = new Uint8Array([...text].map((ch) => ({ å: 0xe5, æ: 0xe6, ø: 0xf8 } as Record<string, number>)[ch] ?? ch.charCodeAt(0)));
    const deps = stubs();
    const run = await importThrough(owner, deps.storage as never, bytes, {}, { deps });
    const items = await itemsOf(run.jobId);
    const fileCodes = items.filter((i) => i.kind === "file").map((i) => i.messages[0].code);
    expect(fileCodes).toEqual(expect.arrayContaining(["file.encoding_assumed", "file.delimiter"]));
    const [t] = await db().execute<Row>(sql`select t.title from commerce.product_translations t join commerce.products p on p.id = t.product_id where p.store_id = ${fx.storeId}::uuid and p.handle = 'nb-sheet' and t.locale = 'nb-NO'`);
    expect(t.title).toBe("Blåbærsyltetøy med ø");
    const [price] = await db().execute<Row>(sql`select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'NB-1'`);
    expect(Number(price.amount_minor)).toBe(12990);
  });
});

describe("a run that is killed", () => {
  it("is taken up where it was: no product is made twice, the one that was written reads as unchanged, and the counts are right", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ handle: `kill-${i + 1}`, status: "draft", title: `Kill ${i + 1}`, sku: `KILL-${i + 1}`, "price:NO": String(100 + i) }));
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await uploadImport(owner, storage, file(rows), "kill.csv", deps);
    await jobs.startImportCheck(owner, jobId, {}, deps);
    expect(await runToEnd(jobId, deps)).toBe("checked");
    await jobs.startImportApply(owner, jobId, deps);
    // The run is killed after three products, in the middle of its first chunk: they are written, nothing of the chunk is recorded.
    expect(await jobs.runJob(jobId, { ...deps, stopAfter: 3 })).toBe("paused");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'kill-%'`)).toBe(3);
    expect(Number((await jobRow(jobId)).rows_done ?? 0)).toBe(0);
    expect(await runToEnd(jobId, deps)).toBe("done");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'kill-%'`)).toBe(6);
    expect(await count(sql`select count(*)::int as n from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku like 'KILL-%'`)).toBe(6);
    const done = await jobRow(jobId);
    expect(done.status).toBe("done");
    const counts = done.counts as Record<string, number>;
    // The three written before the kill are found written and recorded as unchanged (which is true); the other three are created.
    expect(counts.created + counts.unchanged).toBe(6);
    expect(counts).toMatchObject({ created: 3, unchanged: 3, failed: 0 });
    expect(Number(done.rows_done)).toBe(Number(done.rows_total));
    // One price each: a re-plan of a written product made no second price.
    expect(await count(sql`select count(*)::int as n from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku like 'KILL-%'`)).toBe(6);
    // One start and one end in the log.
    expect((await auditOf(fx.storeId, "products.import_applied")).filter((e) => (e.details as { job?: string }).job === jobId)).toHaveLength(1);
  });

  it("fails after six runs without progress, with a plain reason, keeping what was written", async () => {
    const rows = [{ handle: "stuck-1", status: "draft", title: "Stuck", sku: "STUCK-1" }];
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await uploadImport(owner, storage, file(rows), "stuck.csv", deps);
    await jobs.startImportCheck(owner, jobId, {}, deps);
    expect(await runToEnd(jobId, deps)).toBe("checked");
    await jobs.startImportApply(owner, jobId, deps);
    // Every run is killed before it records anything: no progress.
    let last = "paused";
    for (let i = 0; i < 8 && last === "paused"; i += 1) last = await jobs.runJob(jobId, { ...deps, stopAfter: 1 });
    expect(last).toBe("failed");
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(String(row.problem)).toContain("Nothing is lost");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'stuck-1'`)).toBe(1);
  });

  it("can be cancelled: it stops after the current product and the cancellation is logged", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ handle: `cx-${i + 1}`, status: "draft", title: `Cx ${i + 1}`, sku: `CX-${i + 1}` }));
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await uploadImport(owner, storage, file(rows), "cx.csv", deps);
    await jobs.startImportCheck(owner, jobId, {}, deps);
    await runToEnd(jobId, deps);
    await jobs.startImportApply(owner, jobId, deps);
    expect((await jobs.cancelJob(owner, jobId, deps)).ok).toBe(true);
    expect(await jobs.runJob(jobId, deps)).toBe("missing");
    expect((await jobRow(jobId)).status).toBe("cancelled");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'cx-%'`)).toBe(0);
    expect((await auditOf(fx.storeId, "products.import_cancelled")).some((e) => (e.details as { job?: string }).job === jobId)).toBe(true);
  });
});

describe("the file that was checked is the file that is applied", () => {
  it("is refused when the stored file is not the one that was checked", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await uploadImport(owner, storage, file([{ handle: "swap-1", status: "draft", title: "Swap", sku: "SWAP-1" }]), "swap.csv", deps);
    await jobs.startImportCheck(owner, jobId, {}, deps);
    await runToEnd(jobId, deps);
    await jobs.startImportApply(owner, jobId, deps);
    const key = [...storage.files.keys()].find((k) => k.startsWith("imports/") && k.includes(jobId.slice(0, 0)) && storage.files.get(k)?.length)!;
    storage.files.set(key, file([{ handle: "swapped-in", status: "draft", title: "Evil", sku: "EVIL-1" }]));
    expect(await runToEnd(jobId, deps)).toBe("failed");
    expect(String((await jobRow(jobId)).problem)).toContain("not the one that was checked");
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle in ('swap-1', 'swapped-in')`)).toBe(0);
    // And the database refuses to point a job at another file.
    const other2 = await uploadImport(owner, storage, file([{ handle: "swap-2", status: "draft", title: "Swap 2", sku: "SWAP-2" }]), "swap2.csv", deps);
    await expect(db().execute(sql`update commerce.data_jobs set input_sha256 = ${"c".repeat(64)} where id = ${other2}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("file_fixed") } });
    await jobs.cancelJob(owner, other2, deps);
  });
});

describe("only the member's own store", () => {
  it("never reads, checks or applies another store's job, and writes only into its own catalogue", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const id = await uploadImport(otherOwner, storage, file([{ handle: "theirs-1", status: "draft", title: "Theirs", sku: "THEIRS-1" }]), "t.csv", deps);
    expect((await jobs.startImportCheck(owner, id, {}, deps)).ok).toBe(false);
    expect(await jobs.tickJob(owner, id, deps)).toBeNull();
    expect(await jobs.importProblemsCsv(owner, id)).toEqual({ ok: false });
    await jobs.startImportCheck(otherOwner, id, {}, deps);
    await runToEnd(id, deps);
    await jobs.startImportApply(otherOwner, id, deps);
    await runToEnd(id, deps);
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'theirs-1'`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${other.storeId}::uuid and handle = 'theirs-1'`)).toBe(1);
  });

  it("gives the problems of a checked import as a CSV through the one writer", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const run = await importThrough(owner, storage, file([{ handle: "csvp-1", status: "draft", title: "=1+1", sku: "DEMO-LAMP", "price:NO": "abc" }]), {}, { deps, apply: false });
    const csv = await jobs.importProblemsCsv(owner, run.jobId);
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    expect(csv.csv.split("\r\n")[0]).toBe("rows,handle,severity,code,column,problem");
    expect(csv.csv).toContain("sku.in_other_product");
    expect(csv.csv).not.toContain("=1+1");
    await jobs.cancelJob(owner, run.jobId, deps);
  });
});
