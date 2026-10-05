// Test support for the integration tests of data in and out (wave 2, D165): an in-memory stand-in for the two private buckets, a run-to-the-end
// loop for a job, and members of a store with and without the owner role. Not imported by the app.
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseCsv, writeCsv, type Cell, type DialectId } from "@/lib/csv";

import type { Account, Membership } from "./auth";
import type { DataDeps, DataStorage } from "./data-job-store";
import { runJob, type RunOutcome } from "./data-jobs";
import { ownerOf, unique, type Fixture } from "./invoice-test-fixture";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

export type FakeStorage = DataStorage & {
  files: Map<string, Uint8Array>;
  /** Paths removed, in order. */
  removed: string[];
  /** Signed addresses made: bucket, path, name, seconds. */
  signed: { bucket: string; path: string; name: string; seconds: number }[];
  /** While true, every call fails as if storage were down. */
  down: boolean;
};

/** The imports and exports buckets in memory. A signed address is a plain string that names what it was made for. */
export function fakeStorage(): FakeStorage {
  const files = new Map<string, Uint8Array>();
  const state: FakeStorage = {
    files,
    removed: [],
    signed: [],
    down: false,
    async signedUpload(path) {
      return state.down ? null : { token: `token-${path.length}` };
    },
    async upload(bucket, path, bytes) {
      if (state.down) return false;
      files.set(`${bucket}/${path}`, bytes);
      return true;
    },
    async download(bucket, path) {
      if (state.down) return null;
      return files.get(`${bucket}/${path}`) ?? null;
    },
    async remove(bucket, paths) {
      if (state.down) return false;
      for (const p of paths) {
        files.delete(`${bucket}/${p}`);
        state.removed.push(`${bucket}/${p}`);
      }
      return true;
    },
    async list(bucket, folder) {
      if (state.down) return null;
      const prefix = folder === "" ? `${bucket}/` : `${bucket}/${folder}/`;
      const seen = new Map<string, boolean>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        seen.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
      }
      return [...seen].map(([name, isFolder]) => ({ name, isFolder }));
    },
    async signedUrl(bucket, path, name, seconds) {
      if (state.down) return null;
      state.signed.push({ bucket, path, name, seconds });
      return `https://storage.test/${bucket}/${path}?download=${encodeURIComponent(name)}&expires=${seconds}`;
    },
  };
  return state;
}

/** The deps of a test: the fake buckets, no `after()`, and the time of a run as long as it needs. */
export const depsWith = (storage: DataStorage | null, more: Partial<DataDeps> = {}): DataDeps => ({ storage, schedule: () => undefined, budgetMs: 60_000, ...more });

/** A file as bytes the way a spreadsheet saves it. */
export const csvBytes = (rows: readonly (readonly Cell[])[], dialect: DialectId = "standard"): Uint8Array => new TextEncoder().encode(writeCsv(rows, dialect));

/** The text of a stored file. */
export const textOf = (storage: FakeStorage, bucket: string, path: string): string => new TextDecoder().decode(storage.files.get(`${bucket}/${path}`));

/** Runs a job until it has finished, a pause is a run's end (not the job's): at most `max` runs. The last outcome. */
export async function runToEnd(id: string, deps: DataDeps, max = 40): Promise<RunOutcome> {
  let last: RunOutcome = "paused";
  for (let i = 0; i < max; i += 1) {
    last = await runJob(id, deps);
    if (last !== "paused") return last;
  }
  return last;
}

/** The owner of a fixture store, and an admin of it (a member without the `owner` key, who may write products and read orders). */
export async function membersOf(fx: Fixture): Promise<{ owner: Membership; admin: Membership }> {
  const owner = await ownerOf(fx);
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${unique("admin")}@example.com`}, 'Staff') returning id, email, name`);
  const account: Account = { id: String(row.id), email: String(row.email), name: String(row.name), platformAdmin: false };
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${fx.storeId}::uuid, ${account.id}::uuid, 'admin')`);
  return { owner, admin: { account, store: (await getStore(fx.slug))!, role: "admin" } };
}

export async function jobRow(id: string): Promise<Row> {
  const [row] = await db().execute<Row>(sql`select * from commerce.data_jobs where id = ${id}::uuid`);
  return row;
}

export async function auditOf(storeId: string, action: string): Promise<Row[]> {
  return db().execute<Row>(sql`select * from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action} order by id`);
}

/** A CSV text as rows of cells (the header first), for asserting a file's contents: read by the same reader the import uses. */
export const rowsOfCsv = (text: string): string[][] => parseCsv(text).rows;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** A second market (Sweden, in kronor) and a second language for a fixture store: what a file with `price:SE` and `title:sv-SE` needs. */
export async function addSwedish(fx: Fixture): Promise<void> {
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    values (${fx.storeId}::uuid, 'SE', 'SEK', 'sv-SE', array['sv-SE'], true) on conflict do nothing
  `);
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where id = ${fx.storeId}::uuid`);
}

/** The imports bucket as a browser leaves it: the file is put under the signed path and registered as a job. The job's id. */
export async function uploadImport(member: Membership, storage: FakeStorage, bytes: Uint8Array, name = "products.csv", deps: DataDeps = depsWith(storage)): Promise<string> {
  const { startImportUpload, registerImport } = await import("./data-jobs");
  const started = await startImportUpload(member, name, deps);
  if (!started.ok) throw new Error(started.problem);
  storage.files.set(`imports/${started.path}`, bytes);
  const registered = await registerImport(member, { path: started.path, name }, deps);
  if (!registered.ok) throw new Error(registered.problems.join(" "));
  return registered.jobId;
}

export type ImportRun = { jobId: string; dry: { toCreate: number; toUpdate: number; unchanged: number; withProblems: number }; checked: Row; applied: Row | null };

/** Register, check and (unless `apply` is false) apply a file; the rows of the job after each step. */
export async function importThrough(member: Membership, storage: FakeStorage, bytes: Uint8Array, options: unknown = {}, o: { apply?: boolean; deps?: DataDeps; name?: string } = {}): Promise<ImportRun> {
  const jobs = await import("./data-jobs");
  const deps = o.deps ?? depsWith(storage);
  const jobId = await uploadImport(member, storage, bytes, o.name ?? "products.csv", deps);
  try {
    const check = await jobs.startImportCheck(member, jobId, options, deps);
    if (!check.ok) throw new Error(check.problem);
    const outcome = await runToEnd(jobId, deps);
    if (outcome !== "checked") throw new Error(`the check ended ${outcome}: ${String((await jobRow(jobId)).problem)}`);
    const checked = await jobRow(jobId);
    const dry = jobs.dryCountsOf({ counts: checked.counts as Record<string, unknown> });
    if (o.apply === false) return { jobId, dry, checked, applied: null };
    const applied = await jobs.startImportApply(member, jobId, deps);
    if (!applied.ok) throw new Error(`${applied.problem} ${JSON.stringify((await itemsOf(jobId)).flatMap((i) => i.messages.map((m) => `${i.ref}:${m.code}`)))}`);
    const end = await runToEnd(jobId, deps);
    if (end !== "done") throw new Error(`the apply ended ${end}: ${String((await jobRow(jobId)).problem)}`);
    return { jobId, dry, checked, applied: await jobRow(jobId) };
  } catch (error) {
    // A failed step must not leave the store's one open import behind for the next test.
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where id = ${jobId}::uuid and status in ('uploaded', 'checking', 'checked', 'queued', 'running')`);
    throw error;
  }
}

export async function itemsOf(jobId: string): Promise<{ seq: number; kind: string; ref: string | null; outcome: string; messages: { severity: string; code: string; text: string }[]; changes: Record<string, unknown> }[]> {
  const rows = await db().execute<Row>(sql`select seq, kind, ref, outcome, messages, changes from commerce.data_job_items where job_id = ${jobId}::uuid order by seq`);
  return rows.map((r) => ({ seq: Number(r.seq), kind: String(r.kind), ref: r.ref ? String(r.ref) : null, outcome: String(r.outcome), messages: r.messages as never, changes: r.changes as Record<string, unknown> }));
}

/** A manufacturer in the EU for a fixture store, so its products can be published. The operator's id. */
export async function euOperator(fx: Fixture): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
    values (${fx.storeId}::uuid, 'Fixture GmbH', 'Hauptstrasse 1, 10115 Berlin', 'mail@fixture.example', 'DE') returning id
  `);
  return String(row.id);
}

/**
 * Products as the editor saves them: active, a picture, a manufacturer in the EU, one variant `{prefix}-{i}` priced `100 + i` kroner with `i` in stock
 * (more than one variant when `variants` says so). The ids, in order. Saved through `saveProduct()`, so everything the editor writes is there.
 */
export async function seedProducts(fx: Fixture, count: number, o: { prefix?: string; variants?: number; status?: "active" | "draft"; operator?: string } = {}): Promise<{ id: string; handle: string; skus: string[] }[]> {
  const { getEditorContext, emptyProduct, saveProduct } = await import("./products");
  const { productInput } = await import("@/lib/product-input");
  // The manufacturer first: the editor's context lists the operators that exist when it is read.
  const operator = o.operator ?? (await euOperator(fx));
  const store = (await getStore(fx.slug))!;
  const editor = await getEditorContext(store);
  const prefix = o.prefix ?? "SEED";
  const out: { id: string; handle: string; skus: string[] }[] = [];
  for (let i = 1; i <= count; i += 1) {
    const n = o.variants ?? 1;
    const skus = Array.from({ length: n }, (_, v) => (n === 1 ? `${prefix}-${i}` : `${prefix}-${i}-${v + 1}`));
    const status = o.status ?? "active";
    const input = productInput.parse({
      ...emptyProduct(editor),
      handle: `${prefix.toLowerCase()}-${i}`,
      status,
      translations: editor.locales.map((locale, k) => ({ locale, title: k === 0 ? `Seed product ${i}` : "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" })),
      media: [{ url: "/demo/lamp.webp", thumbnailUrl: null, alt: "" }],
      options: n === 1 ? [] : [{ name: "Size", values: skus.map((_, v) => `S${v + 1}`) }],
      variants: skus.map((sku, v) => ({
        id: null, options: n === 1 ? {} : { Size: `S${v + 1}` }, sku, gtin: null, measure: null, prices: { NO: String(100 + i + v) }, cost: "", stock: i + v, active: true,
        weightGrams: null, hsCode: null, originCountry: null, delivery: "physical", rentalPeriod: "day", image: null,
      })),
      manufacturer: { id: operator },
    });
    const saved = await saveProduct(store, editor, null, input);
    if (!saved.ok) throw new Error(`seed ${i}: ${saved.problems.join(" ")}`);
    out.push({ id: saved.productId, handle: input.handle, skus });
  }
  return out;
}

export async function priceOf(storeId: string, sku: string, market = "NO"): Promise<number | null> {
  const [row] = await db().execute<Row>(sql`
    select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id
    where v.store_id = ${storeId}::uuid and v.sku = ${sku} and c.market_code = ${market}
  `);
  return row ? Number(row.amount_minor) : null;
}

export async function stockOf(storeId: string, sku: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(l.on_hand, 0) as n from commerce.product_variants v
    left join commerce.inventory_levels l on l.variant_id = v.id where v.store_id = ${storeId}::uuid and v.sku = ${sku}
  `);
  return Number(row?.n ?? 0);
}
