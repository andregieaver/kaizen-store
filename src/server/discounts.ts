import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv } from "@/lib/csv";
import { codeAllowed, codeRuleFor, type CodeRule } from "@/lib/discount-combinations";
import {
  applyDiscount,
  CODE_CLASSES,
  CODE_ITEMS_MAX,
  CODES_MAX,
  stackCodes,
  type CodeClass,
  type StackCandidate,
  type StackRefusal,
  generateCodesInput,
  generatedCode,
  availability,
  limitedToSome,
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
import { segmentsOfBuyer } from "./segment-membership";
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
    combinesWith: (Array.isArray(row.combines_with) ? row.combines_with : []).filter((c): c is CodeClass => (CODE_CLASSES as readonly string[]).includes(String(c))),
    // Older rows and reads without the column combine, as every code did before D367.
    combinesWithCampaigns: row.combines_with_campaigns !== false,
    segmentId: row.segment_id ? String(row.segment_id) : null,
    maxUnits: row.max_units === null || row.max_units === undefined ? null : Number(row.max_units),
    reward: row.reward === true,
  };
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/**
 * An order used the code `d` when it is its first code or one of its others (D299 E2: `order_discount_codes`; orders placed before have only the
 * first, on the order).
 */
const orderUsed = sql`(o.discount_code_id = d.id or exists (
  select 1 from commerce.order_discount_codes x where x.store_id = o.store_id and x.order_id = o.id and x.discount_id = d.id))`;

const used = (customerId: string | null) => sql`
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and ${orderUsed} and o.status <> 'cancelled' and o.copied_from is null) as used,
  (select count(*)::int from commerce.orders o
    where o.store_id = d.store_id and ${orderUsed} and o.status <> 'cancelled' and o.copied_from is null
      and ${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid) as used_by_customer
`;

/** An order used the generated code `i` (D299 E1, E2). */
const itemUsed = sql`(o.discount_code_item_id = i.id or exists (
  select 1 from commerce.order_discount_codes x where x.store_id = o.store_id and x.order_id = o.id and x.item_id = i.id))`;

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
        -- What the code itself took off where the order keeps it (D299 E2), else the order's discount as before.
        select o.currency, sum(coalesce(
          (select sum(x.amount_minor) from commerce.order_discount_codes x where x.store_id = o.store_id and x.order_id = o.id and x.discount_id = d.id),
          o.discount_minor - o.credit_minor - o.referral_discount_minor - o.vat_relief_minor))::bigint as total from commerce.orders o
        where o.store_id = d.store_id and ${orderUsed} and o.copied_from is null
          and o.status not in ('cancelled', 'pending_payment')
        group by o.currency) g) as given
    from commerce.discount_codes d
    -- A loyalty reward's code (D401) is the reward's, kept on the Bonus page.
    where d.store_id = ${storeId}::uuid and not d.reward
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
function discountFacts(
  d: Pick<StoreDiscount, "code" | "kind" | "percent" | "amounts" | "minSubtotals" | "usageLimit" | "oncePerCustomer" | "startsAt" | "endsAt" | "active" | "segmentId">,
): Record<string, unknown> {
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
    // The segment's id (D380), never who is in it.
    segment: d.segmentId,
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
  if (d.segmentId) {
    const [row] = await db().execute<Row>(sql`select 1 from commerce.segments where store_id = ${store.id}::uuid and id = ${d.segmentId}::uuid`);
    if (!row) problems.push("The chosen segment no longer exists.");
  }
  const existing = id ? await getDiscount(store.id, id) : null;
  if (id && !existing) return { ok: false, problems: ["The code no longer exists."] };
  if (existing?.reward) return { ok: false, problems: ["This code belongs to a loyalty reward: change it on the Bonus page."] };
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
    combinesWith: JSON.stringify([...new Set(d.combinesWith)]),
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
            customer_ids = ${values.customerIds}::jsonb, unique_codes = ${d.uniqueCodes}, combines_with = ${values.combinesWith}::jsonb,
            combines_with_campaigns = ${d.combinesWithCampaigns}, segment_id = ${d.segmentId}::uuid, updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid and not reward
          returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.discount_codes (
            store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
            starts_at, ends_at, usage_limit, once_per_customer, active, term_ids, min_quantity, tier_ids, customer_ids, unique_codes, combines_with,
            combines_with_campaigns, segment_id
          ) values (
            ${store.id}::uuid, ${values.code}, ${values.kind}, ${values.percent}, ${values.amounts}::jsonb,
            ${values.minSubtotals}::jsonb, ${values.productIds}::jsonb, ${values.recurring},
            ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${d.usageLimit}, ${d.oncePerCustomer}, ${d.active},
            ${values.termIds}::jsonb, ${d.minQuantity}, ${values.tierIds}::jsonb, ${values.customerIds}::jsonb, ${d.uniqueCodes},
            ${values.combinesWith}::jsonb, ${d.combinesWithCampaigns}, ${d.segmentId}::uuid
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
  if (!current || current.reward) return { ok: true };
  await db().execute(sql`delete from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${id}::uuid and not reward`);
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
  let itemFacts: { customerId: string | null; endsAt: string | null } | undefined;
  if (row?.unique_codes) return { ok: false, problem: "unknown" };
  if (!row) {
    const [found] = await runner.execute<Row>(sql`
      select i.id as item_id, i.code as item_code, i.discount_id, i.customer_id as item_customer, i.ends_at as item_ends from commerce.discount_code_items i
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
    itemFacts = { customerId: found.item_customer ? String(found.item_customer) : null, endsAt: iso(found.item_ends) };
  }
  const [counts] = await runner.execute<Row>(sql`
    select ${used(customerId)},
      (select count(*)::int from commerce.discount_code_items i join commerce.orders o on o.store_id = i.store_id and ${itemUsed}
        where i.store_id = d.store_id and i.id = ${item?.id ?? null}::uuid and o.status <> 'cancelled' and o.copied_from is null) as item_used
    from commerce.discount_codes d where d.id = ${row.id}
  `);
  const discount = inShownCurrency(toDiscount(row), market);
  const limited = limitedToSome(discount);
  const tierIds = limited && customerId ? await customerTierIds(runner, storeId, customerId) : [];
  // A code for a segment's people (D380) asks whether this buyer is one of them now.
  const segmentIds = discount.segmentId && customerId ? [...(await segmentsOfBuyer(runner, storeId, customerId, [discount.segmentId]))] : [];
  const problem = availability(discount, {
    now: new Date(),
    used: Number(counts.used),
    usedByCustomer: Number(counts.used_by_customer),
    signedIn: customerId !== null,
    marketCode: market.code,
    itemUsed: item ? Number(counts.item_used) : undefined,
    item: itemFacts,
    customer: customerId ? { id: customerId, tierIds, segmentIds } : null,
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

/** The codes on the shopper's cart (D299 E2), in the order typed: the first, then the rest. */
export async function getCartCodes(shop: Shop): Promise<string[]> {
  const cartId = await readCartId(shop);
  if (!cartId) return [];
  const [row] = await db().execute<Row>(sql`
    select discount_code, more_codes from commerce.carts
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
  return row ? cartCodesOf(row) : [];
}

/** A cart row's codes: `discount_code` first, then `more_codes`. */
export function cartCodesOf(row: Row): string[] {
  const more = Array.isArray(row.more_codes) ? row.more_codes.map(String) : [];
  return [...new Set([...(row.discount_code ? [String(row.discount_code)] : []), ...more].filter(Boolean))];
}

async function writeCartCodes(shop: Shop, change: (codes: string[]) => string[] | null): Promise<"saved" | "full" | "none"> {
  const cartId = await readCartId(shop);
  if (!cartId) return "none";
  return db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select discount_code, more_codes from commerce.carts
      where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
      for update
    `);
    if (!row) return "none";
    const next = change(cartCodesOf(row));
    if (next === null) return "full";
    await tx.execute(sql`
      update commerce.carts
      set discount_code = ${next[0] ?? null},
          more_codes = coalesce((select array_agg(c order by n) from jsonb_array_elements_text(${JSON.stringify(next.slice(1))}::jsonb) with ordinality as t(c, n)), '{}'),
          updated_at = now()
      where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid
    `);
    return "saved";
  });
}

/** Adds a code to the cart (D299 E2); one already there is not added twice, and a sixth is refused. */
export async function addCartCode(shop: Shop, text: string): Promise<"saved" | "full" | "none"> {
  const code = normalizeCode(text);
  if (!code) return "none";
  return writeCartCodes(shop, (codes) => (codes.includes(code) ? codes : codes.length >= CODES_MAX ? null : [...codes, code]));
}

/** Puts exactly this code on the cart (or none, with null), as a cart reminder's link does. */
export async function setCartCode(shop: Shop, text: string | null): Promise<boolean> {
  const code = text === null ? null : normalizeCode(text) || null;
  return (await writeCartCodes(shop, () => (code ? [code] : []))) === "saved";
}

/** Takes one code off the cart, or all of them with null. */
export async function removeCartCode(shop: Shop, text: string | null): Promise<boolean> {
  const code = text === null ? null : normalizeCode(text);
  return (await writeCartCodes(shop, (codes) => (code === null ? [] : codes.filter((c) => c !== code)))) === "saved";
}

/** What became of each code on a basket (D299 E2), in the order the shopper typed them. */
export type CodeOutcome =
  | { code: string; ok: true; amountMinor: number }
  | {
      code: string;
      ok: false;
      problem: DiscountProblem;
      /** The code it cannot be used with, for `not_combinable`. */
      with: string | null;
      /** Its own minimum in the currency shown, for `minimum`. */
      minimumMinor: number | null;
      /** It does not apply on its own (rather than only beside the others). */
      alone: boolean;
    };

export type CodesResult = {
  codes: CodeOutcome[];
  /** The codes used, in the order applied, with the generated code where one was typed. */
  used: { code: string; discount: StoreDiscount; item: { id: string; code: string } | null; applied: AppliedDiscount }[];
  /** What they take off together; null when none applies. */
  applied: AppliedDiscount | null;
  /** The codes used, joined by " + " as the order keeps them; null for none. */
  label: string | null;
};

/**
 * Which of the codes typed apply to a basket, and what they take off together (D299 E2): each is checked as a single code is
 * (`findUsableDiscount()`), and `stackCodes()` chooses among those that can be used. The cart, the checkout's code field and
 * `placeOrder()` all go through this, so they agree. With `lock` (in `placeOrder()`'s transaction) every code and generated
 * code typed is locked first, in id order, so two checkouts never wait on each other in a circle.
 */
export async function stackForBasket(
  runner: Runner,
  storeId: string,
  texts: string[],
  context: {
    market: Market;
    customerId: string | null;
    lock?: boolean;
    /** Which codes the basket's campaigns let in (D367, `campaignsAndCodes()`); a code kept out is refused as `with_campaigns`. */
    campaigns?: CodeRule;
  },
  basket: { marketCode: string; lines: DiscountLine[]; shippingMinor: number },
): Promise<CodesResult> {
  const typed = [...new Set(texts.map(normalizeCode).filter(Boolean))].slice(0, CODES_MAX);
  if (typed.length === 0) return { codes: [], used: [], applied: null, label: null };
  if (context.lock) {
    const list = JSON.stringify(typed);
    await runner.execute(sql`
      select d.id from commerce.discount_codes d
      where d.store_id = ${storeId}::uuid and (
        d.code in (select jsonb_array_elements_text(${list}::jsonb))
        or d.id in (select i.discount_id from commerce.discount_code_items i
                    where i.store_id = ${storeId}::uuid and i.code in (select jsonb_array_elements_text(${list}::jsonb))))
      order by d.id for update
    `);
    await runner.execute(sql`
      select i.id from commerce.discount_code_items i
      where i.store_id = ${storeId}::uuid and i.code in (select jsonb_array_elements_text(${list}::jsonb))
      order by i.id for update
    `);
  }
  const found = await Promise.all(typed.map((text) => findUsableDiscount(runner, storeId, text, context).then((f) => ({ text, f }))));
  const usable = found.filter(
    (x): x is { text: string; f: Extract<FoundDiscount, { ok: true }> } => x.f.ok && codeAllowed(context.campaigns, x.f.discount),
  );
  const termed = usable.some((x) => x.f.discount.termIds.length > 0);
  const terms = termed ? await termsOfProducts(runner, storeId, [...new Set(basket.lines.map((l) => l.productId))]) : null;
  const candidates: StackCandidate[] = usable.map(({ text, f }) => ({
    key: text,
    discount: f.discount,
    reached:
      f.discount.termIds.length > 0 && terms
        ? new Set([...terms].filter(([, termIds]) => termIds.some((t) => f.discount.termIds.includes(t))).map(([productId]) => productId))
        : undefined,
  }));
  const stack = stackCodes(candidates, basket);
  const byText = new Map(usable.map((x) => [x.text, x.f]));
  const used = stack.used.map((u) => {
    const f = byText.get(u.key)!;
    return { code: f.item?.code ?? f.discount.code, discount: f.discount, item: f.item, applied: u.applied };
  });
  const codes: CodeOutcome[] = found.map(({ text, f }): CodeOutcome => {
    if (!f.ok) return { code: text, ok: false, problem: f.problem, with: null, minimumMinor: null, alone: true };
    // Left out for the basket's campaigns, which gave more (D367): it would apply, so it does not stop the checkout.
    if (!codeAllowed(context.campaigns, f.discount)) return { code: text, ok: false, problem: "with_campaigns", with: null, minimumMinor: null, alone: false };
    const hit = stack.used.find((u) => u.key === text);
    if (hit) return { code: text, ok: true, amountMinor: hit.applied.totalMinor };
    const refusal: StackRefusal = stack.refused[text] ?? { problem: "not_applicable", with: null, alone: true };
    return {
      code: text,
      ok: false,
      problem: refusal.problem,
      with: refusal.with,
      minimumMinor: refusal.problem === "minimum" ? (f.discount.minSubtotals[basket.marketCode] ?? null) : null,
      alone: refusal.alone,
    };
  });
  return {
    codes,
    used,
    applied: used.length > 0 ? stack.applied : null,
    label: used.length > 0 ? used.map((u) => u.code).join(" + ") : null,
  };
}

/**
 * What the cart's codes do to this basket, checked as checkout will
 * check them, so the cart shows what the shopper will pay.
 */
export async function previewCartCodes(
  shop: Shop,
  basket: { lines: DiscountLine[]; shippingMinor: number },
  /**
   * The cart's codes and the buyer when the caller has read them (else the cookie's cart and the signed-in customer), and which codes
   * the basket's campaigns let in (D367, `campaignsAndCodes()`).
   */
  options: { texts?: string[]; customerId?: string | null; campaigns?: CodeRule } = {},
): Promise<CodesResult | null> {
  const texts = options.texts ?? (await getCartCodes(shop));
  if (texts.length === 0) return null;
  const customerId = options.customerId !== undefined ? options.customerId : ((await getCustomer(shop.storeId))?.id ?? null);
  return stackForBasket(db(), shop.storeId, texts, { market: shop.market, customerId, campaigns: options.campaigns }, { marketCode: shop.market.code, ...basket });
}

/**
 * Whether a code the shopper types at checkout would apply to the order
 * waiting for payment beside the codes already on the cart, checked as
 * placing the order will (D31, D38, D299 E2): the order is only placed again
 * once it does, so a code that does not work never costs the shopper their
 * checkout. A code that applies may push out one it cannot be used with,
 * when it takes more off; the cart then says why of the other.
 */
export async function checkCodeForOrder(
  shop: Shop,
  orderId: string,
  text: string,
): Promise<{ ok: true; code: string } | { ok: false; problem: DiscountProblem; with: string | null; minimumMinor: number | null }> {
  const typed = normalizeCode(text);
  if (!typed) return { ok: false, problem: "unknown", with: null, minimumMinor: null };
  const current = (await getCartCodes(shop)).filter((c) => c !== typed);
  if (current.length >= CODES_MAX) return { ok: false, problem: "codes_full", with: null, minimumMinor: null };
  const result = await stackOnOrder(shop, orderId, [...current, typed]);
  const outcome = result?.codes.find((c) => c.code === typed);
  if (!result || !outcome) return { ok: false, problem: "not_applicable", with: null, minimumMinor: null };
  // Kept out only by the order's campaigns (D367): placing the order again weighs the code against them and takes the better.
  if (outcome.ok || outcome.problem === "with_campaigns") return { ok: true, code: typed };
  return { ok: false, problem: outcome.problem, with: outcome.with, minimumMinor: outcome.minimumMinor };
}

/** What became of each of the cart's codes on the order waiting for payment, for the checkout to say (D299 E2); null without codes. */
export async function orderCodeOutcomes(shop: Shop, orderId: string): Promise<CodeOutcome[] | null> {
  const texts = await getCartCodes(shop);
  if (texts.length === 0) return null;
  return (await stackOnOrder(shop, orderId, texts))?.codes ?? null;
}

/** The codes stacked on an order waiting for payment, counting what a campaign, the group and the welcome discount left. */
async function stackOnOrder(shop: Shop, orderId: string, texts: string[]): Promise<CodesResult | null> {
  const customer = await getCustomer(shop.storeId);
  const [order] = await db().execute<Row>(sql`
    select shipping_minor, member_percent from commerce.orders where store_id = ${shop.storeId}::uuid and id = ${orderId}::uuid
  `);
  if (!order) return null;
  // The campaigns the order got (D367): a code they do not combine with is kept out, as placing the order kept it.
  const [given] = await db().execute<Row>(sql`
    select count(*)::int as n, coalesce(bool_and(c.combines_with_codes), true) as combine
    from commerce.campaigns c
    where c.store_id = ${shop.storeId}::uuid and c.id::text in (
      select o.campaign_shipping ->> 'id' from commerce.orders o
      where o.store_id = ${shop.storeId}::uuid and o.id = ${orderId}::uuid and o.campaign_shipping is not null
      union
      select part ->> 'id' from commerce.order_lines ol cross join lateral jsonb_array_elements(ol.campaign_parts) part
      where ol.store_id = ${shop.storeId}::uuid and ol.order_id = ${orderId}::uuid
    )
  `);
  const campaigns = codeRuleFor(Number(given?.n ?? 0) > 0 ? [{ combinesWithCodes: Boolean(given.combine) }] : []);
  const lines = await db().execute<Row>(sql`
    select ol.id, v.product_id, ol.unit_price_minor, ol.member_discount_minor, ol.campaign_discount_minor, ol.referral_discount_minor, ol.quantity, ol.selling_plan_id is not null as recurring
    from commerce.order_lines ol
    join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
    where ol.store_id = ${shop.storeId}::uuid and ol.order_id = ${orderId}::uuid
  `);
  return stackForBasket(db(), shop.storeId, texts, { market: shop.market, customerId: customer?.id ?? null, campaigns }, {
    marketCode: shop.market.code,
    // The codes count what a campaign (D114), the buyer's group or company discount (D108) and the friend's welcome discount (D131) left, as placing the order does.
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
  if (discount.reward) return { ok: false, problem: "A reward's codes are made when customers redeem it." };
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
        select 1 from commerce.orders o where o.store_id = i.store_id and ${itemUsed} and o.status <> 'cancelled' and o.copied_from is null
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
      exists (select 1 from commerce.orders o where o.store_id = i.store_id and ${itemUsed} and o.status <> 'cancelled' and o.copied_from is null) as used
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

// ---------------------------------------------------------------------------
// Sign-up codes (D304 J3)
// ---------------------------------------------------------------------------

/** The store's discounts with single-use codes, as a newsletter form's welcome code can be (the builder's choice). */
export async function signupCodeChoices(storeId: string): Promise<{ id: string; code: string }[]> {
  const rows = await db().execute<Row>(sql`
    select id, code from commerce.discount_codes where store_id = ${storeId}::uuid and unique_codes and not reward order by active desc, code
  `);
  return rows.map((r) => ({ id: String(r.id), code: String(r.code) }));
}

/**
 * One single-use code of the form's discount for an address that has just confirmed its sign-up (D304 J3), or null: once per store, discount
 * and address whichever form asked (`signup_incentives`), only for the store's own discount with single-use codes, on and inside its dates, and
 * never past `CODE_ITEMS_MAX`. The code's text is returned for its email and kept nowhere but the code list.
 */
export async function issueSignupCode(storeId: string, discountId: string, email: string, formId: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const discount = await getDiscount(storeId, discountId);
  if (!discount || !discount.uniqueCodes || !discount.active) return null;
  const now = Date.now();
  if (discount.startsAt && Date.parse(discount.startsAt) > now) return null;
  if (discount.endsAt && Date.parse(discount.endsAt) <= now) return null;
  return db().transaction(async (tx) => {
    await tx.execute(sql`select 1 from commerce.discount_codes where store_id = ${storeId}::uuid and id = ${discountId}::uuid for update`);
    const [state] = await tx.execute<Row>(sql`
      select count(*)::int as n, coalesce(max(batch), 0)::int as batch,
        (select max(i.batch) from commerce.signup_incentives s join commerce.discount_code_items i on i.store_id = s.store_id and i.id = s.code_item_id
          where s.store_id = ${storeId}::uuid and s.discount_id = ${discountId}::uuid)::int as signup_batch
      from commerce.discount_code_items where store_id = ${storeId}::uuid and discount_id = ${discountId}::uuid
    `);
    if (Number(state.n) >= CODE_ITEMS_MAX) return null;
    const [kept] = await tx.execute<Row>(sql`
      insert into commerce.signup_incentives (store_id, discount_id, email, form_id)
      values (${storeId}::uuid, ${discountId}::uuid, ${address}, ${formId.slice(0, 64)})
      on conflict (store_id, discount_id, email) do nothing
      returning id
    `);
    if (!kept) return null;
    // Every sign-up code of a discount shares one batch, so the code list shows them together.
    const batch = state.signup_batch == null ? Number(state.batch) + 1 : Number(state.signup_batch);
    for (let round = 0; round < 10; round++) {
      const code = generatedCode(discount.code, (n) => new Uint8Array(randomBytes(n)));
      const [item] = await tx.execute<Row>(sql`
        insert into commerce.discount_code_items (store_id, discount_id, code, batch)
        select ${storeId}::uuid, ${discountId}::uuid, ${code}, ${batch}
        where not exists (select 1 from commerce.discount_codes d where d.store_id = ${storeId}::uuid and d.code = ${code})
        on conflict (store_id, code) do nothing
        returning id
      `);
      if (!item) continue;
      await tx.execute(sql`update commerce.signup_incentives set code_item_id = ${String(item.id)}::uuid where id = ${String(kept.id)}::uuid`);
      return code;
    }
    throw new Error("No free code text after ten tries.");
  });
}
