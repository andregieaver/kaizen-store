import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { htmlToRichText } from "@/lib/html-rich-text";
import { parseCsv } from "@/lib/csv";
import { normaliseEmail } from "@/lib/email-address";
import {
  COPY_FEEDS,
  EMPTY_COPY,
  FEED_FILES,
  FEED_KIND,
  MENUS_QUERY,
  PLAIN_FEEDS,
  CATCH_UP_FEEDS,
  consentLines,
  catchUpQuery,
  VENDORS_FILE,
  vendorLines,
  copyReady,
  copyStateOf,
  directItems,
  fileOfFeed,
  menuInputOf,
  nextToApply,
  nextToRead,
  readBulkLines,
  type CopyFeed,
  type CopyState,
  type DirectItem,
  type FeedProblem,
  type FeedState,
  type VendorLine,
} from "@/lib/shopify-copy";

import type { Membership } from "./auth";
import { IMPORTS_BUCKET, dataStorage, getJob, type DataDeps, type DataJob } from "./data-job-store";
import {
  cancelJob,
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
import { blogsNow, saveBlog } from "./blogs";
import { log } from "./log";
import { listStoreMenus, saveStoreMenu } from "./menus";
import { listPages, pagesTag, savePage } from "./pages";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import { memberCan } from "./permissions";
import { safeFetch } from "./replicate-fetch";
import { shopifyGraphql, type ShopifyDeps } from "./shopify-connect";
import { customerMark, recordMoveItems } from "./shopify-undo";
import { pgTextArray } from "./pg-arrays";
import { SETTINGS_FEEDS, applySettingsFeed, readSettingsFeed } from "./shopify-settings-copy";

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

const STEPS: Partial<Record<CopyFeed, Steps>> & Record<"products" | "collections" | "customers" | "orders" | "redirects", Steps> = {
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
  collections: {
    register: registerImport,
    // Only the categories column: products found by handle, none made.
    check: (m, id, deps) => startImportCheck(m, id, { mode: "update", unpublishable: "draft", missingVariants: "keep", redirects: false }, deps),
    apply: startImportApply,
    page: (store, id) => `/admin/${store}/products/import/${id}`,
  },
  redirects: {
    register: registerRedirectImport,
    check: (m, id, deps) => startRedirectCheck(m, id, { existing: "skip" }, deps),
    apply: startRedirectApply,
    page: (store, id) => `/admin/${store}/redirects/import/${id}`,
  },
};

/** One column of an import's own file, its distinct values (an import being applied keeps its file in the imports bucket). */
async function columnOf(member: Membership, jobId: string, data: DataDeps, column: string): Promise<string[]> {
  const job = await getJob(member.store.id, jobId);
  const storage = data.storage === undefined ? dataStorage() : data.storage;
  const bytes = job?.inputPath && storage ? await storage.download(IMPORTS_BUCKET, job.inputPath) : null;
  if (!bytes) return [];
  const rows = parseCsv(bytes).rows;
  const at = rows[0]?.indexOf(column) ?? -1;
  return at < 0 ? [] : [...new Set(rows.slice(1).map((r) => (r[at] ?? "").trim()).filter(Boolean))];
}

/** The products of a products file that are not the store's yet, by handle: written down for *Undo this copy* (step 9). */
async function markNewProducts(member: Membership, jobId: string, data: DataDeps): Promise<void> {
  const handles = (await columnOf(member, jobId, data, "Handle")).map((h) => h.toLowerCase());
  if (handles.length === 0) return;
  const known = new Set(
    (await db().execute<Row>(sql`select handle from commerce.products where store_id = ${member.store.id}::uuid and handle = any(${pgTextArray(handles)}::text[])`)).map((r) => String(r.handle)),
  );
  await recordMoveItems(member.store.id, "product", handles.filter((h) => !known.has(h)));
}

/** The addresses of a customers file that are not the store's customers yet, as marks (never the address). */
async function markNewCustomers(member: Membership, jobId: string, data: DataDeps): Promise<void> {
  const emails = (await columnOf(member, jobId, data, "Email")).map(normaliseEmail).filter((e) => e.includes("@"));
  if (emails.length === 0) return;
  const known = new Set(
    (await db().execute<Row>(sql`select lower(email) as email from commerce.customers where store_id = ${member.store.id}::uuid and lower(email) = any(${pgTextArray(emails)}::text[])`)).map((r) => String(r.email)),
  );
  await recordMoveItems(member.store.id, "customer", emails.filter((e) => !known.has(e)).map(customerMark));
}

/** How many things a job's dry run would bring over (every count but the ones with problems or skipped). */
export function importableOf(job: Pick<DataJob, "counts">): number {
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  return Object.entries(dry)
    .filter(([name]) => !/problem|error|skipped/i.test(name))
    .reduce((sum, [, n]) => sum + (typeof n === "number" && Number.isFinite(n) ? n : 0), 0);
}

/** The page's link to a feed's import job (a `direct` feed has none). */
export const feedJobPage = (feed: CopyFeed, storeSlug: string, jobId: string): string | null => STEPS[feed as keyof typeof STEPS]?.page(storeSlug, jobId) ?? null;

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

/**
 * *Copy my shop* (and *Start again*): a fresh copy, every feed waiting to be read. An earlier copy's imports that were never applied
 * (uploaded, checking or checked) are cancelled first, since a store has one open import of each kind; an applied one stays as it is.
 */
export async function startCopy(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const state = await stateOf(member.store.id);
  if (!state) return { ok: false };
  for (const feed of COPY_FEEDS) {
    const id = state.feeds[feed].job;
    if (!id) continue;
    const job = await getJob(member.store.id, id);
    if (job && (job.status === "uploaded" || job.status === "checking" || job.status === "checked")) await cancelJob(member, id);
  }
  await save(member.store.id, { ...EMPTY_COPY, startedAt: new Date().toISOString() });
  log("info", "shopify.copy_started", { storeId: member.store.id });
  return { ok: true };
}

/**
 * Move day's catch-up (D445 step 7a): a copy of only what Shopify made since `since` (new products, customers and past orders, through the
 * same imports), brought over without asking, since the owner pressed *Move my shop*. The earlier copy's vendors are carried over.
 */
/** `only`: the feeds read; the daily look of the 14 days after (step 7c) asks only for customers and orders. */
export async function startCatchUp(member: Membership, since: string, only: readonly CopyFeed[] = CATCH_UP_FEEDS): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const state = await stateOf(member.store.id);
  if (!state) return { ok: false };
  const feeds = Object.fromEntries(COPY_FEEDS.map((f) => [f, (CATCH_UP_FEEDS.includes(f) && only.includes(f)) || (f === "subscribers" && only.includes("customers")) ? { stage: "waiting" } : { stage: "empty", count: 0 }])) as CopyState["feeds"];
  const vendors = state.feeds.products.vendors;
  if (vendors) feeds.products = { ...feeds.products, vendors };
  await save(member.store.id, { startedAt: new Date().toISOString(), apply: true, since, feeds });
  log("info", "shopify.catch_up_started", { storeId: member.store.id });
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

const storageOf = (deps: CopyDeps) => (deps.data?.storage === undefined ? dataStorage() : deps.data.storage);

/** A `later` or `direct` feed's file kept in the imports bucket until it is brought over; its path, or null when storage would not take it. The bucket takes only CSV and plain text, so JSON Lines go as `text/plain`. */
async function keepFile(member: Membership, feed: CopyFeed, text: string, deps: CopyDeps): Promise<string | null> {
  const storage = storageOf(deps);
  if (!storage) return null;
  const path = `${member.store.id}/${randomUUID()}/${FEED_FILES[feed]}`;
  return (await storage.upload(IMPORTS_BUCKET, path, new TextEncoder().encode(text), feed === "collections" ? "text/csv" : "text/plain")) ? path : null;
}

async function keptFile(path: string, deps: CopyDeps): Promise<string | null> {
  const bytes = await storageOf(deps)?.download(IMPORTS_BUCKET, path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** The products' vendors (D445 step 6) kept beside the products' file: its path, or null when there are none or storage would not take it. */
async function keepVendors(member: Membership, text: string, deps: CopyDeps, before: string | null = null): Promise<string | null> {
  // A catch-up reads only the new products: the earlier copy's vendors are kept beside them.
  const earlier = before ? await keptFile(before, deps) : null;
  const read = vendorLines(readBulkLines(text));
  const fresh = new Set(read.map((l) => l.handle));
  const lines = [...(earlier ? vendorLines(readBulkLines(earlier)).filter((l) => !fresh.has(l.handle)) : []), ...read];
  const storage = storageOf(deps);
  if (lines.length === 0 || !storage) return null;
  const path = `${member.store.id}/${randomUUID()}/${VENDORS_FILE}`;
  return (await storage.upload(IMPORTS_BUCKET, path, new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n")), "text/plain")) ? path : null;
}

/** The vendors the last copy read, for *Who makes your products?* (owner only); empty when the copy kept none (one started before step 6). */
export async function copiedVendors(member: Membership, deps: CopyDeps = {}): Promise<VendorLine[]> {
  if (!memberCan(member, OWNER)) return [];
  const path = (await stateOf(member.store.id))?.feeds.products.vendors;
  const text = path ? await keptFile(path, deps) : null;
  if (!text) return [];
  return readBulkLines(text).roots.flatMap((r) =>
    typeof r.handle === "string" && typeof r.vendor === "string" ? [{ vendor: r.vendor, handle: r.handle, active: r.active === true }] : [],
  );
}

/** A finished read of a `later` or `direct` feed: its file kept, the feed ready to be brought over (or empty). */
async function stage(member: Membership, feed: CopyFeed, text: string, deps: CopyDeps): Promise<FeedState> {
  const { csv, count } = fileOfFeed(feed, text);
  if (count === 0) return { stage: "empty", count: 0 };
  if (new TextEncoder().encode(csv).length > IMPORT_MAX_BYTES * 4) return { stage: "failed", problem: "too_large" };
  const path = await keepFile(member, feed, csv, deps);
  return path ? { stage: "checked", path, count } : { stage: "failed", problem: "storage" };
}

/** The collections' file handed to the product import once the products are in (`later`): registered and checked; applied when checked. */
async function registerLater(member: Membership, feed: CopyFeed, f: FeedState, deps: CopyDeps): Promise<FeedState> {
  const text = f.path ? await keptFile(f.path, deps) : null;
  if (text === null) return { ...f, stage: "failed", problem: "storage" };
  const handed = await hand(member, feed, `${text}`, deps, true);
  return "empty" in handed ? { stage: "empty", count: 0 } : "problem" in handed ? { ...f, stage: "failed", problem: handed.problem } : { ...f, stage: "checking", job: handed.job };
}

/** How many of a `direct` feed's items one tick writes: each is a page save (or a menu), with its checks. */
const DIRECT_BATCH: Partial<Record<CopyFeed, number>> = { pages: 15, articles: 15, menus: 5 };

const pageInputOf = (item: DirectItem, extra: Record<string, unknown> = {}) => ({
  title: item.title,
  slug: item.handle,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: [{ id: randomUUID(), type: "row", layout: "1", columns: [{ id: randomUUID(), blocks: [{ id: randomUUID(), type: "richText", doc: htmlToRichText(item.body).doc }] }] }],
  ...extra,
});

/** Saves one page or post through the editor's own `savePage()`; one the checker holds back is saved as a draft for the owner to look at. */
async function savePageOf(member: Membership, item: DirectItem, type: "page" | "article", extra: Record<string, unknown>): Promise<boolean> {
  const input = pageInputOf(item, extra);
  const first = await savePage(member.account, member.store.id, null, input, { publish: item.published, type });
  const kept = async (result: Awaited<ReturnType<typeof savePage>>) => {
    // Written down for *Undo this copy* (step 9).
    if (result.ok && "id" in result && typeof result.id === "string") await recordMoveItems(member.store.id, "page", [result.id]);
    return result.ok;
  };
  if (first.ok) return kept(first);
  if (first.code === "needs_confirmation") return kept(await savePage(member.account, member.store.id, null, input, { publish: false, type }));
  log("warn", "shopify.copy_page_refused", { storeId: member.store.id, type, problems: first.problems.length });
  return false;
}

/** The blog each Shopify blog's posts go to here: the first one the store's main blog, the others found or made by their handle. */
async function blogIdsOf(member: Membership, items: readonly DirectItem[]): Promise<Map<string, string | null>> {
  const ids = new Map<string, string | null>();
  const handles = [...new Set(items.map((i) => i.blog?.handle ?? "").filter(Boolean))];
  const blogs = await blogsNow(member.store.id);
  const locale = member.store.localization.locales[0];
  handles.forEach((h, n) => {
    if (n === 0) ids.set(h, null);
  });
  for (const h of handles.slice(1)) {
    const found = blogs.find((b) => b.handle === h);
    if (found) {
      ids.set(h, found.main ? null : found.id);
      continue;
    }
    const title = items.find((i) => i.blog?.handle === h)?.blog?.title || h;
    const made = await saveBlog(member.account, member.store, null, { handle: h, titles: locale ? { [locale]: title } : {}, comments: "off", listingPageId: null });
    ids.set(h, made.ok ? made.id : null);
  }
  return ids;
}

/** One tick of a `direct` feed: the next items written by their editors' own writers; an item already here (same address or name) is left. */
async function applyDirect(member: Membership, feed: CopyFeed, f: FeedState, deps: CopyDeps): Promise<FeedState> {
  const text = f.path ? await keptFile(f.path, deps) : null;
  if (text === null) return { ...f, stage: "failed", problem: "storage" };
  const tree = readBulkLines(text);
  if (SETTINGS_FEEDS.includes(feed)) return applySettingsFeed(member, feed, f, tree.roots);
  const cursor = f.cursor ?? 0;
  const size = DIRECT_BATCH[feed] ?? 10;
  let made = f.made ?? 0;
  let refused = f.refused ?? 0;
  let total = 0;
  if (feed === "pages" || feed === "articles") {
    const type = feed === "pages" ? "page" : "article";
    const items = directItems(tree);
    total = items.length;
    const here = new Set((await listPages(member.store.id, type)).map((p) => p.slug));
    const blogs = feed === "articles" ? await blogIdsOf(member, items) : new Map<string, string | null>();
    for (const item of items.slice(cursor, cursor + size)) {
      if (here.has(item.handle)) {
        made += 1;
        continue;
      }
      const blogId = item.blog ? blogs.get(item.blog.handle) : null;
      const extra = type === "article" ? { ...(blogId ? { blogId } : {}), ...(item.author ? { author: item.author } : {}) } : {};
      if (await savePageOf(member, item, type, extra)) made += 1;
      else refused += 1;
    }
    refreshTag(pagesTag(member.store.id));
  } else {
    total = tree.roots.length;
    const locale = member.store.localization.locales[0] ?? "en";
    const names = new Set((await listStoreMenus(member.store.id)).map((m) => m.name.toLowerCase()));
    for (const menu of tree.roots.slice(cursor, cursor + size)) {
      const input = menuInputOf(menu, locale);
      if (names.has(input.name.toLowerCase())) {
        made += 1;
        continue;
      }
      let saved = await saveStoreMenu(member, null, input);
      // A link to a page, post or product that is not here (yet) is kept as its address, so the menu still comes over.
      if (!saved.ok)
        saved = await saveStoreMenu(member, null, {
          ...input,
          items: input.items.map((i) =>
            i.link.kind === "page" ? { ...i, link: { kind: "url", url: `/${i.link.slug}` } } : i.link.kind === "article" ? { ...i, link: { kind: "url", url: `/blog/${i.link.slug}` } } : i.link.kind === "product" ? { ...i, link: { kind: "url", url: `/p/${i.link.handle}` } } : i,
          ),
        });
      if (saved.ok) {
        made += 1;
        await recordMoveItems(member.store.id, "menu", [saved.id]);
      }
      else {
        refused += 1;
        log("warn", "shopify.copy_menu_refused", { storeId: member.store.id, problems: saved.problems.length });
      }
    }
    refreshTag(storeTag(member.store.slug));
  }
  const next = cursor + size;
  return next >= total ? { ...f, stage: "done", cursor: total, made, refused } : { ...f, stage: "applying", cursor: next, made, refused };
}

/** A finished read made into its file and handed to its import's dry run. */
async function hand(member: Membership, feed: CopyFeed, text: string, deps: CopyDeps, isFile = false): Promise<{ job: string; count: number } | { problem: FeedProblem } | { empty: true }> {
  const { csv, count } = isFile ? { csv: text, count: Math.max(0, text.split("\n").filter((l) => l.trim() !== "").length - 1) } : fileOfFeed(feed, text);
  if (count === 0) return { empty: true };
  const bytes = new TextEncoder().encode(csv);
  if (bytes.length > IMPORT_MAX_BYTES) return { problem: "too_large" };
  const data = deps.data ?? {};
  const storage = data.storage === undefined ? dataStorage() : data.storage;
  if (!storage) return { problem: "storage" };
  const path = `${member.store.id}/${randomUUID()}/${FEED_FILES[feed]}`;
  if (!(await storage.upload(IMPORTS_BUCKET, path, bytes, "text/csv"))) return { problem: "storage" };
  const registered = await STEPS[feed]!.register(member, { path, name: FEED_FILES[feed] }, { ...data, storage });
  if (!registered.ok) {
    log("warn", "shopify.copy_register_refused", { storeId: member.store.id, feed, problems: registered.problems.length });
    return { problem: "import_refused" };
  }
  const options = feed === "products" ? await productOptions(member, deps) : {};
  const checked = await STEPS[feed]!.check(member, registered.jobId, { ...data, storage }, options);
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
  const state: CopyState = { startedAt: leased.startedAt, apply: leased.apply, ...(leased.since ? { since: leased.since } : {}), feeds: { ...leased.feeds } };
  const before = leased.feeds;
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
        if (FEED_KIND[feed] === "import") {
          const handed = await hand(member, feed, file.text, deps);
          state.feeds[feed] = "empty" in handed ? { stage: "empty", count: 0 } : "problem" in handed ? { stage: "failed", problem: handed.problem } : { stage: "checking", job: handed.job, count: handed.count };
          // The customers' email consent, as Shopify records it, becomes the subscribers' part (step 8): only a subscription with its date.
          if (feed === "customers") {
            const subscribed = consentLines(readBulkLines(file.text)).filter((l) => l.state === "SUBSCRIBED" && l.updatedAt !== null);
            state.feeds.subscribers = subscribed.length > 0 ? await stage(member, "subscribers", subscribed.map((l) => JSON.stringify(l)).join("\n"), deps) : { stage: "empty", count: 0 };
          }
          if (feed === "products" && "job" in handed) {
            const vendors = await keepVendors(member, file.text, deps, state.since ? (before.products.vendors ?? null) : null);
            if (vendors) state.feeds.products.vendors = vendors;
          }
        } else state.feeds[feed] = await stage(member, feed, file.text, deps);
      } else if (status === "FAILED" || status === "CANCELED" || status === "CANCELING" || status === "EXPIRED") {
        log("warn", "shopify.copy_read_failed", { storeId, feed, status, code: poll.data.node?.errorCode ?? null });
        state.feeds[feed] = { stage: "failed", problem: poll.data.node?.errorCode === "ACCESS_DENIED" ? "shopify_refused" : "shopify_failed" };
      }
    }
    // The next read, one at a time.
    const next = nextToRead(state);
    if (next === "menus") {
      const answer = await shopifyGraphql<{ menus?: { nodes?: Record<string, unknown>[] } }>(storeId, MENUS_QUERY, {}, deps);
      state.feeds.menus = answer.ok ? await stage(member, "menus", (answer.data.menus?.nodes ?? []).map((m) => JSON.stringify(m)).join("\n"), deps) : { stage: "failed", problem: "shopify_refused" };
    } else if (next && PLAIN_FEEDS.includes(next)) {
      const read = await readSettingsFeed(storeId, next, deps);
      state.feeds[next] = read.ok ? await stage(member, next, read.text, deps) : { stage: "failed", problem: "shopify_refused" };
    } else if (next) {
      const run = await shopifyGraphql<BulkRun>(storeId, BULK_RUN, { query: catchUpQuery(next, state.since ?? null) }, deps);
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
      else if (job.status === "done") {
        state.feeds[feed] = { ...f, stage: "done" };
        // The import's created rows are named by its own items: written down for *Undo this copy* (step 9).
        await recordMoveItems(storeId, "job", [job.id]);
      }
      else if (job.status === "queued" || job.status === "running") state.feeds[feed] = { ...f, stage: "applying" };
      else if (job.status === "checked") state.feeds[feed] = { ...f, stage: "checked" };
      else if (job.status === "checking" || job.status === "uploaded") state.feeds[feed] = { ...f, stage: "checking" };
    }
    // After *Bring it over*: the next checked feed, once the one before it is done.
    // A `direct` feed being written goes on.
    for (const feed of COPY_FEEDS) {
      const f = state.feeds[feed];
      if (FEED_KIND[feed] === "direct" && f.stage === "applying") state.feeds[feed] = await applyDirect(member, feed, f, deps);
    }
    const apply = nextToApply(state);
    if (apply && FEED_KIND[apply] === "direct") state.feeds[apply] = await applyDirect(member, apply, { ...state.feeds[apply], stage: "applying", cursor: 0, made: 0, refused: 0 }, deps);
    else if (apply && FEED_KIND[apply] === "later" && !state.feeds[apply].job) state.feeds[apply] = await registerLater(member, apply, state.feeds[apply], deps);
    else if (apply) {
      const f = state.feeds[apply];
      // The customers this apply will make (addresses not here yet), written down first, as marks, for *Undo this copy* (step 9).
      if (apply === "customers") await markNewCustomers(member, f.job!, data);
      if (apply === "products") await markNewProducts(member, f.job!, data);
      const started = await STEPS[apply]!.apply(member, f.job!, data);
      // A dry run that found nothing to bring over is refused by its import: the owner fixes it on the import's page (`needs_fixing`).
      const job = started.ok ? null : await getJob(storeId, f.job!);
      state.feeds[apply] = started.ok ? { ...f, stage: "applying" } : { ...f, stage: "failed", problem: job && importableOf(job) === 0 ? "needs_fixing" : "import_refused" };
    }
    // No customers read, no subscribers from them.
    if (state.feeds.subscribers.stage === "waiting" && (state.feeds.customers.stage === "empty" || state.feeds.customers.stage === "failed")) {
      state.feeds.subscribers = { stage: "empty", count: 0 };
    }
    // The products' vendors stay known whatever became of a later read of the products (a catch-up that found none).
    if (!state.feeds.products.vendors && before.products.vendors) state.feeds.products = { ...state.feeds.products, vendors: before.products.vendors };
    return state;
  } catch (error) {
    log("error", "shopify.copy_step_failed", { storeId }, error);
    return state;
  } finally {
    await save(storeId, state);
  }
}
