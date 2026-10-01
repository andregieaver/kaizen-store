import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { DEFAULT_SETTINGS, parseRecommendSettings, type RecommendSettings } from "@/lib/recommendations";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * A store's recommendation settings and the owner's rules for them (D139): switched on or off, whether the store's AI may
 * re-rank, the share of visitors who get the plain ranking, the ceiling for upsells, the monthly token cap; and which
 * products go with which, never go together, or are never recommended.
 */

export const recommendTag = (storeId: string) => `recommend:${storeId}`;

const toSettings = (row: Row | undefined): RecommendSettings =>
  row
    ? {
        enabled: Boolean(row.enabled),
        ai: Boolean(row.ai),
        holdoutPercent: Number(row.holdout_percent),
        upsellCeilingPercent: Number(row.upsell_ceiling_percent),
        monthlyTokenCap: row.monthly_token_cap === null ? null : Number(row.monthly_token_cap),
      }
    : DEFAULT_SETTINGS;

/** The store's settings (off until saved), for the site's pages: cached with the store's recommendation tag. */
export async function getRecommendSettings(storeId: string): Promise<RecommendSettings> {
  "use cache";
  cacheLife("hours");
  cacheTag(recommendTag(storeId));
  const [row] = await readDb().execute<Row>(sql`select * from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
  return toSettings(row);
}

/** The same for the admin and the engine's cap check, per request. */
export async function getRecommendSettingsFresh(storeId: string): Promise<RecommendSettings> {
  const [row] = await db().execute<Row>(sql`select * from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
  return toSettings(row);
}

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

/** Saves the owner's form, checked again here, and writes the change to the audit log. */
export async function saveRecommendSettings(account: Account, storeId: string, form: FormData): Promise<SaveResult> {
  const parsed = parseRecommendSettings(form);
  if (!parsed.ok) return parsed;
  const s = parsed.settings;
  await db().execute(sql`
    insert into commerce.recommendation_settings (store_id, enabled, ai, holdout_percent, upsell_ceiling_percent, monthly_token_cap, updated_by)
    values (${storeId}::uuid, ${s.enabled}, ${s.ai}, ${s.holdoutPercent}, ${s.upsellCeilingPercent}, ${s.monthlyTokenCap}, ${account.id}::uuid)
    on conflict (store_id) do update set
      enabled = excluded.enabled, ai = excluded.ai, holdout_percent = excluded.holdout_percent,
      upsell_ceiling_percent = excluded.upsell_ceiling_percent, monthly_token_cap = excluded.monthly_token_cap,
      updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(account.id, storeId, "recommendations.settings_saved", { ...s });
  return { ok: true };
}

/** Tokens the store's recommendations have used of the AI this calendar month (UTC): what the cap is counted against. */
export async function tokensUsedThisMonth(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(input_tokens + output_tokens), 0)::bigint as used
    from commerce.ai_usage
    where store_id = ${storeId}::uuid and feature = 'recommendations' and created_at >= date_trunc('month', now())
  `);
  return Number(row?.used ?? 0);
}

// ---------------------------------------------------------------------------
// The owner's rules
// ---------------------------------------------------------------------------

export type RuleKind = "goes_with" | "never_with" | "hide";

export type RuleRow = {
  id: string;
  kind: RuleKind;
  product: { id: string; title: string };
  other: { id: string; title: string } | null;
};

/** The store's rules with the products' titles (in the store's first language), newest first. */
export async function listRules(storeId: string): Promise<RuleRow[]> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.kind, r.product_id, r.other_product_id,
      (select title from commerce.product_translations t where t.product_id = r.product_id order by t.locale limit 1) as product_title,
      (select title from commerce.product_translations t where t.product_id = r.other_product_id order by t.locale limit 1) as other_title
    from commerce.recommendation_rules r
    where r.store_id = ${storeId}::uuid
    order by r.created_at desc, r.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as RuleKind,
    product: { id: String(row.product_id), title: String(row.product_title ?? "") },
    other: row.other_product_id ? { id: String(row.other_product_id), title: String(row.other_title ?? "") } : null,
  }));
}

/** The store's products to choose among: active ones, by title (in the store's first language). */
export async function ruleProducts(storeId: string): Promise<{ id: string; title: string }[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, (select title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1) as title
    from commerce.products p
    where p.store_id = ${storeId}::uuid and p.status = 'active'
    order by lower((select title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1)), p.id
    limit 1000
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title ?? "") }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adds a rule: a pairing for a product (`both` makes it work from the other product too), or a product to hide. A rule
 * that already exists is left as it is. Both products must be the store's.
 */
export async function addRule(
  account: Account,
  storeId: string,
  input: { kind: string; productId: string; otherProductId?: string | null; both?: boolean },
): Promise<SaveResult> {
  const kind = input.kind;
  if (kind !== "goes_with" && kind !== "never_with" && kind !== "hide") return { ok: false, problems: ["Choose what kind of rule this is."] };
  if (!UUID.test(input.productId)) return { ok: false, problems: ["Choose a product."] };
  const other = kind === "hide" ? null : (input.otherProductId ?? null);
  if (kind !== "hide" && (!other || !UUID.test(other))) return { ok: false, problems: ["Choose the other product."] };
  if (other && other === input.productId) return { ok: false, problems: ["Choose two different products."] };
  const pairs: [string, string | null][] = [[input.productId, other]];
  if (other && (input.both || kind === "never_with")) pairs.push([other, input.productId]);
  const owned = await db().execute<Row>(sql`
    select id from commerce.products where store_id = ${storeId}::uuid and id in (${sql.join(
      [...new Set(pairs.flatMap(([a, b]) => [a, b]).filter((id): id is string => id !== null))].map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  const wanted = new Set(pairs.flatMap(([a, b]) => [a, b]).filter((id): id is string => id !== null));
  if (owned.length !== wanted.size) return { ok: false, problems: ["Those products are not in this store."] };
  for (const [product, second] of pairs) {
    await db().execute(sql`
      insert into commerce.recommendation_rules (store_id, kind, product_id, other_product_id)
      values (${storeId}::uuid, ${kind}, ${product}::uuid, ${second}::uuid)
      on conflict do nothing
    `);
  }
  await audit(account.id, storeId, "recommendations.rule_added", { kind, productId: input.productId, otherProductId: other });
  return { ok: true };
}

export async function removeRule(account: Account, storeId: string, ruleId: string): Promise<SaveResult> {
  if (!UUID.test(ruleId)) return { ok: false, problems: ["That rule is gone."] };
  const rows = await db().execute<Row>(sql`
    delete from commerce.recommendation_rules where store_id = ${storeId}::uuid and id = ${ruleId}::uuid returning kind
  `);
  if (rows.length === 0) return { ok: false, problems: ["That rule is gone."] };
  await audit(account.id, storeId, "recommendations.rule_removed", { ruleId, kind: String(rows[0].kind) });
  return { ok: true };
}
