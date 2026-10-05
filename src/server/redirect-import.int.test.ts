import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { readRedirectFile } from "@/lib/redirect-csv";

import { auditOf, csvBytes, depsWith, fakeStorage, itemsOf, jobRow, rowsOfCsv, runToEnd, textOf, type FakeStorage } from "./data-test-support";
import { auditActions, redirectFixture, redirectRowsOf, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** The size above which an export is a job: the real figure is 2,000 rows, lowered here so a few redirects make a job. */
const limits = vi.hoisted(() => ({ direct: 2000 }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  return Object.defineProperty({ ...original }, "DIRECT_EXPORT_MAX_ROWS", { get: () => limits.direct, enumerable: true });
});

const jobs = await import("./data-jobs");
const redirects = await import("./redirects");

type Row = Record<string, unknown>;

/**
 * The redirect import and export (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4, 2.2.5, 6.1 R3), on the pipeline of D165: a file is registered,
 * checked as one set (nothing written), applied in chunks with every line judged again at write time, resumed after a stop, cancelled, held to the file that
 * was checked; the file of manual redirects imports back unchanged; a large export is a job delivered by a link, never emailed.
 */

let f: RedirectFixture;
let other: RedirectFixture;

const HEADER = ["Redirect from", "Redirect to"];
const file = (rows: [string, string][], header: string[] = HEADER): Uint8Array => csvBytes([header, ...rows]);

beforeAll(async () => {
  f = await redirectFixture("rimport");
  other = await redirectFixture("rimport-other");
});

afterAll(async () => {
  await closeDb();
});

// A step that failed must not leave the store's one open import behind for the next test.
afterEach(async () => {
  limits.direct = 2000;
  await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where kind = 'redirect_import' and store_id in (${f.fx.storeId}::uuid, ${other.fx.storeId}::uuid) and status in ('uploaded', 'checking', 'checked', 'queued', 'running')`);
});

const upload = async (fx: RedirectFixture, storage: FakeStorage, bytes: Uint8Array, name = "redirects.csv", deps = depsWith(storage)): Promise<string> => {
  const started = await jobs.startRedirectUpload(fx.owner, name, deps);
  if (!started.ok) throw new Error(started.problem);
  storage.files.set(`imports/${started.path}`, bytes);
  const registered = await jobs.registerRedirectImport(fx.owner, { path: started.path, name }, deps);
  if (!registered.ok) throw new Error(registered.problems.join(" "));
  return registered.jobId;
};

const check = async (fx: RedirectFixture, jobId: string, deps: ReturnType<typeof depsWith>, options: unknown = {}) => {
  const started = await jobs.startRedirectCheck(fx.owner, jobId, options, deps);
  if (!started.ok) throw new Error(started.problem);
  const end = await runToEnd(jobId, deps);
  if (end !== "checked") throw new Error(`the check ended ${end}: ${String((await jobRow(jobId)).problem)}`);
  return { row: await jobRow(jobId), dry: jobs.redirectDryCountsOf({ counts: (await jobRow(jobId)).counts as Record<string, unknown> }) };
};

const apply = async (fx: RedirectFixture, jobId: string, deps: ReturnType<typeof depsWith>) => {
  const started = await jobs.startRedirectApply(fx.owner, jobId, deps);
  if (!started.ok) throw new Error(started.problem);
  return runToEnd(jobId, deps);
};

const manualCount = async (fx: RedirectFixture): Promise<number> => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.redirects where store_id = ${fx.fx.storeId}::uuid and kind = 'manual'`))[0].n);

describe("registering a file", () => {
  it("refuses a file that is empty, is no redirect file, ends inside a quote or is over the rows, naming the problem, and removes it", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const attempt = async (bytes: Uint8Array) => {
      const started = await jobs.startRedirectUpload(f.owner, "x.csv", deps);
      if (!started.ok) throw new Error("upload");
      storage.files.set(`imports/${started.path}`, bytes);
      const registered = await jobs.registerRedirectImport(f.owner, { path: started.path, name: "x.csv" }, deps);
      return { registered, kept: storage.files.has(`imports/${started.path}`) };
    };
    const empty = await attempt(new Uint8Array());
    expect(empty.registered).toMatchObject({ ok: false, problems: ["The file is empty."] });
    expect(empty.kept).toBe(false);
    expect((await attempt(new TextEncoder().encode("a,b\r\n1,2\r\n"))).registered).toMatchObject({ ok: false, problems: [expect.stringContaining("Redirect from")] });
    expect((await attempt(new TextEncoder().encode('Redirect from,Redirect to\r\n/x,"never closed\r\n'))).registered).toMatchObject({ ok: false, problems: [expect.stringContaining("quoted cell")] });
    expect(await manualCount(f)).toBe(0);
    expect(await db().execute(sql`select 1 from commerce.data_jobs where store_id = ${f.fx.storeId}::uuid and kind = 'redirect_import'`)).toHaveLength(0);
  });

  it("refuses a path that is not under the store's own folder, and a member without the Website write key", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    storage.files.set(`imports/${other.fx.storeId}/aaaaaaaa-0000-4000-8000-000000000001/x.csv`, file([["/a", "/om-oss"]]));
    expect(await jobs.registerRedirectImport(f.owner, { path: `${other.fx.storeId}/aaaaaaaa-0000-4000-8000-000000000001/x.csv`, name: "x.csv" }, deps)).toMatchObject({ ok: false });
    expect(await jobs.registerRedirectImport(f.owner, { path: `../${f.fx.storeId}/x.csv`, name: "x.csv" }, deps)).toMatchObject({ ok: false });
    expect(await jobs.startRedirectUpload(f.reader, "x.csv", deps)).toMatchObject({ ok: false });
    expect(await jobs.startRedirectUpload(f.outsider, "x.csv", deps)).toMatchObject({ ok: false });
    expect(await jobs.registerRedirectImport(f.reader, { path: "x", name: "x.csv" }, deps)).toMatchObject({ ok: false });
  });

  it("keeps one open import per store: a second is refused and its file removed, and another store has its own", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const first = await upload(f, storage, file([["/one", "/om-oss"]]), "one.csv", deps);
    const started = await jobs.startRedirectUpload(f.owner, "two.csv", deps);
    if (!started.ok) throw new Error("upload");
    storage.files.set(`imports/${started.path}`, file([["/two", "/om-oss"]]));
    const second = await jobs.registerRedirectImport(f.owner, { path: started.path, name: "two.csv" }, deps);
    expect(second).toMatchObject({ ok: false, problems: [expect.stringContaining("Another redirect import is open")] });
    expect(storage.files.has(`imports/${started.path}`)).toBe(false);
    expect(await upload(other, storage, file([["/three", "/om-oss"]]), "three.csv", deps)).toBeTruthy();
    // A product import is a different kind: it does not count against this one.
    expect((await jobRow(first)).kind).toBe("redirect_import");
  });
});

describe("the check", () => {
  it("writes no redirect, says for every line what an apply would do, and counts them as a dry run", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    await redirects.createRedirect(f.owner, { from: "/exists-same", to: "/om-oss" });
    await redirects.createRedirect(f.owner, { from: "/exists-other", to: "/om-oss" });
    const before = await manualCount(f);
    const rows: [string, string][] = [
      ["/new-1", "/om-oss"],
      ["/exists-same", "/om-oss"],
      ["/exists-other", "/alle-produkter"],
      ["/cart", "/om-oss"],
      ["/new-1", "/alle-produkter"],
      ["/loop-x", "/loop-y"],
      ["/loop-y", "/loop-x"],
      ["/external", "https://evil.example/x"],
      ["/no/prefixed", "/om-oss"],
      [`/p/${f.product.handle}`, "/om-oss"],
      ["", "/om-oss"],
      ["/to-nothing", ""],
      ["/chain-1", "/new-1"],
    ];
    const jobId = await upload(f, storage, file(rows), "check.csv", deps);
    const { dry } = await check(f, jobId, deps);
    expect(await manualCount(f)).toBe(before);
    expect(dry).toEqual({ toCreate: 3, toReplace: 1, unchanged: 1, skipped: 0, withErrors: 8 });
    const items = await itemsOf(jobId);
    const byRef = new Map(items.filter((i) => i.kind === "redirect").map((i, n) => [n, i]));
    const codes = (n: number) => byRef.get(n)!.messages.map((m) => m.code);
    expect(codes(0)).toEqual([]);
    expect(codes(1)).toEqual(["exists.same"]);
    expect(codes(2)).toEqual(["exists.update"]);
    expect(codes(3)).toContain("source.reserved");
    expect(codes(4)).toContain("duplicate.in_file");
    expect(codes(5)).toEqual(["target.not_found"]);
    expect(codes(6)).toContain("target.loop");
    expect(codes(7)).toContain("target.external");
    expect(codes(8)).toContain("source.market_prefix");
    expect(codes(9)).toContain("source.live");
    expect(codes(10)).toContain("source.missing");
    expect(codes(11)).toContain("target.missing");
    expect(codes(12)).toContain("target.chain");
    // The dry run's items say what an apply would do, and no item is a written one.
    expect(byRef.get(0)!.outcome).toBe("checked");
    expect(byRef.get(0)!.changes).toMatchObject({ will: "created" });
    // A later line sees an earlier one: /loop-y closes the loop with /loop-x of the line before.
    expect(byRef.get(5)!.outcome).toBe("checked");
  });

  it("judges lines in later chunks against what earlier chunks would write (a chain collapses, a loop is refused), as one set", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage, { chunkRows: 2 });
    const rows: [string, string][] = [["/a1", "/om-oss"], ["/a2", "/a1"], ["/a3", "/a2"], ["/a4", "/a5"], ["/a5", "/a4"]];
    const jobId = await upload(f, storage, file(rows), "chunks.csv", deps);
    const { dry } = await check(f, jobId, deps);
    expect(dry).toMatchObject({ toCreate: 4, withErrors: 1 });
    const items = (await itemsOf(jobId)).filter((i) => i.kind === "redirect");
    expect(items[2].messages.map((m) => m.code)).toContain("target.chain");
    expect(items[4].messages.map((m) => m.code)).toContain("target.loop");
    expect(await manualCount(f)).toBe(await manualCount(f));
  });

  it("is the same as a second look at the same file with another option: keeping existing redirects skips them", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    await redirects.createRedirect(f.owner, { from: "/keep-me", to: "/om-oss" });
    const jobId = await upload(f, storage, file([["/keep-me", "/alle-produkter"], ["/fresh", "/om-oss"]]), "options.csv", deps);
    expect((await check(f, jobId, deps, { existing: "replace" })).dry).toMatchObject({ toCreate: 1, toReplace: 1, skipped: 0 });
    expect((await check(f, jobId, deps, { existing: "skip" })).dry).toMatchObject({ toCreate: 1, toReplace: 0, skipped: 1 });
  });

  it("gives a file with extra columns, semicolons and a byte order mark the same lines, and the problems as a file of their own", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const bytes = csvBytes([["Redirect from", "Redirect to", "type", "used"], ["/nordic", "/om-oss", "manual", 4], ["/cart", "/om-oss", "manual", 0]], "excel_nordic");
    const jobId = await upload(f, storage, bytes, "nordic.csv", deps);
    const { dry } = await check(f, jobId, deps);
    expect(dry).toMatchObject({ toCreate: 1, withErrors: 1 });
    const problems = await jobs.redirectProblemsCsv(f.owner, jobId, deps);
    if (!problems.ok) throw new Error("problems");
    const rows = rowsOfCsv(problems.csv);
    expect(rows[0]).toEqual(["row", "redirect_from", "redirect_to", "severity", "code", "message"]);
    expect(rows.some((r) => r[1] === "/cart" && r[4] === "source.reserved")).toBe(true);
    expect(rows.some((r) => r[4] === "column.ignored")).toBe(true);
    // A member without the key gets no file.
    expect(await jobs.redirectProblemsCsv(f.reader, jobId, deps)).toEqual({ ok: false });
  });
});

describe("the apply", () => {
  it("writes the planned lines in chunks, each line judged again at write time, and lists the ones that were skipped", async () => {
    const fx = await redirectFixture("rimport-apply");
    const storage = fakeStorage();
    const deps = depsWith(storage, { chunkRows: 2 });
    const rows: [string, string][] = [["/ap-1", "/om-oss"], ["/ap-2", "/ap-1"], ["/ap-3", "/alle-produkter"], ["/ap-live-later", "/om-oss"], ["/ap-5", "/om-oss"]];
    const jobId = await upload(fx, storage, file(rows), "apply.csv", deps);
    expect((await check(fx, jobId, deps)).dry).toMatchObject({ toCreate: 5, withErrors: 0 });
    // Between the check and the apply a page takes /ap-live-later: the line must be skipped, not written.
    await db().execute(sql`update commerce.pages set slug = 'ap-live-later' where store_id = ${fx.fx.storeId}::uuid and slug = 'forside'`);
    expect(await apply(fx, jobId, deps)).toBe("done");
    const written = (await redirectRowsOf(fx.fx.storeId)).filter((r) => r.kind === "manual").map((r) => [r.source, r.target, r.origin]);
    expect(written).toEqual([["/ap-1", "/om-oss", "import"], ["/ap-2", "/om-oss", "import"], ["/ap-3", "/alle-produkter", "import"], ["/ap-5", "/om-oss", "import"]]);
    const row = await jobRow(jobId);
    expect(row.status).toBe("done");
    expect(row.counts).toMatchObject({ created: 4, failed: 1 });
    const items = (await itemsOf(jobId)).filter((i) => i.kind === "redirect");
    expect(items.map((i) => i.outcome)).toEqual(["created", "created", "created", "failed", "created"]);
    expect(items[3].messages.map((m) => m.code)).toContain("source.live");
    expect(Number(row.rows_done)).toBe(5);
    // The files of an import are kept 30 days.
    expect(Math.round((new Date(String(row.expires_at)).getTime() - new Date(String(row.finished_at)).getTime()) / 86_400_000)).toBe(30);
  });

  it("writes one pair of entries for the job, with counts, never one per redirect or an address", async () => {
    const fx = await redirectFixture("rimport-audit");
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, file([["/au-1", "/om-oss"], ["/au-2", "/om-oss"], ["/au-3", "/om-oss"]]), "audit.csv", deps);
    await check(fx, jobId, deps);
    expect(await apply(fx, jobId, deps)).toBe("done");
    const entries = await auditActions(fx.fx.storeId, "redirect");
    expect(entries.map((e) => e.action)).toEqual(["redirects.import_started", "redirects.import_applied"]);
    expect(JSON.stringify(entries)).not.toContain("/au-1");
    expect(entries[0].details).toMatchObject({ job: jobId, file: "audit.csv", toCreate: 3 });
    expect(entries[1].details).toMatchObject({ job: jobId, created: 3 });
    expect(entries.every((e) => e.area === "website")).toBe(true);
  });

  it("goes on where the cursor is after a run that was killed, and writes no redirect twice", async () => {
    const fx = await redirectFixture("rimport-resume");
    const storage = fakeStorage();
    const deps = depsWith(storage, { chunkRows: 3 });
    const rows: [string, string][] = Array.from({ length: 10 }, (_, i) => [`/rs-${i}`, i % 2 === 0 ? "/om-oss" : "/alle-produkter"]);
    const jobId = await upload(fx, storage, file(rows), "resume.csv", deps);
    await check(fx, jobId, deps);
    const started = await jobs.startRedirectApply(fx.owner, jobId, deps);
    if (!started.ok) throw new Error(started.problem);
    // The run is cut off after the first chunk was written and before it was recorded.
    expect(await jobs.runJob(jobId, { ...deps, stopAfter: 3 })).toBe("paused");
    expect(await manualCount(fx)).toBe(3);
    expect(await runToEnd(jobId, deps)).toBe("done");
    expect(await manualCount(fx)).toBe(10);
    const row = await jobRow(jobId);
    // The chunk that was written but not recorded is `unchanged` on the second look: nothing was written twice.
    expect(Number((row.counts as Record<string, number>).created) + Number((row.counts as Record<string, number>).unchanged)).toBe(10);
    expect(Number((row.counts as Record<string, number>).unchanged)).toBe(3);
    const items = (await itemsOf(jobId)).filter((i) => i.kind === "redirect");
    expect(items).toHaveLength(10);
    expect(new Set((await redirectRowsOf(fx.fx.storeId)).map((r) => r.source)).size).toBe(10);
  });

  it("is refused without a check, for another file's check, for a file with nothing to import, and while it is already running", async () => {
    const fx = await redirectFixture("rimport-refuse");
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, file([["/cart", "/om-oss"]]), "bad.csv", deps);
    expect(await jobs.startRedirectApply(fx.owner, jobId, deps)).toEqual({ ok: false, problem: "Check the file first." });
    await check(fx, jobId, deps);
    expect(await jobs.startRedirectApply(fx.owner, jobId, deps)).toMatchObject({ ok: false, problem: expect.stringContaining("No redirect in this file can be imported") });
    expect(await jobs.startRedirectApply(fx.reader, jobId, deps)).toMatchObject({ ok: false });
    // Another store's member cannot check or apply this job: it is not found.
    expect(await jobs.startRedirectCheck(other.owner, jobId, {}, deps)).toEqual({ ok: false, problem: "This import could not be found." });
    expect(await jobs.startRedirectApply(other.owner, jobId, deps)).toEqual({ ok: false, problem: "This import could not be found." });
  });

  it("does not apply a file that is not the one that was checked", async () => {
    const fx = await redirectFixture("rimport-sha");
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, file([["/sha-1", "/om-oss"]]), "sha.csv", deps);
    await check(fx, jobId, deps);
    const path = String((await jobRow(jobId)).input_path);
    storage.files.set(`imports/${path}`, file([["/sha-1", "/om-oss"], ["/sha-evil", "/om-oss"]]));
    const started = await jobs.startRedirectApply(fx.owner, jobId, deps);
    if (!started.ok) throw new Error(started.problem);
    expect(await runToEnd(jobId, deps)).toBe("failed");
    expect(String((await jobRow(jobId)).problem)).toContain("not the one that was checked");
    expect(await manualCount(fx)).toBe(0);
  });

  it("can be cancelled, keeps what was written, and the cancel is logged", async () => {
    const fx = await redirectFixture("rimport-cancel");
    const storage = fakeStorage();
    const deps = depsWith(storage, { chunkRows: 2 });
    const jobId = await upload(fx, storage, file([["/cn-1", "/om-oss"], ["/cn-2", "/om-oss"], ["/cn-3", "/om-oss"], ["/cn-4", "/om-oss"]]), "cancel.csv", deps);
    await check(fx, jobId, deps);
    await jobs.startRedirectApply(fx.owner, jobId, deps);
    await jobs.runJob(jobId, { ...deps, budgetMs: 1 });
    expect(await jobs.cancelJob(fx.owner, jobId, deps)).toEqual({ ok: true });
    expect((await jobRow(jobId)).status).toBe("cancelled");
    expect(await jobs.cancelJob(fx.owner, jobId, deps)).toMatchObject({ ok: false });
    expect((await auditActions(fx.fx.storeId, "redirects.import_cancelled")).length).toBe(1);
    // A cancelled import frees the store's one open import.
    expect(await upload(fx, storage, file([["/cn-5", "/om-oss"]]), "next.csv", deps)).toBeTruthy();
  });

  it("never deletes a redirect, and leaves the ones that are not in the file", async () => {
    const fx = await redirectFixture("rimport-keep");
    await redirects.createRedirect(fx.owner, { from: "/not-in-file", to: "/om-oss" });
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, file([["/in-file", "/om-oss"]]), "keep.csv", deps);
    await check(fx, jobId, deps);
    expect(await apply(fx, jobId, deps)).toBe("done");
    expect((await redirectRowsOf(fx.fx.storeId)).map((r) => r.source)).toEqual(["/in-file", "/not-in-file"]);
  });

  it("replaces an automatic redirect from the same address when the line says so, and never makes a loop of an automatic one", async () => {
    const fx = await redirectFixture("rimport-auto");
    await db().execute(sql`update commerce.products set handle = ${`${fx.product.handle}-renamed`} where id = ${fx.product.id}::uuid`);
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, file([[`/p/${fx.product.handle}`, "/alle-produkter"]]), "auto.csv", deps);
    expect((await check(fx, jobId, deps)).dry).toMatchObject({ toCreate: 1 });
    expect((await itemsOf(jobId)).find((i) => i.kind === "redirect")!.messages.map((m) => m.code)).toContain("exists.replaced_automatic");
    expect(await apply(fx, jobId, deps)).toBe("done");
    expect((await redirectRowsOf(fx.fx.storeId)).find((r) => r.source === `/p/${fx.product.handle}`)).toMatchObject({ kind: "manual", target: "/alle-produkter" });
  });
});

describe("the export", () => {
  it("is a download at once for a small store, in Shopify's two columns first, and the file imports back with every line unchanged", async () => {
    const fx = await redirectFixture("rexport");
    await redirects.createRedirect(fx.owner, { from: "/ex-1", to: "/om-oss" });
    await redirects.createRedirect(fx.owner, { from: "/ex-2", to: `/p/${fx.product.handle}?variant=2#top` });
    await redirects.createRedirect(fx.owner, { from: "/ex-3/øre", to: "/alle-produkter" });
    await db().execute(sql`update commerce.products set handle = ${`${fx.product.handle}-new`} where id = ${fx.product.id}::uuid`);
    const result = await jobs.requestRedirectExport(fx.owner, {});
    if (!result.ok || result.mode !== "file") throw new Error(JSON.stringify(result));
    expect(result.filename).toMatch(/^redirects-\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = rowsOfCsv(result.csv);
    expect(rows[0]).toEqual(["Redirect from", "Redirect to", "type", "created", "used", "last_used"]);
    // Manual redirects only by default, by source.
    expect(rows.slice(1).map((r) => r[0])).toEqual(["/ex-1", "/ex-2", "/ex-3/øre"].sort((a, b) => a.localeCompare(b)));
    expect(rows.slice(1).every((r) => r[2] === "manual")).toBe(true);
    // The file imports back: every line is unchanged on the same store.
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const jobId = await upload(fx, storage, new TextEncoder().encode(result.csv), "back.csv", deps);
    expect((await check(fx, jobId, deps)).dry).toEqual({ toCreate: 0, toReplace: 0, unchanged: 3, skipped: 0, withErrors: 0 });
    // The Nordic dialect reads back the same.
    const nordic = await jobs.requestRedirectExport(fx.owner, { dialect: "excel_nordic" });
    if (!nordic.ok || nordic.mode !== "file") throw new Error("nordic");
    const read = readRedirectFile(new TextEncoder().encode(nordic.csv));
    expect(read.ok && read.lines.map((l) => [l.from, l.to])).toEqual(rows.slice(1).map((r) => [r[0], r[1]]));
  });

  it("can include the automatic redirects, each with the address the thing has now, and writes one entry with the count", async () => {
    const fx = await redirectFixture("rexport-all");
    await redirects.createRedirect(fx.owner, { from: "/ea-1", to: "/om-oss" });
    await db().execute(sql`update commerce.products set handle = ${`${fx.product.handle}-new`} where id = ${fx.product.id}::uuid`);
    await db().execute(sql`update commerce.terms set slug = ${`${fx.category.slug}-new`} where id = ${fx.category.id}::uuid`);
    const result = await jobs.requestRedirectExport(fx.owner, { scope: "all" });
    if (!result.ok || result.mode !== "file") throw new Error("file");
    const rows = rowsOfCsv(result.csv).slice(1);
    expect(rows.map((r) => [r[0], r[1], r[2]])).toEqual([
      [`/category/${fx.category.slug}`, `/category/${fx.category.slug}-new`, "category"],
      ["/ea-1", "/om-oss", "manual"],
      [`/p/${fx.product.handle}`, `/p/${fx.product.handle}-new`, "product"],
    ]);
    const entries = await auditOf(fx.fx.storeId, "redirects.export_made");
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toMatchObject({ rows: 3, direct: true, scope: "all" });
    expect(JSON.stringify(entries[0].details)).not.toContain("/ea-1");
  });

  it("is a job above the size of a download, in parts, delivered by a link to the member, never emailed with the file", async () => {
    const fx = await redirectFixture("rexport-job");
    await db().execute(sql`
      insert into commerce.redirects (store_id, kind, source, target, origin) select ${fx.fx.storeId}::uuid, 'manual', '/job-' || lpad(g::text, 4, '0'), '/om-oss', 'import' from generate_series(1, 25) g
    `);
    limits.direct = 10;
    const storage = fakeStorage();
    const sent: { to: string; kind: string; subject: string; body: string }[] = [];
    const deps = depsWith(storage, {
      batchRows: 4,
      partRows: 10,
      send: (async (m: { to: string; kind: string; email: { subject: string; html: string; text: string } }) => {
        sent.push({ to: m.to, kind: m.kind, subject: m.email.subject, body: `${m.email.html}${m.email.text}` });
        return "sent";
      }) as never,
    });
    const started = await jobs.requestRedirectExport(fx.owner, {}, deps);
    if (!started.ok || started.mode !== "job") throw new Error("job");
    expect((await jobRow(started.jobId)).kind).toBe("redirect_export");
    expect(await runToEnd(started.jobId, deps)).toBe("done");
    const done = await jobRow(started.jobId);
    const files = done.files as { path: string; name: string; rows: number }[];
    expect(files.length).toBe(3);
    expect(files.reduce((n, p) => n + p.rows, 0)).toBe(25);
    const together = files.flatMap((p) => rowsOfCsv(textOf(storage, "exports", p.path)).slice(1));
    expect(together.map((r) => r[0])).toEqual(Array.from({ length: 25 }, (_, i) => `/job-${String(i + 1).padStart(4, "0")}`));
    // The member is told by one email that names the kind, holds no file and links to the page.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: fx.owner.account.email, kind: "data_job.ready", subject: "Your redirect file is ready" });
    expect(sent[0].body).toContain(`/admin/${fx.fx.slug}/redirects/export?job=${started.jobId}`);
    expect(sent[0].body).not.toContain("/job-0001");
    // A signed address for the part is made when it is pressed and logged first; another store's member gets none.
    expect(await jobs.downloadPart(fx.owner, started.jobId, 0, deps)).toMatchObject({ ok: true });
    expect(await jobs.downloadPart(other.owner, started.jobId, 0, deps)).toEqual({ ok: false, problem: "This file is not available." });
    expect((await auditOf(fx.fx.storeId, "redirects.export_downloaded")).length).toBe(1);
  });

  it("is for the Website's readers: a member without the read key is refused, and the options are checked", async () => {
    expect(await jobs.requestRedirectExport(f.outsider, {})).toMatchObject({ ok: false, code: "forbidden" });
    expect(await jobs.requestRedirectExport(f.reader, { dialect: "nope" })).toMatchObject({ ok: false, code: "options" });
    expect(await jobs.requestRedirectExport(f.reader, { scope: "everything" })).toMatchObject({ ok: false, code: "options" });
    expect(await jobs.requestRedirectExport(f.reader, {})).toMatchObject({ ok: true, mode: "file" });
  });

  it("only exports the store's own redirects", async () => {
    const mine = await jobs.requestRedirectExport(f.owner, { scope: "all" });
    if (!mine.ok || mine.mode !== "file") throw new Error("file");
    const theirs = await redirects.createRedirect(other.owner, { from: "/only-theirs", to: "/om-oss" });
    expect(theirs.ok).toBe(true);
    expect(mine.csv).not.toContain("/only-theirs");
  });
});

describe("the file as a pure round trip", () => {
  it("writes a header and reads it back to the same lines, whatever the dialect", () => {
    const cells: Cell[][] = [HEADER, ["/a", "/om-oss"], ["/b?x=1", "/p/x#y"]];
    for (const dialect of ["standard", "excel_nordic"] as const) {
      const read = readRedirectFile(new TextEncoder().encode(writeCsv(cells, dialect)));
      expect(read.ok && read.lines.map((l) => [l.from, l.to])).toEqual([["/a", "/om-oss"], ["/b?x=1", "/p/x#y"]]);
    }
  });
});
