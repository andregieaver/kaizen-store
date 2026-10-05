import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { productColumns } from "@/lib/product-csv";

import { auditOf, depsWith, fakeStorage, jobRow, membersOf, rowsOfCsv, runToEnd, textOf } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** The size above which an export is a job: the real figure is 2,000 rows, lowered here so a few products make a job. */
const limits = vi.hoisted(() => ({ direct: 2000 }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  return Object.defineProperty({ ...original }, "DIRECT_EXPORT_MAX_ROWS", { get: () => limits.direct, enumerable: true });
});

const jobs = await import("./data-jobs");
const { getEditorContext } = await import("./products");
const { csvContextFor } = await import("./product-data");

type Row = Record<string, unknown>;

/**
 * The product export (D165, `docs/wave-2-data.md` 2.1, 6.1 criterion 1): one row per variant of the store's products in the Kaizen layout, as a
 * download at once for a small store and as a job (chunks put together into parts, kept 7 days) for a large one, only the member's own store, logged
 * with counts and never a cell.
 */

let fx: Fixture;
let other: Fixture;
let members: Awaited<ReturnType<typeof membersOf>>;
let otherMembers: Awaited<ReturnType<typeof membersOf>>;

beforeAll(async () => {
  fx = await makeStore("pexp");
  other = await makeStore("pexp2");
  members = await membersOf(fx);
  otherMembers = await membersOf(other);
});

afterAll(async () => {
  await closeDb();
});

describe("a small product export", () => {
  it("is a download at once with the header of the contract and a row for every variant and extra picture", async () => {
    limits.direct = 2000;
    const result = await jobs.requestProductExport(members.admin, {});
    expect(result.ok && result.mode).toBe("file");
    if (!result.ok || result.mode !== "file") return;
    const rows = rowsOfCsv(result.csv);
    const editor = await getEditorContext(members.admin.store);
    const ctx = await csvContextFor(members.admin.store, editor);
    expect(rows[0]).toEqual(productColumns(ctx));
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_variants where store_id = ${fx.storeId}::uuid`);
    expect(rows.length - 1).toBeGreaterThanOrEqual(Number(count.n));
    // Every demo product and every variant SKU is in it.
    const handleColumn = rows[0].indexOf("handle");
    const skuColumn = rows[0].indexOf("sku");
    const handles = new Set(rows.slice(1).map((r) => r[handleColumn]));
    expect(handles.has("demo-bordlampe") && handles.has("demo-keramikkopp") && handles.has("demo-sykkelutleie")).toBe(true);
    const skus = rows.slice(1).map((r) => r[skuColumn]);
    expect(skus).toEqual(expect.arrayContaining(["DEMO-LAMP", "DEMO-MUG-BLACK", "DEMO-MUG-WHITE", "DEMO-SYKKEL-TIME"]));
    expect(result.filename).toMatch(/^products-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("puts a product's own cells on its first row only", async () => {
    const result = await jobs.requestProductExport(members.admin, {});
    if (!result.ok || result.mode !== "file") throw new Error("file");
    const rows = rowsOfCsv(result.csv);
    const h = rows[0];
    const mugs = rows.filter((r) => r[h.indexOf("handle")] === "demo-keramikkopp");
    expect(mugs.length).toBeGreaterThanOrEqual(2);
    expect(mugs[0][h.indexOf("title")]).not.toBe("");
    for (const continuation of mugs.slice(1)) expect(continuation[h.indexOf("title")]).toBe("");
  });

  it("writes one audit entry with counts and no cell, and refuses to serve a file whose entry cannot be written", async () => {
    await jobs.requestProductExport(members.admin, { scope: "status", status: "active" });
    const entries = await auditOf(fx.storeId, "products.export_made");
    expect(entries.length).toBeGreaterThan(0);
    const details = JSON.stringify(entries.at(-1)?.details);
    expect(details).toContain('"rows"');
    expect(details).not.toMatch(/Bordlampe|DEMO-LAMP|demo-/);
    // The log fails: no file.
    const auth = await import("./auth");
    const spy = vi.spyOn(auth, "audit").mockRejectedValue(new Error("log down"));
    try {
      const refused = await jobs.requestProductExport(members.admin, {});
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("not_logged");
    } finally {
      spy.mockRestore();
    }
  });

  it("can leave the pictures' columns out, and take only one status or one category", async () => {
    const noPictures = await jobs.requestProductExport(members.admin, { pictures: "false" });
    if (!noPictures.ok || noPictures.mode !== "file") throw new Error("file");
    const header = rowsOfCsv(noPictures.csv)[0];
    expect(header).not.toContain("image_url");
    expect(header).not.toContain("variant_image_url");
    expect(header).toContain("sku");
    const [category] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'category', 'Lamps', 'lamps') returning id`);
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'demo-bordlampe'`);
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${fx.storeId}::uuid, ${String(product.id)}::uuid, ${String(category.id)}::uuid)`);
    const one = await jobs.requestProductExport(members.admin, { scope: "term", termId: String(category.id) });
    if (!one.ok || one.mode !== "file") throw new Error("file");
    const rows = rowsOfCsv(one.csv);
    expect(new Set(rows.slice(1).map((r) => r[rows[0].indexOf("handle")]))).toEqual(new Set(["demo-bordlampe"]));
    expect(rows[1][rows[0].indexOf("categories")]).toContain("Lamps");
  });

  it("is refused for a member without products:read, and a bad option is a code", async () => {
    const nobody = { ...members.admin, permissions: ["orders:read"], roleId: null } as typeof members.admin;
    const refused = await jobs.requestProductExport(nobody, {});
    expect(refused.ok).toBe(false);
    const bad = await jobs.requestProductExport(members.admin, { scope: "status" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("options");
  });
});

describe("a large product export is a job", () => {
  it("is made in chunks and put together into parts, kept for 7 days, and equals the file made at once", async () => {
    limits.direct = 2000;
    const direct = await jobs.requestProductExport(members.admin, {});
    if (!direct.ok || direct.mode !== "file") throw new Error("file");
    limits.direct = 3;
    const storage = fakeStorage();
    const deps = depsWith(storage, { batchRows: 2, partRows: 7 });
    const started = await jobs.requestProductExport(members.admin, {}, deps);
    expect(started.ok && started.mode).toBe("job");
    if (!started.ok || started.mode !== "job") return;
    const queued = await jobRow(started.jobId);
    expect(queued.status).toBe("queued");
    expect(queued.kind).toBe("product_export");
    expect(await runToEnd(started.jobId, deps)).toBe("done");
    const done = await jobRow(started.jobId);
    expect(done.status).toBe("done");
    const files = done.files as { path: string; name: string; rows: number; bytes: number; sha256: string }[];
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => f.path.startsWith(`${fx.storeId}/${started.jobId}/part-`))).toBe(true);
    // The parts have the header each and, together, the rows of the file made at once.
    const direct_rows = rowsOfCsv(direct.csv);
    const together = files.flatMap((f) => rowsOfCsv(textOf(storage, "exports", f.path)).slice(1));
    expect(rowsOfCsv(textOf(storage, "exports", files[0].path))[0]).toEqual(direct_rows[0]);
    expect(together).toEqual(direct_rows.slice(1));
    expect(files.reduce((n, f) => n + f.rows, 0)).toBe(direct_rows.length - 1);
    // The chunks are gone and the files expire in 7 days.
    expect([...storage.files.keys()].some((k) => k.includes("chunk-"))).toBe(false);
    const days = (new Date(String(done.expires_at)).getTime() - new Date(String(done.finished_at)).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect(Number(done.rows_done)).toBe(Number(done.rows_total));
    expect((await auditOf(fx.storeId, "products.export_made")).some((e) => (e.details as { job?: string }).job === started.jobId)).toBe(true);
  });

  it("goes on where it was after a run that stopped, and writes no row twice", async () => {
    limits.direct = 3;
    const storage = fakeStorage();
    const first = await jobs.requestProductExport(members.admin, {}, depsWith(storage, { batchRows: 2 }));
    if (!first.ok || first.mode !== "job") throw new Error("job");
    // A run with no time at all writes nothing and leaves the job to the next.
    const none = await jobs.runJob(first.jobId, depsWith(storage, { batchRows: 2, budgetMs: 0 }));
    expect(none).toBe("paused");
    // One batch, then the run is cut off.
    await jobs.runJob(first.jobId, depsWith(storage, { batchRows: 2, budgetMs: 1 }));
    expect(await runToEnd(first.jobId, depsWith(storage, { batchRows: 2 }))).toBe("done");
    const files = (await jobRow(first.jobId)).files as { path: string; rows: number }[];
    const rows = rowsOfCsv(textOf(storage, "exports", files[0].path));
    const handleColumn = rows[0].indexOf("handle");
    const skuColumn = rows[0].indexOf("sku");
    const keys = rows.slice(1).map((r) => `${r[handleColumn]}|${r[skuColumn]}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fails with a plain reason when storage is not there, keeps no half-made file, and is not served from memory", async () => {
    limits.direct = 3;
    const storage = fakeStorage();
    storage.down = true;
    const started = await jobs.requestProductExport(members.admin, {}, depsWith(storage));
    if (!started.ok || started.mode !== "job") throw new Error("job");
    // Down for every run: each is tried again, and after the attempts the job is failed with the reason.
    expect(await runToEnd(started.jobId, depsWith(storage), 10)).toBe("failed");
    const row = await jobRow(started.jobId);
    expect(row.status).toBe("failed");
    expect(String(row.problem)).toContain("Storage was not available");
    expect(JSON.stringify(row.files)).toBe("[]");
    expect(storage.files.size).toBe(0);
  });

  it("is limited to three at a time per store", async () => {
    limits.direct = 3;
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const made: string[] = [];
    // Finish what earlier tests left queued, so the count is clean.
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where store_id = ${fx.storeId}::uuid and kind <> 'product_import' and status in ('queued', 'running')`);
    for (let i = 0; i < 3; i += 1) {
      const r = await jobs.requestProductExport(members.admin, {}, deps);
      if (!r.ok || r.mode !== "job") throw new Error("job");
      made.push(r.jobId);
    }
    const fourth = await jobs.requestProductExport(members.admin, {}, deps);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.code).toBe("too_many");
    // Another store has its own three.
    const elsewhere = await jobs.requestProductExport(otherMembers.admin, {}, deps);
    expect(elsewhere.ok && elsewhere.mode).toBe("job");
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where store_id in (${fx.storeId}::uuid, ${other.storeId}::uuid) and kind <> 'product_import' and status = 'queued'`);
  });

  it("never shows another store's job or file, and a guessed job id is not found", async () => {
    limits.direct = 3;
    const storage = fakeStorage();
    const deps = depsWith(storage, { batchRows: 2 });
    const mine = await jobs.requestProductExport(members.admin, {}, deps);
    if (!mine.ok || mine.mode !== "job") throw new Error("job");
    await runToEnd(mine.jobId, deps);
    expect(await jobs.jobFor(members.admin, mine.jobId)).not.toBeNull();
    expect(await jobs.jobFor(otherMembers.admin, mine.jobId)).toBeNull();
    expect(await jobs.downloadPart(otherMembers.admin, mine.jobId, 0, deps)).toEqual({ ok: false, problem: "This file is not available." });
    expect(await jobs.tickJob(otherMembers.admin, mine.jobId, deps)).toBeNull();
    // Nothing of the other store is in this store's file.
    const files = (await jobRow(mine.jobId)).files as { path: string }[];
    const text = textOf(storage, "exports", files[0].path);
    expect(text).not.toContain(other.slug);
  });

  it("is downloaded by a signed address of 60 seconds that is logged first; there is no standing link", async () => {
    limits.direct = 3;
    const storage = fakeStorage();
    const deps = depsWith(storage, { batchRows: 5 });
    const made = await jobs.requestProductExport(members.admin, {}, deps);
    if (!made.ok || made.mode !== "job") throw new Error("job");
    await runToEnd(made.jobId, deps);
    const got = await jobs.downloadPart(members.admin, made.jobId, 0, deps);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(storage.signed.at(-1)?.seconds).toBe(60);
    expect(got.url).toContain("expires=60");
    const logged = await auditOf(fx.storeId, "products.export_downloaded");
    expect(logged.some((e) => (e.details as { job?: string }).job === made.jobId)).toBe(true);
    // A part that is not there is not found.
    expect((await jobs.downloadPart(members.admin, made.jobId, 99, deps)).ok).toBe(false);
  });
});
