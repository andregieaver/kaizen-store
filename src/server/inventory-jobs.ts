import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isDialect, parseCsv, unescapeText, writeCsv, type Cell, type DialectId } from "@/lib/csv";
import { EMPTY_COUNTS, finding, summariseCounts, type Finding, type ItemOutcome, type ItemSummary, type JobCounts } from "@/lib/data-job";
import { IMPORT_MAX_BYTES, INVENTORY_APPLY_CHUNK } from "@/lib/data-limits";
import {
  EXPORT_COLUMNS,
  checkHeader,
  decideRow,
  duplicateFlags,
  inventoryExportCells,
  parseInventoryRow,
  readHeader,
  tooManyRows,
  type ExportRow,
  type HeaderIndex,
  type LocationRef,
  type ParsedRow,
} from "@/lib/inventory-csv";
import { policyProblem, type StockPolicy } from "@/lib/inventory";
import type { FileFinding } from "@/lib/product-csv";
import { variantLabel } from "@/lib/product-input";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { JobStopped, type ExportReader } from "./data-export-run";
import {
  IMPORTS_BUCKET,
  getJob,
  importPathPattern,
  listItems,
  putItems,
  safeName,
  saveProgress,
  finishJob,
  scheduleJob,
  sha256Of,
  stillRunning,
  StorageDown,
  storageOf,
  type DataDeps,
  type DataJob,
  type ItemInput,
} from "./data-job-store";
import { NO_ACCESS, memberCan } from "./permissions";
import { pgTextArray, pgUuidArray } from "./pg-arrays";
import { refreshTag } from "./refresh";
import { withStockContext } from "./stock-context";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Stock by file (wave 3, D172, `docs/wave-3-inventory.md` 2.4): two kinds of the D165 jobs (`inventory_export`, `inventory_import`) on the same pipeline,
 * never a second one. The export is one row per active goods variant and active location. The import is a COUNT: `sku`, `location` and `on_hand` (the
 * figure counted), optionally `on_hand_was` (the figure the file was made from: a row whose stored figure is not that one is a CONFLICT and is skipped,
 * because a sale since makes the count stale), a `reason` (default `count`), a `note`, and the policy and warning level. The dry run reads every row and
 * writes nothing; the apply writes each row as one movement with `source = 'file'` and the job's id, each row on its own transaction and judged again
 * at the moment it is written. It never creates a variant, a location or a product, never deletes anything and never writes a negative figure. A finding
 * names a SKU or a column and never quotes a cell. One audit entry when it starts and one when it ends, counts only. `products:write`.
 */

const WRITE = "products:write" as const;

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

export type InventoryExportOptions = { dialect: DialectId };

const exportSchema = z.object({ dialect: z.string().default("standard") });

/** The options a form or a job holds, checked. */
export function parseInventoryExportOptions(raw: unknown): { ok: true; options: InventoryExportOptions } | { ok: false; problem: string } {
  const parsed = exportSchema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) return { ok: false, problem: "The choices for the export could not be read." };
  if (!isDialect(parsed.data.dialect)) return { ok: false, problem: "Choose a file format." };
  return { ok: true, options: { dialect: parsed.data.dialect } };
}

/** The variants a stock file lists: active goods that are shipped, of an active or draft product (the Inventory page's list). */
const LISTED = (storeId: string) => sql`
  v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.kind = 'goods' and p.status in ('active', 'draft')
`;

/** The rows the file will have (a variant at each active location), for the choice between a download and a job and for the limit. */
export async function countInventoryExportRows(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select (select count(*) from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id where ${LISTED(storeId)})
         * (select count(*) from commerce.inventory_locations where store_id = ${storeId}::uuid and active) as n
  `);
  return Number(row?.n ?? 0);
}

/** The variants of the file, for progress. */
async function countVariants(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id where ${LISTED(storeId)}`);
  return Number(row?.n ?? 0);
}

/**
 * The reader of a stock export: a batch of variants after a keyset position (handle, SKU, id), each written once per active location in rank order
 * with what the location holds (on hand, held by checkouts in progress, what is left). A location that is not active is not in the file.
 */
export async function inventoryExportReader(store: Pick<Store, "id" | "localization">, options: InventoryExportOptions): Promise<ExportReader> {
  const storeId = store.id;
  const locale = store.localization.locales[0] ?? "en";
  return {
    header: [...EXPORT_COLUMNS],
    dialect: options.dialect,
    fileBase: "stock",
    total: () => countVariants(storeId),
    async read(position, limit) {
      const after = Array.isArray(position) && position.length === 3 && position.every((x) => typeof x === "string") ? (position as [string, string, string]) : null;
      const variants = await db().execute<Row>(sql`
        select v.id, v.sku, v.options, v.stock_policy, v.backorder_days, v.low_stock_threshold, p.handle,
               coalesce(tl.title, tf.title, p.handle) as title
        from commerce.product_variants v
        join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
        left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
        left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
        where ${LISTED(storeId)}
          ${after ? sql`and (p.handle, v.sku, v.id) > (${after[0]}, ${after[1]}, ${after[2]}::uuid)` : sql``}
        order by p.handle, v.sku, v.id
        limit ${limit + 1}
      `);
      const batch = variants.slice(0, limit);
      const ids = batch.map((v) => String(v.id));
      const places = await db().execute<Row>(sql`
        select id, name from commerce.inventory_locations where store_id = ${storeId}::uuid and active order by priority, created_at, id
      `);
      const cells = ids.length
        ? await db().execute<Row>(sql`
            select l.variant_id, l.location_id, l.on_hand,
                   coalesce((select sum(r.quantity)::int from commerce.inventory_reservations r
                              where r.store_id = l.store_id and r.variant_id = l.variant_id and r.location_id = l.location_id
                                and r.released_at is null and r.expires_at > now()), 0) as held
            from commerce.inventory_levels l
            where l.store_id = ${storeId}::uuid and l.variant_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          `)
        : [];
      const at = new Map(cells.map((c) => [`${c.variant_id}:${c.location_id}`, { onHand: Number(c.on_hand), held: Number(c.held) }]));
      const rows: Cell[][] = [];
      for (const v of batch) {
        for (const place of places) {
          const level = at.get(`${v.id}:${place.id}`) ?? { onHand: 0, held: 0 };
          const row: ExportRow = {
            sku: String(v.sku),
            product: String(v.title),
            options: variantLabel((v.options ?? {}) as Record<string, string>),
            location: String(place.name),
            onHand: level.onHand,
            committed: level.held,
            available: level.onHand - level.held,
            stockPolicy: v.stock_policy === "continue" ? "continue" : "deny",
            backorderDays: v.backorder_days === null ? null : Number(v.backorder_days),
            lowStockThreshold: v.low_stock_threshold === null ? null : Number(v.low_stock_threshold),
          };
          rows.push(inventoryExportCells(row));
        }
      }
      const last = batch.at(-1);
      return { rows, position: last ? [String(last.handle), String(last.sku), String(last.id)] : after, more: variants.length > limit, units: batch.length };
    },
  };
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

type FileRow = { row: number; cells: string[] };
type ReadFile = { ok: true; index: HeaderIndex; rows: FileRow[]; findings: FileFinding[] } | { ok: false; problems: string[] };

/**
 * A file's bytes into rows, or why it is refused: empty, over the size or the row limit, ending inside a quoted cell, or without the `sku` and `on_hand`
 * columns (`file.not_inventory`, naming them). Blank lines are not rows. A row with another number of cells than the header is a warning (the first 50).
 */
export function readInventoryFile(bytes: Uint8Array): ReadFile {
  if (bytes.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, problems: [finding("file.too_large", { max: Math.floor(IMPORT_MAX_BYTES / 1024 / 1024) }).text] };
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problems: ["The file ends inside a quoted cell. Check the quotes and try again."] };
  if (parsed.rows.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  const index = readHeader(parsed.rows[0]);
  const refused = checkHeader(index);
  if (refused) return { ok: false, problems: [refused.text] };
  const many = tooManyRows(parsed.rows.length - 1);
  if (many) return { ok: false, problems: [many.text] };
  const findings: FileFinding[] = [];
  if (parsed.assumed) findings.push({ rows: [], finding: finding("file.encoding_assumed") });
  for (const row of parsed.ragged.slice(0, 50)) findings.push({ rows: [row], finding: finding("file.ragged_row") });
  const rows: FileRow[] = [];
  parsed.rows.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return;
    rows.push({ row: i + 2, cells });
  });
  return { ok: true, index, rows, findings };
}

// ---------------------------------------------------------------------------
// Upload and register
// ---------------------------------------------------------------------------

export type UploadStart = { ok: true; path: string; token: string; bucket: typeof IMPORTS_BUCKET } | { ok: false; problem: string };

/** A signed upload for the browser: one new path in the store's folder of the private imports bucket. */
export async function startInventoryUpload(member: Membership, fileName: string, deps: DataDeps = {}): Promise<UploadStart> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Uploads are not set up on this server." };
  const path = `${member.store.id}/${randomUUID()}/${safeName(fileName, "stock.csv")}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, problem: "The upload could not be started. Try again." };
  return { ok: true, path, token: started.token, bucket: IMPORTS_BUCKET };
}

export type RegisterResult = { ok: true; jobId: string; rows: number } | { ok: false; problems: string[] };

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const shownName = (name: string): string => name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "stock.csv";

/** Registers a file the browser uploaded: read, refused with a sentence (and removed), or kept as a job in `uploaded` with its SHA-256. One stock import is open per store. */
export async function registerInventoryImport(member: Membership, input: { path: string; name: string }, deps: DataDeps = {}): Promise<RegisterResult> {
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
  const read = readInventoryFile(bytes);
  if (!read.ok) return refuse(read.problems);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, rows_total)
      values (${storeId}::uuid, 'inventory_import', 'uploaded', 'kaizen', ${member.account.id}::uuid, ${input.path}, ${shownName(input.name)}, ${bytes.length}, ${sha256Of(bytes)}, ${read.rows.length})
      returning id
    `);
    return { ok: true, jobId: String(row.id), rows: read.rows.length };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return refuse(["Another stock import is open for this store. Finish it or cancel it first."]);
  }
}

// ---------------------------------------------------------------------------
// Check and apply: starting them
// ---------------------------------------------------------------------------

export type StepResult = { ok: true } | { ok: false; problem: string };

/** Starts (or restarts) the dry run of an uploaded or checked stock import: it writes no stock. */
export async function checkInventoryImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "inventory_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "uploaded" && job.status !== "checked") return { ok: false, problem: job.status === "checking" ? "The file is being checked." : "This import can no longer be checked." };
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'checking', phase = 'check', options = '{}'::jsonb, cursor = '{}'::jsonb, counts = '{}'::jsonb,
           rows_done = null, rows_total = null, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'inventory_import' and status in ('uploaded', 'checked')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This import can no longer be checked." };
  await db().execute(sql`delete from commerce.data_job_items where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

export type InventoryDry = { toUpdate: number; unchanged: number; conflicts: number; withProblems: number };

/** The numbers a checked job shows before it is applied. */
export const inventoryDryCountsOf = (job: Pick<DataJob, "counts">): InventoryDry => {
  const d = (job.counts.dry ?? {}) as Record<string, unknown>;
  return { toUpdate: Number(d.toUpdate ?? 0), unchanged: Number(d.unchanged ?? 0), conflicts: Number(d.conflicts ?? 0), withProblems: Number(d.withProblems ?? 0) };
};

/**
 * Starts the apply of a checked import: the same file (its SHA-256 is checked again when the run begins). The start is written to the activity log first
 * (`products.inventory_import_started`: counts and the job, never a SKU), and an import whose entry cannot be written does not start.
 */
export async function applyInventoryImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "inventory_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "checked") return { ok: false, problem: "Check the file first." };
  const dry = inventoryDryCountsOf(job);
  if (dry.toUpdate + dry.unchanged === 0) return { ok: false, problem: "No row of this file can be imported. Fix the problems the check found and check it again." };
  try {
    await audit(member.account.id, member.store.id, "products.inventory_import_started", { job: job.id, rows: job.rowsTotal, toUpdate: dry.toUpdate, conflicts: dry.conflicts }, { area: "products", target: { type: "data_job", id: job.id } });
  } catch (error) {
    console.error("[inventory-jobs] the start could not be written to the activity log", error);
    return { ok: false, problem: "The activity log could not be written, so the import was not started. Try again." };
  }
  const files = Number((job.cursor as { files?: unknown }).files ?? 0);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'queued', phase = 'apply', cursor = ${JSON.stringify({ next: 0, files })}::jsonb, counts = ${JSON.stringify({ ...EMPTY_COUNTS, dry })}::jsonb,
           rows_done = 0, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'inventory_import' and status = 'checked'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Check the file first." };
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Judging a row
// ---------------------------------------------------------------------------

type Prepared = {
  store: { id: string };
  index: HeaderIndex;
  rows: FileRow[];
  fileFindings: FileFinding[];
  locations: LocationRef[];
  /** Per row: the parsed row (or null) and the findings the pure parser made. */
  parsed: { row: ParsedRow | null; findings: Finding[] }[];
  duplicates: boolean[];
};

async function locationsOf(storeId: string): Promise<LocationRef[]> {
  const rows = await db().execute<Row>(sql`select id, name, active from commerce.inventory_locations where store_id = ${storeId}::uuid order by active desc, priority, created_at, id`);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), active: Boolean(r.active) }));
}

/** The file of a run, read from storage again at the start of EVERY run and held to the SHA-256 it was registered with: an apply is of the file that was checked. */
async function prepare(job: DataJob, deps: DataDeps): Promise<Prepared> {
  const storage = storageOf(deps);
  if (!storage || !job.inputPath) throw new StorageDown();
  const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath);
  if (!bytes) throw new StorageDown();
  if (sha256Of(bytes) !== job.inputSha256) throw new JobStopped("The file is not the one that was checked. Upload it again.");
  const read = readInventoryFile(bytes);
  if (!read.ok) throw new JobStopped(read.problems[0]);
  const locations = await locationsOf(job.storeId);
  const parsed = read.rows.map((r) => parseInventoryRow(r.cells, read.index, locations));
  return { store: { id: job.storeId }, index: read.index, rows: read.rows, fileFindings: read.findings, locations, parsed, duplicates: duplicateFlags(parsed.map((p) => p.row)) };
}

type Variant = { id: string; sku: string; delivery: string; policy: StockPolicy; days: number | null; threshold: number | null };

/** The store's variants by SKU for a chunk of rows: exact first, else the one variant whose SKU matches in lower case. */
async function variantsFor(storeId: string, skus: readonly string[]): Promise<Map<string, Variant>> {
  const out = new Map<string, Variant>();
  if (skus.length === 0) return out;
  const wanted = [...new Set(skus.map((s) => s.toLowerCase()))];
  const rows = await db().execute<Row>(sql`
    select id, sku, delivery::text as delivery, stock_policy, backorder_days, low_stock_threshold from commerce.product_variants
    where store_id = ${storeId}::uuid and lower(sku) = any(${pgTextArray(wanted)}::text[])
  `);
  const byLower = new Map<string, Row[]>();
  for (const r of rows) byLower.set(String(r.sku).toLowerCase(), [...(byLower.get(String(r.sku).toLowerCase()) ?? []), r]);
  for (const sku of skus) {
    const options = byLower.get(sku.toLowerCase()) ?? [];
    const found = options.find((r) => String(r.sku) === sku) ?? (options.length === 1 ? options[0] : undefined);
    if (found) {
      out.set(sku, {
        id: String(found.id),
        sku: String(found.sku),
        delivery: String(found.delivery),
        policy: found.stock_policy === "continue" ? "continue" : "deny",
        days: found.backorder_days === null ? null : Number(found.backorder_days),
        threshold: found.low_stock_threshold === null ? null : Number(found.low_stock_threshold),
      });
    }
  }
  return out;
}

/** What the file asks of a variant's policy and level, laid over what it has now: the policy, its days (always stated with `continue`) and the warning level. */
function policyAfter(row: ParsedRow, v: Variant): { stockPolicy: StockPolicy; backorderDays: number | null; lowStockThreshold: number | null } {
  const stockPolicy = row.stockPolicy ?? v.policy;
  const backorderDays = row.stockPolicy === null ? v.days : stockPolicy === "continue" ? row.backorderDays : null;
  return { stockPolicy, backorderDays, lowStockThreshold: row.lowStockThreshold ?? v.threshold };
}

type Judged = {
  /** The item's findings (errors make the row skipped). */
  findings: Finding[];
  /** What an apply would do with the row; `skip` when a finding stops it. */
  action: "skip" | "unchanged" | "update" | "conflict";
  variant: Variant | null;
  row: ParsedRow | null;
  /** The SKU the row names (as the file typed it, trimmed), for a row that could not be read too; null when the cell is empty. */
  ref: string | null;
  current: number;
  location: string;
};

/** Judges a chunk of rows against the store as it is now: the parser's findings, the duplicate, the SKU, the figure under the row. */
async function judge(p: Prepared, at: number, count: number): Promise<Judged[]> {
  const slice = p.parsed.slice(at, at + count);
  const skus = slice.flatMap((x) => (x.row ? [x.row.sku] : []));
  const variants = await variantsFor(p.store.id, skus);
  const wanted = slice.flatMap((x) => (x.row && variants.get(x.row.sku) ? [{ v: variants.get(x.row.sku)!.id, l: x.row.locationId }] : []));
  const levels = new Map<string, number>();
  if (wanted.length > 0) {
    const rows = await db().execute<Row>(sql`
      select variant_id, location_id, on_hand from commerce.inventory_levels
      where store_id = ${p.store.id}::uuid and variant_id = any(${pgUuidArray([...new Set(wanted.map((w) => w.v))])}::uuid[])
    `);
    for (const r of rows) levels.set(`${r.variant_id}:${r.location_id}`, Number(r.on_hand));
  }
  const nameOf = new Map(p.locations.map((l) => [l.id, l.name]));
  return slice.map((x, i): Judged => {
    const findings = [...x.findings];
    const duplicate = p.duplicates[at + i];
    const row = x.row;
    const typed = unescapeText(p.rows[at + i].cells[p.index.sku] ?? "").trim();
    const ref = row?.sku ?? (typed === "" ? null : typed.slice(0, 120));
    const skip = (extra?: Finding): Judged => ({ findings: extra ? [...findings, extra] : findings, action: "skip", variant: null, row, ref, current: 0, location: row ? (nameOf.get(row.locationId) ?? "") : "" });
    if (!row) return skip();
    if (duplicate) return skip(finding("stockfile.duplicate", { sku: row.sku }));
    const v = variants.get(row.sku);
    if (!v) return skip(finding("stockfile.sku_unknown", { sku: row.sku }));
    if (v.delivery !== "physical") return skip(finding("stockfile.sku_not_goods", { sku: row.sku }));
    const next = policyAfter(row, v);
    const problem = policyProblem(next, "physical");
    if (problem) return skip(finding("stockfile.failed", { sku: row.sku, reason: problem }));
    const current = levels.get(`${v.id}:${row.locationId}`) ?? 0;
    const decision = decideRow(row, current);
    const policyChanged = next.stockPolicy !== v.policy || next.backorderDays !== v.days || next.lowStockThreshold !== v.threshold;
    const location = nameOf.get(row.locationId) ?? "";
    if (decision.kind === "conflict") return { findings: [...findings, finding("stockfile.conflict", { sku: row.sku, was: decision.was, now: decision.now })], action: "conflict", variant: v, row, ref, current, location };
    return { findings, ref, action: decision.kind === "unchanged" && !policyChanged ? "unchanged" : "update", variant: v, row, current, location };
  });
}

const hasError = (findings: readonly Finding[]) => findings.some((f) => f.severity === "error");

/** A judged row as the item the page lists: its SKU, its rows, the figures and what an apply will do. Findings only; never a cell. */
function itemOf(seq: number, rowNumber: number, j: Judged, dry: boolean): ItemInput {
  const will = j.action === "update" ? "update" : j.action === "unchanged" ? "unchanged" : j.action === "conflict" ? "conflict" : "skip";
  const figures = j.row && j.variant ? { location: j.location, current: j.current, next: j.action === "update" || j.action === "unchanged" ? j.row.onHand : j.current, change: j.action === "update" ? j.row.onHand - j.current : 0 } : {};
  const outcome: ItemOutcome = dry ? "checked" : j.action === "update" ? "updated" : j.action === "unchanged" ? "unchanged" : "skipped";
  return { seq, kind: "stock", ref: j.ref, rows: [rowNumber], outcome: hasError(j.findings) && !dry ? "failed" : outcome, messages: j.findings, changes: { will, ...figures } };
}

// ---------------------------------------------------------------------------
// The check: a dry run
// ---------------------------------------------------------------------------

type CheckCursor = { next: number; files: number; filesWritten: boolean; dry: InventoryDry; warnings: number; errors: number };

const checkCursor = (job: DataJob): CheckCursor => {
  const c = job.cursor as Partial<CheckCursor>;
  const d = (c.dry ?? {}) as Partial<InventoryDry>;
  return {
    next: Number(c.next ?? 0),
    files: Number(c.files ?? 0),
    filesWritten: c.filesWritten === true,
    dry: { toUpdate: Number(d.toUpdate ?? 0), unchanged: Number(d.unchanged ?? 0), conflicts: Number(d.conflicts ?? 0), withProblems: Number(d.withProblems ?? 0) },
    warnings: Number(c.warnings ?? 0),
    errors: Number(c.errors ?? 0),
  };
};

const chunkOf = (deps: DataDeps): number => Math.max(1, deps.chunkRows ?? INVENTORY_APPLY_CHUNK);

/** One run of a dry run: judges the rows chunk by chunk, writing an item for each and no stock. A run that stops goes on where the cursor is. */
export async function runInventoryCheck(job: DataJob, deps: DataDeps, until: number): Promise<"checked" | "paused"> {
  const p = await prepare(job, deps);
  const cursor = checkCursor(job);
  const total = p.rows.length;
  if (!cursor.filesWritten) {
    await putItems(job, p.fileFindings.map((f, i): ItemInput => ({ seq: i, kind: "file", ref: null, rows: f.rows, outcome: "checked", messages: [f.finding], changes: {} })));
    cursor.files = p.fileFindings.length;
    cursor.filesWritten = true;
    cursor.errors = p.fileFindings.filter((f) => f.finding.severity === "error").length;
    cursor.warnings = p.fileFindings.filter((f) => f.finding.severity === "warning").length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsTotal: total, rowsDone: cursor.next }))) return "paused";
  }
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) return "paused";
    const judged = await judge(p, cursor.next, size);
    const items = judged.map((j, i) => {
      for (const f of j.findings) {
        if (f.severity === "error") cursor.errors += 1;
        if (f.severity === "warning") cursor.warnings += 1;
      }
      if (j.action === "update") cursor.dry.toUpdate += 1;
      else if (j.action === "unchanged") cursor.dry.unchanged += 1;
      else if (j.action === "conflict") cursor.dry.conflicts += 1;
      else cursor.dry.withProblems += 1;
      return itemOf(cursor.files + cursor.next + i, p.rows[cursor.next + i].row, j, true);
    });
    await putItems(job, items);
    cursor.next += judged.length;
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

/**
 * One row, on its own transaction: the level row locked, the figure compared with the one the file was made from, written as one movement with the
 * job's id (and the policy and warning level, when the file states them). Judged again here, not trusted from the dry run: a sale since is a conflict.
 */
async function writeRow(job: DataJob, p: Prepared, i: number): Promise<Judged> {
  const [first] = await judge(p, i, 1);
  if (first.action === "skip" || first.action === "conflict" || !first.row || !first.variant) return first;
  const { row, variant } = first;
  try {
    return await db().transaction(async (tx): Promise<Judged> => {
      const [level] = await tx.execute<Row>(sql`
        select on_hand from commerce.inventory_levels
        where store_id = ${job.storeId}::uuid and variant_id = ${variant.id}::uuid and location_id = ${row.locationId}::uuid for update
      `);
      const now = level ? Number(level.on_hand) : 0;
      const decision = decideRow(row, now);
      if (decision.kind === "conflict") return { ...first, action: "conflict", current: now, findings: [...first.findings, finding("stockfile.conflict", { sku: row.sku, was: decision.was, now: decision.now })] };
      if (decision.kind === "change") {
        await withStockContext(tx, { reason: row.reason, source: "file", accountId: job.requestedBy, jobId: job.id, note: row.note }, () =>
          tx.execute(sql`
            insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
            values (${job.storeId}::uuid, ${variant.id}::uuid, ${row.locationId}::uuid, ${row.onHand})
            on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
          `),
        );
      }
      const next = policyAfter(row, variant);
      if (next.stockPolicy !== variant.policy || next.backorderDays !== variant.days || next.lowStockThreshold !== variant.threshold) {
        await tx.execute(sql`
          update commerce.product_variants
             set stock_policy = ${next.stockPolicy}, backorder_days = ${next.backorderDays}, low_stock_threshold = ${next.lowStockThreshold}
           where store_id = ${job.storeId}::uuid and id = ${variant.id}::uuid
        `);
      }
      return { ...first, action: decision.kind === "change" || first.action === "update" ? "update" : "unchanged", current: now };
    });
  } catch (error) {
    console.error("[inventory-jobs] a row could not be saved", error);
    return { ...first, action: "skip", findings: [...first.findings, finding("stockfile.failed", { sku: row.sku })] };
  }
}

/** One run of an apply: row by row (a row is its own transaction), the items and counts saved after each chunk, the cursor kept so a run that was killed goes on where it was. */
export async function runInventoryApply(job: DataJob, deps: DataDeps, until: number): Promise<"done" | "paused"> {
  const p = await prepare(job, deps);
  const cursor = applyCursor(job);
  const total = p.rows.length;
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  let counts: JobCounts = { ...EMPTY_COUNTS, ...(Object.fromEntries(Object.entries(job.counts).filter(([k]) => k in EMPTY_COUNTS)) as Partial<JobCounts>) };
  let processed = 0;
  let wrote = false;
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) break;
    const end = Math.min(cursor.next + size, total);
    const items: ItemInput[] = [];
    const summaries: ItemSummary[] = [];
    for (let i = cursor.next; i < end; i += 1) {
      const j = await writeRow(job, p, i);
      if (j.action === "update") wrote = true;
      summaries.push({ outcome: j.action === "update" ? "updated" : j.action === "unchanged" ? "unchanged" : hasError(j.findings) ? "failed" : "skipped", messages: j.findings });
      items.push(itemOf(cursor.files + i, p.rows[i].row, j, false));
      processed += 1;
      // A test's way of killing a run in the middle of a chunk.
      if (deps.stopAfter !== undefined && processed >= deps.stopAfter) throw new Error("the run was stopped (test)");
    }
    await putItems(job, items);
    const add = summariseCounts(summaries);
    counts = Object.fromEntries(Object.keys(EMPTY_COUNTS).map((k) => [k, (counts as Record<string, number>)[k] + (add as Record<string, number>)[k]])) as JobCounts;
    cursor.next = end;
    if (!(await saveProgress(job, { cursor: { ...cursor }, counts: { ...counts, dry }, rowsDone: cursor.next, rowsTotal: total }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
  }
  if (wrote) refreshTag(catalogTag(job.storeId));
  if (cursor.next < total) return "paused";
  const ended = await finishJob(job, { status: "done", counts: { ...counts, dry }, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "apply", keepDays: 30 });
  if (!ended) return "paused";
  await audit(job.requestedBy, job.storeId, "products.inventory_imported", { job: job.id, rows: total, updated: counts.updated, unchanged: counts.unchanged, skipped: counts.skipped, failed: counts.failed }, { area: "products", target: { type: "data_job", id: job.id } }).catch((error) =>
    console.error("[inventory-jobs] the end could not be written to the activity log", error),
  );
  return "done";
}

// ---------------------------------------------------------------------------
// The problems as a file
// ---------------------------------------------------------------------------

/**
 * The findings of a stock import as a CSV (row, sku, severity, code, column, message), through the one writer. The SKU is the item's reference as
 * the file read it; a finding never quotes a cell. `products:write`.
 */
export async function inventoryProblemsCsv(member: Membership, jobId: string): Promise<{ ok: true; filename: string; csv: string } | { ok: false }> {
  if (!memberCan(member, WRITE)) return { ok: false };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "inventory_import") return { ok: false };
  const rows: Cell[][] = [["row", "sku", "severity", "code", "column", "message"]];
  for (let offset = 0; offset < 200_000; offset += 500) {
    const page = await listItems(member.store.id, job.id, { offset, limit: 500 });
    for (const item of page.items) for (const m of item.messages) rows.push([item.rows[0] ?? null, item.ref, m.severity, m.code, m.column ?? null, m.text]);
    if (page.items.length < 500) break;
  }
  return { ok: true, filename: `stock-import-problems-${new Date().toISOString().slice(0, 10)}.csv`, csv: writeCsv(rows, "standard") };
}
