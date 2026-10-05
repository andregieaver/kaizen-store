import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { finding, type Finding } from "@/lib/data-job";
import { REDIRECTS_MAX, REDIRECT_BULK_DELETE_MAX, REDIRECT_PAGE_SIZE } from "@/lib/data-limits";
import { areaOfAction } from "@/lib/audit";
import { normaliseSource, normaliseTarget, pathOfTarget, type AddressContext } from "@/lib/redirect-path";
import type { RedirectLine } from "@/lib/redirect-csv";
import { planRedirectLines, writesOf, type LinePlan, type RedirectImportOptions } from "@/lib/redirect-plan";
import { redirectStatus, validateRedirect, type RedirectKind, type RedirectOrigin, type RedirectStatus } from "@/lib/redirects";

import { type Membership } from "./auth";
import { NO_ACCESS, memberCan } from "./permissions";
import { pgUuidArray } from "./pg-arrays";
import { addressContextOf, indexFor, liveOf, manualCountOf, pathsOfIndex, refreshRedirects, type Executor } from "./redirect-live";
import type { Store } from "./stores";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * The redirect manager's service (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2, 5.2): list, add, edit, delete and search a store's redirects.
 * **Only this module and the database's triggers write `commerce.redirects`** (`redirect-writers.test.ts` scans for another writer). Every function takes the
 * member, asks the key itself (`website:read` to read, `website:write` to change) and carries the store id in every statement; another store's redirect is "not
 * found". A change and its activity-log entry are one transaction: an entry that cannot be written means nothing was changed. Every write takes the store's
 * advisory lock (the one `commerce.redirects_no_loop()` takes), so the count against the limit and the loop check cannot be raced, and refreshes the cache tag
 * the lookup of a missing address is cached under.
 */

const WRITE = "website:write" as const;
const READ = "website:read" as const;

/** A short sentence for each refusal that is not a finding, never text from an address. */
export const REDIRECT_PROBLEMS = {
  forbidden: NO_ACCESS,
  not_found: "This redirect no longer exists. It may have been deleted.",
  not_logged: "The activity log could not be written, so nothing was changed. Try again.",
  too_many: `Choose at most ${REDIRECT_BULK_DELETE_MAX} redirects at a time.`,
  nothing: "Choose at least one redirect.",
  taken: "Another redirect already goes from that address. Edit that one instead.",
  automatic: "This redirect is made by Kaizen when an address changes. Delete it, or make a redirect of your own from the same address to replace it.",
} as const;
export type RedirectProblemCode = keyof typeof REDIRECT_PROBLEMS;

export type RedirectFailure = { ok: false; code: RedirectProblemCode | "invalid"; problems: string[]; findings: Finding[] };
const fail = (code: RedirectProblemCode | "invalid", findings: Finding[] = []): RedirectFailure => ({
  ok: false,
  code,
  problems: code === "invalid" ? findings.filter((f) => f.severity === "error").map((f) => f.text) : [REDIRECT_PROBLEMS[code]],
  findings,
});

export type SavedRedirect = {
  ok: true;
  id: string;
  /** The address it goes from and to, as stored (the final destination when the target was itself redirected). */
  source: string;
  target: string;
  /** False when a redirect from this address already existed (its target was replaced, or it was already as asked). */
  created: boolean;
  /** Nothing was written: the redirect was already there as asked. */
  unchanged: boolean;
  /** An automatic redirect from this address was replaced. */
  replacedAutomatic: boolean;
  /** Warnings and notes of the check (a chain collapsed, a target that does not exist, a query dropped). */
  findings: Finding[];
};

export type RedirectInput = { from: string; to: string };
export type RedirectDeps = { limit?: number };

/** Writes an entry of the activity log in the transaction of the change it describes (an entry that fails undoes the change). */
async function auditIn(tx: Tx, member: Pick<Membership, "account" | "store">, action: string, details: Record<string, unknown>, target: { type: string; id: string }): Promise<void> {
  await tx.execute(sql`
    insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id)
    values (${member.account.id}::uuid, ${member.store.id}::uuid, ${action}, ${JSON.stringify(details)}::jsonb, ${areaOfAction(action)}, ${target.type}, ${target.id})
  `);
}

/** The store's advisory lock for its redirects (the same key as `commerce.redirects_no_loop()`): held to the end of the transaction. */
export async function lockRedirects(run: Executor, storeId: string): Promise<void> {
  await run.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`redirects:${storeId}`}, 0))`);
}

// ---------------------------------------------------------------------------
// Writing lines: the one door
// ---------------------------------------------------------------------------

export type ChunkResult = { plans: LinePlan[]; written: number; replacedAutomatic: number; ids: Map<string, string> };

/**
 * Plans lines against the store as it is NOW and writes the ones that create or replace a manual redirect: the store is locked, the redirects and live
 * addresses the lines name are read inside the same transaction, `planRedirectLines()` (the pure plan an import's dry run uses) judges every line, and each
 * write deletes the automatic redirect it replaces and inserts or updates the manual one. The import's apply runs this on a chunk of 500 lines; the form and
 * the assistant on one; the migration importers of a later run call `addRedirects()`. The caller opens the transaction (and writes the activity entry in it).
 */
export async function writeLines(
  tx: Tx,
  store: Pick<Store, "id" | "slug" | "markets">,
  accountId: string | null,
  origin: RedirectOrigin,
  lines: readonly RedirectLine[],
  options: RedirectImportOptions,
  more: { duplicates?: ReadonlySet<number>; limit?: number; ctx?: AddressContext } = {},
): Promise<ChunkResult> {
  const ctx = more.ctx ?? addressContextOf(store);
  await lockRedirects(tx, store.id);
  const seeds: string[] = [];
  for (const line of lines) {
    const from = normaliseSource(line.from, ctx);
    if (from.ok) seeds.push(from.source);
    const to = normaliseTarget(line.to, ctx);
    if (to.ok) seeds.push(to.path);
  }
  const index = await indexFor(store.id, seeds, tx);
  const live = await liveOf(store.id, [...seeds, ...pathsOfIndex(index)], tx);
  const manualCount = await manualCountOf(store.id, tx);
  const plans = planRedirectLines(lines, { ctx, live, index, manualCount, options, limit: more.limit, duplicates: more.duplicates });
  const ids = new Map<string, string>();
  let replacedAutomatic = 0;
  let written = 0;
  for (const write of writesOf(plans)) {
    if (write.replacesAutomatic) {
      await tx.execute(sql`delete from commerce.redirects where store_id = ${store.id}::uuid and source = ${write.source} and kind <> 'manual'`);
      replacedAutomatic += 1;
    }
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.redirects (store_id, kind, source, target, origin, created_by)
      values (${store.id}::uuid, 'manual', ${write.source}, ${write.target}, ${origin}, ${accountId}::uuid)
      on conflict on constraint redirects_store_source_key
      do update set target = excluded.target, origin = excluded.origin, updated_at = now()
      returning id
    `);
    ids.set(write.source, String(row.id));
    written += 1;
  }
  return { plans, written, replacedAutomatic, ids };
}

const originOf = (given: RedirectOrigin | undefined): RedirectOrigin => (given === "report" || given === "assistant" || given === "import" ? given : "editor");

/**
 * Adds a manual redirect from an address to an address (or replaces the target of the one from that address). The check is `validateRedirect()`: a refusal
 * names each problem with its finding; a warning (a chain collapsed to its final destination, a target that does not exist) is saved and returned. Writes the
 * entry `redirect.created` or `redirect.updated` with the two addresses and nothing else.
 */
export async function createRedirect(member: Membership, input: RedirectInput, options: { origin?: RedirectOrigin } & RedirectDeps = {}): Promise<SavedRedirect | RedirectFailure> {
  if (!memberCan(member, WRITE)) return fail("forbidden");
  try {
    return await db().transaction(async (tx) => {
      const result = await writeLines(tx, member.store, member.account.id, originOf(options.origin), [{ row: 1, from: String(input.from ?? ""), to: String(input.to ?? "") }], { existing: "replace" }, { limit: options.limit });
      const plan = result.plans[0];
      if (plan.action === "error" || plan.source === null || plan.target === null) return fail("invalid", plan.findings);
      const id = result.ids.get(plan.source) ?? (await idOfSource(tx, member.store.id, plan.source));
      if (plan.action !== "unchanged") {
        const existed = plan.action === "replace";
        await auditIn(tx, member, existed ? "redirect.updated" : "redirect.created", { from: plan.source, to: plan.target }, { type: "redirect", id });
      }
      return { ok: true as const, id, source: plan.source, target: plan.target, created: plan.action === "create", unchanged: plan.action === "unchanged", replacedAutomatic: plan.replacesAutomatic, findings: plan.findings };
    }).then((out) => {
      if (out.ok && !out.unchanged) refreshRedirects(member.store.id);
      return out;
    });
  } catch (error) {
    return failureOf(error);
  }
}

/** The batch door for what imports redirects (the migration importers of a later run): the same checks, one transaction, the lines judged in order. No entry is written here: the caller writes one for the whole batch. */
export async function addRedirects(
  member: Membership,
  lines: readonly RedirectInput[],
  options: { origin?: RedirectOrigin; existing?: RedirectImportOptions["existing"] } & RedirectDeps = {},
): Promise<{ ok: true; plans: LinePlan[]; written: number } | RedirectFailure> {
  if (!memberCan(member, WRITE)) return fail("forbidden");
  const numbered: RedirectLine[] = lines.map((l, i) => ({ row: i + 1, from: String(l.from ?? ""), to: String(l.to ?? "") }));
  try {
    const out = await db().transaction((tx) => writeLines(tx, member.store, member.account.id, originOf(options.origin), numbered, { existing: options.existing ?? "replace" }, { limit: options.limit }));
    if (out.written > 0 || out.replacedAutomatic > 0) refreshRedirects(member.store.id);
    return { ok: true, plans: out.plans, written: out.written };
  } catch (error) {
    return failureOf(error);
  }
}

async function idOfSource(run: Executor, storeId: string, source: string): Promise<string> {
  const [row] = await run.execute<Row>(sql`select id from commerce.redirects where store_id = ${storeId}::uuid and source = ${source}`);
  return String(row.id);
}

/** The database's refusal of a loop is the same finding the check makes (a race that got past the check); anything else is not ours to hide. */
function failureOf(error: unknown): RedirectFailure {
  const text = JSON.stringify({ m: (error as Error)?.message, c: (error as { cause?: { message?: string } })?.cause?.message });
  if (text.includes("redirect.loop")) return fail("invalid", [finding("target.loop", {})]);
  if (text.includes("audit_log")) return fail("not_logged");
  throw error;
}

/**
 * Checks an address pair for the form as it is typed, without writing: the findings, the final destination that would be stored, and what exists for the
 * address now (a manual redirect with its target, or an automatic one). `website:read`.
 */
export async function checkRedirect(member: Membership, input: RedirectInput, deps: RedirectDeps = {}): Promise<{ ok: true; ok_to_save: boolean; source: string | null; target: string | null; findings: Finding[]; existing: { kind: "manual"; target: string } | { kind: "automatic" } | null } | RedirectFailure> {
  if (!memberCan(member, READ)) return fail("forbidden");
  const ctx = addressContextOf(member.store);
  const from = normaliseSource(String(input.from ?? ""), ctx);
  const to = normaliseTarget(String(input.to ?? ""), ctx);
  const seeds = [...(from.ok ? [from.source] : []), ...(to.ok ? [to.path] : [])];
  const index = await indexFor(member.store.id, seeds);
  const live = await liveOf(member.store.id, [...seeds, ...pathsOfIndex(index)]);
  const check = validateRedirect({ from: String(input.from ?? ""), to: String(input.to ?? "") }, { ctx, live, index, manualCount: await manualCountOf(member.store.id), limit: deps.limit });
  return { ok: true, ok_to_save: check.ok, source: check.source, target: check.target, findings: check.findings, existing: check.existing };
}

/**
 * Edits a manual redirect: its source, its target or both. An automatic one is not edited (make one of your own from its address, which replaces it). A source
 * that another manual redirect already has is refused; one that an automatic redirect has replaces it. The check is the add form's, with this redirect left
 * out of what it is checked against, and the count against the limit unchanged.
 */
export async function updateRedirect(member: Membership, id: string, input: RedirectInput, deps: RedirectDeps = {}): Promise<SavedRedirect | RedirectFailure> {
  if (!memberCan(member, WRITE)) return fail("forbidden");
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return fail("not_found");
  try {
    const out = await db().transaction(async (tx) => {
      const store = member.store;
      await lockRedirects(tx, store.id);
      const [current] = await tx.execute<Row>(sql`select id, kind, source, target from commerce.redirects where store_id = ${store.id}::uuid and id = ${id}::uuid for update`);
      if (!current) return fail("not_found");
      if (String(current.kind) !== "manual") return fail("automatic");
      const ctx = addressContextOf(store);
      const from = normaliseSource(String(input.from ?? ""), ctx);
      const to = normaliseTarget(String(input.to ?? ""), ctx);
      const seeds = [String(current.source), ...(from.ok ? [from.source] : []), ...(to.ok ? [to.path] : [])];
      const index = await indexFor(store.id, seeds, tx);
      // This redirect is not what it is checked against: its old address is free, and it does not count twice.
      const manual = new Map(index.manual);
      manual.delete(String(current.source));
      const others = { manual, automatic: index.automatic };
      const live = await liveOf(store.id, [...seeds, ...pathsOfIndex(others)], tx);
      const manualCount = (await manualCountOf(store.id, tx)) - 1;
      const check = validateRedirect({ from: String(input.from ?? ""), to: String(input.to ?? "") }, { ctx, live, index: others, manualCount, limit: deps.limit ?? REDIRECTS_MAX });
      const findings = check.findings.filter((f) => f.code !== "exists.same" && f.code !== "exists.update");
      if (!check.ok || check.source === null || check.target === null) return fail("invalid", findings);
      if (check.existing?.kind === "manual") return fail("taken", findings);
      if (check.existing?.kind === "automatic") await tx.execute(sql`delete from commerce.redirects where store_id = ${store.id}::uuid and source = ${check.source} and kind <> 'manual'`);
      const unchanged = check.source === String(current.source) && check.target === String(current.target);
      if (!unchanged) {
        await tx.execute(sql`update commerce.redirects set source = ${check.source}, target = ${check.target}, updated_at = now() where store_id = ${store.id}::uuid and id = ${id}::uuid`);
        await auditIn(tx, member, "redirect.updated", { from: check.source, to: check.target }, { type: "redirect", id });
      }
      return { ok: true as const, id, source: check.source, target: check.target, created: false, unchanged, replacedAutomatic: check.existing?.kind === "automatic", findings };
    });
    if (out.ok && !out.unchanged) refreshRedirects(member.store.id);
    return out;
  } catch (error) {
    return failureOf(error);
  }
}

/**
 * Deletes redirects of any kind (the automatic ones too: an owner may not want one), at most 200 at a time. One entry `redirect.deleted` with the count and,
 * for a single redirect, its two addresses. A redirect of another store is left alone and not counted.
 */
export async function deleteRedirects(member: Membership, ids: readonly string[]): Promise<{ ok: true; deleted: number } | RedirectFailure> {
  if (!memberCan(member, WRITE)) return fail("forbidden");
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return fail("nothing");
  if (unique.length > REDIRECT_BULK_DELETE_MAX) return fail("too_many");
  try {
    const deleted = await db().transaction(async (tx) => {
      await lockRedirects(tx, member.store.id);
      const rows = await tx.execute<Row>(sql`
        delete from commerce.redirects
         where store_id = ${member.store.id}::uuid and id = any(${pgUuidArray(unique)}::uuid[])
        returning id, kind, source, target
      `);
      if (rows.length === 0) return 0;
      const one = rows.length === 1 ? rows[0] : null;
      const details = one ? { count: 1, from: String(one.source), ...(one.target ? { to: String(one.target) } : {}), kind: String(one.kind) } : { count: rows.length };
      await auditIn(tx, member, "redirect.deleted", details, { type: "redirect", id: String((one ?? rows[0]).id) });
      return rows.length;
    });
    if (deleted > 0) refreshRedirects(member.store.id);
    return { ok: true, deleted };
  } catch (error) {
    return failureOf(error);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The filters of the list (2.2.1): everything, manual ones, a product's, categories' and tags', or pages' and articles' (read only, kept by `page_redirects`). */
export const REDIRECT_FILTERS = ["all", "manual", "products", "terms", "pages"] as const;
export type RedirectFilter = (typeof REDIRECT_FILTERS)[number];

export type ListedRedirect = {
  id: string;
  kind: RedirectKind | "page" | "article";
  source: string;
  /** The stored target of a manual one; the current address of the thing for an automatic one and a page's (null when it is not live). */
  target: string | null;
  origin: RedirectOrigin | "system";
  /** Requests, a lower bound; null for a page's (kept by `page_redirects`, which does not count). */
  hits: number | null;
  lastHitAt: string | null;
  createdAt: string;
  /** Who made it: a person's name or email, or null for one the system made. */
  createdBy: string | null;
  /** A page's or article's: shown, never edited here. */
  readOnly: boolean;
  status: RedirectStatus;
  /** How many more redirects a chain goes through. */
  more: number;
};

export type RedirectList = { rows: ListedRedirect[]; total: number; page: number; pages: number; pageSize: number; manual: number; limit: number };

/** A search text as a `like` pattern: `%`, `_` and `\` are the text's own. */
export const likePattern = (text: string): string => `%${text.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

/**
 * A page of the store's redirects, newest first (2.2.1): `q` matches the source or the target as a substring, case-insensitively (the trigram indexes keep
 * it fast at 100,000 rows). Each row carries its status (an address that is live now is not used; a target that is not a live address is a warning; a chain
 * says how many more redirects it goes through). `website:read`; an empty list for a member without it.
 */
export async function listRedirects(member: Membership, query: { q?: string; filter?: RedirectFilter; page?: number } = {}): Promise<RedirectList> {
  const size = REDIRECT_PAGE_SIZE;
  const empty: RedirectList = { rows: [], total: 0, page: 1, pages: 1, pageSize: size, manual: 0, limit: REDIRECTS_MAX };
  if (!memberCan(member, READ)) return empty;
  const storeId = member.store.id;
  const filter: RedirectFilter = REDIRECT_FILTERS.includes(query.filter as RedirectFilter) ? (query.filter as RedirectFilter) : "all";
  const q = (query.q ?? "").trim().slice(0, 200);
  const pattern = q === "" ? null : likePattern(q);
  const wantsRedirects = filter !== "pages";
  const wantsPages = filter === "all" || filter === "pages";
  const kindFilter = filter === "manual" ? sql`and r.kind = 'manual'` : filter === "products" ? sql`and r.kind = 'product'` : filter === "terms" ? sql`and r.kind in ('category', 'tag')` : sql``;
  const searchR = pattern === null ? sql`` : sql`and (lower(r.source) like ${pattern} escape '\\' or lower(r.target) like ${pattern} escape '\\')`;
  const searchP = pattern === null ? sql`` : sql`and lower(case when pr.type = 'article' then '/blog/' || pr.slug else '/' || pr.slug end) like ${pattern} escape '\\'`;

  const redirects = wantsRedirects
    ? sql`
      select r.id, r.kind, r.source, r.target, r.product_id, r.term_id, r.origin, r.hits, r.last_hit_at, r.created_at, r.created_by,
        case r.kind
          when 'product' then (select '/p/' || p.handle from commerce.products p where p.store_id = r.store_id and p.id = r.product_id and p.status = 'active')
          when 'category' then (select '/category/' || t.slug from commerce.terms t where t.store_id = r.store_id and t.id = r.term_id)
          when 'tag' then (select '/tag/' || t.slug from commerce.terms t where t.store_id = r.store_id and t.id = r.term_id)
          else r.target
        end as shown_target,
        false as read_only
      from commerce.redirects r
      where r.store_id = ${storeId}::uuid ${kindFilter} ${searchR}`
    : null;
  const pageRows = wantsPages
    ? sql`
      select pr.id, pr.type as kind, case when pr.type = 'article' then '/blog/' || pr.slug else '/' || pr.slug end as source, null::text as target,
        null::uuid as product_id, null::uuid as term_id, 'system' as origin, null::bigint as hits, null::timestamptz as last_hit_at, pr.created_at, null::uuid as created_by,
        (select case when pg.type = 'article' then '/blog/' || pg.slug else '/' || pg.slug end from commerce.pages pg where pg.id = pr.page_id and pg.store_id = pr.store_id and pg.published_at is not null) as shown_target,
        true as read_only
      from commerce.page_redirects pr
      where pr.store_id = ${storeId}::uuid ${searchP}`
    : null;
  const source = redirects && pageRows ? sql`${redirects} union all ${pageRows}` : (redirects ?? pageRows)!;

  const [counts] = await db().execute<Row>(sql`select count(*)::int as n from (${source}) u`);
  const total = Number(counts?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), pages);
  const rows = await db().execute<Row>(sql`
    select u.*, coalesce(nullif(a.name, ''), a.email) as maker
    from (${source}) u left join commerce.accounts a on a.id = u.created_by
    order by u.created_at desc, u.id
    limit ${size} offset ${(page - 1) * size}
  `);
  const manual = await manualCountOf(storeId);

  const sources = rows.map((r) => String(r.source));
  const index = await indexFor(storeId, sources);
  const targets = rows.flatMap((r) => (r.shown_target ? [pathOfTarget(String(r.shown_target))] : []));
  const live = await liveOf(storeId, [...sources, ...targets, ...pathsOfIndex(index)]);
  const listed = rows.map((r): ListedRedirect => {
    const kind = String(r.kind) as ListedRedirect["kind"];
    const readOnly = Boolean(r.read_only);
    const shown = r.shown_target === null || r.shown_target === undefined ? null : String(r.shown_target);
    const status = readOnly
      ? { status: (shown === null ? "target_missing" : "active") as RedirectStatus, more: 0 }
      : redirectStatus({ kind: kind as RedirectKind, source: String(r.source), target: r.target ? String(r.target) : null }, { live, index });
    return {
      id: String(r.id),
      kind,
      source: String(r.source),
      target: shown,
      origin: String(r.origin) as ListedRedirect["origin"],
      hits: r.hits === null || r.hits === undefined ? null : Number(r.hits),
      lastHitAt: r.last_hit_at ? new Date(String(r.last_hit_at)).toISOString() : null,
      createdAt: new Date(String(r.created_at)).toISOString(),
      createdBy: r.maker ? String(r.maker) : null,
      readOnly,
      status: status.status,
      more: status.more,
    };
  });
  return { rows: listed, total, page, pages, pageSize: size, manual, limit: REDIRECTS_MAX };
}

export type RedirectCounts = { manual: number; product: number; category: number; tag: number; page: number; article: number; total: number; limit: number };

/** How many redirects the store has of each kind (pages' and articles' from `page_redirects` too), for the list's header and the assistant. Counted in code from the rows, never estimated. `website:read`. */
export async function redirectCounts(member: Membership): Promise<RedirectCounts | null> {
  if (!memberCan(member, READ)) return null;
  return redirectCountsOf(member.store.id);
}

/** The same for a caller that has already checked the key. */
export async function redirectCountsOf(storeId: string): Promise<RedirectCounts> {
  const rows = await db().execute<Row>(sql`
    select kind, count(*)::int as n from commerce.redirects where store_id = ${storeId}::uuid group by kind
    union all
    select type, count(*)::int from commerce.page_redirects where store_id = ${storeId}::uuid group by type
  `);
  const out: RedirectCounts = { manual: 0, product: 0, category: 0, tag: 0, page: 0, article: 0, total: 0, limit: REDIRECTS_MAX };
  for (const row of rows) {
    const kind = String(row.kind) as keyof Omit<RedirectCounts, "total" | "limit">;
    if (kind in out) out[kind] += Number(row.n);
    out.total += Number(row.n);
  }
  return out;
}

/** One redirect of the store (any kind), for the edit form; null for another store's or none. `website:read`. */
export async function getRedirect(member: Membership, id: string): Promise<{ id: string; kind: RedirectKind; source: string; target: string | null } | null> {
  if (!memberCan(member, READ) || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const [row] = await db().execute<Row>(sql`select id, kind, source, target from commerce.redirects where store_id = ${member.store.id}::uuid and id = ${id}::uuid`);
  return row ? { id: String(row.id), kind: String(row.kind) as RedirectKind, source: String(row.source), target: row.target ? String(row.target) : null } : null;
}

/** Everything the export needs of a store's redirects, a page at a time by source (a cursor): `automatic` adds the product, category and tag ones. */
export async function redirectsForExport(storeId: string, o: { automatic: boolean; after: string | null; limit: number }): Promise<{ rows: { kind: RedirectKind; source: string; target: string | null; createdAt: Date; hits: number; lastHitAt: Date | null }[]; last: string | null; more: boolean }> {
  const rows = await db().execute<Row>(sql`
    select r.kind, r.source,
      case r.kind
        when 'manual' then r.target
        when 'product' then (select '/p/' || p.handle from commerce.products p where p.store_id = r.store_id and p.id = r.product_id and p.status = 'active')
        when 'category' then (select '/category/' || t.slug from commerce.terms t where t.store_id = r.store_id and t.id = r.term_id)
        else (select '/tag/' || t.slug from commerce.terms t where t.store_id = r.store_id and t.id = r.term_id)
      end as target,
      r.created_at, r.hits, r.last_hit_at
    from commerce.redirects r
    where r.store_id = ${storeId}::uuid ${o.automatic ? sql`` : sql`and r.kind = 'manual'`} ${o.after === null ? sql`` : sql`and r.source > ${o.after}`}
    order by r.source limit ${o.limit + 1}
  `);
  const page = rows.slice(0, o.limit);
  return {
    rows: page.map((r) => ({ kind: String(r.kind) as RedirectKind, source: String(r.source), target: r.target ? String(r.target) : null, createdAt: new Date(String(r.created_at)), hits: Number(r.hits), lastHitAt: r.last_hit_at ? new Date(String(r.last_hit_at)) : null })),
    last: page.length > 0 ? String(page[page.length - 1].source) : o.after,
    more: rows.length > o.limit,
  };
}

// ---------------------------------------------------------------------------
// Counting a request
// ---------------------------------------------------------------------------

const hitWritten = new Map<string, number>();

/**
 * Counts a request an existing redirect answered (`hits` and `last_hit_at`, the only change anyone but the manager makes to a redirect row): a lower bound,
 * throttled to one write a second per redirect and instance, never for the build's prerender; never throws. The cached lookup calls it in its fill.
 */
export async function countHit(storeId: string, redirectId: string, now: number = Date.now()): Promise<void> {
  try {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const before = hitWritten.get(redirectId);
    if (before !== undefined && now - before < 1_000) return;
    if (hitWritten.size > 5_000) hitWritten.clear();
    hitWritten.set(redirectId, now);
    await db().execute(sql`update commerce.redirects set hits = hits + 1, last_hit_at = now() where store_id = ${storeId}::uuid and id = ${redirectId}::uuid`);
  } catch (error) {
    console.error("[redirects] a hit could not be counted", error instanceof Error ? error.message : error);
  }
}
