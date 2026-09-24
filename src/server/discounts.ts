import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  applyDiscount,
  availability,
  normalizeCode,
  type AppliedDiscount,
  type DiscountLine,
  storeDiscountInput,
  type DiscountProblem,
  type StoreDiscount,
} from "@/lib/discounts";
import type { Market } from "@/lib/markets";
import { parsePrice } from "@/lib/product-input";

import { audit, type Membership } from "./auth";
import { readCartId, type Shop } from "./cart";
import { getCustomer } from "./customers";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * A store's discount codes (D31): what the admin makes, and what the cart
 * and checkout look up. A code counts as used by each order that got it and
 * was not cancelled, paid or waiting for payment (so a code with one use
 * left cannot go to two checkouts at once).
 */

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

function toDiscount(row: Row): StoreDiscount {
  return {
    id: String(row.id),
    code: String(row.code),
    kind: row.kind as StoreDiscount["kind"],
    percent: Number(row.percent),
    amounts: (row.amounts ?? {}) as Record<string, number>,
    minSubtotals: (row.min_subtotals ?? {}) as Record<string, number>,
    productIds: (row.product_ids as string[] | null) ?? null,
    recurring: Boolean(row.recurring),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
    oncePerCustomer: Boolean(row.once_per_customer),
    active: Boolean(row.active),
  };
}

const used = (customerId: string | null) => sql`
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and o.discount_code_id = d.id and o.status <> 'cancelled') as used,
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and o.discount_code_id = d.id and o.status <> 'cancelled'
      and ${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid) as used_by_customer
`;

export type DiscountListRow = StoreDiscount & {
  used: number;
  /** The discount given on paid orders, per currency. */
  given: Record<string, number>;
};

export async function listDiscounts(storeId: string): Promise<DiscountListRow[]> {
  const rows = await db().execute<Row>(sql`
    select d.*, ${used(null)},
      (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from (
        select o.currency, sum(o.discount_minor)::bigint as total from commerce.orders o
        where o.store_id = d.store_id and o.discount_code_id = d.id
          and o.status not in ('cancelled', 'pending_payment')
        group by o.currency) g) as given
    from commerce.discount_codes d
    where d.store_id = ${storeId}::uuid
    order by d.active desc, d.created_at desc
  `);
  return rows.map((row) => ({
    ...toDiscount(row),
    used: Number(row.used),
    given: Object.fromEntries(Object.entries((row.given ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])),
  }));
}

export async function getDiscount(storeId: string, id: string): Promise<(StoreDiscount & { used: number }) | null> {
  const [row] = await db().execute<Row>(sql`
    select d.*, ${used(null)} from commerce.discount_codes d
    where d.store_id = ${storeId}::uuid and d.id = ${id}::uuid
  `);
  return row ? { ...toDiscount(row), used: Number(row.used) } : null;
}

/** An ISO time from the admin's `datetime-local`, read as Norwegian time. */
function osloTime(value: string | null): string | null {
  if (!value) return null;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : null;
  if (!local) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // The offset Oslo has at that moment (summer or winter time).
  const guess = new Date(`${local}:00Z`);
  const oslo = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Oslo" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (oslo.getTime() - utc.getTime())).toISOString();
}

/**
 * Creates or changes a code. Amounts are typed per market in its currency;
 * a fixed amount needs at least one market. A code that has been used
 * keeps its text and kind, so orders still say what they got.
 */
export async function saveDiscount(
  { account, store }: Membership,
  id: string | null,
  input: unknown,
): Promise<SaveResult & { id?: string }> {
  const parsed = storeDiscountInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const d = parsed.data;
  const problems: string[] = [];

  const perMarket = (texts: Record<string, string>, what: string) => {
    const out: Record<string, number> = {};
    for (const market of store.markets) {
      const text = texts[market.code] ?? "";
      if (!text) continue;
      const minor = parsePrice(text, market.currency);
      if (minor === null || minor <= 0) problems.push(`${what} for ${market.name} is not a valid amount.`);
      else out[market.code] = minor;
    }
    return out;
  };
  const amounts = d.kind === "fixed" ? perMarket(d.amounts, "The amount off") : {};
  const minSubtotals = perMarket(d.minSubtotals, "The minimum order");
  if (d.kind === "fixed" && Object.keys(amounts).length === 0 && problems.length === 0) {
    problems.push("Give the amount off in at least one country's currency.");
  }
  const startsAt = osloTime(d.startsAt);
  const endsAt = osloTime(d.endsAt);
  if (startsAt && endsAt && startsAt >= endsAt) problems.push("The code must end after it starts.");
  if (d.productIds) {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.products
      where store_id = ${store.id}::uuid and id in (${sql.join(d.productIds.map((p) => sql`${p}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== new Set(d.productIds).size) problems.push("A chosen product no longer exists.");
  }
  if (id) {
    const current = await getDiscount(store.id, id);
    if (!current) return { ok: false, problems: ["The code no longer exists."] };
    if (current.used > 0 && (current.code !== d.code || current.kind !== d.kind)) {
      problems.push("This code has been used, so its text and kind stay as they are. Make a new code instead.");
    }
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const values = {
    code: d.code,
    kind: d.kind,
    percent: d.kind === "percent" ? d.percent : 0,
    amounts: JSON.stringify(amounts),
    minSubtotals: JSON.stringify(minSubtotals),
    productIds: d.productIds ? JSON.stringify([...new Set(d.productIds)]) : null,
    recurring: d.kind === "percent" && d.recurring,
  };
  try {
    const [row] = id
      ? await db().execute<Row>(sql`
          update commerce.discount_codes set
            code = ${values.code}, kind = ${values.kind}, percent = ${values.percent},
            amounts = ${values.amounts}::jsonb, min_subtotals = ${values.minSubtotals}::jsonb,
            product_ids = ${values.productIds}::jsonb, recurring = ${values.recurring},
            starts_at = ${startsAt}::timestamptz, ends_at = ${endsAt}::timestamptz,
            usage_limit = ${d.usageLimit}, once_per_customer = ${d.oncePerCustomer}, active = ${d.active},
            updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid
          returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.discount_codes (
            store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
            starts_at, ends_at, usage_limit, once_per_customer, active
          ) values (
            ${store.id}::uuid, ${values.code}, ${values.kind}, ${values.percent}, ${values.amounts}::jsonb,
            ${values.minSubtotals}::jsonb, ${values.productIds}::jsonb, ${values.recurring},
            ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${d.usageLimit}, ${d.oncePerCustomer}, ${d.active}
          )
          returning id
        `);
    await audit(account.id, store.id, id ? "discount.updated" : "discount.created", { code: values.code });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [`The store already has a code ${values.code}.`] };
    throw error;
  }
}

/** Deletes a code no order has used; one that has been used can only be switched off. */
export async function deleteDiscount({ account, store }: Membership, id: string): Promise<SaveResult> {
  const current = await getDiscount(store.id, id);
  if (!current) return { ok: true };
  const [ever] = await db().execute<Row>(sql`
    select 1 from commerce.orders where store_id = ${store.id}::uuid and discount_code_id = ${id}::uuid limit 1
  `);
  if (ever) return { ok: false, problems: ["Orders have used this code, so it can only be switched off."] };
  await db().execute(sql`delete from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "discount.deleted", { code: current.code });
  return { ok: true };
}

export type FoundDiscount = { ok: true; discount: StoreDiscount } | { ok: false; problem: DiscountProblem };

/**
 * A code the shopper can use now: known to the store, switched on, within
 * its dates and limits. In checkout, pass the transaction and `lock`, so
 * two orders cannot take the last use at once.
 */
export async function findUsableDiscount(
  runner: Runner,
  storeId: string,
  text: string,
  { market, customerId, lock = false }: { market: Market; customerId: string | null; lock?: boolean },
): Promise<FoundDiscount> {
  const code = normalizeCode(text);
  if (!code) return { ok: false, problem: "unknown" };
  const [row] = await runner.execute<Row>(sql`
    select d.* from commerce.discount_codes d
    where d.store_id = ${storeId}::uuid and d.code = ${code}
    ${lock ? sql`for update` : sql``}
  `);
  if (!row) return { ok: false, problem: "unknown" };
  const [counts] = await runner.execute<Row>(sql`select ${used(customerId)} from commerce.discount_codes d where d.id = ${row.id}`);
  const discount = toDiscount(row);
  const problem = availability(discount, {
    now: new Date(),
    used: Number(counts.used),
    usedByCustomer: Number(counts.used_by_customer),
    signedIn: customerId !== null,
    marketCode: market.code,
  });
  return problem ? { ok: false, problem } : { ok: true, discount };
}

/** The code on the shopper's cart, if any. */
export async function getCartCode(shop: Shop): Promise<string | null> {
  const cartId = await readCartId(shop);
  if (!cartId) return null;
  const [row] = await db().execute<Row>(sql`
    select discount_code from commerce.carts
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
  return row?.discount_code ? String(row.discount_code) : null;
}

/** Puts a code on the cart (or takes it off, with null); the cart page checks it against the basket. */
export async function setCartCode(shop: Shop, text: string | null): Promise<boolean> {
  const cartId = await readCartId(shop);
  if (!cartId) return false;
  const code = text === null ? null : normalizeCode(text) || null;
  const rows = await db().execute<Row>(sql`
    update commerce.carts set discount_code = ${code}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
    returning id
  `);
  return rows.length > 0;
}

export type CartDiscount =
  | { code: string; ok: true; discount: StoreDiscount; applied: AppliedDiscount }
  | { code: string; ok: false; problem: DiscountProblem; minimumMinor: number | null };

/**
 * What the cart's code does to this basket, checked as checkout will
 * check it, so the cart shows what the shopper will pay.
 */
export async function previewCartDiscount(
  shop: Shop,
  basket: { lines: DiscountLine[]; shippingMinor: number },
): Promise<CartDiscount | null> {
  const code = await getCartCode(shop);
  if (!code) return null;
  const customer = await getCustomer(shop.storeId);
  const found = await findUsableDiscount(db(), shop.storeId, code, { market: shop.market, customerId: customer?.id ?? null });
  if (!found.ok) return { code, ok: false, problem: found.problem, minimumMinor: null };
  const result = applyDiscount(found.discount, { marketCode: shop.market.code, ...basket });
  return result.ok
    ? { code, ok: true, discount: found.discount, applied: result.applied }
    : { code, ok: false, problem: result.problem, minimumMinor: found.discount.minSubtotals[shop.market.code] ?? null };
}

/** The store's products to choose from, by title in the store's first language. */
export async function listProductChoices(storeId: string, locale: string): Promise<{ id: string; title: string }[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, coalesce(tl.title, tf.title, p.handle) as title
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where p.store_id = ${storeId}::uuid and p.status <> 'archived'
    order by 2
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
}
