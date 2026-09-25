import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  TERMS_MAX,
  TERM_LABELS,
  selfAndDescendants,
  termInput,
  type ContentType,
  type Term,
  type TermKind,
  type TermScope,
} from "@/lib/taxonomy";

import { audit, type Account } from "./auth";

/**
 * Categories and tags (D50): Kaizen's for its pages, and each store's for
 * its products. Changing them revalidates `termsTag(scope)`; grids and
 * listings that show them also carry their content's tags.
 */

type Row = Record<string, unknown>;

export const termsTag = (scope: TermScope) => `terms:${scope.storeId ?? "platform"}:${scope.contentType}`;

export type TermsResult = { ok: true; id: string; terms: Term[] } | { ok: false; problems: string[] };

const toTerm = (row: Row): Term => ({
  id: String(row.id),
  kind: row.kind as TermKind,
  parentId: row.parent_id == null ? null : String(row.parent_id),
  name: String(row.name),
  slug: String(row.slug),
});

const scopeWhere = (scope: TermScope) =>
  sql`store_id is not distinct from ${scope.storeId}::uuid and content_type = ${scope.contentType}`;

/** Every category and tag of a scope, by name: for the admin. */
export async function listTerms(scope: TermScope): Promise<Term[]> {
  const rows = await db().execute<Row>(sql`
    select id, kind, parent_id, name, slug from commerce.terms
    where ${scopeWhere(scope)}
    order by kind, lower(name)
  `);
  return rows.map(toTerm);
}

/** The same for the site, cached until the scope's categories or tags change. */
export async function siteTerms(storeId: string | null, contentType: ContentType): Promise<Term[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(termsTag({ storeId, contentType }));
  const rows = await readDb().execute<Row>(sql`
    select id, kind, parent_id, name, slug from commerce.terms
    where ${scopeWhere({ storeId, contentType })}
    order by kind, lower(name)
  `);
  return rows.map(toTerm);
}

/**
 * The same, read now: for cached functions that carry `termsTag` themselves,
 * such as content grids, so they never see an older cached list.
 */
export async function currentTerms(storeId: string | null, contentType: ContentType): Promise<Term[]> {
  const rows = await readDb().execute<Row>(sql`
    select id, kind, parent_id, name, slug from commerce.terms
    where ${scopeWhere({ storeId, contentType })}
  `);
  return rows.map(toTerm);
}

/** Only the ids that are this scope's categories (or tags), each once. */
export async function scopedTermIds(scope: TermScope, kind: TermKind, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select id from commerce.terms
    where ${scopeWhere(scope)} and kind = ${kind}
      and id = any(${`{${unique.join(",")}}`}::uuid[])
  `);
  const known = new Set(rows.map((r) => String(r.id)));
  return unique.filter((id) => known.has(id));
}

function problemOf(error: unknown): string | null {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    const message = String((e as { message?: unknown }).message ?? "");
    if (code === "23505") return "taken";
    if (message.includes("inside itself")) return "A category cannot be inside itself or one of its own subcategories.";
    if (message.includes("same kind of content")) return "Choose a parent among these categories.";
  }
  return null;
}

const takenProblem = (kind: TermKind, slug: string) =>
  `Another ${TERM_LABELS[kind].one.toLowerCase()} already has the address ${slug}. Choose another.`;

/** A free address for a new term: its own, or with -2, -3 … when made from the name and taken. */
async function freeSlug(scope: TermScope, kind: TermKind, slug: string, chosen: boolean): Promise<string | null> {
  const rows = await db().execute<Row>(sql`
    select slug from commerce.terms where ${scopeWhere(scope)} and kind = ${kind}
      and (slug = ${slug} or slug like ${`${slug}-%`})
  `);
  const taken = new Set(rows.map((r) => String(r.slug)));
  if (!taken.has(slug)) return slug;
  if (chosen) return null;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug.slice(0, 75)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

async function checkParent(scope: TermScope, kind: TermKind, parentId: string | null): Promise<string | null> {
  if (kind === "tag" || parentId === null) return null;
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.terms where ${scopeWhere(scope)} and kind = 'category' and id = ${parentId}::uuid
  `);
  return row ? null : "Choose a parent among these categories.";
}

export async function createTerm(account: Account, scope: TermScope, input: unknown): Promise<TermsResult> {
  const parsed = termInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const term = parsed.data;
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.terms where ${scopeWhere(scope)}`);
  if (Number(count.n) >= TERMS_MAX) {
    return { ok: false, problems: [`There can be at most ${TERMS_MAX} categories and tags. Delete some first.`] };
  }
  const parentProblem = await checkParent(scope, term.kind, term.parentId);
  if (parentProblem) return { ok: false, problems: [parentProblem] };
  const chosen = (input as { slug?: unknown }).slug;
  const slug = await freeSlug(scope, term.kind, term.slug, typeof chosen === "string" && chosen.trim() !== "");
  if (!slug) return { ok: false, problems: [takenProblem(term.kind, term.slug)] };
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug)
      values (${scope.storeId}::uuid, ${scope.contentType}, ${term.kind}, ${term.parentId}::uuid, ${term.name}, ${slug})
      returning id
    `);
    const id = String(row.id);
    await audit(account.id, scope.storeId, `${scope.contentType}.${term.kind}_created`, { id, name: term.name, slug });
    return { ok: true, id, terms: await listTerms(scope) };
  } catch (error) {
    const problem = problemOf(error);
    if (!problem) throw error;
    return { ok: false, problems: [problem === "taken" ? takenProblem(term.kind, slug) : problem] };
  }
}

/** Renames, re-addresses or moves a category or tag; its kind stays. */
export async function updateTerm(account: Account, scope: TermScope, id: string, input: unknown): Promise<TermsResult> {
  const [existing] = await db().execute<Row>(sql`
    select kind from commerce.terms where ${scopeWhere(scope)} and id = ${id}::uuid
  `);
  if (!existing) return { ok: false, problems: ["This category or tag no longer exists. It may have been deleted."] };
  const kind = existing.kind as TermKind;
  const parsed = termInput.safeParse({ ...(input as object), kind });
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const term = parsed.data;
  if (term.parentId && selfAndDescendants(await listTerms(scope), id).has(term.parentId)) {
    return { ok: false, problems: ["A category cannot be inside itself or one of its own subcategories."] };
  }
  const parentProblem = await checkParent(scope, kind, term.parentId);
  if (parentProblem) return { ok: false, problems: [parentProblem] };
  try {
    await db().execute(sql`
      update commerce.terms set name = ${term.name}, slug = ${term.slug}, parent_id = ${term.parentId}::uuid, updated_at = now()
      where id = ${id}::uuid
    `);
    await audit(account.id, scope.storeId, `${scope.contentType}.${kind}_updated`, { id, name: term.name, slug: term.slug });
    return { ok: true, id, terms: await listTerms(scope) };
  } catch (error) {
    const problem = problemOf(error);
    if (!problem) throw error;
    return { ok: false, problems: [problem === "taken" ? takenProblem(kind, term.slug) : problem] };
  }
}

/**
 * Deletes a category or tag. A category's subcategories move up to its
 * parent; items lose it (a page when it is next saved: until then its
 * stored id no longer matches anything).
 */
export async function deleteTerm(account: Account, scope: TermScope, id: string): Promise<TermsResult> {
  const deleted = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select kind, name, slug, parent_id from commerce.terms where ${scopeWhere(scope)} and id = ${id}::uuid for update
    `);
    if (!row) return null;
    await tx.execute(sql`update commerce.terms set parent_id = ${row.parent_id}::uuid where parent_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.terms where id = ${id}::uuid`);
    return row;
  });
  if (!deleted) return { ok: false, problems: ["This category or tag no longer exists. It may have been deleted."] };
  await audit(account.id, scope.storeId, `${scope.contentType}.${String(deleted.kind)}_deleted`, {
    id,
    name: deleted.name,
    slug: deleted.slug,
  });
  return { ok: true, id, terms: await listTerms(scope) };
}

/** An owner's page and article categories and tags, for content grids of either (D57). */
export async function bothTerms(storeId: string | null): Promise<{ page: Term[]; article: Term[] }> {
  const [page, article] = await Promise.all([
    listTerms({ storeId, contentType: "page" }),
    listTerms({ storeId, contentType: "article" }),
  ]);
  return { page, article };
}
