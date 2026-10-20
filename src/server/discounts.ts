import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv } from "@/lib/csv";
import {
  applyDiscount,
  CODE_ITEMS_MAX,
  generateCodesInput,
  generatedCode,
  availability,
  normalizeCode,
  type AppliedDiscount,
  type DiscountLine,
  storeDiscountInput,
  type DiscountProblem,
  type StoreDiscount,
} from "@/lib/discounts";
import { shown, type Market } from "@/lib/markets";
import { parsePrice } from "@/lib/product-input";
import { planPrice } from "@/lib/subscriptions";

import { auditChange } from "./audit";
import type { Membership } from "./auth";
import { termsOfProducts } from "./campaigns";
import { readCartId, type Shop } from "./cart";
import { customerTierIds } from "./customer-tiers";
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
    termIds: ids(row.term_ids),
    minQuantity: row.min_quantity === null || row.min_quantity === undefined ? null : Number(row.min_quantity),
    tierIds: ids(row.tier_ids),
    customerIds: ids(row.customer_ids),
    uniqueCodes: Boolean(row.unique_codes),
  };
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const used = (customerId: string | null) => sql`
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and o.discount_code_id = d.id and o.status <> 'cancelled' and o.copied_from is null) as used,
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and o.discount_code_id = d.id and o.status <> 'cancelled' and o.copied_from is null
      and ${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid) as used_by_customer
`;

/**
 * A code's amounts for the market, in the currency shown (D109): what it
 * takes off and its minimum are typed in each country's own currency.
 */
function inShownCurrency(discount: StoreDiscount, market: Market): StoreDiscount {
  const code = market.code;
  const convert = (amounts: Record<string, number>) => (amounts[code] === undefined ? amounts : { ...amounts, [code]: shown(market, amounts[code]) });
  return { ...discount, amounts: convert(discount.amounts), minSubtotals: convert(discount.minSubtotals) };
}

export type DiscountListRow = StoreDiscount & {
  used: number;
  /** The discount given on paid orders, per currency. */
  given: Record<string, number>;
};

export async function listDiscounts(storeId: string): Promise<DiscountListRow[]> {
  const rows = await db().execute<Row>(sql`
    select d.*, ${used(null)},
      (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from (
        select o.currency, sum(o.discount_minor - o.credit_minor - o.referral_discount_minor - o.vat_relief_minor)::bigint as total from commerce.orders o
        where o.store_id = d.store_id and o.discount_code_id = d.id and o.copied_from is null
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

/** What the activity log keeps of a code: the fields of `ALLOWED_FIELDS.discount`, amounts in minor units per country (never a customer, never an order). */
function discountFacts(d: Pick<StoreDiscount, "code" | "kind" | "percent" | "amounts" | "minSubtotals" | "usageLimit" | "oncePerCustomer" | "startsAt" | "endsAt" | "active">): Record<string, unknown> {
  return {
    code: d.code,
    kind: d.kind,
    value: d.kind === "percent" ? d.percent : d.amounts,
    minimumMinor: Object.keys(d.minSubtotals).length > 0 ? d.minSubtotals : null,
    usageLimit: d.usageLimit,
    perCustomerLimit: d.oncePerCustomer ? 1 : null,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    active: d.active,
  };
}

/** An ISO time from the admin's `datetime-local`, read as Norwegian time. */
export function osloTime(value: string | null): string | null {
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
 * a fixed amount needs at least one market. Orders already placed keep
 * what they got: a change only applies to orders from now on.
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
  const termIds = [...new Set(d.termIds)];
  if (termIds.length > 0) {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.terms
      where store_id = ${store.id}::uuid and content_type = 'product' and id in (${sql.join(termIds.map((t) => sql`${t}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== termIds.length) problems.push("A chosen category or tag no longer exists.");
  }
  const tierIds = [...new Set(d.tierIds)];
  if (tierIds.length > 0) {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.customer_tiers
      where store_id = ${store.id}::uuid and id in (${sql.join(tierIds.map((t) => sql`${t}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== tierIds.length) problems.push("A chosen customer group no longer exists.");
  }
  // Named customers are typed by their email and kept by id; an email the store does not know is said, never guessed.
  const emails = [...new Set(d.customerEmails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  let customerIds: string[] = [];
  if (emails.length > 100) problems.push("Name at most 100 customers.");
  else if (emails.length > 0) {
    const rows = await db().execute<Row>(sql`
      select id, lower(email) as email from commerce.customers
      where store_id = ${store.id}::uuid and lower(email) in (select jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb))
    `);
    const known = new Map(rows.map((r) => [String(r.email), String(r.id)]));
    const unknown = emails.filter((e) => !known.has(e));
    if (unknown.length > 0) problems.push(`No customer has the email ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ""}.`);
    customerIds = [...new Set(emails.map((e) => known.get(e)).filter((v): v is string => Boolean(v)))];
  }
  const existing = id ? await getDiscount(store.id, id) : null;
  if (id && !existing) return { ok: false, problems: ["The code no longer exists."] };
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  // A country the store keeps but does not offer now (Several countries off, D178) is not in the editor: its amounts are kept as they were.
  if (existing) {
    const hidden = (code: string) => !store.markets.some((m) => m.code === code);
    if (d.kind === "fixed") for (const [code, minor] of Object.entries(existing.amounts)) if (hidden(code)) amounts[code] ??= minor;
    for (const [code, minor] of Object.entries(existing.minSubtotals)) if (hidden(code)) minSubtotals[code] ??= minor;
  }

  const values = {
    code: d.code,
    kind: d.kind,
    percent: d.kind === "percent" ? d.percent : 0,
    amounts: JSON.stringify(amounts),
    minSubtotals: JSON.stringify(minSubtotals),
    productIds: d.productIds ? JSON.stringify([...new Set(d.productIds)]) : null,
    recurring: d.kind === "percent" && d.recurring,
    termIds: JSON.stringify(termIds),
    tierIds: JSON.stringify(tierIds),
    customerIds: JSON.stringify(customerIds),
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
            term_ids = ${values.termIds}::jsonb, min_quantity = ${d.minQuantity}, tier_ids = ${values.tierIds}::jsonb,
            customer_ids = ${values.customerIds}::jsonb, unique_codes = ${d.uniqueCodes},
            updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid
          returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.discount_codes (
            store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
            starts_at, ends_at, usage_limit, once_per_customer, active, term_ids, min_quantity, tier_ids, customer_ids, unique_codes
          ) values (
            ${store.id}::uuid, ${values.code}, ${values.kind}, ${values.percent}, ${values.amounts}::jsonb,
            ${values.minSubtotals}::jsonb, ${values.productIds}::jsonb, ${values.recurring},
            ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${d.usageLimit}, ${d.oncePerCustomer}, ${d.active},
            ${values.termIds}::jsonb, ${d.minQuantity}, ${values.tierIds}::jsonb, ${values.customerIds}::jsonb, ${d.uniqueCodes}
          )
          returning id
        `);
    const saved = await getDiscount(store.id, String(row.id));
    await auditChange(
      { accountId: account.id, storeId: store.id },
      id ? "discount.updated" : "discount.created",
      { type: "discount", id: String(row.id), label: values.code },
      existing ? discountFacts(existing) : null,
      saved ? discountFacts(saved) : null,
      "discount",
      { code: values.code },
    );
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [`The store already has a code ${values.code}.`] };
    throw error;
  }
}

/**
 * Deletes a code. Orders that used it keep what they got and still show
 * the code's text; shoppers can no longer use it.
 */
export async function deleteDiscount({ account, store }: Membership, id: string): Promise<SaveResult> {
  const current = await getDiscount(store.id, id);
  if (!current) return { ok: true };
  await db().execute(sql`delete from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await auditChange({ accountId: account.id, storeId: store.id }, "discount.deleted", { type: "discount", id, label: current.code }, discountFacts(current), null, "discount", { code: current.code, used: current.used });
  return { ok: true };
}

export type FoundDiscount =
  | { ok: true; discount: StoreDiscount; /** The generated code used (D299 E1), and its text. */ item: { id: string; code: string } | null }
  | { ok: false; problem: DiscountProblem };

/**
 * A code the shopper can use now: known to the store, switched on, within
 * its dates and limits, and for this customer. The text is one of the store's
 * own codes, else one of its generated single-use codes (D299 E1), whose
 * code is then the one that applies. In checkout, pass the transaction and
 * `lock`, so two orders cannot take the last use (or a generated code) at once.
 */
export async function findUsableDiscount(
  runner: Runner,
  storeId: string,
  text: string,
  { market, customerId, lock = false }: { market: Market; customerId: string | null; lock?: boolean },
): Promise<FoundDiscount> {
  const code = normalizeCode(text);
  if (!code) return { ok: false, problem: "unknown" };
  let [row] = await runner.execute<Row>(sql`
    select d.* from commerce.discount_codes d
    where d.store_id = ${storeId}::uuid and d.code = ${code}
    ${lock ? sql`for update` : sql``}
  `);
  let item: { id: string; code: string } | null = null;
  if (row?.unique_codes) return { ok: false, problem: "unknown" };
  if (!row) {
    const [found] = await runner.execute<Row>(sql`
      select i.id as item_id, i.code as item_code, i.discount_id from commerce.discount_code_items i
      where i.store_id = ${storeId}::uuid and i.code = ${code}
      ${lock ? sql`for update` : sql``}
    `);
    if (!found) return { ok: false, problem: "unknown" };
    [row] = await runner.execute<Row>(sql`
      select d.* from commerce.discount_codes d
      where d.store_id = ${storeId}::uuid and d.id = ${String(found.discount_id)}::uuid and d.unique_codes
      ${lock ? sql`for update` : sql``}
    `);
    if (!row) return { ok: false, problem: "unknown" };
    item = { id: String(found.item_id), code: String(found.item_code) };
  }
  const [counts] = await runner.execute<Row>(sql`
    select ${used(customerId)},
      (select count(*)::int from commerce.orders o
        where o.store_id = d.store_id and o.discount_code_item_id = ${item?.id ?? null}::uuid and o.status <> 'cancelled' and o.copied_from is null) as item_used
    from commerce.discount_codes d where d.id = ${row.id}
  `);
  const discount = inShownCurrency(toDiscount(row), market);
  const limited = discount.tierIds.length > 0 || discount.customerIds.length > 0;
  const tierIds = limited && customerId ? await customerTierIds(runner, storeId, customerId) : [];
  const problem = availability(discount, {
    now: new Date(),
    used: Number(counts.used),
    usedByCustomer: Number(counts.used_by_customer),
    signedIn: customerId !== null,
    marketCode: market.code,
    itemUsed: item ? Number(counts.item_used) : undefined,
    customer: customerId ? { id: customerId, tierIds } : null,
  });
  return problem ? { ok: false, problem } : { ok: true, discount, item };
}

/**
 * What a code takes off a basket (D31, D299 E1): `applyDiscount()` with the basket's products the code's categories and tags reach (a
 * category reaches the ones under it), read here as campaigns read them. The cart, the checkout's code check and `placeOrder()` all apply a
 * code through this, so they agree.
 */
export async function applyCode(
  runner: Runner,
  storeId: string,
  discount: StoreDiscount,
  basket: { marketCode: string; lines: DiscountLine[]; shippingMinor: number },
): Promise<ReturnType<typeof applyDiscount>> {
  let reached: Set<string> | undefined;
  if (discount.termIds.length > 0) {
    const terms = await termsOfProducts(runner, storeId, [...new Set(basket.lines.map((l) => l.productId))]);
    reached = new Set([...terms].filter(([, termIds]) => termIds.some((t) => discount.termIds.includes(t))).map(([productId]) => productId));
  }
  return applyDiscount(discount, { ...basket, reached });
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
  const result = await applyCode(db(), shop.storeId, found.discount, { marketCode: shop.market.code, ...basket });
  return result.ok
    ? { code, ok: true, discount: found.discount, applied: result.applied }
    : { code, ok: false, problem: result.problem, minimumMinor: found.discount.minSubtotals[shop.market.code] ?? null };
}

/**
 * Whether a code the shopper types at checkout would apply to the order
 * waiting for payment, checked as placing the order will (D31, D38): the
 * order is only placed again once it does, so a code that does not work
 * never costs the shopper their checkout.
 */
export async function checkCodeForOrder(
  shop: Shop,
  orderId: string,
  text: string,
): Promise<{ ok: true; code: string } | { ok: false; problem: DiscountProblem; minimumMinor: number | null }> {
  const customer = await getCustomer(shop.storeId);
  const found = await findUsableDiscount(db(), shop.storeId, text, { market: shop.market, customerId: customer?.id ?? null });
  if (!found.ok) return { ok: false, problem: found.problem, minimumMinor: null };
  const [order] = await db().execute<Row>(sql`
    select shipping_minor, member_percent from commerce.orders where store_id = ${shop.storeId}::uuid and id = ${orderId}::uuid
  `);
  const lines = await db().execute<Row>(sql`
    select ol.id, v.product_id, ol.unit_price_minor, ol.member_discount_minor, ol.campaign_discount_minor, ol.referral_discount_minor, ol.quantity, ol.selling_plan_id is not null as recurring
    from commerce.order_lines ol
    join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
    where ol.store_id = ${shop.storeId}::uuid and ol.order_id = ${orderId}::uuid
  `);
  if (!order) return { ok: false, problem: "not_applicable", minimumMinor: null };
  const result = await applyCode(db(), shop.storeId, found.discount, {
    marketCode: shop.market.code,
    // The code counts what a campaign (D114), the buyer's group or company discount (D108) and the friend's welcome discount (D131) left, as placing the order does.
    lines: lines.map((line) => ({
      key: String(line.id),
      productId: String(line.product_id),
      unitMinor: Number(line.member_discount_minor) > 0 ? planPrice(Number(line.unit_price_minor), Number(order.member_percent)) : Number(line.unit_price_minor),
      quantity: Number(line.quantity),
      todayMinor: Number(line.unit_price_minor) * Number(line.quantity) - Number(line.member_discount_minor) - Number(line.campaign_discount_minor) - Number(line.referral_discount_minor),
      recurring: Boolean(line.recurring),
    })),
    shippingMinor: Number(order.shipping_minor),
  });
  return result.ok
    ? { ok: true, code: found.item?.code ?? found.discount.code }
    : { ok: false, problem: result.problem, minimumMinor: found.discount.minSubtotals[shop.market.code] ?? null };
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

// ---------------------------------------------------------------------------
// Generated single-use codes (D299 E1, docs/wave-5-marketing.md 7.1)
// ---------------------------------------------------------------------------

export type GenerateResult = { ok: true; made: number } | { ok: false; problem: string };

/** Makes up to `count` new single-use codes for a code with generated codes (`marketing:write`); each text is new in the store. */
export async function generateCodes({ account, store }: Membership, id: string, input: unknown): Promise<GenerateResult> {
  const parsed = generateCodesInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Say how many codes to make." };
  const { count, prefix } = parsed.data;
  const discount = await getDiscount(store.id, id);
  if (!discount) return { ok: false, problem: "The code no longer exists." };
  if (!discount.uniqueCodes) return { ok: false, problem: "Switch on single-use codes for this discount first." };
  const made = await db().transaction(async (tx) => {
    await tx.execute(sql`select 1 from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${id}::uuid for update`);
    const [state] = await tx.execute<Row>(sql`
      select count(*)::int as n, coalesce(max(batch), 0)::int as batch from commerce.discount_code_items
      where store_id = ${store.id}::uuid and discount_id = ${id}::uuid
    `);
    if (Number(state.n) + count > CODE_ITEMS_MAX) return -1;
    const batch = Number(state.batch) + 1;
    let total = 0;
    // A clash with a code already there is skipped and made again; with eight characters from 31 that is rare.
    for (let round = 0; round < 10 && total < count; round++) {
      const wanted = new Set<string>();
      while (wanted.size < count - total) wanted.add(generatedCode(prefix, (n) => new Uint8Array(randomBytes(n))));
      for (let start = 0; start < wanted.size; start += 1000) {
        const chunk = [...wanted].slice(start, start + 1000);
        const rows = await tx.execute<Row>(sql`
          insert into commerce.discount_code_items (store_id, discount_id, code, batch)
          select ${store.id}::uuid, ${id}::uuid, c, ${batch} from jsonb_array_elements_text(${JSON.stringify(chunk)}::jsonb) as c
          where not exists (select 1 from commerce.discount_codes d where d.store_id = ${store.id}::uuid and d.code = c)
          on conflict (store_id, code) do nothing
          returning 1
        `);
        total += rows.length;
      }
    }
    return total;
  });
  if (made < 0) return { ok: false, problem: `A code can have at most ${CODE_ITEMS_MAX.toLocaleString("en-GB")} generated codes.` };
  await auditChange({ accountId: account.id, storeId: store.id }, "discount.codes_generated", { type: "discount", id, label: discount.code }, null, null, "discount", { count: made });
  return { ok: true, made };
}

/** How many generated codes a code has, and how many were used. */
export async function codeItemCounts(storeId: string, id: string): Promise<{ made: number; used: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as made,
      count(*) filter (where exists (
        select 1 from commerce.orders o where o.store_id = i.store_id and o.discount_code_item_id = i.id and o.status <> 'cancelled' and o.copied_from is null
      ))::int as used
    from commerce.discount_code_items i where i.store_id = ${storeId}::uuid and i.discount_id = ${id}::uuid
  `);
  return { made: Number(row?.made ?? 0), used: Number(row?.used ?? 0) };
}

/** The CSV of a code's generated codes (code, used, made on), for the owner to hand out; logged without any code's text. */
export async function exportCodeItems({ account, store }: Membership, id: string): Promise<{ csv: string; name: string } | null> {
  const discount = await getDiscount(store.id, id);
  if (!discount) return null;
  const rows = await db().execute<Row>(sql`
    select i.code, i.created_at,
      exists (select 1 from commerce.orders o where o.store_id = i.store_id and o.discount_code_item_id = i.id and o.status <> 'cancelled' and o.copied_from is null) as used
    from commerce.discount_code_items i where i.store_id = ${store.id}::uuid and i.discount_id = ${id}::uuid
    order by i.batch, i.code
  `);
  const csv = writeCsv([
    ["code", "used", "made_on"],
    ...rows.map((r) => [String(r.code), r.used ? "yes" : "no", new Date(String(r.created_at)).toISOString().slice(0, 10)]),
  ]);
  await auditChange({ accountId: account.id, storeId: store.id }, "discount.codes_exported", { type: "discount", id, label: discount.code }, null, null, "discount", { count: rows.length });
  return { csv, name: `${discount.code.toLowerCase()}-codes.csv` };
}

/** The emails of the customers a code is for, in the order kept, for its editor. */
export async function customerEmailsOf(storeId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select email from commerce.customers
    where store_id = ${storeId}::uuid and id in (select v::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as v)
    order by lower(email)
  `);
  return rows.map((r) => String(r.email));
}
