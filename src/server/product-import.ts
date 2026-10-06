import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db/client";
import { DELIMITER_WORDS, parseCsv, type ParsedCsv } from "@/lib/csv";
import { finding, summariseCounts, type Finding, type ItemSummary, type JobCounts, EMPTY_COUNTS } from "@/lib/data-job";
import { BULK_CHUNK, IMPORT_MAX_BYTES, IMPORT_MAX_PRODUCTS, IMPORT_MAX_ROWS, IMPORT_PICTURE_MAX_BYTES, IMPORT_PICTURE_TYPES, IMPORT_PICTURE_WIDTH, IMPORT_THUMBNAIL_WIDTH } from "@/lib/data-limits";
import { groupProducts, readNeutral, type FileFinding, type Grouped, type NeutralFile, type ProductCsvContext, type ProductDraft } from "@/lib/product-csv";
import { detectFormat, readShopify } from "@/lib/product-csv-shopify";
import {
  checkFile,
  blockingFinding,
  duplicateSkus,
  dryRunCounts,
  itemOf,
  namedKeys,
  parseImportOptions,
  pendingKey,
  planProduct,
  withCreatedTerms,
  type FetchedPicture,
  type ImportOptions,
  type PlanEnv,
  type ProductPlan,
  type StoreSnapshot,
} from "@/lib/product-import";
import type { Account } from "./auth";
import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import {
  IMPORTS_BUCKET,
  assetsOf,
  failJob,
  finishJob,
  getJob,
  importPathPattern,
  putAsset,
  putItems,
  safeName,
  saveProgress,
  scheduleJob,
  sha256Of,
  stillRunning,
  StorageDown,
  storageOf,
  type DataDeps,
  type DataJob,
  type ItemInput,
  releaseJob,
} from "./data-job-store";
import { JobStopped } from "./data-export-run";
import { fieldsTag } from "./custom-fields";
import { refreshStoreEmbeddings } from "./embeddings";
import { storePicture as storeLibraryPicture } from "./media-library";
import { NO_ACCESS, memberCan } from "./permissions";
import { csvContextFor, getEditorContext, inBatches, libraryAddresses, loadStored, ownPictureTest, pgTextArray, pgUuidArray, publishContextFor, storeOf } from "./product-data";
import { emptyProduct, saveProduct, setArchived, type EditorContext, type StockMode } from "./products";
import { refreshTag } from "./refresh";
import { safeFetch } from "./replicate-fetch";
import { createTerm, listTerms } from "./taxonomy";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The product import (D165, `docs/wave-2-data.md` 2.2): upload, check (a dry run that writes nothing), apply. The apply goes ONLY through the
 * editor's own door: `loadStored()` reads a product with `getProductForEdit()`, `planProduct()` lays the file over it, and `saveProduct()` writes
 * it, so `commerce.set_price`, `productProblems()`, the unit-price rules and the publishing triggers apply unchanged. No code here writes a
 * product, a variant, a price or stock itself, deletes anything, or changes a handle (`product-import-writers.test.ts` scans for it). Each
 * product is checked again from the store's state when it is written (the dry run is advice), one product at a time, and a product that cannot
 * be saved is listed with the editor's sentence while the others go on. Pictures from other websites are fetched only through `safeFetch()`.
 */

const WRITE = "products:write" as const;

// ---------------------------------------------------------------------------
// Upload and register
// ---------------------------------------------------------------------------

export type UploadStart = { ok: true; path: string; token: string; bucket: typeof IMPORTS_BUCKET } | { ok: false; problem: string };

/** A signed upload for the browser: one new path in the store's folder of the private imports bucket (the file is up to 15 MB). */
export async function startImportUpload(member: Membership, fileName: string, deps: DataDeps = {}): Promise<UploadStart> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Uploads are not set up on this server." };
  const path = `${member.store.id}/${randomUUID()}/${safeName(fileName)}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, problem: "The upload could not be started. Try again." };
  return { ok: true, path, token: started.token, bucket: IMPORTS_BUCKET };
}

export type RegisterResult = { ok: true; jobId: string } | { ok: false; problems: string[] };

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** A file's name as the member gave it, safe to show: no control characters, at most 120 characters. */
const shownName = (name: string): string => name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "products.csv";

/** The file as neutral rows and what was found out about it, or why it is refused. Pure given the context. */
export function readImportFile(bytes: Uint8Array, ctx: ProductCsvContext, options: ImportOptions): { ok: true; parsed: ParsedCsv; file: NeutralFile; grouped: Grouped; extra: FileFinding[] } | { ok: false; problems: string[] } {
  if (bytes.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, problems: [finding("file.too_large", { max: Math.floor(IMPORT_MAX_BYTES / 1024 / 1024) }).text] };
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problems: ["The file ends inside a quoted cell. Check the quotes and try again."] };
  if (parsed.rows.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  const header = parsed.rows[0].map((h) => h.replace(/^﻿/, "").trim());
  if (header.every((h) => h === "")) return { ok: false, problems: [finding("file.no_header").text] };
  if (parsed.rows.length - 1 > IMPORT_MAX_ROWS) return { ok: false, problems: [finding("file.too_many_rows", { n: parsed.rows.length - 1, max: IMPORT_MAX_ROWS }).text] };
  const format = detectFormat(header);
  if (!format) return { ok: false, problems: [finding("file.unknown_format").text] };
  const file = format === "shopify" ? readShopify(parsed.rows, ctx, { priceMarket: options.priceMarket }) : readNeutral(parsed.rows, ctx);
  const grouped = groupProducts(file);
  if (grouped.drafts.length > IMPORT_MAX_PRODUCTS) return { ok: false, problems: [finding("file.too_many_products", { n: grouped.drafts.length, max: IMPORT_MAX_PRODUCTS }).text] };
  const extra: FileFinding[] = [];
  if (parsed.assumed) extra.push({ rows: [], finding: finding("file.encoding_assumed") });
  extra.push({ rows: [], finding: finding("file.delimiter", { name: DELIMITER_WORDS[parsed.delimiter] }) });
  for (const row of parsed.ragged.slice(0, 50)) extra.push({ rows: [row], finding: finding("file.ragged_row") });
  return { ok: true, parsed, file, grouped, extra };
}

/**
 * Registers a file the browser uploaded to the imports bucket: reads it, refuses it with a sentence naming the problem or limit (and removes it),
 * or keeps it as a job in `uploaded` with its SHA-256 and the format found from its header. One product import is open per store at a time.
 */
export async function registerImport(member: Membership, input: { path: string; name: string }, deps: DataDeps = {}): Promise<RegisterResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: [NO_ACCESS] };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problems: ["Uploads are not set up on this server."] };
  const storeId = member.store.id;
  if (typeof input.path !== "string" || !importPathPattern(storeId).test(input.path)) return { ok: false, problems: ["The file did not arrive. Choose it again."] };
  const refuse = async (problems: string[]): Promise<RegisterResult> => {
    await storage.remove(IMPORTS_BUCKET, [input.path]).catch(() => false);
    return { ok: false, problems };
  };
  const bytes = await storage.download(IMPORTS_BUCKET, input.path);
  if (!bytes) return { ok: false, problems: ["The file did not arrive. Choose it again."] };
  const editor = await getEditorContext(member.store);
  const ctx = await csvContextFor(member.store, editor);
  const read = readImportFile(bytes, ctx, parseImportOptions({}));
  if (!read.ok) return refuse(read.problems);
  const format = read.file.format;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, rows_total)
      values (${storeId}::uuid, 'product_import', 'uploaded', ${format}, ${member.account.id}::uuid, ${input.path}, ${shownName(input.name)}, ${bytes.length}, ${sha256Of(bytes)}, ${read.parsed.rows.length - 1})
      returning id
    `);
    return { ok: true, jobId: String(row.id) };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return refuse(["Another product import is open for this store. Finish it or cancel it first."]);
  }
}

// ---------------------------------------------------------------------------
// Check and apply: starting them
// ---------------------------------------------------------------------------

export type StepResult = { ok: true } | { ok: false; problem: string };

/** Starts (or restarts, with other options) the dry run of an uploaded or checked import. */
export async function checkImport(member: Membership, jobId: string, rawOptions: unknown, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "product_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "uploaded" && job.status !== "checked") return { ok: false, problem: job.status === "checking" ? "The file is being checked." : "This import can no longer be checked." };
  const options = parseImportOptions(rawOptions);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'checking', phase = 'check', options = ${JSON.stringify(options)}::jsonb, cursor = '{}'::jsonb, counts = '{}'::jsonb,
           rows_done = null, rows_total = null, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'product_import' and status in ('uploaded', 'checked')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This import can no longer be checked." };
  await db().execute(sql`delete from commerce.data_job_items where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  await db().execute(sql`delete from commerce.data_job_assets where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

/** The numbers a checked job shows before it is applied. */
export const dryCountsOf = (job: Pick<DataJob, "counts">): { toCreate: number; toUpdate: number; unchanged: number; withProblems: number } => {
  const d = (job.counts.dry ?? {}) as Record<string, unknown>;
  return { toCreate: Number(d.toCreate ?? 0), toUpdate: Number(d.toUpdate ?? 0), unchanged: Number(d.unchanged ?? 0), withProblems: Number(d.withProblems ?? 0) };
};

/**
 * Starts the apply of a checked import: the same file (its SHA-256 is checked again when the run begins) with the options it was checked with.
 * The start is written to the activity log first, and an import whose entry cannot be written does not start.
 */
export async function applyImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "product_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "checked") return { ok: false, problem: "Check the file first." };
  const dry = dryCountsOf(job);
  if (dry.toCreate + dry.toUpdate + dry.unchanged === 0) return { ok: false, problem: "No product in this file can be imported. Fix the problems the check found, or choose other options and check it again." };
  try {
    await audit(member.account.id, member.store.id, "products.import_started", { job: job.id, format: job.format, file: job.inputName, products: job.rowsTotal, toCreate: dry.toCreate, toUpdate: dry.toUpdate }, { area: "products", target: { type: "data_job", id: job.id } });
  } catch (error) {
    console.error("[import] the start could not be written to the activity log", error);
    return { ok: false, problem: "The activity log could not be written, so the import was not started. Try again." };
  }
  const files = Number((job.cursor as { files?: unknown }).files ?? 0);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'queued', phase = 'apply', cursor = ${JSON.stringify({ next: 0, files })}::jsonb, counts = ${JSON.stringify({ ...EMPTY_COUNTS, dry })}::jsonb,
           rows_done = 0, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'product_import' and status = 'checked'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Check the file first." };
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The file of a run
// ---------------------------------------------------------------------------

type Loaded = { sha: string; file: NeutralFile; grouped: Grouped; extra: FileFinding[]; fileFindings: FileFinding[]; blocked: Finding | null; dup: Map<string, string> };
/** The file of a run, read from storage again at the start of EVERY run and held to the SHA-256 it was registered with: an apply is of the file that was checked. */
async function loadFile(job: DataJob, deps: DataDeps, ctx: ProductCsvContext, options: ImportOptions, env: PlanEnv): Promise<Loaded> {
  const storage = storageOf(deps);
  if (!storage || !job.inputPath) throw new StorageDown();
  const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath);
  if (!bytes) throw new StorageDown();
  if (sha256Of(bytes) !== job.inputSha256) throw new JobStopped("The file is not the one that was checked. Upload it again.");
  const read = readImportFile(bytes, ctx, options);
  if (!read.ok) throw new JobStopped(read.problems[0]);
  const fileFindings = [...read.extra, ...checkFile(read.file, read.grouped, env), ...read.grouped.findings];
  const loaded: Loaded = { sha: String(job.inputSha256), file: read.file, grouped: read.grouped, extra: read.extra, fileFindings, blocked: blockingFinding(fileFindings), dup: duplicateSkus(read.grouped.drafts) };
  return loaded;
}

type Prepared = { store: Store; editor: EditorContext; ctx: ProductCsvContext; options: ImportOptions; publish: Awaited<ReturnType<typeof publishContextFor>>; activeLocations: number };

async function prepare(job: DataJob): Promise<Prepared> {
  const store = await storeOf(job.storeId);
  if (!store) throw new JobStopped("The store could not be found.");
  const editor = await getEditorContext(store);
  const ctx = await csvContextFor(store, editor);
  const [locations] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_locations where store_id = ${store.id}::uuid and active`);
  return { store, editor, ctx, options: parseImportOptions(job.options), publish: await publishContextFor(editor), activeLocations: Number(locations?.n ?? 1) };
}

const envFor = (p: Prepared, own: ReadonlySet<string>, fetched?: ReadonlyMap<string, FetchedPicture | null>): PlanEnv => ({
  ctx: p.ctx,
  options: p.options,
  blank: { ...emptyProduct(p.editor), manufacturer: null },
  publish: p.publish,
  isOwnPicture: ownPictureTest(p.store.id, own),
  fetched,
  activeLocations: p.activeLocations,
});

/** What the store holds about the products a chunk of the file names: each by handle, who owns the SKUs and variant ids, and the store's own picture addresses. */
async function snapshotFor(p: Prepared, drafts: readonly ProductDraft[]): Promise<{ snapshot: StoreSnapshot; own: Set<string> }> {
  const keys = namedKeys({ drafts: [...drafts], findings: [] });
  const storeId = p.store.id;
  const found = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid and handle = any(${pgTextArray(keys.handles)}::text[])`);
  const stored = await inBatches(found, 6, (r) => loadStored(p.store, p.editor, p.ctx, String(r.id)));
  const products = new Map(stored.flatMap((s) => (s ? [[s.handle, s] as const] : [])));
  const skus = await db().execute<Row>(sql`
    select lower(v.sku) as sku, v.id, p.handle from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where v.store_id = ${storeId}::uuid and lower(v.sku) = any(${pgTextArray(keys.skus.map((s) => s.toLowerCase()))}::text[])
  `);
  const ids = await db().execute<Row>(sql`
    select v.id, p.handle from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where v.store_id = ${storeId}::uuid and v.id = any(${pgUuidArray(keys.variantIds)}::uuid[])
  `);
  const own = new Set<string>();
  for (const s of products.values()) {
    for (const m of s.media) {
      own.add(m.url);
      if (m.thumbnailUrl) own.add(m.thumbnailUrl);
    }
    for (const v of s.variants) if (v.image) own.add(v.image.url);
  }
  const wanted = drafts.flatMap((d) => [...d.pictures.map((x) => x.url), ...d.variants.map((v) => v.v.variant_image_url ?? "")]).filter((u) => u !== "");
  for (const url of await libraryAddresses(storeId, wanted)) own.add(url);
  return {
    snapshot: {
      products,
      skuOwners: new Map(skus.map((r) => [String(r.sku), { handle: String(r.handle), variantId: String(r.id) }])),
      variantOwners: new Map(ids.map((r) => [String(r.id), String(r.handle)])),
    },
    own,
  };
}

// ---------------------------------------------------------------------------
// The check: a dry run
// ---------------------------------------------------------------------------

type CheckCursor = { next: number; files: number; filesWritten: boolean; dry: { toCreate: number; toUpdate: number; unchanged: number; withProblems: number }; warnings: number; errors: number };

const checkCursor = (job: DataJob): CheckCursor => {
  const c = job.cursor as Partial<CheckCursor>;
  const d = (c.dry ?? {}) as Partial<CheckCursor["dry"]>;
  return { next: Number(c.next ?? 0), files: Number(c.files ?? 0), filesWritten: c.filesWritten === true, dry: { toCreate: Number(d.toCreate ?? 0), toUpdate: Number(d.toUpdate ?? 0), unchanged: Number(d.unchanged ?? 0), withProblems: Number(d.withProblems ?? 0) }, warnings: Number(c.warnings ?? 0), errors: Number(c.errors ?? 0) };
};

const fileItem = (seq: number, f: FileFinding): ItemInput => ({ seq, kind: "file", ref: null, rows: f.rows, outcome: "checked", messages: [f.finding], changes: {} });

/** One run of a dry run: plans the products chunk by chunk, writing an item for each and nothing to the catalogue. */
export async function runImportCheck(job: DataJob, deps: DataDeps, until: number): Promise<"checked" | "paused"> {
  const p = await prepare(job);
  const loaded = await loadFile(job, deps, p.ctx, p.options, envFor(p, new Set()));
  const cursor = checkCursor(job);
  const total = loaded.grouped.drafts.length;
  if (!cursor.filesWritten) {
    await putItems(job, loaded.fileFindings.map((f, i) => fileItem(i, f)));
    cursor.files = loaded.fileFindings.length;
    cursor.filesWritten = true;
    cursor.errors = loaded.fileFindings.filter((f) => f.finding.severity === "error").length;
    cursor.warnings = loaded.fileFindings.filter((f) => f.finding.severity === "warning").length;
    cursor.dry.withProblems = loaded.fileFindings.filter((f) => f.finding.severity === "error" && f.rows.length > 0).length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsTotal: total, rowsDone: cursor.next }))) return "paused";
  }
  while (cursor.next < total) {
    if (Date.now() >= until) return "paused";
    const drafts = loaded.grouped.drafts.slice(cursor.next, cursor.next + BULK_CHUNK);
    const { snapshot, own } = await snapshotFor(p, drafts);
    const items: ItemInput[] = [];
    drafts.forEach((draft, i) => {
      const plan = planProduct(draft, loaded.file, envFor(p, own), snapshot, { blocked: loaded.blocked, duplicateSku: loaded.dup.get(draft.handle) ?? null });
      const one = dryRunCounts([plan], []);
      cursor.dry.toCreate += one.toCreate;
      cursor.dry.toUpdate += one.toUpdate;
      cursor.dry.unchanged += one.unchanged;
      cursor.dry.withProblems += one.withProblems;
      for (const f of plan.findings) {
        if (f.severity === "error") cursor.errors += 1;
        if (f.severity === "warning") cursor.warnings += 1;
      }
      const item = itemOf(plan, true);
      items.push({ seq: cursor.files + cursor.next + i, kind: "product", ref: item.ref, rows: item.rows, outcome: "checked", messages: item.messages, changes: item.changes });
    });
    await putItems(job, items);
    cursor.next += drafts.length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsDone: cursor.next }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
  }
  const counts = { ...cursor.dry, dry: cursor.dry, warnings: cursor.warnings, errors: cursor.errors };
  const ended = await finishJob(job, { status: "checked", counts, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "check" });
  return ended ? "checked" : "paused";
}

// ---------------------------------------------------------------------------
// The apply
// ---------------------------------------------------------------------------

type ApplyCursor = { next: number; files: number };

const applyCursor = (job: DataJob): ApplyCursor => {
  const c = job.cursor as Partial<ApplyCursor>;
  return { next: Number(c.next ?? 0), files: Number(c.files ?? 0) };
};

/** The sentence of the editor for a product it could not save, with whatever a person typed taken out of it. */
const editorReason = (problem: string): string => problem.replace(/"[^"]*"/g, "…").replace(/\.+$/, "").slice(0, 200);

async function accountOf(accountId: string): Promise<Account> {
  const [row] = await db().execute<Row>(sql`select id, email, name from commerce.accounts where id = ${accountId}::uuid`);
  return { id: accountId, email: row ? String(row.email) : "", name: row?.name ? String(row.name) : null, platformAdmin: false };
}

/**
 * The ids of the categories and tags a plan needs that do not exist yet, made now. A term is looked for by name (and parent) in the store's
 * current terms first, so two products naming the same new category share one, and a resumed job makes none twice.
 */
async function ensureTerms(p: Prepared, account: Account, plan: ProductPlan): Promise<{ ids: Map<string, string>; created: number; problem: string | null }> {
  const ids = new Map<string, string>();
  let created = 0;
  const scope = { storeId: p.store.id, contentType: "product" } as const;
  let terms = await listTerms(scope);
  for (const term of plan.pendingTerms) {
    let parent: string | null = null;
    let id: string | null = null;
    for (let i = 0; i < term.path.length; i += 1) {
      const name = term.path[i];
      const found = terms.find((x) => x.kind === term.kind && (term.kind === "tag" || x.parentId === parent) && x.name.toLowerCase() === name.toLowerCase());
      if (found) id = found.id;
      else {
        const made = await createTerm(account, scope, { kind: term.kind, name, slug: "", parentId: term.kind === "tag" ? null : parent });
        if (!made.ok) return { ids, created, problem: editorReason(made.problems[0] ?? "A category could not be made.") };
        id = made.id;
        terms = made.terms;
        created += 1;
      }
      parent = id;
    }
    if (id) ids.set(pendingKey(term), id);
  }
  return { ids, created, problem: null };
}

const defaultFetchPicture: NonNullable<DataDeps["fetchPicture"]> = async (url) => {
  const got = await safeFetch(url, { maxBytes: IMPORT_PICTURE_MAX_BYTES, timeoutMs: 15_000, accept: "image/*" });
  if (!got.ok) return { ok: false, problem: got.problem };
  if (!(IMPORT_PICTURE_TYPES as readonly string[]).includes(got.contentType)) return { ok: false, problem: "That address is not a picture that can be used." };
  return { ok: true, bytes: got.bytes, contentType: got.contentType };
};

/** The name a fetched picture gets in the library, from its address. */
const pictureName = (url: string): string => {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "picture");
    return `${safeName(last.replace(/\.[A-Za-z0-9]{1,5}$/, ""), "picture")}.webp`;
  } catch {
    return "picture.webp";
  }
};

/** Fetches, shrinks (a 1,600 px WebP and a 480 px copy) and keeps one picture in the library. */
async function fetchOne(job: DataJob, url: string, deps: DataDeps): Promise<{ ok: true; url: string; thumbnailUrl: string } | { ok: false; reason: string }> {
  const got = await (deps.fetchPicture ?? defaultFetchPicture)(url);
  if (!got.ok) return { ok: false, reason: got.problem };
  let image: Buffer;
  let thumb: Buffer;
  try {
    const source = sharp(got.bytes, { failOn: "none", animated: false }).rotate();
    image = await source.clone().resize({ width: IMPORT_PICTURE_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    thumb = await source.clone().resize({ width: IMPORT_THUMBNAIL_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    return { ok: false, reason: "That address is not a picture that can be used." };
  }
  const name = pictureName(url);
  const stored = await (deps.storePicture ?? storeLibraryPicture)(
    { storeId: job.storeId, accountId: job.requestedBy },
    new File([new Uint8Array(image)], name, { type: "image/webp" }),
    new File([new Uint8Array(thumb)], name, { type: "image/webp" }),
    { fileName: name },
  );
  return stored.ok ? { ok: true, url: stored.url, thumbnailUrl: stored.thumbnailUrl } : { ok: false, reason: stored.problem };
}

/** Pictures a product names that the store does not have: each fetched once per job (a resumed job reads the answer back), `null` for one that failed. */
async function fetchPictures(job: DataJob, urls: readonly string[], deps: DataDeps): Promise<{ fetched: Map<string, FetchedPicture | null>; newlyFetched: number }> {
  const done = await assetsOf(job, urls);
  const fetched = new Map<string, FetchedPicture | null>();
  let newlyFetched = 0;
  for (const url of urls) {
    const known = done.get(url);
    if (known) {
      fetched.set(url, known.libraryUrl ? { url: known.libraryUrl, thumbnailUrl: await thumbnailOf(job.storeId, known.libraryUrl) } : null);
      continue;
    }
    const result = await fetchOne(job, url, deps);
    if (result.ok) {
      await putAsset(job, url, { libraryUrl: result.url });
      fetched.set(url, { url: result.url, thumbnailUrl: result.thumbnailUrl });
      newlyFetched += 1;
    } else {
      await putAsset(job, url, { reason: result.reason });
      fetched.set(url, null);
    }
  }
  return { fetched, newlyFetched };
}

async function thumbnailOf(storeId: string, url: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select thumbnail_url from commerce.media where store_id = ${storeId}::uuid and url = ${url}`);
  return row?.thumbnail_url ? String(row.thumbnail_url) : null;
}

type Written = { item: ItemInput; summary: ItemSummary; wrote: boolean };

/**
 * One product written. The slow work comes first and writes nothing to the product: the pictures a plan names are fetched (seconds each) and the
 * categories made. Only then is the store read AGAIN and the product planned a second time from that fresh state, which `saveProduct()` writes at
 * once, so what was sold, priced or edited while a picture was fetched is not written over (D165 review: a 3-unit sale paid during the fetch used to
 * be put back on the shelf). A variant whose stock the file does not change is left alone (`StockMode`), so even the milliseconds between the read
 * and the save cannot lose a sale unless the file itself sets that variant's stock.
 */
async function applyProduct(job: DataJob, p: Prepared, account: Account, loaded: Loaded, draft: ProductDraft, seq: number, deps: DataDeps): Promise<Written> {
  const first = await snapshotFor(p, [draft]);
  const extra = { blocked: loaded.blocked, duplicateSku: loaded.dup.get(draft.handle) ?? null };
  let plan = planProduct(draft, loaded.file, envFor(p, first.own), first.snapshot, extra);
  let newlyFetched = 0;
  let fetched: Map<string, FetchedPicture | null> | undefined;
  if (plan.input && plan.pictures.length > 0) {
    const got = await fetchPictures(job, plan.pictures, deps);
    newlyFetched = got.newlyFetched;
    fetched = got.fetched;
  }
  let termsCreated = 0;
  let outcome: ItemInput["outcome"] = plan.outcome;
  let messages = [...plan.findings];
  let wrote = false;
  if (plan.input) {
    const made = await ensureTerms(p, account, plan);
    termsCreated = made.created;
    if (made.problem) {
      outcome = "failed";
      messages.push(finding("save.failed", { handle: draft.handle, reason: made.problem }));
    } else {
      // The state now, read just before the write (not the one the pictures were chosen from).
      const now = await snapshotFor(p, [draft]);
      plan = planProduct(draft, loaded.file, envFor(p, now.own, fetched), now.snapshot, extra);
      outcome = plan.outcome;
      messages = [...plan.findings];
      if (plan.input) {
        plan = withCreatedTerms(plan, made.ids);
        const stored = now.snapshot.products.get(draft.handle) ?? null;
        const existing = stored?.id ?? null;
        const stockMode: StockMode = { loaded: new Map((stored?.variants ?? []).flatMap((v) => (v.id ? [[v.id, v.stock] as const] : []))), source: "file", accountId: job.requestedBy, jobId: job.id };
        const saved = await saveProduct(p.store, p.editor, existing, plan.input as NonNullable<ProductPlan["input"]>, plan.fields, plan.variantFields, undefined, stockMode);
        if (!saved.ok) {
          outcome = "failed";
          messages.push(finding("save.failed", { handle: draft.handle, reason: editorReason(saved.problems[0] ?? "The product could not be saved.") }));
        } else {
          wrote = true;
          // The editor's save makes an archived product a draft: archive it again when the file says archived.
          if (plan.archiveAfter) await setArchived(p.store, saved.productId, true);
        }
      }
    }
  }
  const changes = { prices: outcome === "failed" ? 0 : plan.changes.prices, fields: plan.changes.fields, stock: plan.changes.stock, pictures: newlyFetched, terms: termsCreated };
  return {
    wrote,
    summary: { outcome, messages, changes },
    item: { seq, kind: "product", ref: draft.handle, rows: draft.rows, outcome, messages, changes },
  };
}

/** One run of an apply: chunks of products, each product in its own transaction, the items and counts saved after each chunk. */
export async function runImportApply(job: DataJob, deps: DataDeps, until: number): Promise<"done" | "paused"> {
  const p = await prepare(job);
  const loaded = await loadFile(job, deps, p.ctx, p.options, envFor(p, new Set()));
  const cursor = applyCursor(job);
  const total = loaded.grouped.drafts.length;
  const account = await accountOf(job.requestedBy);
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  let counts: JobCounts = { ...EMPTY_COUNTS, ...(Object.fromEntries(Object.entries(job.counts).filter(([k]) => k in EMPTY_COUNTS)) as Partial<JobCounts>) };
  let processed = 0;
  let wroteAny = false;
  try {
    while (cursor.next < total) {
      if (Date.now() >= until) return "paused";
      const drafts = loaded.grouped.drafts.slice(cursor.next, cursor.next + BULK_CHUNK);
      const items: ItemInput[] = [];
      const summaries: ItemSummary[] = [];
      for (let i = 0; i < drafts.length; i += 1) {
        const written = await applyProduct(job, p, account, loaded, drafts[i], cursor.files + cursor.next + i, deps);
        items.push(written.item);
        summaries.push(written.summary);
        wroteAny ||= written.wrote;
        processed += 1;
        // A test's way of killing a run in the middle of a chunk: what was written stays written, nothing of the chunk is recorded.
        if (deps.stopAfter !== undefined && processed >= deps.stopAfter) throw new Error("the run was stopped (test)");
      }
      await putItems(job, items);
      const add = summariseCounts(summaries);
      counts = Object.fromEntries(Object.keys(EMPTY_COUNTS).map((k) => [k, (counts as Record<string, number>)[k] + (add as Record<string, number>)[k]])) as JobCounts;
      cursor.next += drafts.length;
      // The catalogue and fields caches, once per chunk, from a place with no action's context.
      if (wroteAny) {
        refreshTag(catalogTag(p.store.id));
        refreshTag(fieldsTag(p.store.id));
      }
      if (!(await saveProgress(job, { cursor: { ...cursor }, counts: { ...counts, dry }, rowsDone: cursor.next, rowsTotal: total }))) return "paused";
      if (!(await stillRunning(job))) return "paused";
    }
  } finally {
    // Search by meaning finds the products as written, without waiting for the five-minute job (D74); never stops the import.
    if (wroteAny) await refreshStoreEmbeddings(p.store.id).catch(() => undefined);
  }
  const ended = await finishJob(job, { status: "done", counts: { ...counts, dry }, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "apply", keepDays: 30 });
  if (!ended) return "paused";
  await audit(job.requestedBy, job.storeId, "products.import_applied", { job: job.id, format: job.format, file: job.inputName, ...counts }, { area: "products", target: { type: "data_job", id: job.id } }).catch((error) => console.error("[import] the end could not be written to the activity log", error));
  return "done";
}

/** A job that could not go on: failed with a plain reason, never a quoted cell. */
export const stopImport = failJob;
export { releaseJob };
