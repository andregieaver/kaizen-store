import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import type { FieldDef } from "@/lib/custom-fields";
import { filterableFields, isRangeField, rangeFields } from "@/lib/field-filters";
import { keepOwnIds, parseTermRules, ruleTermIds, termRulesSchema, type RuleCondition, type TermRules } from "@/lib/term-rules";

import { activeFieldGroups } from "./custom-fields";
import { OFFERED } from "./product-conditions";

/**
 * Collections filled by rules on the server (wave 6 unit A2, D319, `docs/wave-6-catalogue.md` 3.3): what is saved is checked here
 * (`checkedRules()`: the shape, then every id against the store), and what a rule holds is counted by the database's own evaluator
 * (`commerce.product_matches_rules()`), never worked out in code, so the count the owner sees is what the shop lists.
 */

type Row = Record<string, unknown>;

/** What the rule editor offers: the store's manual categories and tags, its manufacturers, and its public filter fields with what they take. */
export type RuleChoices = {
  terms: { id: string; name: string; kind: "category" | "tag" }[];
  manufacturers: { id: string; name: string }[];
  fields: { id: string; label: string; type: string; choices: { key: string; label: string }[]; unit: string | null; range: boolean }[];
  /** The store's own country's currency, which a price condition is in. */
  currency: string;
  /** The store's main language, for amounts and names. */
  locale: string;
};

/** The store's public filter fields on products (D119): the only fields a rule may name. */
async function ruleFields(storeId: string): Promise<FieldDef[]> {
  return filterableFields(await activeFieldGroups(storeId, "product"));
}

/** The categories and tags a rule may name: the store's product terms filled by hand, other than `except` (the term itself). */
async function manualTerms(storeId: string, except: string | null) {
  const rows = await db().execute<Row>(sql`
    select id, name, kind from commerce.terms
    where store_id = ${storeId}::uuid and content_type = 'product' and rules is null
      and (${except}::uuid is null or id <> ${except}::uuid)
    order by kind, lower(name)
  `);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), kind: r.kind === "tag" ? ("tag" as const) : ("category" as const) }));
}

export async function ruleChoices(storeId: string, termId: string | null): Promise<RuleChoices> {
  const [terms, operators, fields, [store]] = await Promise.all([
    manualTerms(storeId, termId),
    db().execute<Row>(sql`select id, name from commerce.economic_operators where store_id = ${storeId}::uuid order by lower(name)`),
    ruleFields(storeId),
    db().execute<Row>(sql`
      select m.currency, coalesce(s.locales[1], 'en') as locale
      from commerce.stores s join commerce.markets m on m.store_id = s.id and m.code = commerce.home_market(s.id)
      where s.id = ${storeId}::uuid
    `),
  ]);
  const ranges = new Map(rangeFields(fields).map((r) => [r.def.id, r]));
  return {
    terms,
    manufacturers: operators.map((r) => ({ id: String(r.id), name: String(r.name) })),
    fields: fields.map((def) => ({
      id: def.id,
      label: def.label,
      type: def.type,
      choices: (def.choices ?? []).map((c) => ({ key: c.key, label: c.label })),
      unit: ranges.get(def.id)?.kind === "measurement" ? (ranges.get(def.id)?.unit ?? null) : null,
      range: isRangeField(def),
    })),
    currency: store ? String(store.currency).trim() : "EUR",
    locale: store ? String(store.locale) : "en",
  };
}

/** A field condition kept to what its field can hold: a choice's key, yes or no as `true`/`false`, or a range in the field's own unit. */
function fieldCondition(c: Extract<RuleCondition, { kind: "field" }>, def: FieldDef): RuleCondition | null {
  if (isRangeField(def)) {
    if (c.min === null && c.max === null) return null;
    if (c.min !== null && c.max !== null && c.min > c.max) return null;
    const unit = def.type === "measurement" ? (def.units?.[0] ?? null) : null;
    return { ...c, value: null, unit };
  }
  if (c.value === null) return null;
  if (def.type === "boolean") return c.value === "true" || c.value === "false" ? { ...c, min: null, max: null, unit: null } : null;
  const keys = new Set((def.choices ?? []).map((choice) => choice.key));
  return keys.has(c.value) ? { ...c, min: null, max: null, unit: null } : null;
}

export type CheckedRules = { ok: true; rules: TermRules } | { ok: false; problems: string[] };

/**
 * Rules as sent, checked for a store's term (`termId`, null for a new one): the shape (`termRulesSchema`), then only the store's own manual
 * categories and tags (never the term itself or another filled by rules: no loops), manufacturers and public filter fields (`keepOwnIds()`), each
 * field condition kept to what its field holds. Conditions naming nothing of the store's are dropped; none left is a problem.
 */
export async function checkedRules(storeId: string, termId: string | null, raw: unknown): Promise<CheckedRules> {
  const parsed = termRulesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const [terms, operators, fields] = await Promise.all([
    manualTerms(storeId, termId),
    db().execute<Row>(sql`select id from commerce.economic_operators where store_id = ${storeId}::uuid`),
    ruleFields(storeId),
  ]);
  const defs = new Map(fields.map((def) => [def.id, def]));
  const own = keepOwnIds(parsed.data, {
    terms: new Set(terms.map((t) => t.id)),
    manufacturers: new Set(operators.map((r) => String(r.id))),
    fields: new Set(defs.keys()),
  });
  const conditions = (own?.conditions ?? []).flatMap((c): RuleCondition[] => {
    if (c.kind !== "field") return [c];
    const kept = fieldCondition(c, defs.get(c.fieldId)!);
    return kept ? [kept] : [];
  });
  if (conditions.length === 0) return { ok: false, problems: ["Add a condition that names something in this store."] };
  return { ok: true, rules: { match: parsed.data.match, conditions } };
}

/** Whether another collection filled by rules names this term, so it cannot be filled by rules itself (its products would then be none). */
export async function namedByRules(storeId: string, termId: string): Promise<string | null> {
  const rows = await db().execute<Row>(sql`
    select name, rules from commerce.terms where store_id = ${storeId}::uuid and rules is not null and id <> ${termId}::uuid
  `);
  const naming = rows.find((r) => {
    const rules = parseTermRules(r.rules);
    return rules !== null && ruleTermIds(rules).includes(termId);
  });
  return naming ? String(naming.name) : null;
}

/** How many of the store's products a rule holds, and each of its conditions alone: active and offered products only, as the shop lists. */
export type RuleCount = { total: number; each: number[] };

export async function countRuleMembers(storeId: string, rules: TermRules): Promise<RuleCount> {
  const each = rules.conditions.map(
    (c, i) => sql`count(*) filter (where commerce.product_matches_condition(p.store_id, p.id, ${JSON.stringify(c)}::jsonb))::int as ${sql.raw(`c${i}`)}`,
  );
  const [row] = await readDb().execute<Row>(sql`
    select count(*) filter (where commerce.product_matches_rules(p.store_id, p.id, ${JSON.stringify(rules)}::jsonb))::int as total,
      ${sql.join(each, sql`, `)}
    from commerce.products p
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED}
  `);
  return { total: Number(row?.total ?? 0), each: rules.conditions.map((_, i) => Number(row?.[`c${i}`] ?? 0)) };
}

/** The products a term filled by rules holds now, newest first: active ones the evaluator lets in, at most `limit`. */
export async function ruleMemberIds(storeId: string, termId: string, limit: number): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select p.id from commerce.products p join commerce.terms t on t.store_id = p.store_id and t.id = ${termId}::uuid and t.rules is not null
    where p.store_id = ${storeId}::uuid and commerce.product_matches_rules(p.store_id, p.id, t.rules)
    order by p.created_at desc, p.handle
    limit ${limit}
  `);
  return rows.map((r) => String(r.id));
}
