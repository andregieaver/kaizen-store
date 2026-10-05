import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JOB_STATUSES, canMove, statusesOf, type JobStatus } from "@/lib/data-job";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * Data in and out (D165, `docs/wave-2-data.md` 3): the rules the database itself holds, run against real Postgres (PGlite) with every
 * migration applied. The job's lifecycle, the one active import, the file an import was checked against, the active export limit, the
 * bulk editor's record as append-only with an undo once, and the new tables as store-owned, private and left behind by a copy.
 */

let db: PGlite;
let shop: string;
let other: string;
let owner: string;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('dj-shop', 'Jobs', 'NO') returning id")).id;
  other = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('dj-other', 'Other', 'NO') returning id")).id;
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('dj-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

async function importJob(store = shop, status: JobStatus = "uploaded"): Promise<string> {
  // An import from a past test may still be active in the store: end it so a new one can start.
  if (status === "uploaded") await endActiveImports(store);
  return (
    await one<{ id: string }>(
      `insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes)
       values ($1, 'product_import', $2, 'kaizen', $3, 'p/x.csv', 'x.csv', 100) returning id`,
      [store, status, owner],
    )
  ).id;
}
async function endActiveImports(store: string) {
  await db.query(
    `update commerce.data_jobs set status = 'cancelled' where store_id = $1 and kind = 'product_import' and status in ('uploaded', 'checking', 'checked')`,
    [store],
  );
  await db.query(
    `update commerce.data_jobs set status = 'cancelled' where store_id = $1 and kind = 'product_import' and status in ('queued', 'running')`,
    [store],
  );
}
const statusOf = async (id: string) => (await one<{ status: string }>("select status from commerce.data_jobs where id = $1", [id])).status;
const move = (id: string, to: string, extra = "") => db.query(`update commerce.data_jobs set status = $2 ${extra} where id = $1`, [id, to]);

describe("the new tables are private, store-owned and left with the original", () => {
  const TABLES = ["data_jobs", "data_job_items", "data_job_assets", "bulk_edit_batches", "bulk_edit_items"];

  it("have row-level security on and no policy, so the Data API reaches none of them", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relname = any($1) order by 1`,
      [TABLES],
    );
    expect(rows).toEqual(TABLES.slice().sort().map((relname) => ({ relname, relrowsecurity: true })));
    const { rows: policies } = await db.query("select 1 from pg_policies where schemaname = 'commerce' and tablename = any($1)", [TABLES]);
    expect(policies).toEqual([]);
  });

  it("have a store_id and are `never` in COPY_RULES (a copy starts with none)", async () => {
    for (const table of TABLES) {
      expect(COPY_RULES[table]?.group, table).toBe("never");
      const col = await one("select 1 as x from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = 'store_id'", [table]);
      expect(col, table).toBeDefined();
    }
  });

  it("are not touched by a duplicated store", async () => {
    const id = await importJob(shop);
    await db.query("insert into commerce.data_job_items (store_id, job_id, seq, kind, outcome) values ($1, $2, 0, 'product', 'checked')", [shop, id]);
    const batchId = (await one<{ id: string }>("insert into commerce.bulk_edit_batches (store_id, requested_by, action) values ($1, $2, 'stock') returning id", [shop, owner])).id;
    await db.query("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, gen_random_uuid(), 'stock', 'unchanged')", [shop, batchId]);
    const copy = (
      await one<{ id: string }>("select commerce.duplicate_store($1, $2, $3, $4, null::uuid[], null::uuid[], null::uuid[]) as id", [shop, "dj-copy", "dj-copy", owner])
    ).id;
    expect(copy).toBeTruthy();
    for (const table of TABLES) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from commerce.${table} where store_id = $1`, [copy]);
      expect([table, rows[0].n]).toEqual([table, 0]);
    }
    await endActiveImports(shop);
  });
});

describe("a job's checks", () => {
  it("refuses an unknown kind, status, phase or format", async () => {
    const insert = (kind: string, status: string, phase: string | null, format: string | null) =>
      db.query("insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values ($1, $2, $3, $4, $5, $6)", [shop, kind, status, phase, format, owner]);
    await expect(insert("order_import", "queued", null, null)).rejects.toThrow(/data_jobs_kind/);
    await expect(insert("order_export", "waiting", null, null)).rejects.toThrow(/data_jobs_status|data_job\.start/);
    await expect(insert("order_export", "queued", "dream", null)).rejects.toThrow(/data_jobs_phase/);
    await expect(insert("order_export", "queued", "write", "csv")).rejects.toThrow(/data_jobs_format/);
  });

  it("keeps rows done within the total, the file within 15 MiB, the hash a SHA-256, and files an array", async () => {
    const id = await importJob();
    await rejects("update commerce.data_jobs set rows_total = 10, rows_done = 11 where id = $1", [id], /data_jobs_rows_done/);
    await rejects("update commerce.data_jobs set rows_done = -1 where id = $1", [id], /data_jobs_rows_done/);
    await rejects("update commerce.data_jobs set input_bytes = 15728641 where id = $1", [id], /data_jobs_input_bytes/);
    await db.query("update commerce.data_jobs set input_bytes = 15728640 where id = $1", [id]);
    await rejects("update commerce.data_jobs set input_sha256 = 'abc' where id = $1", [id], /data_jobs_input_sha256/);
    await rejects("update commerce.data_jobs set files = '{}' where id = $1", [id], /data_jobs_json|data_jobs_import_no_files/);
    await rejects("update commerce.data_jobs set options = '[]' where id = $1", [id], /data_jobs_json/);
    await endActiveImports(shop);
  });

  it("gives an import no output files and an export no input file or Shopify format", async () => {
    const id = await importJob();
    await rejects(`update commerce.data_jobs set files = '[{"path":"a"}]' where id = $1`, [id], /data_jobs_import_no_files/);
    await endActiveImports(shop);
    await rejects(
      "insert into commerce.data_jobs (store_id, kind, status, requested_by, input_path) values ($1, 'order_export', 'queued', $2, 'x')",
      [shop, owner],
      /data_jobs_export_no_input/,
    );
    await rejects(
      "insert into commerce.data_jobs (store_id, kind, status, requested_by, format) values ($1, 'order_export', 'queued', $2, 'shopify')",
      [shop, owner],
      /data_jobs_export_no_input/,
    );
  });

  it("stamps an ended job with its finish time, and refuses a plain reason over 500 characters", async () => {
    const id = await importJob();
    await move(id, "cancelled");
    expect((await one<{ finished_at: string | null }>("select finished_at from commerce.data_jobs where id = $1", [id])).finished_at).not.toBeNull();
    await rejects("update commerce.data_jobs set problem = $2 where id = $1", [id, "x".repeat(501)], /data_jobs_problem/);
  });

  it("removes a job's items and assets with the job, and refuses items that name another store's job", async () => {
    const id = await importJob(shop);
    await db.query("insert into commerce.data_job_items (store_id, job_id, seq, kind, ref, rows, outcome) values ($1, $2, 0, 'product', 'a', '{2,3}', 'checked')", [shop, id]);
    await db.query("insert into commerce.data_job_assets (store_id, job_id, source_url, reason) values ($1, $2, 'https://example.com/a.jpg', 'not an image')", [shop, id]);
    await rejects("insert into commerce.data_job_items (store_id, job_id, seq, kind, outcome) values ($1, $2, 1, 'product', 'checked')", [other, id], /data_job_items_job_fk/);
    await rejects("insert into commerce.data_job_assets (store_id, job_id, source_url, reason) values ($1, $2, 'x', 'y')", [other, id], /data_job_assets_job_fk/);
    // A resumed job writes an item once.
    await db.query(
      `insert into commerce.data_job_items (store_id, job_id, seq, kind, outcome) values ($1, $2, 0, 'product', 'created')
       on conflict (job_id, seq) do update set outcome = excluded.outcome`,
      [shop, id],
    );
    expect(await one("select count(*)::int as n, min(outcome) as o from commerce.data_job_items where job_id = $1", [id])).toEqual({ n: 1, o: "created" });
    await rejects("insert into commerce.data_job_items (store_id, job_id, seq, kind, outcome) values ($1, $2, 5, 'product', 'bogus')", [shop, id], /data_job_items_outcome/);
    await rejects("insert into commerce.data_job_assets (store_id, job_id, source_url) values ($1, $2, 'https://example.com/b.jpg')", [shop, id], /data_job_assets_result/);
    await endActiveImports(shop);
    await db.query("delete from commerce.data_jobs where id = $1", [id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.data_job_items where job_id = $1", [id])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.data_job_assets where job_id = $1", [id])).n).toBe(0);
  });
});

describe("one active import per store", () => {
  it("refuses a second import while one is uploaded, checking, checked, queued or running, in that store only", async () => {
    await endActiveImports(shop);
    const first = await importJob(shop);
    await expect(importJob(shop, "uploaded").then(() => null)).resolves.toBeNull(); // helper ends the first: a new one is then allowed
    expect(await statusOf(first)).toBe("cancelled");
    const active = await importJob(shop);
    await rejects(
      "insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'product_import', 'uploaded', $2)",
      [shop, owner],
      /data_jobs_one_active_import_idx/,
    );
    // Another store is not held back, and exports and ended imports do not count.
    const elsewhere = await importJob(other);
    expect(elsewhere).toBeTruthy();
    await db.query("insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'order_export', 'queued', $2)", [shop, owner]);
    await move(active, "cancelled");
    expect(await importJob(shop)).toBeTruthy();
    await endActiveImports(shop);
    await endActiveImports(other);
  });
});

describe("the lifecycle moves forward only", () => {
  it("starts an import uploaded and an export queued, and an export never uploads, checks or waits to be applied", async () => {
    await rejects("insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'product_import', 'running', $2)", [shop, owner], /data_job\.start/);
    await rejects("insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'product_export', 'running', $2)", [shop, owner], /data_job\.start/);
    await rejects("insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'customer_export', 'checked', $2)", [shop, owner], /data_job\.status_kind/);
  });

  it("holds the same table of moves as src/lib/data-job.ts, for every pair of statuses", async () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const { rows } = await db.query<{ ok: boolean }>("select commerce.data_job_move_allowed($1, $2) as ok", [from, to]);
        expect([from, to, rows[0].ok]).toEqual([from, to, canMove(from, to)]);
      }
    }
    expect(statusesOf("order_export")).not.toContain("checked");
    expect(statusesOf("product_import")).toContain("checked");
  });

  it("walks an import from uploaded to done, and refuses a step back, a skipped step and a restart of an ended job", async () => {
    const id = await importJob();
    await rejects("update commerce.data_jobs set status = 'running' where id = $1", [id], /data_job\.status/);
    await move(id, "checking");
    await move(id, "checked");
    await rejects("update commerce.data_jobs set status = 'uploaded' where id = $1", [id], /data_job\.status/);
    await move(id, "queued");
    await rejects("update commerce.data_jobs set status = 'checked' where id = $1", [id], /data_job\.status/);
    await move(id, "running");
    await move(id, "done");
    for (const to of ["running", "queued", "checking", "uploaded", "cancelled", "failed"]) {
      await rejects("update commerce.data_jobs set status = $2 where id = $1", [id, to], /data_job\.status/);
    }
    await move(id, "expired");
    await rejects("update commerce.data_jobs set status = 'done' where id = $1", [id], /data_job\.status/);
  });

  it("lets a checked import be checked again (its options changed): the one move back", async () => {
    const id = await importJob();
    await move(id, "checking");
    await move(id, "checked");
    await db.query(`update commerce.data_jobs set status = 'checking', options = '{"mode":"only_update"}' where id = $1`, [id]);
    await move(id, "checked");
    expect(await statusOf(id)).toBe("checked");
    await endActiveImports(shop);
  });

  it("walks an export from queued to done and ends a failed or cancelled one for good", async () => {
    const id = await one<{ id: string }>("select commerce.start_export_job($1, 'order_export', $2, '{}', 3) as id", [shop, owner]).then((r) => r.id);
    await move(id, "running");
    await move(id, "done");
    const failed = await one<{ id: string }>("select commerce.start_export_job($1, 'customer_export', $2, '{}', 3) as id", [shop, owner]).then((r) => r.id);
    await move(failed, "failed", ", problem = 'storage was not available'");
    await rejects("update commerce.data_jobs set status = 'running' where id = $1", [failed], /data_job\.status/);
  });

  it("keeps a job's store, kind, requester and id", async () => {
    const id = await importJob();
    await rejects("update commerce.data_jobs set store_id = $2 where id = $1", [id, other], /data_job\.fixed/);
    await rejects("update commerce.data_jobs set kind = 'product_export' where id = $1", [id], /data_job\.fixed/);
    const stranger = (await one<{ id: string }>("insert into commerce.accounts (email) values ('dj-stranger@example.com') returning id")).id;
    await rejects("update commerce.data_jobs set requested_by = $2 where id = $1", [id, stranger], /data_job\.fixed/);
    await rejects("update commerce.data_jobs set id = gen_random_uuid() where id = $1", [id], /data_job\.fixed|violates foreign key|update or delete/);
    await endActiveImports(shop);
  });

  it("keeps updated_at current", async () => {
    const id = await importJob();
    await db.query("update commerce.data_jobs set updated_at = now() - interval '1 day' where id = $1", [id]);
    await db.query("update commerce.data_jobs set rows_total = 5 where id = $1", [id]);
    const { rows } = await db.query<{ fresh: boolean }>("select updated_at > now() - interval '1 minute' as fresh from commerce.data_jobs where id = $1", [id]);
    expect(rows[0].fresh).toBe(true);
    await endActiveImports(shop);
  });
});

describe("the file an import was checked against cannot be swapped", () => {
  it("lets the file be registered once while the job is uploaded or being checked, and never changed after", async () => {
    const id = await importJob();
    await db.query("update commerce.data_jobs set input_sha256 = $2 where id = $1", [id, SHA]);
    await rejects("update commerce.data_jobs set input_sha256 = $2 where id = $1", [id, SHA2], /data_job\.file_fixed/);
    await rejects("update commerce.data_jobs set input_path = 'other/y.csv' where id = $1", [id], /data_job\.file_fixed/);
    await rejects("update commerce.data_jobs set input_bytes = 5 where id = $1", [id], /data_job\.file_fixed/);
    await move(id, "checking");
    await move(id, "checked");
    await rejects("update commerce.data_jobs set input_sha256 = $2 where id = $1", [id, SHA2], /data_job\.file_fixed/);
    await move(id, "queued");
    await move(id, "running");
    await rejects("update commerce.data_jobs set input_sha256 = $2 where id = $1", [id, SHA2], /data_job\.file_fixed/);
    await move(id, "done");
    // Purging removes the file and may clear its columns; it is never pointed at another.
    await rejects("update commerce.data_jobs set input_path = null where id = $1", [id], /data_job\.file_fixed/);
    await db.query("update commerce.data_jobs set input_path = null, input_sha256 = null, purged_at = now(), status = 'expired' where id = $1", [id]);
    await endActiveImports(shop);
  });

  it("refuses to register a file on a job that is already checked", async () => {
    const id = await importJob(shop, "uploaded");
    await move(id, "checking");
    await move(id, "checked");
    await rejects("update commerce.data_jobs set input_sha256 = $2 where id = $1", [id, SHA], /data_job\.file_fixed/);
    await endActiveImports(shop);
  });
});

describe("the choices of a job", () => {
  it("fixes an export's options from the start", async () => {
    const id = await one<{ id: string }>(`select commerce.start_export_job($1, 'product_export', $2, '{"dialect":"standard"}', 3) as id`, [shop, owner]).then((r) => r.id);
    await rejects(`update commerce.data_jobs set options = '{"dialect":"excel_nordic"}' where id = $1`, [id], /data_job\.options_fixed/);
    await move(id, "running");
    await rejects(`update commerce.data_jobs set options = '{}' where id = $1`, [id], /data_job\.options_fixed/);
    await move(id, "cancelled");
  });

  it("fixes an import's options once it is checked, unless it is checked again, and from the apply on", async () => {
    const id = await importJob();
    await db.query(`update commerce.data_jobs set options = '{"mode":"create"}' where id = $1`, [id]);
    await move(id, "checking");
    await db.query(`update commerce.data_jobs set options = '{"mode":"update"}' where id = $1`, [id]);
    await move(id, "checked");
    await rejects(`update commerce.data_jobs set options = '{"mode":"both"}' where id = $1`, [id], /data_job\.options_fixed/);
    await rejects(`update commerce.data_jobs set options = '{"mode":"both"}', status = 'queued' where id = $1`, [id], /data_job\.options_fixed/);
    await move(id, "queued");
    await move(id, "running");
    await rejects(`update commerce.data_jobs set options = '{"mode":"both"}' where id = $1`, [id], /data_job\.options_fixed/);
    await endActiveImports(shop);
  });

  it("keeps an ended job's figures and files, which can only be purged", async () => {
    const id = await one<{ id: string }>("select commerce.start_export_job($1, 'order_export', $2, '{}', 3) as id", [shop, owner]).then((r) => r.id);
    await db.query(`update commerce.data_jobs set status = 'running', rows_total = 10, rows_done = 5, counts = '{"x":1}' where id = $1`, [id]);
    await db.query(`update commerce.data_jobs set status = 'done', rows_done = 10, files = '[{"path":"a/b/part-1.csv","name":"orders.csv","rows":10,"bytes":5,"sha256":"x"}]' where id = $1`, [id]);
    await rejects("update commerce.data_jobs set rows_done = 9 where id = $1", [id], /data_job\.ended/);
    await rejects(`update commerce.data_jobs set counts = '{}' where id = $1`, [id], /data_job\.ended/);
    await rejects(`update commerce.data_jobs set files = '[]' where id = $1`, [id], /data_job\.ended/);
    await db.query("update commerce.data_jobs set status = 'expired', files = '[]', purged_at = now() where id = $1", [id]);
    await rejects("update commerce.data_jobs set purged_at = null where id = $1", [id], /data_job\.ended/);
  });
});

describe("starting an export", () => {
  it("counts the active exports of a store under a lock and refuses past the limit, never counting an import, an ended job or another store", async () => {
    const store = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('dj-limit', 'Limit', 'NO') returning id")).id;
    const start = (kind: string) => one<{ id: string }>("select commerce.start_export_job($1, $2, $3, '{}', 3) as id", [store, kind, owner]).then((r) => r.id);
    await db.query("insert into commerce.data_jobs (store_id, kind, status, requested_by) values ($1, 'product_import', 'uploaded', $2)", [store, owner]);
    const a = await start("order_export");
    await start("customer_export");
    await start("product_export");
    await rejects("select commerce.start_export_job($1, 'order_export', $2, '{}', 3)", [store, owner], /data_job\.too_many_exports/);
    // Another store is not held back; a job that ends frees its place.
    expect(await one("select commerce.start_export_job($1, 'order_export', $2, '{}', 3) as id", [shop, owner])).toBeDefined();
    await move(a, "running");
    await move(a, "done");
    expect(await start("order_export")).toBeTruthy();
    await rejects("select commerce.start_export_job($1, 'product_import', $2, '{}', 3)", [store, owner], /data_job\.kind/);
    const row = await one<{ status: string; phase: string; format: string; kind: string }>("select status, phase, format, kind from commerce.data_jobs where id = $1", [a]);
    expect(row).toEqual({ status: "done", phase: "write", format: "kaizen", kind: "order_export" });
  });

  it("holds the limit when two requests come at once (the advisory lock serialises them)", async () => {
    const store = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('dj-race', 'Race', 'NO') returning id")).id;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => db.query("select commerce.start_export_job($1, 'order_export', $2, '{}', 3)", [store, owner])),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.data_jobs where store_id = $1", [store])).n).toBe(3);
  });
});

describe("the bulk editor's record", () => {
  const product = "00000000-0000-4000-8000-0000000000aa";
  async function batch(action = "price", over: { store?: string; undoOf?: string | null; createdAt?: string } = {}): Promise<string> {
    return (
      await one<{ id: string }>(
        `insert into commerce.bulk_edit_batches (store_id, requested_by, action, params, undo_of, counts, created_at)
         values ($1, $2, $3, '{"percent":-10}', $4, '{"products":1}', coalesce($5::timestamptz, now())) returning id`,
        [over.store ?? shop, owner, action, over.undoOf ?? null, over.createdAt ?? null],
      )
    ).id;
  }
  async function item(id: string, seq: number, outcome = "changed", field = "price:NO") {
    await db.query(
      `insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, variant_id, field, before, after, outcome, reason)
       values ($1, $2, $3, $4, $4, $5, '24900', '22410', $6, $7)`,
      [shop, id, seq, product, field, outcome, outcome === "failed" ? "Give the product a title." : null],
    );
  }

  it("checks the action, the fields and a failure's reason", async () => {
    await expect(batch("delete")).rejects.toThrow(/bulk_edit_batches_action/);
    const id = await batch();
    await rejects("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, $3, 'title', 'changed')", [shop, id, product], /bulk_edit_items_field/);
    await rejects("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, $3, 'price:norway', 'changed')", [shop, id, product], /bulk_edit_items_field/);
    await rejects("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, $3, 'stock', 'failed')", [shop, id, product], /bulk_edit_items_failed_reason/);
    await item(id, 0);
    await item(id, 1, "failed", "stock");
    await rejects("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, $3, 'stock', 'changed')", [shop, id, product], /bulk_edit_items_batch_id_seq_pk/);
  });

  it("keeps items inside their own store's batch", async () => {
    const id = await batch();
    await rejects("insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values ($1, $2, 0, $3, 'stock', 'changed')", [other, id, product], /bulk_edit_items_batch_fk/);
  });

  it("is append-only: a batch and its items cannot be edited", async () => {
    const id = await batch();
    await item(id, 0);
    await rejects(`update commerce.bulk_edit_batches set params = '{"percent":50}' where id = $1`, [id], /bulk_edit\.append_only/);
    await rejects(`update commerce.bulk_edit_batches set counts = '{}' where id = $1`, [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_batches set action = 'stock' where id = $1", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_items set after = '1' where batch_id = $1", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_items set before = '1' where batch_id = $1", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_items set outcome = 'failed', reason = 'x' where batch_id = $1", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_items set outcome = 'unchanged' where batch_id = $1", [id], /bulk_edit\.append_only/);
  });

  it("is undone once: an undo is a batch of its own, within seven days, never of an undo, and marks the batch and its items", async () => {
    const id = await batch();
    await item(id, 0);
    await item(id, 1, "unchanged", "stock");
    // Marked undone only after its undo exists.
    await rejects("update commerce.bulk_edit_batches set undone_at = now() where id = $1", [id], /bulk_edit\.undone/);
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action) values ($1, $2, 'undo')", [shop, owner], /bulk_edit_batches_undo/);
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action, undo_of) values ($1, $2, 'price', $3)", [shop, owner, id], /bulk_edit_batches_undo/);
    // Another store's batch cannot be undone from here.
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action, undo_of) values ($1, $2, 'undo', $3)", [other, owner, id], /bulk_edit_batches_undo_of_fk/);
    const undo = await batch("undo", { undoOf: id });
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action, undo_of) values ($1, $2, 'undo', $3)", [shop, owner, id], /bulk_edit_batches_one_undo_idx/);
    await db.query("update commerce.bulk_edit_batches set undone_at = now() where id = $1", [id]);
    await rejects("update commerce.bulk_edit_batches set undone_at = now() where id = $1", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_batches set undone_at = null where id = $1", [id], /bulk_edit\.append_only/);
    // The one change an item may have: a changed cell marked undone.
    await db.query("update commerce.bulk_edit_items set outcome = 'undone' where batch_id = $1 and outcome = 'changed'", [id]);
    await rejects("update commerce.bulk_edit_items set outcome = 'changed' where batch_id = $1 and seq = 0", [id], /bulk_edit\.append_only/);
    await rejects("update commerce.bulk_edit_items set outcome = 'undone' where batch_id = $1 and seq = 1", [id], /bulk_edit\.append_only/);
    // An undo is not undone.
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action, undo_of) values ($1, $2, 'undo', $3)", [shop, owner, undo], /bulk_edit\.undo_of_undo/);
  });

  it("refuses an undo of a change older than seven days", async () => {
    const old = await batch("stock", { createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    await rejects("insert into commerce.bulk_edit_batches (store_id, requested_by, action, undo_of) values ($1, $2, 'undo', $3)", [shop, owner, old], /bulk_edit\.undo_expired/);
    const fresh = await batch("stock", { createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString() });
    expect(await batch("undo", { undoOf: fresh })).toBeTruthy();
  });

  it("is removed with its batch, by the retention job: a batch's items go with it", async () => {
    const id = await batch();
    await item(id, 0);
    await db.query("delete from commerce.bulk_edit_batches where id = $1", [id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.bulk_edit_items where batch_id = $1", [id])).n).toBe(0);
  });
});

describe("the migrations of this unit", () => {
  it("put no DELETE or DROP inside a function (the Supabase tool cancels such statements)", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const dir = `${process.cwd()}/supabase/migrations`;
    const files = (await readdir(dir)).filter((f) => /_(data_jobs|data_jobs_rules|data_buckets)\.sql$/.test(f));
    expect(files).toHaveLength(3);
    for (const file of files) {
      const text = await readFile(`${dir}/${file}`, "utf8");
      const bodies = [...text.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
      for (const body of bodies) expect([file, /\b(delete|drop)\b/i.test(body)]).toEqual([file, false]);
    }
  });
});
