import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { assignmentsInput, listBreaksInput, listRulesInput, priceListInput, pricesInput, scopeInput, type PriceListInput } from "@/lib/price-lists";
import { formatPriceInput, parsePrice } from "@/lib/product-input";
import { ruleOf, ruleProblem, type QuantityRule } from "@/lib/quantity-rules";

import { audit, type Membership } from "./auth";
import { offeredTo } from "./product-conditions";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Price lists (wave 6 unit C1, D321, `docs/wave-6-catalogue.md` C.1): the only writer of `price_lists`, `price_list_assignments`,
 * `price_list_prices` and `price_list_products`, and the product page's reader of a buyer's prices (`listPricesFor()`). What a buyer pays is
 * only `commerce.buyer_price()`, which the cart and checkout read in their own queries.
 */

export type SaveResult = { ok: true; id?: string } | { ok: false; problems: string[] };

type Account = Membership["account"];
const wordsOf = (account: Account) => adminText(adminLangOf(account.adminLocale), "customers").priceLists;

const LIST_ROW = z.object({
  id: col.uuid,
  name: col.text,
  percent: col.int.nullable(),
  active: col.bool,
  exclusive: col.bool,
  prices: col.int,
  groups: col.int,
  companies: col.int,
  scope: col.int,
});

export type PriceList = z.output<typeof LIST_ROW>;

const listQuery = (storeId: string, id: string | null) => sql`
  select l.id, l.name, l.percent, l.active, l.exclusive,
         (select count(*)::int from commerce.price_list_prices pp where pp.store_id = l.store_id and pp.list_id = l.id) as prices,
         (select count(*)::int from commerce.price_list_assignments a where a.store_id = l.store_id and a.list_id = l.id and a.tier_id is not null) as groups,
         (select count(*)::int from commerce.price_list_assignments a where a.store_id = l.store_id and a.list_id = l.id and a.company_id is not null) as companies,
         (select count(*)::int from commerce.price_list_products s where s.store_id = l.store_id and s.list_id = l.id) as scope
  from commerce.price_lists l
  where l.store_id = ${storeId}::uuid ${id ? sql`and l.id = ${id}::uuid` : sql``}
  order by lower(l.name)
`;

export async function listPriceLists(storeId: string): Promise<PriceList[]> {
  return typedRows(LIST_ROW, listQuery(storeId, null));
}

export async function getPriceList(storeId: string, id: string): Promise<PriceList | null> {
  return typedRow(LIST_ROW, listQuery(storeId, id));
}

/** Who a list is for and what its percentage reaches, by id. */
export async function listTargets(storeId: string, listId: string): Promise<{ tierIds: string[]; companyIds: string[]; productIds: string[]; termIds: string[] }> {
  const [assigned, scoped] = await Promise.all([
    typedRows(z.object({ tier_id: col.uuid.nullable(), company_id: col.uuid.nullable() }), sql`
      select tier_id, company_id from commerce.price_list_assignments where store_id = ${storeId}::uuid and list_id = ${listId}::uuid
    `),
    typedRows(z.object({ product_id: col.uuid.nullable(), term_id: col.uuid.nullable() }), sql`
      select product_id, term_id from commerce.price_list_products where store_id = ${storeId}::uuid and list_id = ${listId}::uuid
    `),
  ]);
  return {
    tierIds: assigned.flatMap((r) => (r.tier_id ? [r.tier_id] : [])),
    companyIds: assigned.flatMap((r) => (r.company_id ? [r.company_id] : [])),
    productIds: scoped.flatMap((r) => (r.product_id ? [r.product_id] : [])),
    termIds: scoped.flatMap((r) => (r.term_id ? [r.term_id] : [])),
  };
}

const PRICE_ROW = z.object({
  variant_id: col.uuid,
  product_id: col.uuid,
  title: col.text,
  options: z.record(z.string(), z.string()).nullable(),
  sku: col.text,
  currency: col.currency,
  amount_minor: col.minor,
});

export type ListPrice = { variantId: string; productId: string; title: string; options: Record<string, string>; sku: string; currency: string; amount: string };

/** A list's fixed prices, with each variant's product and SKU, as the editor shows them ("249,00"). */
export async function listPrices(storeId: string, listId: string, locale: string): Promise<ListPrice[]> {
  const rows = await typedRows(PRICE_ROW, sql`
    select pp.variant_id, v.product_id, coalesce(tl.title, p.handle) as title, v.options, v.sku, pp.currency, pp.amount_minor
    from commerce.price_list_prices pp
    join commerce.product_variants v on v.store_id = pp.store_id and v.id = pp.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where pp.store_id = ${storeId}::uuid and pp.list_id = ${listId}::uuid
    order by lower(coalesce(tl.title, p.handle)), v.sku, pp.currency
  `);
  return rows.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    title: r.title,
    options: r.options ?? {},
    sku: r.sku,
    currency: r.currency,
    amount: formatPriceInput(r.amount_minor, r.currency),
  }));
}

/** The currencies a list's fixed prices may be in: those of the store's markets (each country's own). */
export async function listCurrencies(storeId: string): Promise<string[]> {
  const rows = await typedRows(z.object({ currency: col.currency }), sql`
    select distinct currency from commerce.markets where store_id = ${storeId}::uuid order by currency
  `);
  return rows.map((r) => r.currency);
}

function problemOf(error: unknown): string | null {
  const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
  return code ?? null;
}

/** Makes a list (id null) or changes one: its name, percentage and whether it is on. */
export async function savePriceList({ account, store }: Membership, id: string | null, input: PriceListInput): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = priceListInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => (issue.path[0] === "percent" ? w.problems.percent : issue.message)) };
  const d = parsed.data;
  if (id && !(await getPriceList(store.id, id))) return { ok: false, problems: [w.problems.gone] };
  try {
    const [row] = id
      ? await db().execute<{ id: string }>(sql`
          update commerce.price_lists set name = ${d.name}, percent = ${d.percent}, active = ${d.active}, exclusive = ${d.exclusive}, updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
        `)
      : await db().execute<{ id: string }>(sql`
          insert into commerce.price_lists (store_id, name, percent, active, exclusive) values (${store.id}::uuid, ${d.name}, ${d.percent}, ${d.active}, ${d.exclusive}) returning id
        `);
    await audit(account.id, store.id, id ? "price_list.updated" : "price_list.created", { name: d.name, percent: d.percent, active: d.active, exclusive: d.exclusive });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    if (problemOf(error) === "23505") return { ok: false, problems: [fillWords(w.problems.taken, { name: d.name })] };
    throw error;
  }
}

/** Deletes a list with its prices, scope and assignments; orders keep the id of the list that priced their lines. */
export async function deletePriceList({ account, store }: Membership, id: string): Promise<SaveResult> {
  const list = await getPriceList(store.id, id);
  if (!list) return { ok: true };
  await db().execute(sql`delete from commerce.price_lists where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "price_list.deleted", { name: list.name });
  return { ok: true };
}

/** How many of the given ids are the store's own rows of a table (customer groups, companies, products, product categories). */
async function ownCount(runner: Executor, storeId: string, ids: string[], from: "tiers" | "companies" | "products" | "categories"): Promise<number> {
  if (ids.length === 0) return 0;
  const list = `{${ids.join(",")}}`;
  const where =
    from === "tiers"
      ? sql`select count(*)::int as n from commerce.customer_tiers where store_id = ${storeId}::uuid and id = any(${list}::uuid[])`
      : from === "companies"
        ? sql`select count(*)::int as n from commerce.customer_companies where store_id = ${storeId}::uuid and id = any(${list}::uuid[])`
        : from === "products"
          ? sql`select count(*)::int as n from commerce.products where store_id = ${storeId}::uuid and id = any(${list}::uuid[])`
          : sql`select count(*)::int as n from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and kind = 'category' and id = any(${list}::uuid[])`;
  const row = await typedRow(z.object({ n: col.int }), where, runner);
  return row?.n ?? 0;
}

/** Sets who the list is for: the store's own customer groups and companies, all of them replaced. */
export async function setAssignments({ account, store }: Membership, listId: string, input: unknown): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = assignmentsInput.safeParse(input);
  if (!parsed.success || !(await getPriceList(store.id, listId))) return { ok: false, problems: [w.problems.gone] };
  const tierIds = [...new Set(parsed.data.tierIds)];
  const companyIds = [...new Set(parsed.data.companyIds)];
  return db().transaction(async (tx) => {
    if ((await ownCount(tx, store.id, tierIds, "tiers")) !== tierIds.length || (await ownCount(tx, store.id, companyIds, "companies")) !== companyIds.length) {
      return { ok: false, problems: [w.problems.notOwn] } as SaveResult;
    }
    await tx.execute(sql`delete from commerce.price_list_assignments where store_id = ${store.id}::uuid and list_id = ${listId}::uuid`);
    const rows = [...tierIds.map((id) => ({ tier: id, company: null })), ...companyIds.map((id) => ({ tier: null, company: id }))];
    if (rows.length > 0) {
      await tx.execute(sql`
        insert into commerce.price_list_assignments (store_id, list_id, tier_id, company_id)
        select ${store.id}::uuid, ${listId}::uuid, r.tier, r.company from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(tier uuid, company uuid)
      `);
    }
    await audit(account.id, store.id, "price_list.assigned", { list: listId, groups: tierIds.length, companies: companyIds.length });
    return { ok: true } as SaveResult;
  });
}

/** Sets what the list's percentage reaches: the store's own products and product categories, all of them replaced; none is every product. */
export async function setScope({ account, store }: Membership, listId: string, input: unknown): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = scopeInput.safeParse(input);
  if (!parsed.success || !(await getPriceList(store.id, listId))) return { ok: false, problems: [w.problems.gone] };
  const productIds = [...new Set(parsed.data.productIds)];
  const termIds = [...new Set(parsed.data.termIds)];
  return db().transaction(async (tx) => {
    if ((await ownCount(tx, store.id, productIds, "products")) !== productIds.length || (await ownCount(tx, store.id, termIds, "categories")) !== termIds.length) {
      return { ok: false, problems: [w.problems.notOwn] } as SaveResult;
    }
    await tx.execute(sql`delete from commerce.price_list_products where store_id = ${store.id}::uuid and list_id = ${listId}::uuid`);
    const rows = [...productIds.map((id) => ({ product: id, term: null })), ...termIds.map((id) => ({ product: null, term: id }))];
    if (rows.length > 0) {
      await tx.execute(sql`
        insert into commerce.price_list_products (store_id, list_id, product_id, term_id)
        select ${store.id}::uuid, ${listId}::uuid, r.product, r.term from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(product uuid, term uuid)
      `);
    }
    await audit(account.id, store.id, "price_list.scope_saved", { list: listId, products: productIds.length, categories: termIds.length });
    return { ok: true } as SaveResult;
  });
}

/**
 * Sets fixed prices as typed: each row's amount for its variant and currency (one of the store's markets' currencies), an empty amount
 * taking the price away. Only the store's own variants; every row is checked before anything is written.
 */
export async function setPrices({ account, store }: Membership, listId: string, input: unknown): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = pricesInput.safeParse(input);
  if (!parsed.success || !(await getPriceList(store.id, listId))) return { ok: false, problems: [w.problems.gone] };
  const currencies = new Set(await listCurrencies(store.id));
  const problems: string[] = [];
  const set: { variant: string; currency: string; amount: number }[] = [];
  const cleared: { variant: string; currency: string }[] = [];
  for (const row of parsed.data) {
    if (!currencies.has(row.currency)) {
      problems.push(fillWords(w.problems.currency, { currency: row.currency }));
      continue;
    }
    if (row.amount === "") {
      cleared.push({ variant: row.variantId, currency: row.currency });
      continue;
    }
    const amount = parsePrice(row.amount, row.currency);
    if (amount === null) problems.push(fillWords(w.problems.amount, { typed: row.amount, currency: row.currency }));
    else set.push({ variant: row.variantId, currency: row.currency, amount });
  }
  const variantIds = [...new Set(parsed.data.map((r) => r.variantId))];
  if (variantIds.length > 0) {
    const own = await typedRow(z.object({ n: col.int }), sql`
      select count(*)::int as n from commerce.product_variants where store_id = ${store.id}::uuid and id = any(${`{${variantIds.join(",")}}`}::uuid[])
    `);
    if ((own?.n ?? 0) !== variantIds.length) problems.push(w.problems.unknownVariant);
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  await db().transaction(async (tx) => {
    if (cleared.length > 0) {
      await tx.execute(sql`
        delete from commerce.price_list_prices pp using jsonb_to_recordset(${JSON.stringify(cleared)}::jsonb) as r(variant uuid, currency text)
        where pp.store_id = ${store.id}::uuid and pp.list_id = ${listId}::uuid and pp.variant_id = r.variant and pp.currency = r.currency
      `);
    }
    if (set.length > 0) {
      await tx.execute(sql`
        insert into commerce.price_list_prices (store_id, list_id, variant_id, currency, amount_minor)
        select ${store.id}::uuid, ${listId}::uuid, r.variant, r.currency, r.amount from jsonb_to_recordset(${JSON.stringify(set)}::jsonb) as r(variant uuid, currency text, amount bigint)
        on conflict (list_id, variant_id, currency) do update set amount_minor = excluded.amount_minor, updated_at = now()
      `);
    }
  });
  await audit(account.id, store.id, "price_list.prices_saved", { list: listId, set: set.length, removed: cleared.length });
  return { ok: true };
}

const LIST_BREAK_ROW = z.object({
  variant_id: col.uuid,
  title: col.text,
  options: z.record(z.string(), z.string()).nullable(),
  sku: col.text,
  from_quantity: col.int,
  percent: col.int.nullable(),
  amounts: z.record(z.string(), z.number()).nullable(),
});

export type ListBreak = { variantId: string; title: string; options: Record<string, string>; sku: string; from: number; percent: number | null; prices: Record<string, string> };

/** A list's own prices by quantity (D323 E3), as the editor shows them: per variant, from how many, a percentage or an amount per currency ("249,00"). */
export async function listBreaks(storeId: string, listId: string, locale: string): Promise<ListBreak[]> {
  const rows = await typedRows(LIST_BREAK_ROW, sql`
    select lb.variant_id, coalesce(tl.title, p.handle) as title, v.options, v.sku, lb.from_quantity, lb.percent, lb.amounts
    from commerce.price_list_breaks lb
    join commerce.product_variants v on v.store_id = lb.store_id and v.id = lb.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where lb.store_id = ${storeId}::uuid and lb.list_id = ${listId}::uuid
    order by lower(coalesce(tl.title, p.handle)), v.sku, lb.from_quantity
  `);
  return rows.map((r) => ({
    variantId: r.variant_id,
    title: r.title,
    options: r.options ?? {},
    sku: r.sku,
    from: r.from_quantity,
    percent: r.percent,
    prices: Object.fromEntries(Object.entries(r.amounts ?? {}).map(([currency, amount]) => [currency, formatPriceInput(amount, currency)])),
  }));
}

const LIST_RULE_ROW = z.object({
  variant_id: col.uuid,
  title: col.text,
  options: z.record(z.string(), z.string()).nullable(),
  sku: col.text,
  min_quantity: col.int,
  max_quantity: col.int.nullable(),
  quantity_step: col.int,
});

export type ListRule = { variantId: string; title: string; options: Record<string, string>; sku: string; rule: QuantityRule };

/** A list's own quantity rules (D323 E3), per variant. */
export async function listRules(storeId: string, listId: string, locale: string): Promise<ListRule[]> {
  const rows = await typedRows(LIST_RULE_ROW, sql`
    select q.variant_id, coalesce(tl.title, p.handle) as title, v.options, v.sku, q.min_quantity, q.max_quantity, q.quantity_step
    from commerce.price_list_quantity_rules q
    join commerce.product_variants v on v.store_id = q.store_id and v.id = q.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where q.store_id = ${storeId}::uuid and q.list_id = ${listId}::uuid
    order by lower(coalesce(tl.title, p.handle)), v.sku
  `);
  return rows.map((r) => ({ variantId: r.variant_id, title: r.title, options: r.options ?? {}, sku: r.sku, rule: ruleOf(r) }));
}

/** Whether every variant named is the store's own. */
async function ownVariants(storeId: string, variantIds: string[]): Promise<Map<string, string>> {
  if (variantIds.length === 0) return new Map();
  const rows = await typedRows(z.object({ id: col.uuid, sku: col.text }), sql`
    select id, sku from commerce.product_variants where store_id = ${storeId}::uuid and id = any(${`{${[...new Set(variantIds)].join(",")}}`}::uuid[])
  `);
  return new Map(rows.map((r) => [r.id, r.sku]));
}

/**
 * Sets a list's prices by quantity as typed (D323 E3), replacing the ones there: each a variant of the store's, from how many, a percentage or an
 * amount per currency of the store's countries; at most 10 a variant, one per quantity. Every row is checked before anything is written.
 */
export async function setListBreaks({ account, store }: Membership, listId: string, input: unknown): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = listBreaksInput.safeParse(input);
  if (!parsed.success || !(await getPriceList(store.id, listId))) return { ok: false, problems: [w.problems.gone] };
  const currencies = new Set(await listCurrencies(store.id));
  const skus = await ownVariants(store.id, parsed.data.map((r) => r.variantId));
  const problems: string[] = [];
  const rows: { variant_id: string; from_quantity: number; percent: number | null; amounts: Record<string, number> | null }[] = [];
  const seen = new Set<string>();
  const perVariant = new Map<string, number>();
  for (const row of parsed.data) {
    const variant = skus.get(row.variantId);
    if (!variant) {
      problems.push(w.problems.unknownVariant);
      continue;
    }
    const words = { variant, from: row.from };
    const key = `${row.variantId}:${row.from}`;
    if (seen.has(key)) problems.push(fillWords(w.problems.breakTwice, words));
    seen.add(key);
    perVariant.set(row.variantId, (perVariant.get(row.variantId) ?? 0) + 1);
    const typed = Object.entries(row.prices).filter(([, text]) => text !== "");
    if (row.percent !== null && typed.length > 0) problems.push(fillWords(w.problems.breakBoth, words));
    else if (row.percent !== null) rows.push({ variant_id: row.variantId, from_quantity: row.from, percent: row.percent, amounts: null });
    else if (typed.length === 0) problems.push(fillWords(w.problems.breakNoPrice, words));
    else {
      const amounts: Record<string, number> = {};
      for (const [currency, text] of typed) {
        const amount = currencies.has(currency) ? parsePrice(text, currency) : null;
        if (!currencies.has(currency)) problems.push(fillWords(w.problems.currency, { currency }));
        else if (amount === null) problems.push(fillWords(w.problems.amount, { typed: text, currency }));
        else amounts[currency] = amount;
      }
      rows.push({ variant_id: row.variantId, from_quantity: row.from, percent: null, amounts });
    }
  }
  for (const [variantId, count] of perVariant) if (count > 10) problems.push(fillWords(w.problems.breakMany, { variant: skus.get(variantId) ?? "" }));
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.price_list_breaks where store_id = ${store.id}::uuid and list_id = ${listId}::uuid`);
    if (rows.length > 0) {
      await tx.execute(sql`
        insert into commerce.price_list_breaks (store_id, list_id, variant_id, from_quantity, percent, amounts)
        select ${store.id}::uuid, ${listId}::uuid, r.variant_id, r.from_quantity, r.percent, r.amounts
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(variant_id uuid, from_quantity integer, percent integer, amounts jsonb)
      `);
    }
  });
  await audit(account.id, store.id, "price_list.breaks_saved", { list: listId, breaks: rows.length });
  return { ok: true };
}

/**
 * Sets a list's quantity rules as typed (D323 E3): per variant, a minimum (at least the step), a maximum and a step, as the variant's own rules
 * are kept (`ruleProblem()`); all three empty takes the list's rule away, so its buyers buy by the variant's own.
 */
export async function setListRules({ account, store }: Membership, listId: string, input: unknown): Promise<SaveResult> {
  const w = wordsOf(account);
  const parsed = listRulesInput.safeParse(input);
  if (!parsed.success || !(await getPriceList(store.id, listId))) return { ok: false, problems: [w.problems.gone] };
  const skus = await ownVariants(store.id, parsed.data.map((r) => r.variantId));
  const problems: string[] = [];
  const set: { variant_id: string; min_quantity: number; max_quantity: number | null; quantity_step: number }[] = [];
  const cleared: string[] = [];
  for (const row of parsed.data) {
    const variant = skus.get(row.variantId);
    if (!variant) {
      problems.push(w.problems.unknownVariant);
      continue;
    }
    if (row.min === null && row.max === null && row.step === null) {
      cleared.push(row.variantId);
      continue;
    }
    const step = row.step ?? 1;
    const rule: QuantityRule = { min: row.min ?? step, max: row.max, step };
    const problem = ruleProblem(rule);
    if (problem) problems.push(fillWords(w.problems.ruleBad, { variant, problem }));
    else set.push({ variant_id: row.variantId, min_quantity: rule.min, max_quantity: rule.max, quantity_step: rule.step });
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  await db().transaction(async (tx) => {
    if (cleared.length > 0) {
      await tx.execute(sql`
        delete from commerce.price_list_quantity_rules
        where store_id = ${store.id}::uuid and list_id = ${listId}::uuid and variant_id = any(${`{${cleared.join(",")}}`}::uuid[])
      `);
    }
    if (set.length > 0) {
      await tx.execute(sql`
        insert into commerce.price_list_quantity_rules (store_id, list_id, variant_id, min_quantity, max_quantity, quantity_step)
        select ${store.id}::uuid, ${listId}::uuid, r.variant_id, r.min_quantity, r.max_quantity, r.quantity_step
        from jsonb_to_recordset(${JSON.stringify(set)}::jsonb) as r(variant_id uuid, min_quantity integer, max_quantity integer, quantity_step integer)
        on conflict (list_id, variant_id) do update
          set min_quantity = excluded.min_quantity, max_quantity = excluded.max_quantity, quantity_step = excluded.quantity_step
      `);
    }
  });
  await audit(account.id, store.id, "price_list.rules_saved", { list: listId, set: set.length, removed: cleared.length });
  return { ok: true };
}

const BUYER_PRICE_ROW = z.object({ variant_id: col.uuid, amount_minor: col.minor, list_id: col.uuid });

/**
 * What a signed-in buyer pays for each of a product's variants by their price lists (D321), for the product page's buy part (read per request,
 * never in a cached read): only variants a list prices lower than the market, in the country's own currency as stored (shown with `shown()`).
 * Goods and appointments only, as the cart and checkout price them (`LIST_PRICED`); a guest has none.
 */
export async function listPricesFor(storeId: string, customerId: string | null, variantIds: string[], marketCode: string): Promise<Map<string, { amountMinor: number; listId: string }>> {
  if (!customerId || variantIds.length === 0) return new Map();
  const rows = await typedRows(BUYER_PRICE_ROW, sql`
    select v.id as variant_id, bp.amount_minor, bp.list_id
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.kind in ('goods', 'appointment', 'bundle')
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
    cross join lateral commerce.buyer_price(v.store_id, ${customerId}::uuid, v.id, ${marketCode}, cp.amount_minor) bp
    where v.store_id = ${storeId}::uuid and v.id = any(${`{${variantIds.join(",")}}`}::uuid[])
  `);
  return new Map(rows.map((r) => [r.variant_id, { amountMinor: r.amount_minor, listId: r.list_id }]));
}

const RULE_ROW = z.object({ variant_id: col.uuid, min_quantity: col.int, max_quantity: col.int.nullable(), quantity_step: col.int });

/**
 * The quantity rules a signed-in buyer's price lists give a product's variants (D323 E3), in place of the variants' own, for the product page's
 * buy part (read per request): only variants a list gives a rule; a guest has none. Worked out only by `commerce.quantity_rule()`.
 */
export async function buyerRulesFor(storeId: string, customerId: string | null, variantIds: string[]): Promise<Map<string, QuantityRule>> {
  if (!customerId || variantIds.length === 0) return new Map();
  const rows = await typedRows(RULE_ROW, sql`
    select v.id as variant_id, qr.min_quantity, qr.max_quantity, qr.quantity_step
    from commerce.product_variants v
    cross join lateral commerce.quantity_rule(v.store_id, ${customerId}::uuid, v.id) qr
    where v.store_id = ${storeId}::uuid and v.id = any(${`{${variantIds.join(",")}}`}::uuid[]) and qr.list_id is not null
  `);
  return new Map(rows.map((r) => [r.variant_id, ruleOf(r)]));
}

const FOUND_ROW = z.object({ variant_id: col.uuid, product_id: col.uuid, title: col.text, options: z.record(z.string(), z.string()).nullable(), sku: col.text });

/** Variants to price, by a product's title, handle or a variant's SKU: goods and appointments only, at most 100. */
export async function findVariants(storeId: string, locale: string, query: string): Promise<Omit<ListPrice, "currency" | "amount">[]> {
  const words = query.trim().slice(0, 80);
  if (words === "") return [];
  const like = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await typedRows(FOUND_ROW, sql`
    select v.id as variant_id, p.id as product_id, coalesce(tl.title, p.handle) as title, v.options, v.sku
    from commerce.products p
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where p.store_id = ${storeId}::uuid and p.status <> 'archived' and p.kind in ('goods', 'appointment', 'bundle')
      and (coalesce(tl.title, '') ilike ${like} or p.handle ilike ${like} or v.sku ilike ${like})
    order by lower(coalesce(tl.title, p.handle)), v.sku
    limit 100
  `);
  return rows.map((r) => ({ variantId: r.variant_id, productId: r.product_id, title: r.title, options: r.options ?? {}, sku: r.sku }));
}

/** The AI manager's `list_price_lists` (D321): each list's settings and who it is for, by name; never a buyer's price. */
export async function listPriceListsTool({ store }: { store: { id: string; slug: string } }) {
  const [lists, names] = await Promise.all([
    listPriceLists(store.id),
    typedRows(z.object({ list_id: col.uuid, tier: col.text.nullable(), company: col.text.nullable() }), sql`
      select a.list_id, t.name as tier, c.name as company
      from commerce.price_list_assignments a
      left join commerce.customer_tiers t on t.store_id = a.store_id and t.id = a.tier_id
      left join commerce.customer_companies c on c.store_id = a.store_id and c.id = a.company_id
      where a.store_id = ${store.id}::uuid
      order by lower(coalesce(t.name, c.name))
    `),
  ]);
  return {
    price_lists: lists.slice(0, 50).map((list) => ({
      id: list.id,
      name: list.name,
      on: list.active,
      only_for_its_buyers: list.exclusive,
      percent_off: list.percent,
      fixed_prices: list.prices,
      percent_reaches: list.percent === null ? null : list.scope === 0 ? "every product" : `${list.scope} chosen products and categories`,
      customer_groups: names.filter((n) => n.list_id === list.id && n.tier).map((n) => n.tier),
      companies: names.filter((n) => n.list_id === list.id && n.company).map((n) => n.company),
    })),
    total: lists.length,
    link: `/admin/${store.slug}/price-lists`,
  };
}

const CATALOGUE_ROW = z.object({
  product_id: col.uuid,
  title: col.text,
  image: col.text.nullable(),
  variant_id: col.uuid,
  options: z.record(z.string(), z.string()).nullable(),
  sku: col.text,
  market_minor: col.minor,
  list_minor: col.minor.nullable(),
  in_stock: col.int.nullable(),
  stock_policy: col.text.nullable(),
  min_quantity: col.int,
  max_quantity: col.int.nullable(),
  quantity_step: col.int,
});

export type CatalogueItem = {
  productId: string;
  title: string;
  image: string | null;
  variants: { id: string; options: Record<string, string>; sku: string; marketMinor: number; listMinor: number | null; available: boolean; rule: QuantityRule }[];
};

/**
 * Your catalogue (D321 C.3): the goods a signed-in buyer's own exclusive lists make theirs, each active variant with the market price and the
 * buyer's list price (both in the country's own currency, shown with `shown()`), and whether it can be bought now. Read per request, never cached.
 * Only goods bought once: anything that needs a time or a plan is bought from its own page, which an exclusive product does not have.
 */
export async function buyerCatalogue(storeId: string, customerId: string, marketCode: string, locale: string): Promise<CatalogueItem[]> {
  const rows = await typedRows(CATALOGUE_ROW, sql`
    with mine as (
      select l.id from commerce.buyer_lists(${storeId}::uuid, ${customerId}::uuid) as b(id)
      join commerce.price_lists l on l.store_id = ${storeId}::uuid and l.id = b.id and l.exclusive
      where exists (select 1 from commerce.price_list_products s where s.store_id = l.store_id and s.list_id = l.id)
    )
    select p.id as product_id, coalesce(tl.title, p.handle) as title, coalesce(m.thumbnail_url, m.url) as image,
           v.id as variant_id, v.options, v.sku, cp.amount_minor as market_minor, bp.amount_minor as list_minor, va.in_stock, va.stock_policy,
           qr.min_quantity, qr.max_quantity, qr.quantity_step
    from commerce.products p
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select url, thumbnail_url from commerce.product_media where product_id = p.id order by position limit 1) m on true
    left join lateral commerce.buyer_price(p.store_id, ${customerId}::uuid, v.id, ${marketCode}, cp.amount_minor) bp on true
    left join lateral commerce.quantity_rule(p.store_id, ${customerId}::uuid, v.id) qr on true
    where p.store_id = ${storeId}::uuid and p.status = 'active' and p.kind in ('goods', 'bundle') and not p.subscription_only
      and ${offeredTo(customerId)}
      and exists (select 1 from mine where commerce.price_list_covers(${storeId}::uuid, mine.id, p.id))
    order by lower(coalesce(tl.title, p.handle)), v.sku
    limit 500
  `);
  const items = new Map<string, CatalogueItem>();
  for (const r of rows) {
    const item = items.get(r.product_id) ?? { productId: r.product_id, title: r.title, image: r.image, variants: [] };
    item.variants.push({
      id: r.variant_id,
      options: r.options ?? {},
      sku: r.sku,
      marketMinor: r.market_minor,
      listMinor: r.list_minor,
      available: r.stock_policy === "continue" || (r.in_stock ?? 0) > 0,
      rule: ruleOf(r),
    });
    items.set(r.product_id, item);
  }
  return [...items.values()];
}

/** Whether a signed-in buyer has an exclusive catalogue at all (the account's link to it). */
export async function hasBuyerCatalogue(storeId: string, customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  const row = await typedRow(z.object({ yes: col.bool }), sql`
    select exists (
      select 1 from commerce.buyer_lists(${storeId}::uuid, ${customerId}::uuid) as b(id)
      join commerce.price_lists l on l.store_id = ${storeId}::uuid and l.id = b.id and l.exclusive
      where exists (select 1 from commerce.price_list_products s where s.store_id = l.store_id and s.list_id = l.id)
    ) as yes
  `);
  return row?.yes ?? false;
}
