import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { OwnerToolInput } from "@/lib/owner-tools";
import { normaliseTarget } from "@/lib/redirect-path";
import { readRule } from "@/lib/search-rules";
import { readSynonym, synonymLine } from "@/lib/search-synonyms";
import { ruleSentence, ruleProblemWords, synonymProblemWords } from "@/lib/search-tools";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { addressContextOf } from "./redirect-live";
import { searchStats } from "./search";
import { deleteRule, listRules, saveRule } from "./search-rules";
import { deleteSynonym, listSynonyms, saveSynonym } from "./search-synonyms";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The AI manager's search tools (wave 6 unit F3, D324, `docs/wave-6-catalogue.md` F.3): `search_merchandising` reads the Search page's
 * synonyms, rules and searches that found nothing; `save_search_synonym`, `save_search_rule` and `delete_search_merchandising` change what
 * shoppers find, so each waits for the owner's yes (gate `public`) and goes through the page's own writers (`saveSynonym()`, `saveRule()`,
 * `deleteSynonym()`, `deleteRule()`). A product is named by its handle and a category or tag by its slug, turned into the store's own ids here;
 * the sentences are written in code (`ruleSentence()`), never by the model.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store) => `/admin/${store.slug}/search`;

/** The store's synonyms and rules, and the searches of the last 30 days that found nothing. */
export async function searchMerchandisingTool({ store }: Ctx) {
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const [synonyms, rules, stats] = await Promise.all([listSynonyms(store.id), listRules(store.id, locale), searchStats(store.id)]);
  return {
    synonyms: synonyms.map((row) => ({ id: row.id, language: row.locale, kind: row.kind, line: synonymLine(row) })),
    rules: rules.map((row) => ({ id: row.id, action: row.action, line: ruleSentence(row) })),
    found_nothing: stats.zero.map((row) => ({ search: row.query, times: row.count })),
    languages: store.localization.keptLocales,
    admin: adminLink(store),
  };
}

/** A product's id by its handle, the store's own only. */
async function productIdOf(store: Store, handle: string): Promise<string> {
  const row = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.products where store_id = ${store.id}::uuid and handle = ${handle}`);
  return row?.id ?? fail(`The store has no product with the handle "${handle}". Read it from list_products.`);
}

/** A category's or tag's id by its slug, the catalogue's own only. */
async function termIdOf(store: Store, kind: "category" | "tag", slug: string): Promise<string> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.terms where store_id = ${store.id}::uuid and content_type = 'product' and kind = ${kind} and slug = ${slug}`,
  );
  return row?.id ?? fail(`The store has no ${kind} "${slug}". Read it from list_categories.`);
}

/** A rule's arguments as the page's writer takes them: the store's own ids for the product and the category or tag. */
async function ruleInput(store: Store, input: OwnerToolInput<"save_search_rule">) {
  return {
    id: input.id ?? null,
    action: input.action,
    productId: input.product ? await productIdOf(store, input.product) : null,
    termId: input.category ? await termIdOf(store, "category", input.category) : input.tag ? await termIdOf(store, "tag", input.tag) : null,
    target: input.page ?? null,
    queries: input.searches,
    match: input.match,
    position: input.position,
  };
}

const synonymInput = (input: OwnerToolInput<"save_search_synonym">) => ({
  id: input.id ?? null,
  locale: input.language,
  kind: input.kind,
  words: input.words,
  means: input.means ?? [],
});

export async function saveSearchSynonymTool(ctx: Ctx, input: OwnerToolInput<"save_search_synonym">) {
  const saved = await saveSynonym(ctx, synonymInput(input));
  if (!saved.ok) return fail(synonymProblemWords(saved.problems));
  return { done: `${input.id ? "Changed" : "Added"} the synonyms: searches in ${input.language} find them as said.`, id: saved.id, admin: adminLink(ctx.store) };
}

export async function saveSearchRuleTool(ctx: Ctx, input: OwnerToolInput<"save_search_rule">) {
  const saved = await saveRule(ctx, await ruleInput(ctx.store, input));
  if (!saved.ok) return fail(ruleProblemWords(saved.problems));
  return { done: `${input.id ? "Changed" : "Added"} the search rule.`, id: saved.id, admin: adminLink(ctx.store) };
}

export async function deleteSearchMerchandisingTool(ctx: Ctx, input: OwnerToolInput<"delete_search_merchandising">) {
  const gone = input.synonym ? await deleteSynonym(ctx, input.synonym) : await deleteRule(ctx, input.rule!);
  if (!gone) return fail("That synonym or rule is not the store's, or is gone already. Read search_merchandising again.");
  return { done: `Removed the ${input.synonym ? "synonyms" : "search rule"}.`, admin: adminLink(ctx.store) };
}

/**
 * Checks a gated search tool before it is kept for a yes: what the page's writer would refuse is refused now, in its words, so the owner is
 * never asked to approve what cannot be done.
 */
export async function preflightSearchTool({ store }: Ctx, name: string, raw: Record<string, unknown>): Promise<void> {
  if (name === "save_search_synonym") {
    const input = raw as OwnerToolInput<"save_search_synonym">;
    const read = readSynonym(synonymInput(input));
    if (!read.ok) return fail(synonymProblemWords(read.problems));
    if (!store.localization.keptLocales.includes(read.value.locale)) return fail(synonymProblemWords([{ code: "locale" }]));
    return;
  }
  if (name === "save_search_rule") {
    const input = raw as OwnerToolInput<"save_search_rule">;
    const read = readRule(await ruleInput(store, input));
    if (!read.ok) return fail(ruleProblemWords(read.problems));
    if (read.value.action === "redirect") {
      const target = normaliseTarget(read.value.target ?? "", addressContextOf(store));
      if (!target.ok) return fail(ruleProblemWords([{ code: "target", reason: target.code }]));
    }
    return;
  }
  if (name === "delete_search_merchandising") {
    const input = raw as OwnerToolInput<"delete_search_merchandising">;
    const table = input.synonym ? sql`commerce.search_synonyms` : sql`commerce.search_rules`;
    const id = input.synonym ?? input.rule ?? "";
    const row = await typedRow(z.object({ ok: z.boolean() }), sql`select exists (select 1 from ${table} where store_id = ${store.id}::uuid and id = ${id}::uuid) as ok`);
    if (!row?.ok) return fail("That synonym or rule is not the store's, or is gone already. Read search_merchandising again.");
  }
}
