import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { INVENTORY_FILE_ROWS_MAX } from "@/lib/inventory";

import { auditOf, csvBytes, depsWith, fakeStorage, itemsOf, jobRow, rowsOfCsv, runToEnd, textOf, type FakeStorage } from "./data-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

/** The size above which an export is a job: the real figure is 2,000 rows, lowered here so a few variants make a job. */
const limits = vi.hoisted(() => ({ direct: 2000 }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  return Object.defineProperty({ ...original }, "DIRECT_EXPORT_MAX_ROWS", { get: () => limits.direct, enumerable: true });
});

const jobs = await import("./data-jobs");
const support = await import("./inventory-test-support");
const { addLocation, clearLevels, ledgerIsWhole, levelsOf, mainLocation, movementsOf, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;
let bergen: string;
const OSLO = "Lager Oslo";

beforeAll(async () => {
  store = await newStore("stockfile");
  other = await newStore("stockfile-other");
  oslo = await mainLocation(store.storeId);
  bergen = await addLocation(store.storeId, "Bergen", 5);
  for (const sku of ["DEMO-TOTE", "DEMO-MUG-WHITE", "DEMO-MUG-BLACK"]) await clearLevels(store.storeId, sku);
  await db().execute(sql`update commerce.product_variants set delivery = 'digital' where store_id = ${store.storeId}::uuid and sku = 'DEMO-LAMP'`);
});

afterAll(async () => {
  await closeDb();
});

afterEach(async () => {
  limits.direct = 2000;
  await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where kind = 'inventory_import' and store_id in (${store.storeId}::uuid, ${other.storeId}::uuid) and status in ('uploaded', 'checking', 'checked', 'queued', 'running')`);
});

const HEADER = ["sku", "location", "on_hand", "on_hand_was", "reason", "note", "stock_policy", "backorder_days", "low_stock_threshold"];
const file = (rows: Cell[][], header: string[] = HEADER): Uint8Array => csvBytes([header, ...rows]);
const row = (sku: string, location: string, onHand: number | string, extra: Partial<Record<(typeof HEADER)[number], Cell>> = {}): Cell[] =>
  HEADER.map((h) => (h === "sku" ? sku : h === "location" ? location : h === "on_hand" ? onHand : (extra[h] ?? "")));

const upload = async (member: typeof store.member, storage: FakeStorage, bytes: Uint8Array, name = "stock.csv", deps = depsWith(storage)): Promise<string> => {
  const started = await jobs.startInventoryUpload(member, name, deps);
  if (!started.ok) throw new Error(started.problem);
  storage.files.set(`imports/${started.path}`, bytes);
  const registered = await jobs.registerInventoryImport(member, { path: started.path, name }, deps);
  if (!registered.ok) throw new Error(registered.problems.join(" "));
  return registered.jobId;
};

/** Register and check a file; the dry run's counts and the job. */
async function check(bytes: Uint8Array, storage = fakeStorage(), deps = depsWith(storage), member = store.member) {
  const jobId = await upload(member, storage, bytes, "stock.csv", deps);
  const started = await jobs.startInventoryCheck(member, jobId, deps);
  if (!started.ok) throw new Error(started.problem);
  const outcome = await runToEnd(jobId, deps);
  if (outcome !== "checked") throw new Error(`the check ended ${outcome}: ${String((await jobRow(jobId)).problem)}`);
  const checked = await jobRow(jobId);
  return { jobId, storage, deps, dry: jobs.inventoryDryCountsOf({ counts: checked.counts as Record<string, unknown> }), checked };
}
async function apply(run: Awaited<ReturnType<typeof check>>, member = store.member) {
  const started = await jobs.startInventoryApply(member, run.jobId, run.deps);
  if (!started.ok) throw new Error(started.problem);
  const end = await runToEnd(run.jobId, run.deps);
  if (end !== "done") throw new Error(`the apply ended ${end}: ${String((await jobRow(run.jobId)).problem)}`);
  return jobRow(run.jobId);
}
const codes = async (jobId: string) => (await itemsOf(jobId)).flatMap((i) => i.messages.map((m) => `${i.ref ?? "-"}:${m.code}`));

describe("the stock file: an export, and the same file imported back", () => {
  it("lists every shipped variant at every active location with what each holds, and imports back unchanged", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 7);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 3);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 4);
    const made = await jobs.requestInventoryExport(store.member, { dialect: "standard" });
    if (!made.ok || made.mode !== "file") throw new Error(JSON.stringify(made));
    const [header, ...rows] = rowsOfCsv(made.csv);
    expect(header).toEqual(["sku", "product", "options", "location", "on_hand", "committed", "available", "stock_policy", "backorder_days", "low_stock_threshold"]);
    const tote = rows.filter((r) => r[0] === "DEMO-TOTE");
    expect(tote.map((r) => [r[3], r[4], r[5], r[6]])).toEqual([[OSLO, "7", "0", "7"], ["Bergen", "3", "0", "3"]]);
    // A variant with no level at a location is listed there with 0; a download has no stock and is not listed.
    expect(rows.filter((r) => r[0] === "DEMO-MUG-WHITE").map((r) => [r[3], r[4]])).toEqual([[OSLO, "4"], ["Bergen", "0"]]);
    expect(rows.some((r) => r[0] === "DEMO-LAMP")).toBe(false);
    expect(rows.find((r) => r[0] === "DEMO-THERMOS")).toMatchObject({ 7: "continue", 8: "7" });
    expect((await auditOf(store.storeId, "products.stock_export_made")).at(-1)?.details).toMatchObject({ direct: true });
    // The same file, imported: nothing to change.
    const run = await check(csvBytes(rowsOfCsv(made.csv)));
    expect(run.dry).toMatchObject({ toUpdate: 0, conflicts: 0, withProblems: 0 });
    expect(run.dry.unchanged).toBe(rows.length);
  });

  it("escapes a title that starts like a formula, in the one writer", async () => {
    await db().execute(sql`
      update commerce.product_translations set title = '=HYPERLINK("x")' where product_id = (select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE')
    `);
    const made = await jobs.requestInventoryExport(store.member, { dialect: "standard" });
    if (!made.ok || made.mode !== "file") throw new Error(JSON.stringify(made));
    expect(made.csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(made.csv).toContain("'=HYPERLINK");
  });

  it("is a job when it is large, delivered by a download the member presses, and only to those who read products", async () => {
    limits.direct = 1;
    const storage = fakeStorage();
    const deps = depsWith(storage, { batchRows: 2 });
    const made = await jobs.requestInventoryExport(store.member, { dialect: "standard" }, deps);
    if (!made.ok || made.mode !== "job") throw new Error(JSON.stringify(made));
    expect(await runToEnd(made.jobId, deps)).toBe("done");
    const job = await jobRow(made.jobId);
    expect(job.kind).toBe("inventory_export");
    const files = job.files as { path: string; rows: number }[];
    expect(files.length).toBeGreaterThanOrEqual(1);
    const text = textOf(storage, "exports", files[0].path);
    expect(rowsOfCsv(text)[0][0]).toBe("sku");
    expect(rowsOfCsv(text).length - 1).toBe(files.reduce((n, f) => n + f.rows, 0));
    const link = await jobs.downloadPart(store.member, made.jobId, 0, deps);
    expect(link).toMatchObject({ ok: true });
    expect((await auditOf(store.storeId, "products.stock_export_downloaded")).length).toBe(1);
    // Another store's member finds no such job; a member who cannot read products is refused.
    expect(await jobs.downloadPart(other.member, made.jobId, 0, deps)).toEqual({ ok: false, problem: "This file is not available." });
    const nobody = { ...store.member, role: "admin" as const, permissions: ["orders:read"] };
    expect(await jobs.requestInventoryExport(nobody, { dialect: "standard" })).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("the dry run", () => {
  it("lists every problem class, changes nothing and quotes no cell", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 7);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 3);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 4);
    const before = { tote: await levelsOf(store.storeId, "DEMO-TOTE"), mug: await levelsOf(store.storeId, "DEMO-MUG-WHITE") };
    const [{ n: movementsBefore }] = (await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_movements where store_id = ${store.storeId}::uuid`)) as [{ n: number }];
    const bytes = file([
      row("DEMO-TOTE", OSLO, 9, { reason: "received", note: "Delivery 12", on_hand_was: 7 }),
      row("NO-SUCH-SKU", OSLO, 1),
      row("DEMO-LAMP", OSLO, 1),
      row("DEMO-TOTE", "Atlantis", 1),
      row("DEMO-TOTE", OSLO, "lots"),
      row("DEMO-TOTE", OSLO, -1),
      row("DEMO-TOTE", "Bergen", 5, { reason: "stolen" }),
      row("DEMO-MUG-WHITE", OSLO, 5, { stock_policy: "continue" }),
      row("DEMO-MUG-WHITE", OSLO, 5, { stock_policy: "continue", backorder_days: 120 }),
      row("DEMO-MUG-WHITE", OSLO, 5, { low_stock_threshold: 2_000_000 }),
      row("DEMO-MUG-WHITE", OSLO, 5, { stock_policy: "maybe" }),
      row("DEMO-TOTE", OSLO, 12),
      row("DEMO-MUG-WHITE", "Bergen", 2, { on_hand_was: 99 }),
      row("DEMO-MUG-WHITE", OSLO, 5, { note: "x".repeat(201) }),
      row("", OSLO, 5),
    ]);
    const run = await check(bytes);
    expect(run.dry).toMatchObject({ toUpdate: 1, conflicts: 1 });
    expect(run.dry.withProblems).toBeGreaterThanOrEqual(11);
    const found = await codes(run.jobId);
    for (const code of [
      "stockfile.sku_unknown", "stockfile.sku_not_goods", "stockfile.location_unknown", "stockfile.on_hand_invalid", "stockfile.reason_invalid", "stockfile.days_required",
      "stockfile.days_invalid", "stockfile.threshold_invalid", "stockfile.policy_invalid", "stockfile.duplicate", "stockfile.conflict", "stockfile.note_too_long", "stockfile.sku_missing",
    ]) {
      expect(found.some((c) => c.endsWith(code)), code).toBe(true);
    }
    // No finding quotes a cell: a note, a policy word or a typed figure is never in its sentence.
    const sentences = (await itemsOf(run.jobId)).flatMap((i) => i.messages.map((m) => m.text)).join("\\n");
    for (const quoted of ["Delivery 12", "maybe", "lots", "Atlantis", "stolen"]) expect(sentences).not.toContain(quoted);
    // The dry run wrote nothing: the same levels, no new movement.
    expect({ tote: await levelsOf(store.storeId, "DEMO-TOTE"), mug: await levelsOf(store.storeId, "DEMO-MUG-WHITE") }).toEqual(before);
    const [{ n: movementsAfter }] = (await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_movements where store_id = ${store.storeId}::uuid`)) as [{ n: number }];
    expect(movementsAfter).toBe(movementsBefore);
    // The conflicting row says the figures, and the problems are a file.
    expect((await itemsOf(run.jobId)).find((i) => i.messages.some((m) => m.code === "stockfile.conflict"))?.messages[0].text).toContain("is 0 now, not 99");
    const csv = await jobs.inventoryProblemsCsv(store.member, run.jobId);
    expect(csv).toMatchObject({ ok: true });
    expect(csv.ok && rowsOfCsv(csv.csv)[0]).toEqual(["row", "sku", "severity", "code", "column", "message"]);
    // Nothing is applied from a file that has no row to apply (all problems) and nothing is created: no variant, location or product.
    const [counts] = await db().execute<Row>(sql`select (select count(*)::int from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'NO-SUCH-SKU') as v, (select count(*)::int from commerce.inventory_locations where store_id = ${store.storeId}::uuid and name = 'Atlantis') as l`);
    expect(counts).toMatchObject({ v: 0, l: 0 });
  });

  it("needs the location when the store has several, and takes it as blank when it has one", async () => {
    const run = await check(file([row("DEMO-TOTE", "", 5)]));
    expect(await codes(run.jobId)).toContain("DEMO-TOTE:stockfile.location_required");
    await jobs.cancelJob(store.member, run.jobId, run.deps);
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${bergen}::uuid`);
    try {
      const single = await check(file([row("DEMO-TOTE", "", 9)]));
      expect(single.dry).toMatchObject({ toUpdate: 1, withProblems: 0 });
    } finally {
      await db().execute(sql`update commerce.inventory_locations set active = true where id = ${bergen}::uuid`);
    }
  });

  it("refuses a file without the required columns, an empty file and one over the row limit", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const started = await jobs.startInventoryUpload(store.member, "x.csv", deps);
    if (!started.ok) throw new Error(started.problem);
    storage.files.set(`imports/${started.path}`, csvBytes([["name", "count"], ["a", "1"]]));
    expect(await jobs.registerInventoryImport(store.member, { path: started.path, name: "x.csv" }, deps)).toMatchObject({ ok: false, problems: [expect.stringContaining("not a stock file we know")] });
    const second = await jobs.startInventoryUpload(store.member, "y.csv", deps);
    if (!second.ok) throw new Error(second.problem);
    storage.files.set(`imports/${second.path}`, new Uint8Array());
    expect(await jobs.registerInventoryImport(store.member, { path: second.path, name: "y.csv" }, deps)).toMatchObject({ ok: false });
    const third = await jobs.startInventoryUpload(store.member, "z.csv", deps);
    if (!third.ok) throw new Error(third.problem);
    storage.files.set(`imports/${third.path}`, csvBytes([["sku", "on_hand"], ...Array.from({ length: INVENTORY_FILE_ROWS_MAX + 1 }, (_, i) => [`S${i}`, "1"])]));
    expect(await jobs.registerInventoryImport(store.member, { path: third.path, name: "z.csv" }, deps)).toMatchObject({ ok: false, problems: [expect.stringContaining("20000")] });
    // The refused files are not kept.
    expect([...storage.files.keys()].filter((k) => k.startsWith("imports/"))).toHaveLength(0);
  });
});

describe("the apply", () => {
  it("writes each changed row as one movement of the file, with the reason, the note, the member and the job's id, and one pair of entries", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 7);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 3);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 4);
    const run = await check(
      file([
        row("DEMO-TOTE", OSLO, 12, { reason: "received", note: "Delivery 12", on_hand_was: 7 }),
        row("DEMO-TOTE", "Bergen", 3),
        row("DEMO-MUG-WHITE", OSLO, 1, { stock_policy: "continue", backorder_days: 14, low_stock_threshold: 3 }),
        row("NO-SUCH-SKU", OSLO, 1),
      ]),
    );
    expect(run.dry).toMatchObject({ toUpdate: 2, unchanged: 1, withProblems: 1 });
    const done = await apply(run);
    expect(done.counts).toMatchObject({ updated: 2, unchanged: 1, failed: 1 });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 12, Bergen: 3 });
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ [OSLO]: 1 });
    const tote = (await movementsOf(store.storeId, "DEMO-TOTE")).at(-1)!;
    expect(tote).toMatchObject({ delta: 5, after: 12, reason: "received", source: "file", jobId: run.jobId, actor: store.accountId, note: "Delivery 12" });
    // A row with no reason is a count, and its policy and warning level are saved.
    expect((await movementsOf(store.storeId, "DEMO-MUG-WHITE")).at(-1)).toMatchObject({ delta: -3, reason: "count", source: "file", jobId: run.jobId });
    const [v] = await db().execute<Row>(sql`select stock_policy, backorder_days, low_stock_threshold from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    expect(v).toMatchObject({ stock_policy: "continue", backorder_days: 14, low_stock_threshold: 3 });
    // One pair of entries for the job: counts only, never a SKU or a note.
    const started = await auditOf(store.storeId, "products.inventory_import_started");
    const ended = await auditOf(store.storeId, "products.inventory_imported");
    expect(started.at(-1)?.details).toMatchObject({ job: run.jobId, toUpdate: 2 });
    expect(ended.at(-1)?.details).toMatchObject({ job: run.jobId, updated: 2 });
    expect(JSON.stringify([started.at(-1)?.details, ended.at(-1)?.details])).not.toMatch(/DEMO-|Delivery 12/);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
    // A level of a variant that was made to keep selling, with nothing below zero ever written by a file.
    const items = await itemsOf(run.jobId);
    expect(items.find((i) => i.ref === "DEMO-TOTE" && i.changes.will === "update")).toMatchObject({ outcome: "updated", changes: { current: 7, next: 12, change: 5 } });
  });

  it("skips a row whose stored figure moved since the file was made, even after the dry run, and writes the others", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 12);
    await setLevel(store.storeId, "DEMO-MUG-BLACK", oslo, 5);
    const run = await check(file([row("DEMO-TOTE", OSLO, 20, { on_hand_was: 12 }), row("DEMO-MUG-BLACK", OSLO, 8, { on_hand_was: 5 })]));
    expect(run.dry).toMatchObject({ toUpdate: 2, conflicts: 0 });
    // A sale between the check and the apply: the tote's stored figure is 11 now.
    const order = await place(store.storeId, [["DEMO-TOTE", 1]]);
    await pay(store.storeId, order, store.account);
    const done = await apply(run);
    expect(done.counts).toMatchObject({ updated: 1, skipped: 1 });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 11 });
    expect(await levelsOf(store.storeId, "DEMO-MUG-BLACK")).toMatchObject({ [OSLO]: 8 });
    expect(await codes(run.jobId)).toContain("DEMO-TOTE:stockfile.conflict");
  });

  it("holds the apply to the file that was checked", async () => {
    const run = await check(file([row("DEMO-MUG-BLACK", OSLO, 3)]));
    const [job] = await db().execute<Row>(sql`select input_path from commerce.data_jobs where id = ${run.jobId}::uuid`);
    run.storage.files.set(`imports/${String(job.input_path)}`, file([row("DEMO-MUG-BLACK", OSLO, 999)]));
    const started = await jobs.startInventoryApply(store.member, run.jobId, run.deps);
    expect(started).toEqual({ ok: true });
    expect(await runToEnd(run.jobId, run.deps)).toBe("failed");
    expect((await jobRow(run.jobId)).problem).toContain("not the one that was checked");
    expect(await levelsOf(store.storeId, "DEMO-MUG-BLACK")).toMatchObject({ [OSLO]: 8 });
  });

  it("goes on where it was after a run that was killed, and writes nothing twice", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 11);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 1);
    await setLevel(store.storeId, "DEMO-MUG-BLACK", oslo, 8);
    const storage = fakeStorage();
    const small = depsWith(storage, { chunkRows: 1 });
    const run = await check(file([row("DEMO-TOTE", OSLO, 31), row("DEMO-MUG-WHITE", OSLO, 32), row("DEMO-MUG-BLACK", OSLO, 33)]), storage, small);
    const started = await jobs.startInventoryApply(store.member, run.jobId, small);
    expect(started).toEqual({ ok: true });
    // The run is killed after its second row: the error is the run's, the job is only paused.
    expect(await jobs.runJob(run.jobId, { ...small, stopAfter: 2 })).toBe("paused");
    await db().execute(sql`update commerce.data_jobs set claimed_until = null where id = ${run.jobId}::uuid`);
    expect(await runToEnd(run.jobId, small)).toBe("done");
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 31 });
    expect(await levelsOf(store.storeId, "DEMO-MUG-BLACK")).toMatchObject({ [OSLO]: 33 });
    // Each row is one movement: the row written before the stop is not written again by the resumed run.
    for (const sku of ["DEMO-TOTE", "DEMO-MUG-WHITE", "DEMO-MUG-BLACK"]) {
      const moved = (await movementsOf(store.storeId, sku)).filter((m) => m.jobId === run.jobId);
      expect(moved, sku).toHaveLength(1);
    }
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("is one open import per store, for a member who writes products, and another store never sees the job", async () => {
    const storage = fakeStorage();
    const first = await upload(store.member, storage, file([row("DEMO-TOTE", OSLO, 1)]));
    await expect(upload(store.member, storage, file([row("DEMO-TOTE", OSLO, 2)]))).rejects.toThrow("Another stock import is open");
    // Another store has its own.
    const theirs = await upload(other.member, storage, file([row("DEMO-TOTE", "Lager Oslo", 1)]));
    expect(theirs).not.toBe(first);
    expect(await jobs.startInventoryCheck(other.member, first, depsWith(storage))).toEqual({ ok: false, problem: "This import could not be found." });
    expect(await jobs.jobFor(other.member, first)).toBeNull();
    const reader = { ...store.member, role: "admin" as const, permissions: ["products:read"] };
    expect(await jobs.startInventoryUpload(reader, "x.csv", depsWith(storage))).toEqual({ ok: false, problem: "You do not have access to this." });
    expect(await jobs.startInventoryCheck(reader, first, depsWith(storage))).toEqual({ ok: false, problem: "You do not have access to this." });
    const cancelled = await jobs.cancelJob(store.member, first, depsWith(storage));
    expect(cancelled).toEqual({ ok: true });
    expect((await auditOf(store.storeId, "products.inventory_import_cancelled")).length).toBeGreaterThanOrEqual(1);
  });
});

describe("writing it all in one writer", () => {
  it("writes the file through writeCsv only: a cell that starts like a formula is escaped on the way out and unescaped on the way in", () => {
    const text = writeCsv([["sku", "note"], ["A", "=1+1"]]);
    expect(text).toContain("'=1+1");
    expect(rowsOfCsv(text)[1][1]).toBe("'=1+1");
  });
});
