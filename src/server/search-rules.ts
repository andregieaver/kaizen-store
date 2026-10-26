import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { normaliseTarget } from "@/lib/redirect-path";
import { RULES_MAX, readRule, type RuleAction, type RuleMatch, type RuleProblem, type SearchRule } from "@/lib/search-rules";

import { audit } from "./auth";
import { inTerms } from "./product-conditions";
import { addressContextOf } from "./redirect-live";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's search merchandising (wave 6 unit F2, D324, `docs/wave-6-catalogue.md` F.2): the only writer of `commerce.search_rules`, the
 * reader a search asks for them (`rulesOf()`) and which of its results are in a category or tag a rule names (`termFacts()`). The order itself
 * is `merchandise()`; nothing caches what rules change.
 */

const textArray = (words: string[]) => sql`array(select jsonb_array_elements_text(${JSON.stringify(words)}::jsonb))`;

const RULE = z.object({
  id: col.uuid,
  action: z.enum(["pin", "boost", "bury", "redirect"]),
  product_id: col.uuid.nullable(),
  term_id: col.uuid.nullable(),
  target: z.string().nullable(),
  queries: z.array(z.string()),
  match: z.enum(["contains", "exact"]),
  position: col.int,
});

const asRule = (row: z.infer<typeof RULE>): SearchRule => ({
  id: row.id,
  action: row.action as RuleAction,
  productId: row.product_id,
  termId: row.term_id,
  target: row.target,
  queries: row.queries,
  match: row.match as RuleMatch,
  position: row.position,
});

/** The store's rules, in its order (position, then as saved): one small read per search. */
export async function rulesOf(storeId: string): Promise<SearchRule[]> {
  const rows = await typedRows(
    RULE,
    sql`
      select id, action, product_id, term_id, target, queries, match, position from commerce.search_rules
      where store_id = ${storeId}::uuid order by position, created_at, id
    `,
    readDb(),
  );
  return rows.map(asRule);
}

/** Which of `ids` are in each of `termIds`, as the catalogue reads a category or tag (`inTerms()`: rules-filled collections too). */
export async function termFacts(storeId: string, ids: readonly string[], termIds: readonly string[]): Promise<(productId: string, termId: string) => boolean> {
  const inside = new Set<string>();
  if (ids.length > 0) {
    for (const termId of new Set(termIds)) {
      const rows = await typedRows(
        z.object({ id: col.uuid }),
        sql`
          select p.id from commerce.products p
          where p.store_id = ${storeId}::uuid and p.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[])
            and ${inTerms([termId])}
        `,
        readDb(),
      );
      for (const row of rows) inside.add(`${row.id}:${termId}`);
    }
  }
  return (productId, termId) => inside.has(`${productId}:${termId}`);
}

export type RuleRow = SearchRule & { productTitle: string | null; termName: string | null; termKind: string | null };

/** Every rule of the store for the admin, with the product's title (in `locale`, else its first) and the category's or tag's name. */
export async function listRules(storeId: string, locale: string): Promise<RuleRow[]> {
  const rows = await typedRows(
    RULE.extend({ product_title: z.string().nullable(), term_name: z.string().nullable(), term_kind: z.string().nullable() }),
    sql`
      select r.id, r.action, r.product_id, r.term_id, r.target, r.queries, r.match, r.position,
        coalesce(tl.title, tf.title, p.handle) as product_title, t.name as term_name, t.kind as term_kind
      from commerce.search_rules r
      left join commerce.products p on p.store_id = r.store_id and p.id = r.product_id
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      left join commerce.terms t on t.store_id = r.store_id and t.id = r.term_id
      where r.store_id = ${storeId}::uuid
      order by r.position, r.created_at, r.id
    `,
  );
  return rows.map((row) => ({ ...asRule(row), productTitle: row.product_title, termName: row.term_name, termKind: row.term_kind }));
}

export type RuleWriter = { account: { id: string }; store: Pick<Store, "id" | "slug" | "markets"> };

export type RuleResult =
  | { ok: true; id: string }
  | { ok: false; problems: (RuleProblem | { code: "product" } | { code: "term" } | { code: "target"; reason: string } | { code: "gone" } | { code: "max" })[] };

/**
 * Saves a rule as typed: a new one, or the store's own by `id`, checked by `readRule()`; the product and the category or tag must be the
 * store's own (a term of the catalogue), a redirect's target a page of the store (`normaliseTarget()`). At most `RULES_MAX` a store (the
 * database's trigger holds it too).
 */
export async function saveRule({ account, store }: RuleWriter, raw: unknown): Promise<RuleResult> {
  const read = readRule(raw);
  if (!read.ok) return { ok: false, problems: read.problems };
  const input = read.value;
  let target: string | null = null;
  if (input.action === "redirect") {
    const reading = normaliseTarget(input.target ?? "", addressContextOf(store));
    if (!reading.ok) return { ok: false, problems: [{ code: "target", reason: reading.code }] };
    target = reading.target;
  }
  if (input.productId) {
    const own = await typedRow(z.object({ ok: z.boolean() }), sql`select exists (select 1 from commerce.products where store_id = ${store.id}::uuid and id = ${input.productId}::uuid) as ok`);
    if (!own?.ok) return { ok: false, problems: [{ code: "product" }] };
  }
  if (input.termId) {
    const own = await typedRow(
      z.object({ ok: z.boolean() }),
      sql`select exists (select 1 from commerce.terms where store_id = ${store.id}::uuid and content_type = 'product' and id = ${input.termId}::uuid) as ok`,
    );
    if (!own?.ok) return { ok: false, problems: [{ code: "term" }] };
  }
  const values = { ...input, target };
  const facts = { action: input.action, queries: input.queries.length, match: input.match };
  if (input.id) {
    const updated = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        update commerce.search_rules set action = ${values.action}, product_id = ${values.productId}::uuid, term_id = ${values.termId}::uuid,
          target = ${values.target}, queries = ${textArray(values.queries)}, match = ${values.match}, position = ${values.position}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${input.id}::uuid
        returning id
      `,
    );
    if (!updated) return { ok: false, problems: [{ code: "gone" }] };
    await audit(account.id, store.id, "search.rule_saved", { rule: updated.id, ...facts });
    return { ok: true, id: updated.id };
  }
  const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.search_rules where store_id = ${store.id}::uuid`);
  if ((count?.n ?? 0) >= RULES_MAX) return { ok: false, problems: [{ code: "max" }] };
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.search_rules (store_id, action, product_id, term_id, target, queries, match, position)
      values (${store.id}::uuid, ${values.action}, ${values.productId}::uuid, ${values.termId}::uuid, ${values.target}, ${textArray(values.queries)},
        ${values.match}, ${values.position})
      returning id
    `,
  );
  if (!made) return { ok: false, problems: [{ code: "gone" }] };
  await audit(account.id, store.id, "search.rule_saved", { rule: made.id, ...facts });
  return { ok: true, id: made.id };
}

/** Takes a rule of the store's away; one that is gone already says so. */
export async function deleteRule({ account, store }: RuleWriter, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.search_rules where store_id = ${store.id}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(account.id, store.id, "search.rule_deleted", { rule: id });
  return true;
}
