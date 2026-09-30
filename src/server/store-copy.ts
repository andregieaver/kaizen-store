import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { cutPassages } from "@/lib/knowledge";
import { slugProblem, suggestSlug } from "@/lib/slug";
import {
  COPY_PHASES,
  storeCopyInput,
  storeCopyOptions,
  type CopyChoices,
  type CopyPhase,
  type CopySelection,
  type StoreCopyOptions,
  type StoreCopyProgress,
  type StoreCopyResult,
  type StoreCopySummary,
} from "@/lib/store-copy";

import { audit, type Account } from "./auth";
import { isSlugTaken, MAX_STORES_PER_OWNER } from "./platform";
import { copyStoreMedia, tablesPointingAtOriginal, type MediaCopyDeps } from "./store-copy-media";

type Row = Record<string, unknown>;

/**
 * Duplicating a store (D129, `docs/store-copy.md`). An owner makes a new store from one of theirs and chooses what
 * comes along (`src/lib/store-copy.ts`). `startStoreCopy()` checks the account owns the source and the new store
 * is one it could make, then copies the settings, pages, products and posts at once in one transaction
 * (`commerce.duplicate_store()`), so the owner has the new store immediately, and records the copy in
 * `commerce.store_copies`. The rest is a job that can stop and go on: pictures and files (`copyStoreMedia()`),
 * customers, order history (`commerce.copy_customers()`, `commerce.copy_orders()`, in batches) and finishing
 * (the search, knowledge and vectors rebuilt, a check that nothing points back at the original, caches
 * refreshed). It is started at once with `after()` and taken up again by the five-minute cron
 * (`runStoreCopies()`), one run at a time per copy (a claim with an expiry), each run within a time budget.
 * Progress is in the row (`copyProgress()`); a run that dies is tried again, and a copy that keeps failing is
 * stopped with a plain reason. The new store is closed (its setup is not done) and has no Stripe account, so
 * checkout stays off until its owner connects payments.
 */

/** What a run reaches outside the database, replaceable in tests. */
export type StoreCopyDeps = MediaCopyDeps & {
  /** Starts the job after the response; the cron takes over where that is not possible. */
  schedule?: (run: () => Promise<unknown>) => void;
  /** Rebuilds what is made from the copy (search, knowledge, vectors). */
  rebuild?: (newStoreId: string) => Promise<void>;
  /** Refreshes what the site caches about the new store. */
  invalidate?: (newStoreId: string, slug: string) => Promise<void>;
  /** How long one run may work, in ms, and the batch sizes. */
  budgetMs?: number;
  customerBatch?: number;
  orderBatch?: number;
};

export const COPY_BUDGET_MS = 40_000;
/** How many times a copy is taken up without any progress before it is stopped. */
export const COPY_MAX_ATTEMPTS = 6;
/** How many copies one account may have running at once. */
export const COPIES_RUNNING_MAX = 3;
const CLAIM_MINUTES = 5;
const CUSTOMER_BATCH = 250;
const ORDER_BATCH = 100;
const RECENT_MAX = 20;

const problem = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
/** The same answer for a store that does not exist and one the account may not copy. */
export const NOT_COPYABLE = "You can only copy a store you own.";
const NOT_FOUND = "This copy could not be found.";

const isId = (id: string) => z.uuid().safeParse(id).success;
const uuidList = (ids: string[]) => `{${ids.join(",")}}`;

type CopyCounts = StoreCopyProgress["counts"];
const KINDS = ["pages", "products", "posts", "customers", "orders", "media"] as const;
const emptyCounts = (): CopyCounts =>
  Object.fromEntries(KINDS.map((kind) => [kind, { done: 0, total: 0 }])) as CopyCounts;

// ---------------------------------------------------------------------------
// Who may copy what
// ---------------------------------------------------------------------------

type Source = { id: string; slug: string; name: string };

/** The store to copy, when the account owns it (staff do not) or runs the platform; the demo template only for the platform. */
async function sourceFor(account: Account, slug: string): Promise<Source | null> {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name from commerce.stores s
    where s.slug = ${slug}
      and (
        ${account.platformAdmin}
        or (not s.is_template and exists (
          select 1 from commerce.store_members m
          where m.store_id = s.id and m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
        ))
      )
  `);
  return row ? { id: String(row.id), slug: String(row.slug), name: String(row.name) } : null;
}

// ---------------------------------------------------------------------------
// What the wizard shows
// ---------------------------------------------------------------------------

const pageState = (draft: unknown, published: unknown): "draft" | "published" | "changed" =>
  published === null || published === undefined
    ? "draft"
    : JSON.stringify(draft) === JSON.stringify(published)
      ? "published"
      : "changed";

/** How many orders a copy carries: history, not orders still waiting for payment. */
const copyableOrders = (storeId: string) =>
  sql`(select count(*)::int from commerce.orders where store_id = ${storeId}::uuid and status <> 'pending_payment')`;

/** What an owner can choose from in a store they own: light rows to tick, and how many shoppers and orders there are. */
export async function copyChoices(
  account: Account,
  sourceSlug: string,
): Promise<StoreCopyResult<{ choices: CopyChoices }>> {
  const source = await sourceFor(account, sourceSlug);
  if (!source) return problem(NOT_COPYABLE);
  const list = 5000;
  const [pages, posts, products, [counts]] = await Promise.all([
    db().execute<Row>(sql`
      select id, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title, draft, published from commerce.pages
      where store_id = ${source.id}::uuid and type = 'page' order by updated_at desc limit ${list}
    `),
    db().execute<Row>(sql`
      select id, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title, draft, published from commerce.pages
      where store_id = ${source.id}::uuid and type = 'article' order by coalesce(first_published_at, created_at) desc limit ${list}
    `),
    db().execute<Row>(sql`
      select p.id, p.handle, p.status,
        coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and btrim(t.title) <> '' order by t.locale limit 1), p.handle) as title,
        (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m where m.product_id = p.id order by m.position limit 1) as image
      from commerce.products p where p.store_id = ${source.id}::uuid and p.status <> 'archived'
      order by p.created_at desc, p.id limit ${list}
    `),
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.customers where store_id = ${source.id}::uuid) as customers,
        ${copyableOrders(source.id)} as orders,
        (select count(*)::int from commerce.markets where store_id = ${source.id}::uuid) as markets,
        (select count(*)::int from commerce.menus where store_id = ${source.id}::uuid) as menus,
        (select count(*)::int from commerce.terms where store_id = ${source.id}::uuid) as terms,
        (select count(*)::int from commerce.pages where store_id = ${source.id}::uuid and type in ('header', 'footer', 'product_layout')) as layouts,
        (select count(*)::int from commerce.field_groups where store_id = ${source.id}::uuid) as groups,
        (select count(*)::int from commerce.campaigns where store_id = ${source.id}::uuid) as campaigns,
        (select count(*)::int from commerce.discount_codes where store_id = ${source.id}::uuid) as codes,
        (select count(*)::int from commerce.customer_tiers where store_id = ${source.id}::uuid) as tiers,
        (select count(*)::int from commerce.saved_parts where store_id = ${source.id}::uuid) as parts,
        (select count(*)::int from commerce.store_locations where store_id = ${source.id}::uuid) as locations,
        (select count(*)::int from commerce.inventory_locations where store_id = ${source.id}::uuid) as stock_locations
    `),
  ]);
  const n = (key: string) => Number(counts[key] ?? 0);
  const settings = [
    { label: "Markets", count: n("markets") },
    { label: "Menus", count: n("menus") },
    { label: "Categories and tags", count: n("terms") },
    { label: "Headers, footers and product layouts", count: n("layouts") },
    { label: "Custom field groups", count: n("groups") },
    { label: "Campaigns", count: n("campaigns") },
    { label: "Discount codes", count: n("codes") },
    { label: "Customer groups", count: n("tiers") },
    { label: "Saved rows and components", count: n("parts") },
    { label: "Shop addresses", count: n("locations") },
    { label: "Stock locations", count: n("stock_locations") },
  ].filter((item) => item.count > 0);
  const pageRow = (row: Row) => ({
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    state: pageState(row.draft, row.published),
  });
  return {
    ok: true,
    choices: {
      source: { slug: source.slug, name: source.name },
      pages: pages.map(pageRow),
      posts: posts.map(pageRow),
      products: products.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        handle: String(row.handle),
        status: String(row.status),
        image: row.image ? String(row.image) : null,
      })),
      customers: n("customers"),
      orders: n("orders"),
      settings,
    },
  };
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/** Whether every chosen id is one of the source's own (pages and posts by type, products not archived). */
async function chosenAreOwn(
  sourceId: string,
  kind: "pages" | "products" | "posts",
  selection: CopySelection,
): Promise<boolean> {
  if (selection.mode !== "selected") return true;
  const ids = [...new Set(selection.ids)];
  if (ids.length === 0) return true;
  const list = uuidList(ids);
  const [row] = await db().execute<Row>(
    kind === "products"
      ? sql`select count(*)::int as n from commerce.products where store_id = ${sourceId}::uuid and status <> 'archived' and id = any(${list}::uuid[])`
      : sql`select count(*)::int as n from commerce.pages where store_id = ${sourceId}::uuid and type = ${kind === "pages" ? "page" : "article"} and id = any(${list}::uuid[])`,
  );
  return Number(row?.n ?? 0) === ids.length;
}

/** The ids to pass to `duplicate_store()`: null for all, `{}` for none, or the chosen. */
const idsArg = (selection: CopySelection) => {
  if (selection.mode === "all") return sql`null::uuid[]`;
  const ids = selection.mode === "selected" ? [...new Set(selection.ids)] : [];
  return sql`${uuidList(ids)}::uuid[]`;
};

function creationProblem(error: unknown, slug: string): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
  }
  if (parts.join(" ").includes("stores_slug_unique")) return `The address ${slug} is taken. Choose another.`;
  return "The store could not be copied. Nothing was changed; try again.";
}

/**
 * Makes the new store from the source and starts the rest of the copy. The settings, pages, products and posts are
 * there when this returns (the owner can go to the new store's setup); pictures, customers and orders follow. Nothing
 * is made when anything is refused, and the reasons are plain sentences.
 */
export async function startStoreCopy(
  account: Account,
  input: unknown,
  deps: StoreCopyDeps = {},
): Promise<StoreCopyResult<{ id: string }>> {
  const parsed = storeCopyInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const { source: sourceSlug, name, options } = parsed.data;

  const source = await sourceFor(account, sourceSlug);
  if (!source) return problem(NOT_COPYABLE);

  // The new store is checked as `createStoreForOwner()` checks one: an address that is well formed and free, and the
  // owner's limit (platform admins have none).
  let slug = parsed.data.slug.toLowerCase();
  const derived = slug === "";
  if (derived) slug = suggestSlug(name);
  if (!slug) return problem("Enter an address for the new store.");
  const slugIssue = slugProblem(slug);
  if (slugIssue) return problem(`Store address: ${slugIssue}`);
  if (await isSlugTaken(slug)) {
    if (!derived) return problem(`The address ${slug} is taken. Choose another.`);
    let free: string | null = null;
    for (let n = 2; n < 10 && !free; n += 1) {
      const candidate = `${slug.slice(0, 37)}-${n}`;
      if (!(await isSlugTaken(candidate))) free = candidate;
    }
    if (!free) return problem(`The address ${slug} is taken. Choose another.`);
    slug = free;
  }
  const [owned] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.store_members m join commerce.stores s on s.id = m.store_id
        where m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
          and s.status <> 'closed' and not s.is_template) as stores,
      (select count(*)::int from commerce.store_copies c where c.requested_by = ${account.id}::uuid and c.status = 'running') as running
  `);
  if (!account.platformAdmin && Number(owned?.stores ?? 0) >= MAX_STORES_PER_OWNER) {
    return problem(`You can own up to ${MAX_STORES_PER_OWNER} stores. Contact Kaizen for more.`);
  }
  if (Number(owned?.running ?? 0) >= COPIES_RUNNING_MAX) {
    return problem("You already have stores being copied. Wait for one to finish, then try again.");
  }

  for (const kind of ["pages", "products", "posts"] as const) {
    if (!(await chosenAreOwn(source.id, kind, options[kind]))) {
      return problem(`Some of the ${kind} you chose are not in ${source.name}. Reload the list and choose again.`);
    }
  }

  let copyId: string;
  let newId: string;
  const counts = emptyCounts();
  try {
    ({ copyId, newId } = await db().transaction(async (tx) => {
      const [made] = await tx.execute<Row>(sql`
        select commerce.duplicate_store(
          ${source.id}::uuid, ${slug}, ${name.trim()}, ${account.id}::uuid,
          ${idsArg(options.pages)}, ${idsArg(options.products)}, ${idsArg(options.posts)}
        ) as id
      `);
      const storeId = String(made.id);
      const [made_counts] = await tx.execute<Row>(sql`
        select
          (select count(*)::int from commerce.pages where store_id = ${storeId}::uuid and type = 'page') as pages,
          (select count(*)::int from commerce.pages where store_id = ${storeId}::uuid and type = 'article') as posts,
          (select count(*)::int from commerce.products where store_id = ${storeId}::uuid) as products,
          (select count(*)::int from commerce.customers where store_id = ${source.id}::uuid) as customers,
          ${copyableOrders(source.id)} as orders
      `);
      for (const kind of ["pages", "posts", "products"] as const) {
        const total = Number(made_counts[kind]);
        counts[kind] = { done: total, total };
      }
      counts.customers.total = options.customers ? Number(made_counts.customers) : 0;
      counts.orders.total = options.orders ? Number(made_counts.orders) : 0;
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options, status, phase, counts)
        values (${source.id}::uuid, ${storeId}::uuid, ${account.id}::uuid, ${JSON.stringify(options)}::jsonb, 'running', 'media',
                ${JSON.stringify(counts)}::jsonb)
        returning id
      `);
      return { copyId: String(row.id), newId: storeId };
    }));
  } catch (error) {
    console.error("[store-copy] the copy could not be made:", error);
    return problem(creationProblem(error, slug));
  }

  // Both stores' audit trails say so, with numbers and never anything about customers.
  const summary = {
    copy: copyId,
    pages: counts.pages.total,
    products: counts.products.total,
    posts: counts.posts.total,
    customers: options.customers,
    orders: options.orders,
  };
  await audit(account.id, source.id, "store.copied", { ...summary, direction: "from", other: slug });
  await audit(account.id, newId, "store.copied", { ...summary, direction: "to", other: source.slug });

  const run = () => runStoreCopy(copyId, deps);
  const schedule =
    deps.schedule ??
    ((job: () => Promise<unknown>) => {
      try {
        after(job);
      } catch {
        // Not in a request (or no way to run after it): the five-minute job takes the copy up.
      }
    });
  schedule(run);
  return { ok: true, id: copyId };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/** Something that stops a copy for good, with what to tell the owner. */
class CopyStopped extends Error {}

type CopyRow = {
  id: string;
  sourceId: string;
  newId: string;
  accountId: string;
  options: StoreCopyOptions;
  phase: CopyPhase;
  counts: CopyCounts;
  cursor: {
    customers?: string | null;
    customersDone?: boolean;
    optOuts?: boolean;
    orders?: string | null;
    ordersDone?: boolean;
  };
  attempts: number;
};

function readCounts(value: unknown): CopyCounts {
  const counts = emptyCounts();
  if (typeof value === "object" && value !== null) {
    for (const kind of KINDS) {
      const entry = (value as Record<string, { done?: unknown; total?: unknown } | undefined>)[kind];
      if (entry) counts[kind] = { done: Number(entry.done ?? 0), total: Number(entry.total ?? 0) };
    }
  }
  return counts;
}

const readRow = (row: Row): CopyRow | null => {
  const options = storeCopyOptions.safeParse(row.options);
  if (!options.success) return null;
  return {
    id: String(row.id),
    sourceId: String(row.source_store_id),
    newId: String(row.new_store_id),
    accountId: String(row.requested_by),
    options: options.data,
    phase: (COPY_PHASES as readonly string[]).includes(String(row.phase)) ? (String(row.phase) as CopyPhase) : "media",
    counts: readCounts(row.counts),
    cursor: typeof row.cursor === "object" && row.cursor !== null ? (row.cursor as CopyRow["cursor"]) : {},
    attempts: Number(row.attempts),
  };
};

async function save(copy: CopyRow, patch: { phase?: CopyPhase } = {}): Promise<void> {
  if (patch.phase) copy.phase = patch.phase;
  await db().execute(sql`
    update commerce.store_copies
       set phase = ${copy.phase}, counts = ${JSON.stringify(copy.counts)}::jsonb, cursor = ${JSON.stringify(copy.cursor)}::jsonb,
           attempts = 1, updated_at = now()
     where id = ${copy.id}::uuid
  `);
}

/** After what is copied: the phase that follows, skipping what was not asked for. */
function nextPhase(copy: CopyRow): CopyPhase {
  const wantsPeople = copy.options.customers || copy.options.orders;
  const order: CopyPhase[] = ["media", "people", "orders", "finishing", "done"];
  const skipped = (phase: CopyPhase) =>
    (phase === "people" && !wantsPeople) || (phase === "orders" && !copy.options.orders);
  let next = order[order.indexOf(copy.phase) + 1] ?? "done";
  while (skipped(next)) next = order[order.indexOf(next) + 1] ?? "done";
  return next;
}

async function customersDone(copy: CopyRow): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.customers where store_id = ${copy.newId}::uuid and copied_from is not null
  `);
  return Number(row?.n ?? 0);
}

async function ordersDone(copy: CopyRow): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.orders where store_id = ${copy.newId}::uuid and copied_from is not null
  `);
  return Number(row?.n ?? 0);
}

/** The people phase: the shoppers in batches, then who unsubscribed. */
async function copyPeople(copy: CopyRow, until: number, batch: number): Promise<boolean> {
  if (copy.options.customers && !copy.cursor.customersDone) {
    while (Date.now() < until) {
      const [result] = await db().execute<Row>(sql`
        select * from commerce.copy_customers(${copy.sourceId}::uuid, ${copy.newId}::uuid, ${copy.cursor.customers ?? null}::uuid, ${batch})
      `);
      if (Number(result.handled) === 0) {
        copy.cursor.customersDone = true;
        copy.counts.customers.done = copy.counts.customers.total;
        await save(copy);
        break;
      }
      copy.cursor.customers = String(result.last_id);
      copy.counts.customers.done = Math.min(copy.counts.customers.total, await customersDone(copy));
      await save(copy);
    }
    if (!copy.cursor.customersDone) return false;
  }
  if (!copy.cursor.optOuts) {
    // People who unsubscribed stay unsubscribed, whichever of customers and orders came along.
    await db().execute(sql`select commerce.copy_opt_outs(${copy.sourceId}::uuid, ${copy.newId}::uuid)`);
    copy.cursor.optOuts = true;
    await save(copy);
  }
  return true;
}

/** The orders phase: history in batches. */
async function copyOrderHistory(copy: CopyRow, until: number, batch: number): Promise<boolean> {
  while (!copy.cursor.ordersDone && Date.now() < until) {
    const [result] = await db().execute<Row>(sql`
      select * from commerce.copy_orders(${copy.sourceId}::uuid, ${copy.newId}::uuid, ${copy.cursor.orders ?? null}::uuid, ${batch})
    `);
    if (Number(result.handled) === 0) {
      copy.cursor.ordersDone = true;
      copy.counts.orders.done = copy.counts.orders.total;
      await save(copy);
      break;
    }
    copy.cursor.orders = String(result.last_id);
    copy.counts.orders.done = Math.min(copy.counts.orders.total, await ordersDone(copy));
    await save(copy);
  }
  return Boolean(copy.cursor.ordersDone);
}

/** The chat agent's documents cut into passages (pages are cut by the five-minute job, as for any store). */
async function cutDocuments(storeId: string): Promise<void> {
  const documents = await db().execute<Row>(sql`
    select d.id, d.title, d.content from commerce.knowledge_documents d
    where d.store_id = ${storeId}::uuid and not exists (select 1 from commerce.knowledge_chunks c where c.document_id = d.id)
  `);
  for (const document of documents) {
    const passages = cutPassages(String(document.content));
    if (passages.length === 0) continue;
    await db().execute(sql`
      insert into commerce.knowledge_chunks (store_id, document_id, position, title, body, version)
      values ${sql.join(
        passages.map(
          (body, position) =>
            sql`(${storeId}::uuid, ${String(document.id)}::uuid, ${position}, ${String(document.title)}, ${body}, ${"document"})`,
        ),
        sql`, `,
      )}
    `);
  }
}

async function rebuildDerived(storeId: string): Promise<void> {
  await cutDocuments(storeId);
  // The rest is best effort: the new store's own five-minute jobs bring it up to date if a step stops here.
  const [{ refreshStoreFieldSearch }, { refreshStoreEmbeddings }] = await Promise.all([
    import("./field-search"),
    import("./embeddings"),
  ]);
  for (const step of [() => refreshStoreFieldSearch(storeId), () => refreshStoreEmbeddings(storeId)]) {
    try {
      await step();
    } catch (error) {
      console.warn("[store-copy] a step of finishing did not run:", error instanceof Error ? error.message : error);
    }
  }
}

async function invalidateCaches(storeId: string, slug: string): Promise<void> {
  try {
    const { revalidateTag } = await import("next/cache");
    const [{ storeTag }, { catalogTag }, { pagesTag }, { termsTag }, { fieldsTag }] = await Promise.all([
      import("./stores"),
      import("./catalog"),
      import("./pages"),
      import("./taxonomy"),
      import("./custom-fields"),
    ]);
    for (const tag of [
      storeTag(slug),
      catalogTag(storeId),
      pagesTag(storeId),
      fieldsTag(storeId),
      ...(["page", "article", "product"] as const).map((contentType) => termsTag({ storeId, contentType })),
    ]) {
      revalidateTag(tag, "max");
    }
  } catch (error) {
    // Outside a request there is nothing cached to refresh for a store this new; the caches expire on their own.
    console.warn("[store-copy] caches were not refreshed:", error instanceof Error ? error.message : error);
  }
}

async function fail(copy: { id: string; newId: string; accountId: string }, message: string): Promise<void> {
  await db().execute(sql`
    update commerce.store_copies
       set status = 'failed', problem = ${message}, claimed_until = null, finished_at = now(), updated_at = now()
     where id = ${copy.id}::uuid
  `);
  await audit(copy.accountId, copy.newId, "store.copy_failed", { copy: copy.id, problem: message });
}

const STOPPED_MESSAGE =
  "The copy stopped because of a problem on our side. What was copied is in the new store; you can use it as it is or delete it and try again.";

export type CopyRun = "done" | "failed" | "paused" | "busy" | "missing";

/**
 * One run of a copy's job: claims it (one run at a time), does the phases in order for as long as the time
 * allows, and lets go, to be taken up again by the next run. A run that finds nothing to claim does nothing.
 */
export async function runStoreCopy(id: string, deps: StoreCopyDeps = {}): Promise<CopyRun> {
  if (!isId(id)) return "missing";
  const [claimed] = await db().execute<Row>(sql`
    update commerce.store_copies
       set claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES}), attempts = attempts + 1, updated_at = now()
     where id = ${id}::uuid and status = 'running' and (claimed_until is null or claimed_until < now())
    returning *
  `);
  if (!claimed) {
    const [existing] = await db().execute<Row>(sql`select status from commerce.store_copies where id = ${id}::uuid`);
    return !existing ? "missing" : existing.status === "running" ? "busy" : (existing.status as "done" | "failed");
  }
  const copy = readRow(claimed);
  if (!copy) {
    await fail({ id, newId: String(claimed.new_store_id), accountId: String(claimed.requested_by) }, STOPPED_MESSAGE);
    return "failed";
  }
  if (copy.attempts > COPY_MAX_ATTEMPTS) {
    await fail(copy, `${STOPPED_MESSAGE} It was tried ${COPY_MAX_ATTEMPTS} times.`);
    return "failed";
  }

  const until = Date.now() + (deps.budgetMs ?? COPY_BUDGET_MS);
  try {
    while (copy.phase !== "done") {
      if (copy.phase === "queued" || copy.phase === "content" || copy.phase === "media") {
        const state = await copyStoreMedia(
          { copyId: copy.id, sourceId: copy.sourceId, newId: copy.newId, accountId: copy.accountId },
          until,
          deps,
        );
        copy.counts.media = { done: state.done, total: state.done + state.todo };
        await save(copy);
        if (!state.finished) break;
        copy.phase = "media";
        await save(copy, { phase: nextPhase(copy) });
      } else if (copy.phase === "people") {
        if (!(await copyPeople(copy, until, deps.customerBatch ?? CUSTOMER_BATCH))) break;
        await save(copy, { phase: nextPhase(copy) });
      } else if (copy.phase === "orders") {
        if (!(await copyOrderHistory(copy, until, deps.orderBatch ?? ORDER_BATCH))) break;
        await save(copy, { phase: nextPhase(copy) });
      } else if (copy.phase === "finishing") {
        await (deps.rebuild ?? rebuildDerived)(copy.newId);
        const pointing = await tablesPointingAtOriginal(copy.newId, copy.sourceId);
        if (pointing.length > 0) {
          console.error("[store-copy] the copy still names files of the original in:", pointing.join(", "));
          throw new CopyStopped(
            "Some pictures could not be separated from the original store, so the copy was stopped rather than share its files. Try the copy again, and tell Kaizen if it happens again.",
          );
        }
        const [store] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${copy.newId}::uuid`);
        await (deps.invalidate ?? invalidateCaches)(copy.newId, String(store?.slug ?? ""));
        await save(copy, { phase: "done" });
      }
    }
  } catch (error) {
    if (error instanceof CopyStopped) {
      await fail(copy, error.message);
      return "failed";
    }
    console.error(`[store-copy] ${copy.id} stopped in ${copy.phase}:`, error);
    await db().execute(
      sql`update commerce.store_copies set claimed_until = null, updated_at = now() where id = ${copy.id}::uuid`,
    );
    return "paused";
  }

  if (copy.phase === "done") {
    await db().execute(sql`
      update commerce.store_copies set status = 'done', phase = 'done', claimed_until = null, finished_at = now(), updated_at = now()
       where id = ${copy.id}::uuid
    `);
    await audit(copy.accountId, copy.newId, "store.copy_finished", {
      copy: copy.id,
      customers: copy.counts.customers.done,
      orders: copy.counts.orders.done,
      files: copy.counts.media.done,
    });
    return "done";
  }
  await db().execute(
    sql`update commerce.store_copies set claimed_until = null, updated_at = now() where id = ${copy.id}::uuid`,
  );
  return "paused";
}

/**
 * The five-minute job's share: takes up one copy that is not being worked on (never one that a run holds) and runs it.
 * Never throws.
 */
export async function runStoreCopies(deps: StoreCopyDeps = {}): Promise<{ ran: number; done: number; failed: number }> {
  try {
    const [next] = await db().execute<Row>(sql`
      select id from commerce.store_copies
      where status = 'running' and (claimed_until is null or claimed_until < now())
      order by started_at limit 1
    `);
    if (!next) return { ran: 0, done: 0, failed: 0 };
    const outcome = await runStoreCopy(String(next.id), deps);
    return {
      ran: outcome === "busy" || outcome === "missing" ? 0 : 1,
      done: outcome === "done" ? 1 : 0,
      failed: outcome === "failed" ? 1 : 0,
    };
  } catch (error) {
    console.error("[store-copy] the job failed:", error);
    return { ran: 0, done: 0, failed: 0 };
  }
}

// ---------------------------------------------------------------------------
// Reading progress
// ---------------------------------------------------------------------------

const summaryOf = (row: Row): StoreCopySummary => ({
  id: String(row.id),
  status: row.status as StoreCopySummary["status"],
  phase: (COPY_PHASES as readonly string[]).includes(String(row.phase)) ? (String(row.phase) as CopyPhase) : "queued",
  sourceName: String(row.source_name),
  sourceSlug: String(row.source_slug),
  newName: String(row.new_name),
  newSlug: String(row.new_slug),
  startedAt: new Date(String(row.started_at)).toISOString(),
  finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
});

const fromCopies = sql`
  from commerce.store_copies c
  join commerce.stores src on src.id = c.source_store_id
  join commerce.stores dst on dst.id = c.new_store_id
`;
const copyColumns = sql`
  c.id, c.status, c.phase, c.counts, c.media_left_out, c.problem, c.started_at, c.finished_at,
  src.name as source_name, src.slug as source_slug, dst.name as new_name, dst.slug as new_slug
`;

/**
 * A copy's progress, for the account that started it and nobody else: a malformed id, one that does not exist and one
 * that is someone else's all give the same answer.
 */
export async function copyProgress(
  account: Account,
  id: string,
): Promise<StoreCopyResult<{ progress: StoreCopyProgress }>> {
  if (typeof id !== "string" || !isId(id)) return problem(NOT_FOUND);
  const [row] = await db().execute<Row>(sql`
    select ${copyColumns} ${fromCopies} where c.id = ${id}::uuid and c.requested_by = ${account.id}::uuid
  `);
  if (!row) return problem(NOT_FOUND);
  return {
    ok: true,
    progress: {
      ...summaryOf(row),
      counts: readCounts(row.counts),
      mediaLeftOut: Number(row.media_left_out),
      problem: row.problem ? String(row.problem) : null,
    },
  };
}

/** The account's own copies, newest first (at most twenty), for "Recent copies". */
export async function listStoreCopies(account: Account): Promise<StoreCopySummary[]> {
  const rows = await db().execute<Row>(sql`
    select ${copyColumns} ${fromCopies} where c.requested_by = ${account.id}::uuid
    order by c.started_at desc limit ${RECENT_MAX}
  `);
  return rows.map(summaryOf);
}
