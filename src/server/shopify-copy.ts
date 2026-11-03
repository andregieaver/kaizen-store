import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import {
  BULK_QUERIES,
  COPY_FEEDS,
  EMPTY_COPY,
  FEED_FILES,
  copyReady,
  copyStateOf,
  fileOfFeed,
  nextToApply,
  nextToRead,
  type CopyFeed,
  type CopyState,
  type FeedProblem,
} from "@/lib/shopify-copy";

import type { Membership } from "./auth";
import { IMPORTS_BUCKET, dataStorage, getJob, type DataDeps, type DataJob } from "./data-job-store";
import {
  registerCustomerImport,
  registerHistoryImport,
  registerImport,
  registerRedirectImport,
  startCustomerApply,
  startCustomerCheck,
  startHistoryApply,
  startHistoryCheck,
  startImportApply,
  startImportCheck,
  startRedirectApply,
  startRedirectCheck,
} from "./data-jobs";
import { log } from "./log";
import { memberCan } from "./permissions";
import { safeFetch } from "./replicate-fetch";
import { shopifyGraphql, type ShopifyDeps } from "./shopify-connect";

type Row = Record<string, unknown>;

/**
 * *Copy my shop* (D445 step 4, `docs/moving-from-shopify.md` 5): the connected Shopify shop read by bulk operations, one at a time, each
 * written as the file Shopify's own export makes, and that file handed to the import that already guards its table (products D165,
 * customers D366, order history D384, redirects D168): registered, checked (the dry run, which writes nothing), and applied only when the
 * owner presses *Bring it over*, in order, customers before orders. The move writes nothing of its own: the imports do, by their rules. Its
 * progress is `shop_moves.copy` (this module is its writer), moved on by the page's own ticks under a short lease, so two tabs never start
 * the same read; a read left half-way goes on at the next visit (Shopify keeps a finished bulk read's file for a week). The owner's.
 */

const OWNER = "owner" as const;
const LEASE_SECONDS = 90;
/** The most a bulk read's file may weigh before it is refused (its CSV must then fit the import's 15 MB). */
const BULK_MAX_BYTES = 150 * 1024 * 1024;

export type CopyDeps = ShopifyDeps & { data?: DataDeps; download?: (url: string) => Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> };

type Steps = {
  register: (m: Membership, input: { path: string; name: string }, deps: DataDeps) => Promise<{ ok: true; jobId: string } | { ok: false; problems: string[] }>;
  check: (m: Membership, jobId: string, deps: DataDeps, options: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; problem: string }>;
  apply: (m: Membership, jobId: string, deps: DataDeps) => Promise<{ ok: true } | { ok: false; problem: string }>;
  page: (store: string, jobId: string) => string;
};

const STEPS: Record<CopyFeed, Steps> = {
  products: {
    register: registerImport,
    check: (m, id, deps, options) => startImportCheck(m, id, options, deps),
    apply: startImportApply,
    page: (store, id) => `/admin/${store}/products/import/${id}`,
  },
  customers: {
    register: registerCustomerImport,
    check: (m, id, deps) => startCustomerCheck(m, id, deps),
    apply: startCustomerApply,
    page: (store, id) => `/admin/${store}/customers/import/${id}`,
  },
  orders: {
    register: registerHistoryImport,
    check: (m, id, deps) => startHistoryCheck(m, id, deps),
    apply: startHistoryApply,
    page: (store, id) => `/admin/${store}/orders/history-import/${id}`,
  },
  redirects: {
    register: registerRedirectImport,
    check: (m, id, deps) => startRedirectCheck(m, id, { existing: "skip" }, deps),
    apply: startRedirectApply,
    page: (store, id) => `/admin/${store}/redirects/import/${id}`,
  },
};

/** How many things a job's dry run would bring over (every count but the ones with problems or skipped). */
export function importableOf(job: Pick<DataJob, "counts">): number {
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  return Object.entries(dry)
    .filter(([name]) => !/problem|error|skipped/i.test(name))
    .reduce((sum, [, n]) => sum + (typeof n === "number" && Number.isFinite(n) ? n : 0), 0);
}

/** The page's link to a feed's import job. */
export const feedJobPage = (feed: CopyFeed, storeSlug: string, jobId: string): string => STEPS[feed].page(storeSlug, jobId);

async function stateOf(storeId: string): Promise<CopyState | null> {
  const [row] = await db().execute<Row>(sql`select copy from commerce.shop_moves where store_id = ${storeId}::uuid and source = 'shopify' and status = 'connected'`);
  return row ? copyStateOf(row.copy) : null;
}

/** The copy as the page shows it, with each checked feed's job for its counts (owner only); null when no shop is connected. */
export async function copyView(member: Membership): Promise<{ state: CopyState; jobs: Partial<Record<CopyFeed, DataJob>> } | null> {
  if (!memberCan(member, OWNER)) return null;
  const state = await stateOf(member.store.id);
  if (!state) return null;
  const jobs: Partial<Record<CopyFeed, DataJob>> = {};
  for (const feed of COPY_FEEDS) {
    const id = state.feeds[feed].job;
    if (id) {
      const job = await getJob(member.store.id, id);
      if (job) jobs[feed] = job;
    }
  }
  return { state, jobs };
}

async function save(storeId: string, state: CopyState): Promise<void> {
  await db().execute(sql`
    update commerce.shop_moves set copy = ${JSON.stringify(state)}::jsonb, updated_at = now()
     where store_id = ${storeId}::uuid and source = 'shopify'
  `);
}

/** *Copy my shop*: a fresh copy, every feed waiting to be read. The imports' jobs of an earlier copy stay as they are. */
export async function startCopy(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const state = await stateOf(member.store.id);
  if (!state) return { ok: false };
  await save(member.store.id, { ...EMPTY_COPY, startedAt: new Date().toISOString() });
  log("info", "shopify.copy_started", { storeId: member.store.id });
  return { ok: true };
}

/** *Bring it over*: the checked feeds applied in order. Only once every feed is checked (or had nothing). */
export async function bringItOver(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const state = await stateOf(member.store.id);
  if (!state || !copyReady(state)) return { ok: false };
  await save(member.store.id, { ...state, apply: true });
  return { ok: true };
}

/** Takes the copy's lease (nobody else moves it for `LEASE_SECONDS`), or null when another tick holds it or nothing is connected. */
async function lease(storeId: string): Promise<CopyState | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.shop_moves
       set copy = jsonb_set(copy, '{lease}', to_jsonb((now() + make_interval(secs => ${LEASE_SECONDS}))::text))
     where store_id = ${storeId}::uuid and source = 'shopify' and status = 'connected'
       and (copy->>'lease' is null or (copy->>'lease')::timestamptz < now())
    returning copy
  `);
  return row ? copyStateOf(row.copy) : null;
}

const BULK_RUN = `mutation KaizenBulkRun($query: String!) { bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } } }`;
const BULK_POLL = `query KaizenBulkPoll($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode objectCount url } } }`;
const SHOP_PRICES = `query KaizenCopyShop { shop { currencyCode taxesIncluded } }`;

type BulkRun = { bulkOperationRunQuery?: { bulkOperation?: { id?: string } | null; userErrors?: { message?: string }[] } | null };
type BulkPoll = { node?: { status?: string; errorCode?: string | null; url?: string | null } | null };

/** A finished bulk read's file, from Shopify's own storage (an address its API gave), within the limit. */
async function downloadFile(url: string): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  const got = await safeFetch(url, { maxBytes: BULK_MAX_BYTES, timeoutMs: 120_000, maxRedirects: 3, accept: "application/jsonl,application/json,*/*" });
  if (!got.ok) return { ok: false, tooLarge: /larger/.test(got.problem) };
  return { ok: true, text: Buffer.from(got.bytes).toString("utf8") };
}

/** What the product import is told about the file (`ImportOptions`): the shop's own answer on VAT, the store's market in the shop's currency. */
async function productOptions(member: Membership, deps: CopyDeps): Promise<Record<string, unknown>> {
  const answer = await shopifyGraphql<{ shop?: { currencyCode?: string; taxesIncluded?: boolean } }>(member.store.id, SHOP_PRICES, {}, deps);
  const shop = answer.ok ? answer.data.shop : undefined;
  const market = member.store.markets.find((m) => m.currency === shop?.currencyCode) ?? null;
  return {
    mode: "upsert",
    unpublishable: "draft",
    missingVariants: "keep",
    pricesIncludeVat: typeof shop?.taxesIncluded === "boolean" ? shop.taxesIncluded : null,
    priceMarket: market?.code ?? null,
    redirects: true,
  };
}

/** A finished read made into its file and handed to its import's dry run. */
async function hand(member: Membership, feed: CopyFeed, text: string, deps: CopyDeps): Promise<{ job: string; count: number } | { problem: FeedProblem } | { empty: true }> {
  const { csv, count } = fileOfFeed(feed, text);
  if (count === 0) return { empty: true };
  const bytes = new TextEncoder().encode(csv);
  if (bytes.length > IMPORT_MAX_BYTES) return { problem: "too_large" };
  const data = deps.data ?? {};
  const storage = data.storage === undefined ? dataStorage() : data.storage;
  if (!storage) return { problem: "storage" };
  const path = `${member.store.id}/${randomUUID()}/${FEED_FILES[feed]}`;
  if (!(await storage.upload(IMPORTS_BUCKET, path, bytes, "text/csv"))) return { problem: "storage" };
  const registered = await STEPS[feed].register(member, { path, name: FEED_FILES[feed] }, { ...data, storage });
  if (!registered.ok) {
    log("warn", "shopify.copy_register_refused", { storeId: member.store.id, feed, problems: registered.problems.length });
    return { problem: "import_refused" };
  }
  const options = feed === "products" ? await productOptions(member, deps) : {};
  const checked = await STEPS[feed].check(member, registered.jobId, { ...data, storage }, options);
  if (!checked.ok) return { problem: "import_refused" };
  return { job: registered.jobId, count };
}

/**
 * One step of the copy (the page's tick, owner only): under the lease, a running read is asked about and, when finished, made into its file
 * and checked; the next read is started; a dry run that ended is noted; and after *Bring it over*, the next checked feed is applied once the
 * one before it is done. Every step is safe to repeat. Returns the state as it is after the step (or as it was, when another tick holds it).
 */
export async function advanceCopy(member: Membership, deps: CopyDeps = {}): Promise<CopyState | null> {
  if (!memberCan(member, OWNER)) return null;
  const storeId = member.store.id;
  const leased = await lease(storeId);
  if (!leased) return stateOf(storeId);
  const state: CopyState = { startedAt: leased.startedAt, apply: leased.apply, feeds: { ...leased.feeds } };
  try {
    if (state.startedAt === null) return state;
    const data = deps.data ?? {};
    // A running read: asked about; finished, it becomes its file and its dry run.
    for (const feed of COPY_FEEDS) {
      const f = state.feeds[feed];
      if (f.stage !== "reading" || !f.operation) continue;
      const poll = await shopifyGraphql<BulkPoll>(storeId, BULK_POLL, { id: f.operation }, deps);
      if (!poll.ok) break;
      const status = poll.data.node?.status ?? "";
      if (status === "COMPLETED") {
        const url = poll.data.node?.url ?? null;
        if (!url) {
          state.feeds[feed] = { stage: "empty", count: 0 };
          continue;
        }
        const file = await (deps.download ?? downloadFile)(url);
        if (!file.ok) {
          state.feeds[feed] = { stage: "failed", problem: file.tooLarge ? "too_large" : "shopify_failed" };
          continue;
        }
        const handed = await hand(member, feed, file.text, deps);
        state.feeds[feed] = "empty" in handed ? { stage: "empty", count: 0 } : "problem" in handed ? { stage: "failed", problem: handed.problem } : { stage: "checking", job: handed.job, count: handed.count };
      } else if (status === "FAILED" || status === "CANCELED" || status === "CANCELING" || status === "EXPIRED") {
        log("warn", "shopify.copy_read_failed", { storeId, feed, status, code: poll.data.node?.errorCode ?? null });
        state.feeds[feed] = { stage: "failed", problem: poll.data.node?.errorCode === "ACCESS_DENIED" ? "shopify_refused" : "shopify_failed" };
      }
    }
    // The next read, one at a time.
    const next = nextToRead(state);
    if (next) {
      const run = await shopifyGraphql<BulkRun>(storeId, BULK_RUN, { query: BULK_QUERIES[next] }, deps);
      const id = run.ok ? run.data.bulkOperationRunQuery?.bulkOperation?.id : undefined;
      const errors = run.ok ? (run.data.bulkOperationRunQuery?.userErrors ?? []) : [];
      if (id) state.feeds[next] = { stage: "reading", operation: id };
      else if (errors.length > 0 && !errors.some((e) => /already in progress/i.test(e.message ?? ""))) {
        log("warn", "shopify.copy_read_refused", { storeId, feed: next, errors: errors.length });
        state.feeds[next] = { stage: "failed", problem: "shopify_refused" };
      }
    }
    // Dry runs and applies that ended.
    for (const feed of COPY_FEEDS) {
      const f = state.feeds[feed];
      if ((f.stage !== "checking" && f.stage !== "checked" && f.stage !== "applying") || !f.job) continue;
      const job = await getJob(storeId, f.job);
      // The owner may also have checked again or applied on the import's own page: the job says where it is.
      if (!job || job.status === "failed" || job.status === "cancelled" || job.status === "expired") state.feeds[feed] = { ...f, stage: "failed", problem: "import_failed" };
      else if (job.status === "done") state.feeds[feed] = { ...f, stage: "done" };
      else if (job.status === "queued" || job.status === "running") state.feeds[feed] = { ...f, stage: "applying" };
      else if (job.status === "checked") state.feeds[feed] = { ...f, stage: "checked" };
      else if (job.status === "checking" || job.status === "uploaded") state.feeds[feed] = { ...f, stage: "checking" };
    }
    // After *Bring it over*: the next checked feed, once the one before it is done.
    const apply = nextToApply(state);
    if (apply) {
      const f = state.feeds[apply];
      const started = await STEPS[apply].apply(member, f.job!, data);
      // A dry run that found nothing to bring over is refused by its import: the owner fixes it on the import's page (`needs_fixing`).
      const job = started.ok ? null : await getJob(storeId, f.job!);
      state.feeds[apply] = started.ok ? { ...f, stage: "applying" } : { ...f, stage: "failed", problem: job && importableOf(job) === 0 ? "needs_fixing" : "import_refused" };
    }
    return state;
  } catch (error) {
    log("error", "shopify.copy_step_failed", { storeId }, error);
    return state;
  } finally {
    await save(storeId, state);
  }
}
