import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { FIX_FOR } from "@/lib/data-job-help";

import type { Membership } from "./auth";
import { addSwedish, fakeStorage, importThrough, membersOf } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { runOwnerTool, OwnerToolError } = await import("./owner-tools");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's two tools for data in and out (D165, `docs/wave-2-data.md` 5.5), run the way the assistant runs them (`runOwnerTool()`) against real
 * jobs: a product import checked from a file with known faults, and an order export. They are read-only (nothing starts, applies or downloads), count the
 * findings in code from the stored items, never quote a cell or give a file path or link, show a member only the kinds of job they may use, and never
 * see another store's job.
 */

let fx: Fixture;
let other: Fixture;
let owner: Membership;
let admin: Membership;
let importId: string;
let exportId: string;
let otherImportId: string;

const holder = (m: Membership) => ({ role: m.role, kind: m.kind, permissions: m.permissions });
const run = (m: Membership, name: string, input: unknown = {}) => runOwnerTool({ account: m.account, store: m.store, invalidate: () => {}, holder: holder(m) }, name, input) as Promise<Answer>;

const HEADER = ["handle", "status", "title", "sku", "price_basis", "price:NO", "price:SE", "stock", "gtin", "image_url"];
const file = (rows: Record<string, Cell>[]) => new TextEncoder().encode(writeCsv([HEADER, ...rows.map((r) => HEADER.map((h) => r[h] ?? null))]));

beforeAll(async () => {
  fx = await makeStore("jobtools");
  other = await makeStore("jobtools2");
  await addSwedish(fx);
  const members = await membersOf(fx);
  owner = { ...members.owner, store: (await getStore(fx.slug))! };
  admin = { ...members.admin, store: owner.store, permissions: ["products:write"] };
  const otherOwner = (await membersOf(other)).owner;

  // Three products with known faults: two with a SKU used twice, one with an unreadable price and a barcode that is not digits.
  const bytes = file([
    { handle: "boot", title: "Boot", sku: "DUP-1", status: "draft", "price:NO": "100,00", price_basis: "incl_vat" },
    { handle: "sock", title: "Sock", sku: "DUP-1", status: "draft", "price:NO": "20,00", price_basis: "incl_vat" },
    { handle: "hat", title: "Hat", sku: "HAT-1", status: "draft", "price:NO": "not a price", gtin: "abc", price_basis: "incl_vat" },
  ]);
  const imported = await importThrough(owner, fakeStorage(), bytes, {}, { apply: false });
  importId = imported.jobId;
  const otherImport = await importThrough(otherOwner, fakeStorage(), file([{ handle: "other-boot", title: "Other", sku: "OTH-1", status: "draft", "price:NO": "100,00", price_basis: "incl_vat" }]), {}, { apply: false });
  otherImportId = otherImport.jobId;
  const [job] = await db().execute<Row>(sql`select commerce.start_export_job(${fx.storeId}::uuid, 'order_export', ${owner.account.id}::uuid, '{}'::jsonb, 3) as id`);
  exportId = String(job.id);
});

afterAll(async () => {
  await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where kind = 'product_import' and store_id in (${fx.storeId}::uuid, ${other.storeId}::uuid) and status in ('uploaded', 'checking', 'checked', 'queued', 'running')`);
  await closeDb();
});

describe("list_data_jobs", () => {
  it("lists the store's jobs newest first with their status in words and a page to open, never a file, a path or a link to one", async () => {
    const out = await run(owner, "list_data_jobs");
    expect(out.jobs.map((j: Answer) => j.id)).toEqual(expect.arrayContaining([importId, exportId]));
    expect(out.jobs.map((j: Answer) => j.id)).not.toContain(otherImportId);
    const imp = out.jobs.find((j: Answer) => j.id === importId);
    expect(imp).toMatchObject({ kind: "Product import", kind_code: "product_import", status: "Checked, ready to import", page: `/admin/${fx.slug}/products/import/${importId}` });
    expect(imp.counts.errors).toBeGreaterThanOrEqual(2);
    const exp = out.jobs.find((j: Answer) => j.id === exportId);
    expect(exp).toMatchObject({ kind: "Order file", page: `/admin/${fx.slug}/orders/export?job=${exportId}` });
    expect(exp.counts).toBeUndefined();
    const text = JSON.stringify(out);
    // No storage path, no signed link, no file name, no person.
    expect(text).not.toMatch(/imports\/|exports\/|token=|signed|products\.csv|example\.com|input_path|inputPath/);
    expect(out.notes.join(" ")).toMatch(/Nothing is started, applied or downloaded/);
    const times = out.jobs.map((j: Answer) => j.started);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("narrows to a kind and limits the list", async () => {
    const only = await run(owner, "list_data_jobs", { kind: "product_import", limit: 1 });
    expect(only.jobs).toHaveLength(1);
    expect(only.jobs[0].kind_code).toBe("product_import");
    expect(only.shown_kinds).toEqual(["product_import"]);
  });

  it("shows a member without the owner role only product jobs, and refuses a kind that is the owner's in words, not an empty list", async () => {
    const out = await run(admin, "list_data_jobs");
    // The stock files are the products' too (wave 3): the same keys as the product files.
    expect(out.shown_kinds).toEqual(["product_import", "product_export", "inventory_import", "inventory_export"]);
    expect(out.jobs.map((j: Answer) => j.kind_code)).not.toContain("order_export");
    await expect(run(admin, "list_data_jobs", { kind: "order_export" })).rejects.toThrow(/order and customer files are the owner's/);
    await expect(run(admin, "list_data_jobs", { kind: "customer_export" })).rejects.toBeInstanceOf(OwnerToolError);
  });

  it("is refused to a role with no access to products", async () => {
    const orders = { ...admin, permissions: ["orders:write"] } as Membership;
    await expect(run(orders, "list_data_jobs")).rejects.toThrow(/no access to products/);
  });

  it("says there is nothing yet for a store with no jobs", async () => {
    const empty = (await membersOf(await makeStore("jobtools3"))).owner;
    const out = await run(empty, "list_data_jobs");
    expect(out.jobs).toEqual([]);
    expect(out.notes.join(" ")).toMatch(/no jobs of these kinds yet/);
  });
});

describe("explain_import_problems", () => {
  it("groups the findings by code, counted from the stored items, with what to do and the products each is about", async () => {
    const out = await run(owner, "explain_import_problems", { job_id: importId });
    expect(out.job).toMatchObject({ id: importId, status_code: "checked" });
    expect(out.products_in_file).toBe(3);
    const codes = out.problems.map((p: Answer) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["sku.duplicate_in_file", "price.unreadable", "gtin.invalid"]));
    const dup = out.problems.find((p: Answer) => p.code === "sku.duplicate_in_file");
    expect(dup).toMatchObject({ severity: "error", what_to_do: FIX_FOR["sku.duplicate_in_file"] });
    expect(dup.findings).toBeGreaterThanOrEqual(1);
    expect(out.findings.errors).toBe(out.problems.filter((p: Answer) => p.severity === "error").reduce((n: number, p: Answer) => n + p.findings, 0));
    // Errors come before warnings and information.
    const rank = { error: 0, warning: 1, info: 2 } as Record<string, number>;
    const order = out.problems.map((p: Answer) => rank[p.severity]);
    expect(order).toEqual([...order].sort());
    expect(out.notes.join(" ")).toMatch(/left as it was/);
    expect(out.page).toBe(`/admin/${fx.slug}/products/import/${importId}`);
  });

  it("names products by their handle and never quotes a cell of the file", async () => {
    const out = await run(owner, "explain_import_problems", { job_id: importId });
    const text = JSON.stringify(out);
    expect(text).not.toContain("not a price");
    expect(text).not.toContain("abc");
    expect(text).not.toMatch(/products\.csv|imports\//);
    expect(out.problems.flatMap((p: Answer) => p.examples)).toEqual(expect.arrayContaining(["hat"]));
  });

  it("takes the store's latest import when no id is given", async () => {
    const out = await run(owner, "explain_import_problems");
    expect(out.job.id).toBe(importId);
  });

  it("refuses another store's job, an export's id and an id that is nothing, the same way", async () => {
    await expect(run(owner, "explain_import_problems", { job_id: otherImportId })).rejects.toThrow(/no product import with that id/);
    await expect(run(owner, "explain_import_problems", { job_id: exportId })).rejects.toThrow(/no product import with that id/);
    await expect(run(owner, "explain_import_problems", { job_id: "aaaaaaaa-0000-4000-8000-000000000001" })).rejects.toThrow(/no product import with that id/);
    await expect(run(owner, "explain_import_problems", { job_id: "not an id" })).rejects.toThrow(/arguments could not be read/);
  });

  it("says so when the store has no import", async () => {
    const empty = (await membersOf(await makeStore("jobtools4"))).owner;
    const out = await run(empty, "explain_import_problems");
    expect(out).toMatchObject({ job: null, problems: [], findings: { errors: 0, warnings: 0, information: 0 }, page: `/admin/${empty.store.slug}/products/import` });
    expect(out.notes.join(" ")).toMatch(/no product import yet/);
  });

  it("changes nothing: the job's row is as it was after both tools ran", async () => {
    const before = await db().execute<Row>(sql`select status, counts, updated_at from commerce.data_jobs where id = ${importId}::uuid`);
    await run(owner, "list_data_jobs");
    await run(owner, "explain_import_problems", { job_id: importId });
    const after = await db().execute<Row>(sql`select status, counts, updated_at from commerce.data_jobs where id = ${importId}::uuid`);
    expect(after).toEqual(before);
    const logged = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${fx.storeId}::uuid and action like 'store.assistant.%'`);
    expect(logged).toEqual([]);
  });
});
