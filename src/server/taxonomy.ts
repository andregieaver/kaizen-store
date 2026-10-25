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

import { termSeoInput, parseTermSeo, type TermSeo } from "@/lib/term-seo";
import { cleanTermDescription, parseTermDescription, parseTermTexts, termTextsInput, type TermTexts } from "@/lib/term-texts";
import type { RichTextDoc } from "@/lib/page-content";
import { parseTermRules, type TermRules } from "@/lib/term-rules";

import { audit, type Account } from "./auth";
import { refreshRedirects } from "./redirect-live";
import { getStore } from "./stores";
import { checkedRules, namedByRules, ruleMemberIds, type RuleChoices, type RuleCount } from "./term-rules";

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
  ...(row.requires_unit_price === undefined ? {} : { requiresUnitPrice: Boolean(row.requires_unit_price) }),
  ...(row.seo === undefined ? {} : { seo: parseTermSeo(row.seo) }),
  ...(row.texts === undefined ? {} : { texts: parseTermTexts(row.texts) }),
  ...(row.description === undefined ? {} : { description: parseTermDescription(row.description) }),
  ...(row.image_url === undefined
    ? {}
    : { image: row.image_url == null ? null : { url: String(row.image_url), thumbnailUrl: row.image_thumbnail_url == null ? null : String(row.image_thumbnail_url) } }),
  ...(row.rules === undefined ? {} : { rules: parseTermRules(row.rules) }),
});

/** The columns every reader of terms selects. */
const TERM_COLUMNS = sql.raw("id, kind, parent_id, name, slug, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, rules");

const scopeWhere = (scope: TermScope) =>
  sql`store_id is not distinct from ${scope.storeId}::uuid and content_type = ${scope.contentType}`;

/** Every category and tag of a scope, by name: for the admin. */
export async function listTerms(scope: TermScope): Promise<Term[]> {
  const rows = await db().execute<Row>(sql`
    select ${TERM_COLUMNS} from commerce.terms
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
    select ${TERM_COLUMNS} from commerce.terms
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
    select ${TERM_COLUMNS} from commerce.terms
    where ${scopeWhere({ storeId, contentType })}
  `);
  return rows.map(toTerm);
}

/** Only the ids that are this scope's categories (or tags) an item can be placed in, each once: never one filled by rules (D319). */
export async function scopedTermIds(scope: TermScope, kind: TermKind, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select id from commerce.terms
    where ${scopeWhere(scope)} and kind = ${kind} and rules is null
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

/** The unit price mark (D160) is for a store's product categories only: the database refuses it anywhere else. */
const UNIT_PRICE_MARK_PROBLEM = "Only a product category can need a price per kg or litre.";
const canNeedUnitPrice = (scope: TermScope, kind: TermKind) => scope.storeId !== null && scope.contentType === "product" && kind === "category";

/** Search texts are a store's product categories' and tags' (wave 2, D168): the languages are the store's own, never the browser's say-so. */
const SEO_SCOPE_PROBLEM = "Only a store's product categories and tags have search results texts.";

/**
 * The search texts to keep, checked against the languages the store offers (`termSeoInput`): the languages, the lengths, an empty language removed. Undefined
 * when the form sent none (the term keeps what it has).
 */
async function checkedSeo(scope: TermScope, raw: TermSeo | undefined): Promise<{ ok: true; seo: TermSeo | undefined } | { ok: false; problems: string[] }> {
  if (raw === undefined) return { ok: true, seo: undefined };
  if (scope.storeId === null || scope.contentType !== "product") {
    return Object.keys(raw).length === 0 ? { ok: true, seo: undefined } : { ok: false, problems: [SEO_SCOPE_PROBLEM] };
  }
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${scope.storeId}::uuid`);
  const store = row ? await getStore(String(row.slug)) : null;
  if (!store) return { ok: false, problems: ["This store could not be found."] };
  // Every language the store keeps texts in (D178): the editor sends back a hidden language's texts as they were.
  const parsed = termSeoInput(store.localization.keptLocales).safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  return { ok: true, seo: parsed.data };
}

/** A term's own page (D319) is a store's product categories' and tags' only: the database refuses it anywhere else. */
const PAGE_SCOPE_PROBLEM = "Only a store's product categories and tags have a description, a picture and names in other languages.";

type PageParts = { description: RichTextDoc | null | undefined; image: { url: string; thumbnailUrl: string | null } | null | undefined; texts: TermTexts | undefined };

/**
 * The term's own page as sent, checked (D319): the description cleaned (`cleanTermDescription()`), the other languages against the store's own
 * (`termTextsInput()`: the languages it keeps, never its main one, which is the term's own columns). Undefined parts were not sent (the term keeps
 * what it has).
 */
async function checkedPage(
  scope: TermScope,
  raw: { description?: unknown; image?: { url: string; thumbnailUrl: string | null } | null; texts?: Record<string, unknown> },
): Promise<{ ok: true; page: PageParts } | { ok: false; problems: string[] }> {
  const sent = raw.description !== undefined || raw.image !== undefined || raw.texts !== undefined;
  if (!sent) return { ok: true, page: { description: undefined, image: undefined, texts: undefined } };
  if (scope.storeId === null || scope.contentType !== "product") {
    const empty = raw.description == null && raw.image == null && (raw.texts === undefined || Object.keys(raw.texts).length === 0);
    return empty ? { ok: true, page: { description: undefined, image: undefined, texts: undefined } } : { ok: false, problems: [PAGE_SCOPE_PROBLEM] };
  }
  const description = raw.description === undefined ? undefined : cleanTermDescription(raw.description);
  if (description && !description.ok) return { ok: false, problems: [description.problem] };
  let texts: TermTexts | undefined;
  if (raw.texts !== undefined) {
    const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${scope.storeId}::uuid`);
    const store = row ? await getStore(String(row.slug)) : null;
    if (!store) return { ok: false, problems: ["This store could not be found."] };
    const parsed = termTextsInput(store.localization.keptLocales, store.localization.locales[0] ?? "").safeParse(raw.texts);
    if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
    texts = parsed.data;
  }
  return { ok: true, page: { description: description?.doc, image: raw.image, texts } };
}

/** Rules are a store's product categories' and tags' (D319): the database refuses them anywhere else. */
const RULES_SCOPE_PROBLEM = "Only a store's product categories and tags can be filled by rules.";
const RULES_UNIT_PRICE_PROBLEM = "A category filled by rules cannot need a price per kg or litre: mark the categories its products are placed in.";

/**
 * Rules as sent (D319): undefined when the form sent none (the term keeps what it has), null to fill it by hand, else checked against the store
 * (`checkedRules()`). A term another collection's rules name cannot be filled by rules itself.
 */
async function rulesFor(
  scope: TermScope,
  termId: string | null,
  raw: unknown,
  marked: boolean,
): Promise<{ ok: true; rules: TermRules | null | undefined } | { ok: false; problems: string[] }> {
  if (raw === undefined) return { ok: true, rules: undefined };
  if (raw === null) return { ok: true, rules: null };
  if (scope.storeId === null || scope.contentType !== "product") return { ok: false, problems: [RULES_SCOPE_PROBLEM] };
  if (marked) return { ok: false, problems: [RULES_UNIT_PRICE_PROBLEM] };
  if (termId) {
    const naming = await namedByRules(scope.storeId, termId);
    if (naming) return { ok: false, problems: [`${naming} is filled by rules that name this one, so this one is filled by hand.`] };
  }
  return checkedRules(scope.storeId, termId, raw);
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
  if (term.requiresUnitPrice && !canNeedUnitPrice(scope, term.kind)) return { ok: false, problems: [UNIT_PRICE_MARK_PROBLEM] };
  const seoChecked = await checkedSeo(scope, term.seo);
  if (!seoChecked.ok) return seoChecked;
  const seo = seoChecked.seo ?? {};
  const pageChecked = await checkedPage(scope, term);
  if (!pageChecked.ok) return pageChecked;
  const page = pageChecked.page;
  const rulesChecked = await rulesFor(scope, null, term.rules, term.requiresUnitPrice === true);
  if (!rulesChecked.ok) return rulesChecked;
  const rules = rulesChecked.rules ?? null;
  const chosen = (input as { slug?: unknown }).slug;
  const slug = await freeSlug(scope, term.kind, term.slug, typeof chosen === "string" && chosen.trim() !== "");
  if (!slug) return { ok: false, problems: [takenProblem(term.kind, term.slug)] };
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, rules)
      values (${scope.storeId}::uuid, ${scope.contentType}, ${term.kind}, ${term.parentId}::uuid, ${term.name}, ${slug}, ${term.requiresUnitPrice === true}, ${JSON.stringify(seo)}::jsonb,
        ${page.description ? JSON.stringify(page.description) : null}::jsonb, ${page.image?.url ?? null}, ${page.image?.thumbnailUrl ?? null}, ${JSON.stringify(page.texts ?? {})}::jsonb,
        ${rules ? JSON.stringify(rules) : null}::jsonb)
      returning id
    `);
    const id = String(row.id);
    await audit(account.id, scope.storeId, `${scope.contentType}.${term.kind}_created`, {
      id,
      name: term.name,
      slug,
      ...(term.requiresUnitPrice ? { requiresUnitPrice: true } : {}),
      ...(Object.keys(seo).length > 0 ? { seo: true } : {}),
      ...(page.description || page.image || (page.texts && Object.keys(page.texts).length > 0) ? { page: true } : {}),
      ...(rules ? { rules: rules.conditions.length } : {}),
    });
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
    select kind, slug, requires_unit_price, seo, description, image_url, texts, rules from commerce.terms where ${scopeWhere(scope)} and id = ${id}::uuid
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
  if (term.requiresUnitPrice && !canNeedUnitPrice(scope, kind)) return { ok: false, problems: [UNIT_PRICE_MARK_PROBLEM] };
  // Left out, the mark stays as it was; marking changes nothing in the shop at once (products already on sale are only reported).
  const marked = term.requiresUnitPrice ?? Boolean(existing.requires_unit_price);
  // Search texts: left out, they stay as they were; sent, they are the whole set (a language with both texts empty is removed).
  const seoChecked = await checkedSeo(scope, term.seo);
  if (!seoChecked.ok) return seoChecked;
  const seoChanged = seoChecked.seo !== undefined && JSON.stringify(seoChecked.seo) !== JSON.stringify(parseTermSeo(existing.seo));
  // The term's own page (D319): each part left out stays as it was.
  const pageChecked = await checkedPage(scope, term);
  if (!pageChecked.ok) return pageChecked;
  const page = pageChecked.page;
  const pageChanged =
    (page.description !== undefined && JSON.stringify(page.description) !== JSON.stringify(parseTermDescription(existing.description))) ||
    (page.image !== undefined && (page.image?.url ?? null) !== (existing.image_url == null ? null : String(existing.image_url))) ||
    (page.texts !== undefined && JSON.stringify(page.texts) !== JSON.stringify(parseTermTexts(existing.texts)));
  // Filled by rules (D319): left out, as it was.
  const before = parseTermRules(existing.rules);
  const rulesChecked = await rulesFor(scope, id, term.rules, marked);
  if (!rulesChecked.ok) return rulesChecked;
  const rules = rulesChecked.rules;
  if (marked && (rules === undefined ? before : rules)) return { ok: false, problems: [RULES_UNIT_PRICE_PROBLEM] };
  const rulesChanged = rules !== undefined && JSON.stringify(rules) !== JSON.stringify(before);
  try {
    await db().transaction(async (tx) => {
      if (rulesChanged && rules && !before) {
        // Turned on: the products placed by hand are taken out (the editor said so first); the rules hold its products from now on.
        await tx.execute(sql`delete from commerce.product_terms where store_id = ${scope.storeId}::uuid and term_id = ${id}::uuid`);
      }
      await tx.execute(sql`
        update commerce.terms set name = ${term.name}, slug = ${term.slug}, parent_id = ${term.parentId}::uuid,
          requires_unit_price = ${marked}, seo = ${seoChecked.seo === undefined ? sql`seo` : sql`${JSON.stringify(seoChecked.seo)}::jsonb`},
          description = ${page.description === undefined ? sql`description` : sql`${page.description ? JSON.stringify(page.description) : null}::jsonb`},
          image_url = ${page.image === undefined ? sql`image_url` : sql`${page.image?.url ?? null}`},
          image_thumbnail_url = ${page.image === undefined ? sql`image_thumbnail_url` : sql`${page.image?.thumbnailUrl ?? null}`},
          texts = ${page.texts === undefined ? sql`texts` : sql`${JSON.stringify(page.texts)}::jsonb`},
          rules = ${rules === undefined ? sql`rules` : sql`${rules ? JSON.stringify(rules) : null}::jsonb`},
          updated_at = now()
        where ${scopeWhere(scope)} and id = ${id}::uuid
      `);
      if (rulesChanged && rules === null && before && term.keepMatches && scope.storeId !== null) {
        // Turned off, keeping what matched: those products are placed in it by hand (in no order of the owner's yet).
        await tx.execute(sql`
          insert into commerce.product_terms (store_id, product_id, term_id)
          select p.store_id, p.id, ${id}::uuid from commerce.products p
          where p.store_id = ${scope.storeId}::uuid and commerce.product_matches_rules(p.store_id, p.id, ${JSON.stringify(before)}::jsonb)
          on conflict do nothing
        `);
      }
    });
    await audit(account.id, scope.storeId, `${scope.contentType}.${kind}_updated`, {
      id,
      name: term.name,
      slug: term.slug,
      ...(marked !== Boolean(existing.requires_unit_price) ? { requiresUnitPrice: marked } : {}),
      ...(seoChanged ? { seo: true } : {}),
      ...(pageChanged ? { page: true } : {}),
      ...(rulesChanged ? { rules: rules ? rules.conditions.length : 0, ...(rules === null && term.keepMatches ? { keptMatches: true } : {}) } : {}),
    });
    // A changed address left a redirect from the old one (the database's trigger): the lookup of a missing address is refreshed for it.
    if (scope.storeId !== null && String(existing.slug) !== term.slug) refreshRedirects(scope.storeId);
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

/** A product as a category's or tag's order lists it (D319): its title in the main language and its picture. */
export type TermProduct = { id: string; title: string; status: string; imageUrl: string | null; placed: boolean };

/** What the categories page hands its order panel (D319): the term's own products in order, and saving a new order. */
export type TermOrderActions = {
  products: (termId: string) => Promise<TermProduct[]>;
  saveOrder: (termId: string, productIds: string[]) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  /** Filled by rules (D319): what a rule may name, and how many products the rules being written hold. */
  ruleChoices?: (termId: string | null) => Promise<RuleChoices | null>;
  countRules?: (termId: string | null, rules: unknown) => Promise<({ ok: true } & RuleCount) | { ok: false; problems: string[] }>;
};

/** The most products a term's order lists and takes. */
export const TERM_ORDER_MAX = 500;

/**
 * A store's product category's or tag's own products (not its subcategories'), in the owner's order (wave 6 unit A, D319): placed products by
 * their place, then the others by when they were made. For the admin's panel; drafts and archived products are listed too.
 */
export async function termProducts(storeId: string, termId: string): Promise<TermProduct[]> {
  // A collection filled by rules (D319) lists what its rules hold now, newest first, as its page does; none is placed.
  const ruled = await ruleMemberIds(storeId, termId, TERM_ORDER_MAX);
  if (ruled.length > 0) {
    const rows = await db().execute<Row>(sql`
      select p.id, p.status,
        coalesce((select title from commerce.product_translations tr where tr.product_id = p.id order by tr.locale limit 1), p.handle) as title,
        (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m where m.product_id = p.id order by m.position limit 1) as image_url
      from commerce.products p where p.store_id = ${storeId}::uuid and p.id = any(${`{${ruled.join(",")}}`}::uuid[])
      order by array_position(${`{${ruled.join(",")}}`}::uuid[], p.id)
    `);
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      imageUrl: row.image_url == null ? null : String(row.image_url),
      placed: false,
    }));
  }
  const rows = await db().execute<Row>(sql`
    select p.id, p.status, pt.position,
      coalesce((select title from commerce.product_translations tr where tr.product_id = p.id order by tr.locale limit 1), p.handle) as title,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m where m.product_id = p.id order by m.position limit 1) as image_url
    from commerce.product_terms pt
    join commerce.products p on p.store_id = pt.store_id and p.id = pt.product_id
    where pt.store_id = ${storeId}::uuid and pt.content_type = 'product' and pt.term_id = ${termId}::uuid
    order by pt.position asc nulls last, p.created_at, p.handle
    limit ${TERM_ORDER_MAX}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    imageUrl: row.image_url == null ? null : String(row.image_url),
    placed: row.position != null,
  }));
}

/**
 * Puts a store's product category's or tag's products in the owner's order (D319): `productIds` first to last become places 0, 1, 2 …; the term's
 * products not named keep no place (listed after, by when they were made). Ids that are not the term's own products are ignored. One statement,
 * audited once; the term's `updated_at` moves, so the demo content's removal (D260) keeps a term whose order was set.
 */
export async function setTermOrder(account: Account, storeId: string, termId: string, productIds: readonly string[]): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const ids = [...new Set(productIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, TERM_ORDER_MAX);
  const [term] = await db().execute<Row>(sql`
    select kind, name, rules from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and id = ${termId}::uuid
  `);
  if (!term) return { ok: false, problems: ["This category or tag no longer exists. It may have been deleted."] };
  if (term.rules != null) return { ok: false, problems: ["This category is filled by rules: its products are listed newest first."] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.product_terms pt set position = case when o.place is null then null else o.place - 1 end
      from (select pt2.product_id, x.place from commerce.product_terms pt2
            left join unnest(${`{${ids.join(",")}}`}::uuid[]) with ordinality as x(id, place) on x.id = pt2.product_id
            where pt2.store_id = ${storeId}::uuid and pt2.term_id = ${termId}::uuid) o
      where pt.store_id = ${storeId}::uuid and pt.term_id = ${termId}::uuid and pt.product_id = o.product_id
    `);
    await tx.execute(sql`update commerce.terms set updated_at = now() where store_id = ${storeId}::uuid and id = ${termId}::uuid`);
  });
  await audit(account.id, storeId, `product.${String(term.kind)}_ordered`, { id: termId, name: term.name, products: ids.length }, { area: "products", target: { type: "term", id: termId } });
  return { ok: true };
}
