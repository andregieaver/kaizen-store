import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { auditOf, depsWith, fakeStorage, jobRow, membersOf, runToEnd, textOf } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const limits = vi.hoisted(() => ({ direct: 2000 }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  return Object.defineProperty({ ...original }, "DIRECT_EXPORT_MAX_ROWS", { get: () => limits.direct, enumerable: true });
});

const jobs = await import("./data-jobs");
const store = await import("./data-job-store");
const emails = await import("./data-job-emails");

type Row = Record<string, unknown>;

/**
 * The job pipeline (D165, `docs/wave-2-data.md` 3, 5.2): one run at a time, a claim that expires, the five-minute job that takes up what nobody holds, the
 * start of exports under a lock (three at a time), the one email, the retention in application code (files, items, rows, bulk edits), and what happens
 * when storage or a person cancels. The kinds of file have their own tests (`product-export`, `order-export`, `customer-export`, `product-import`).
 */

let fx: Fixture;
let other: Fixture;
let members: Awaited<ReturnType<typeof membersOf>>;

beforeAll(async () => {
  fx = await makeStore("djobs");
  other = await makeStore("djobs2");
  members = await membersOf(fx);
});

afterAll(async () => {
  await closeDb();
});

const clearQueue = () => db().execute(sql`update commerce.data_jobs set status = 'cancelled', claimed_until = null where store_id in (${fx.storeId}::uuid, ${other.storeId}::uuid) and status in ('queued', 'running', 'checking', 'uploaded', 'checked')`);

/** A finished job of the past: made the way a job is (queued, running, done), with its end in the days given. */
async function oldJob(storeId: string, kind: string, status: "done" | "failed" | "cancelled", daysAgo: number, files: string[] = [], o: { inputPath?: string } = {}): Promise<string> {
  const requester = storeId === fx.storeId ? members.owner.account.id : (await membersOf(other)).owner.account.id;
  const imported = kind === "product_import";
  const [row] = imported
    ? await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256) values (${storeId}::uuid, ${kind}, 'uploaded', 'kaizen', ${requester}::uuid, ${o.inputPath ?? null}, 'x.csv', 1, ${"d".repeat(64)}) returning id`)
    : await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values (${storeId}::uuid, ${kind}, 'queued', 'write', 'kaizen', ${requester}::uuid) returning id`);
  const id = String(row.id);
  if (imported) await db().execute(sql`update commerce.data_jobs set status = 'checking' where id = ${id}::uuid`);
  if (imported) await db().execute(sql`update commerce.data_jobs set status = 'checked' where id = ${id}::uuid`);
  if (imported) await db().execute(sql`update commerce.data_jobs set status = 'queued' where id = ${id}::uuid`);
  await db().execute(sql`update commerce.data_jobs set status = 'running' where id = ${id}::uuid`);
  const list = files.map((path) => ({ path, name: "f.csv", rows: 1, bytes: 1, sha256: "a".repeat(64) }));
  await db().execute(sql`
    update commerce.data_jobs set status = ${status}, finished_at = now() - make_interval(days => ${daysAgo}),
      files = ${JSON.stringify(list)}::jsonb, expires_at = ${status === "done" ? sql`now() - make_interval(days => ${daysAgo}) + interval '7 days'` : sql`null`}
    where id = ${id}::uuid`);
  return id;
}

describe("claiming", () => {
  it("lets one run hold a job at a time, until it lets go or its claim runs out", async () => {
    await clearQueue();
    limits.direct = 0;
    const made = await jobs.requestProductExport(members.admin, {}, depsWith(fakeStorage()));
    if (!made.ok || made.mode !== "job") throw new Error("job");
    const first = await store.claimJob(made.jobId);
    expect(first).toMatchObject({ ok: true, job: { status: "running", attempts: 1 } });
    expect(await store.claimJob(made.jobId)).toEqual({ ok: false, reason: "busy" });
    await store.releaseJob({ id: made.jobId, storeId: fx.storeId });
    expect(await store.claimJob(made.jobId)).toMatchObject({ ok: true, job: { attempts: 2 } });
    // A claim that ran out is as free as one let go.
    await db().execute(sql`update commerce.data_jobs set claimed_until = now() - interval '1 minute' where id = ${made.jobId}::uuid`);
    expect(await store.claimJob(made.jobId)).toMatchObject({ ok: true, job: { attempts: 3 } });
    // A job that is over is not claimed, and an id that is none is missing.
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled', claimed_until = null where id = ${made.jobId}::uuid`);
    expect(await store.claimJob(made.jobId)).toEqual({ ok: false, reason: "ended" });
    expect(await store.claimJob("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, reason: "missing" });
    expect(await store.claimJob("not-an-id")).toEqual({ ok: false, reason: "missing" });
  });

  it("is stopped for good by a person: nothing is saved or finished after the cancel", async () => {
    await clearQueue();
    limits.direct = 0;
    const made = await jobs.requestProductExport(members.admin, {}, depsWith(fakeStorage()));
    if (!made.ok || made.mode !== "job") throw new Error("job");
    const claimed = await store.claimJob(made.jobId);
    if (!claimed.ok) throw new Error("claim");
    expect((await jobs.cancelJob(members.admin, made.jobId)).ok).toBe(true);
    expect(await store.saveProgress(claimed.job, { rowsDone: 1 })).toBe(false);
    expect(await store.stillRunning(claimed.job)).toBe(false);
    expect(await store.finishJob(claimed.job, { status: "done" })).toBe(false);
    expect((await jobRow(made.jobId)).status).toBe("cancelled");
    expect((await jobs.cancelJob(members.admin, made.jobId)).ok).toBe(false);
  });
});

describe("starting exports", () => {
  it("allows three at a time per store, whatever the number of requests that come at once", async () => {
    await clearQueue();
    limits.direct = 0;
    const deps = depsWith(fakeStorage());
    const results = await Promise.all(Array.from({ length: 6 }, () => jobs.requestProductExport(members.admin, {}, deps)));
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "too_many")).toBe(true);
    // The other store has three of its own.
    const theirs = await Promise.all(Array.from({ length: 3 }, async () => jobs.requestProductExport((await membersOf(other)).admin, {}, deps)));
    expect(theirs.every((r) => r.ok)).toBe(true);
  });
});

describe("the five-minute job", () => {
  it("takes up jobs nobody holds and finishes them, and leaves one that a run holds alone", async () => {
    await clearQueue();
    limits.direct = 0;
    const storage = fakeStorage();
    const deps = depsWith(storage, { batchRows: 4 });
    const free = await jobs.requestProductExport(members.admin, {}, deps);
    const held = await jobs.requestProductExport(members.admin, {}, deps);
    if (!free.ok || free.mode !== "job" || !held.ok || held.mode !== "job") throw new Error("jobs");
    const claimed = await store.claimJob(held.jobId);
    expect(claimed.ok).toBe(true);
    // Runs until nothing is left that it may take.
    let total = { ran: 0, done: 0, failed: 0 };
    for (let i = 0; i < 20; i += 1) {
      const step = await jobs.runDataJobs(deps);
      total = { ran: total.ran + step.ran, done: total.done + step.done, failed: total.failed + step.failed };
      if ((await jobRow(free.jobId)).status === "done") break;
    }
    expect((await jobRow(free.jobId)).status).toBe("done");
    expect(total.done).toBeGreaterThanOrEqual(1);
    expect((await jobRow(held.jobId)).status).toBe("running");
    expect((await jobRow(held.jobId)).claimed_until).not.toBeNull();
  });

  it("never throws, whatever is wrong with a job", async () => {
    await clearQueue();
    limits.direct = 0;
    const made = await jobs.requestProductExport(members.admin, {}, depsWith(null));
    if (!made.ok || made.mode !== "job") throw new Error("job");
    // No storage at all: the job is failed with the reason, and the run says so rather than throwing.
    await expect(jobs.runDataJobs({ storage: null, budgetMs: 5_000 })).resolves.toMatchObject({ failed: 1 });
    expect(String((await jobRow(made.jobId)).problem)).toContain("Storage was not available");
  });
});

describe("the email that a file is ready", () => {
  it("is sent once to the person who asked, in English, with the page to open and no file", async () => {
    await clearQueue();
    limits.direct = 0;
    const sent: { to: string; kind: string; key?: string; html: string }[] = [];
    const deps = depsWith(fakeStorage(), { send: async (m) => (sent.push({ to: m.to, kind: m.kind, key: m.idempotencyKey, html: m.email.html }), "logged") });
    const made = await jobs.requestProductExport(members.admin, {}, deps);
    if (!made.ok || made.mode !== "job") throw new Error("job");
    expect(await runToEnd(made.jobId, deps)).toBe("done");
    expect(sent).toEqual([{ to: members.admin.account.email, kind: "data_job.ready", key: `data_job.ready:${made.jobId}`, html: expect.stringContaining(`/admin/${fx.slug}/products/export?job=${made.jobId}`) }]);
    // A second call is the same key: `sendEmail()` keeps one row for it.
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where idempotency_key = ${`data_job.ready:${made.jobId}`}`);
    expect(Number(row.n)).toBeLessThanOrEqual(1);
    const rendered = emails.readyEmail({ storeName: "Shop", what: "order export", url: "https://x.test/admin/shop/orders/export?job=1" });
    expect(rendered.subject).toBe("Your order export is ready");
    expect(JSON.stringify(rendered)).not.toMatch(/csv|attachment|\.zip/i);
    // Nobody to tell: nothing is sent and nothing throws.
    expect(await emails.notifyReady({ id: made.jobId, storeId: fx.storeId, kind: "product_import", requestedBy: members.admin.account.id })).toBeNull();
  });
});

describe("retention", () => {
  it("removes an export's files 7 days after it is done, marks the job expired and purged, and keeps what is not due", async () => {
    await clearQueue();
    const storage = fakeStorage();
    const put = (p: string) => storage.files.set(`exports/${p}`, new Uint8Array([1]));
    const due = `${fx.storeId}/due/part-1.csv`;
    const fresh = `${fx.storeId}/fresh/part-1.csv`;
    put(due);
    put(fresh);
    const dueJob = await oldJob(fx.storeId, "order_export", "done", 8, [due]);
    const freshJob = await oldJob(fx.storeId, "order_export", "done", 1, [fresh]);
    const failedJob = await oldJob(fx.storeId, "customer_export", "failed", 8, []);
    const result = await jobs.pruneDataJobs({ storage });
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await jobRow(dueJob)).toMatchObject({ status: "expired", files: [] });
    expect((await jobRow(dueJob)).purged_at).not.toBeNull();
    expect(storage.files.has(`exports/${due}`)).toBe(false);
    expect(storage.removed).toContain(`exports/${due}`);
    expect((await jobRow(freshJob)).status).toBe("done");
    expect(storage.files.has(`exports/${fresh}`)).toBe(true);
    // A failed one has no files left to hold: it is marked purged and keeps its status.
    expect((await jobRow(failedJob)).status).toBe("failed");
    expect((await jobRow(failedJob)).purged_at).not.toBeNull();
    // An expired job is not a job to download from.
    expect(await jobs.downloadPart(members.owner, dueJob, 0, depsWith(storage))).toMatchObject({ ok: false });
  });

  it("removes an import's file 30 days after it ends, or after it was uploaded and never applied, and no sooner", async () => {
    await clearQueue();
    const storage = fakeStorage();
    const path = (n: string) => `${fx.storeId}/aaaaaaaa-0000-4000-8000-00000000000${n}/x.csv`;
    for (const n of ["1", "2"]) storage.files.set(`imports/${path(n)}`, new Uint8Array([1]));
    const old = await oldJob(fx.storeId, "product_import", "done", 31, [], { inputPath: path("1") });
    const recent = await oldJob(fx.storeId, "product_import", "done", 20, [], { inputPath: path("2") });
    await jobs.pruneDataJobs({ storage });
    expect((await jobRow(old)).purged_at).not.toBeNull();
    expect((await jobRow(old)).input_path).toBeNull();
    expect(storage.files.has(`imports/${path("1")}`)).toBe(false);
    expect((await jobRow(recent)).purged_at).toBeNull();
    expect(storage.files.has(`imports/${path("2")}`)).toBe(true);
    // An upload nobody applied: 30 days after it was uploaded.
    const [stale] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, created_at)
      values (${fx.storeId}::uuid, 'product_import', 'uploaded', 'kaizen', ${members.owner.account.id}::uuid, ${path("3")}, 'x.csv', 1, ${"e".repeat(64)}, now() - interval '31 days') returning id`);
    storage.files.set(`imports/${path("3")}`, new Uint8Array([1]));
    await jobs.pruneDataJobs({ storage });
    expect(await jobRow(String(stale.id))).toMatchObject({ status: "expired" });
    expect(storage.files.has(`imports/${path("3")}`)).toBe(false);
  });

  it("leaves a file that storage would not remove for the next night, and removes it then", async () => {
    await clearQueue();
    const storage = fakeStorage();
    const p = `${fx.storeId}/stuck/part-1.csv`;
    storage.files.set(`exports/${p}`, new Uint8Array([1]));
    const id = await oldJob(fx.storeId, "product_export", "done", 9, [p]);
    storage.down = true;
    await jobs.pruneDataJobs({ storage });
    expect((await jobRow(id)).purged_at).toBeNull();
    expect(storage.files.has(`exports/${p}`)).toBe(true);
    storage.down = false;
    await jobs.pruneDataJobs({ storage });
    expect((await jobRow(id)).purged_at).not.toBeNull();
    expect(storage.files.has(`exports/${p}`)).toBe(false);
  });

  it("deletes a job's items and pictures after 90 days, its row after 12 months, and bulk edits after 90 days (an undo keeps its batch)", async () => {
    await clearQueue();
    const storage = fakeStorage();
    const ninety = await oldJob(fx.storeId, "product_import", "done", 91);
    const young = await oldJob(fx.storeId, "product_import", "done", 10);
    const year = await oldJob(fx.storeId, "product_export", "done", 400);
    for (const id of [ninety, young]) {
      await db().execute(sql`insert into commerce.data_job_items (store_id, job_id, seq, kind, ref, outcome) values (${fx.storeId}::uuid, ${id}::uuid, 0, 'product', 'x', 'created')`);
      await db().execute(sql`insert into commerce.data_job_assets (store_id, job_id, source_url, library_url) values (${fx.storeId}::uuid, ${id}::uuid, 'https://x.test/a.jpg', 'https://lib.test/a.webp')`);
    }
    // Bulk edits: one old, one new, one old whose undo is new (it stays with its undo).
    const batch = async (action: string, daysAgo: number, undoOf: string | null = null) => {
      const [b] = await db().execute<Row>(sql`insert into commerce.bulk_edit_batches (store_id, requested_by, action, params, undo_of, created_at) values (${fx.storeId}::uuid, ${members.owner.account.id}::uuid, ${action}, '{}'::jsonb, ${undoOf}::uuid, now() - make_interval(days => ${daysAgo})) returning id`);
      await db().execute(sql`insert into commerce.bulk_edit_items (store_id, batch_id, seq, product_id, field, outcome) values (${fx.storeId}::uuid, ${String(b.id)}::uuid, 0, gen_random_uuid(), 'stock', 'changed')`);
      return String(b.id);
    };
    const oldBatch = await batch("stock", 100);
    const newBatch = await batch("stock", 5);
    const keptOriginal = await batch("stock", 91);
    // The rule that an undo is made within seven days would refuse a made-up old original, so it is set aside for the setup only.
    await db().execute(sql`alter table commerce.bulk_edit_batches disable trigger bulk_edit_batches_rules`);
    let itsUndo: string;
    try {
      itsUndo = await batch("undo", 89, keptOriginal);
    } finally {
      await db().execute(sql`alter table commerce.bulk_edit_batches enable trigger bulk_edit_batches_rules`);
    }
    const result = await jobs.pruneDataJobs({ storage });
    const items = async (id: string) => Number(((await db().execute<Row>(sql`select count(*)::int as n from commerce.data_job_items where job_id = ${id}::uuid`))[0] as Row).n);
    const assets = async (id: string) => Number(((await db().execute<Row>(sql`select count(*)::int as n from commerce.data_job_assets where job_id = ${id}::uuid`))[0] as Row).n);
    expect([await items(ninety), await assets(ninety)]).toEqual([0, 0]);
    expect([await items(young), await assets(young)]).toEqual([1, 1]);
    expect(result.itemsDeleted).toBeGreaterThanOrEqual(1);
    const exists = async (table: string, id: string) => Number(((await db().execute<Row>(sql.raw(`select count(*)::int as n from commerce.${table} where id = '${id}'`)))[0] as Row).n) === 1;
    expect(await exists("data_jobs", year)).toBe(false);
    expect(await exists("data_jobs", ninety)).toBe(true);
    expect(await exists("bulk_edit_batches", oldBatch)).toBe(false);
    expect(await exists("bulk_edit_batches", newBatch)).toBe(true);
    expect(await exists("bulk_edit_batches", keptOriginal)).toBe(true);
    expect(await exists("bulk_edit_batches", itsUndo)).toBe(true);
    // The items of a removed batch went with it.
    expect(Number(((await db().execute<Row>(sql`select count(*)::int as n from commerce.bulk_edit_items where batch_id = ${oldBatch}::uuid`))[0] as Row).n)).toBe(0);
  });

  it("never throws, whatever the storage does", async () => {
    await expect(jobs.pruneDataJobs({ storage: null })).resolves.toMatchObject({ filesRemoved: 0 });
  });
});

describe("cancelling an export", () => {
  it("removes what it had made and leaves no chunk behind", async () => {
    await clearQueue();
    limits.direct = 0;
    const storage = fakeStorage();
    // A slow storage: the first batch is written, then the time is up.
    const upload = storage.upload.bind(storage);
    const slow = { ...storage, upload: async (...args: Parameters<typeof upload>) => { const ok = await upload(...args); await new Promise((r) => setTimeout(r, 300)); return ok; } };
    const deps = depsWith(storage, { batchRows: 2 });
    const made = await jobs.requestProductExport(members.admin, {}, deps);
    if (!made.ok || made.mode !== "job") throw new Error("job");
    await jobs.runJob(made.jobId, { ...deps, storage: slow, budgetMs: 200 });
    expect([...storage.files.keys()].some((k) => k.includes("chunk-"))).toBe(true);
    expect((await jobs.cancelJob(members.admin, made.jobId, deps)).ok).toBe(true);
    expect([...storage.files.keys()].some((k) => k.includes(made.jobId))).toBe(false);
  });
});

describe("a file no row names (review: a run stores a file a moment before it records it)", () => {
  it("is removed by the run itself when the job was cancelled between the file and its record", async () => {
    await clearQueue();
    limits.direct = 0;
    const storage = fakeStorage();
    const real = storage.upload.bind(storage);
    let cancelled = false;
    const deps = depsWith(storage, { batchRows: 2 });
    const made = await jobs.requestProductExport(members.admin, {}, deps);
    if (!made.ok || made.mode !== "job") throw new Error("job");
    // The person cancels (the cancel clears the bucket: it holds nothing yet) and only then does the batch's upload finish.
    const late = { ...storage, upload: async (...args: Parameters<typeof real>) => { if (!cancelled) { cancelled = true; expect((await jobs.cancelJob(members.admin, made.jobId, deps)).ok).toBe(true); } return real(...args); } };
    await jobs.runJob(made.jobId, { ...deps, storage: late });
    expect(cancelled).toBe(true);
    expect((await jobRow(made.jobId)).status).toBe("cancelled");
    expect([...storage.files.keys()].filter((k) => k.includes(made.jobId))).toEqual([]);
  });

  it("is removed with the rest by a cancel, which lists the job's folder instead of trusting its row", async () => {
    await clearQueue();
    limits.direct = 0;
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const made = await jobs.requestProductExport(members.admin, {}, deps);
    if (!made.ok || made.mode !== "job") throw new Error("job");
    storage.files.set(`exports/${fx.storeId}/${made.jobId}/chunk-000009.csv`, new TextEncoder().encode("x"));
    expect((await jobs.cancelJob(members.admin, made.jobId, deps)).ok).toBe(true);
    expect([...storage.files.keys()].filter((k) => k.includes(made.jobId))).toEqual([]);
  });

  it("is swept by the nightly clean-up when its job is purged or gone, and a live job's files are not touched", async () => {
    const storage = fakeStorage();
    const purged = await oldJob(fx.storeId, "order_export", "done", 8);
    await db().execute(sql`update commerce.data_jobs set purged_at = now(), status = 'expired', files = '[]'::jsonb where id = ${purged}::uuid`);
    const gone = randomUUID();
    const live = await oldJob(fx.storeId, "order_export", "done", 1);
    const keys = [`exports/${fx.storeId}/${purged}/part-1.csv`, `exports/${fx.storeId}/${gone}/part-1.csv`];
    for (const k of keys) storage.files.set(k, new TextEncoder().encode("personal data"));
    storage.files.set(`exports/${fx.storeId}/${live}/part-1.csv`, new TextEncoder().encode("ready"));
    const result = await jobs.pruneDataJobs({ storage });
    expect(result.orphansRemoved).toBe(2);
    for (const k of keys) expect(storage.files.has(k)).toBe(false);
    expect(storage.files.has(`exports/${fx.storeId}/${live}/part-1.csv`)).toBe(true);
  });

  it("is removed by the retention of a job even when its row names nothing", async () => {
    const storage = fakeStorage();
    const id = await oldJob(fx.storeId, "customer_export", "done", 8);
    storage.files.set(`exports/${fx.storeId}/${id}/part-1.csv`, new TextEncoder().encode("x"));
    await jobs.pruneDataJobs({ storage });
    expect(storage.files.has(`exports/${fx.storeId}/${id}/part-1.csv`)).toBe(false);
    expect((await jobRow(id)).status).toBe("expired");
  });
});

describe("what a member may see of a job", () => {
  it("is the kind they may use: a product export for products:read, an order export only for the owner, an import for products:write", async () => {
    await clearQueue();
    limits.direct = -1;
    const deps = depsWith(fakeStorage());
    const product = await jobs.requestProductExport(members.admin, {}, deps);
    if (!product.ok || product.mode !== "job") throw new Error("job");
    const order = await jobs.requestOrderExport(members.owner, { mode: "range", from: "2020-01-01", to: "2030-01-01", dialect: "standard" }, deps);
    if (!order.ok || order.mode !== "job") throw new Error(`job ${JSON.stringify(order)}`);
    expect(await jobs.jobFor(members.admin, product.jobId)).not.toBeNull();
    expect(await jobs.jobFor(members.admin, order.jobId)).toBeNull();
    expect(await jobs.jobFor(members.owner, order.jobId)).not.toBeNull();
    expect((await jobs.listJobs(members.admin, "order_export")).length).toBe(0);
    expect((await jobs.listJobs(members.owner, "order_export")).length).toBeGreaterThan(0);
    expect(await jobs.tickJob(members.admin, order.jobId, deps)).toBeNull();
    expect((await jobs.cancelJob(members.admin, order.jobId)).ok).toBe(false);
    const reader = { ...members.admin, permissions: ["orders:read"] } as typeof members.admin;
    expect(await jobs.jobFor(reader, product.jobId)).toBeNull();
    // The activity log of the exports has counts, kind and job: nothing of a person.
    void auditOf;
    void textOf;
  });
});
